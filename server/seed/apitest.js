/* eslint-disable no-console */
/**
 * Walks the Phase 1 verification list from docs/PLAN.md against the running API.
 *
 * This is the "does the implementation actually match the plan" check. It runs
 * against a live server on PORT, creates its own throwaway product so the
 * demo-parked products are left untouched, and deactivates it at the end.
 *
 * Run: npm run apitest   (with the server already running)
 */

require('dotenv').config({ path: `${__dirname}//../.env` });
const mongoose = require('mongoose');

const BASE = `http://localhost:${process.env.PORT || 5000}/api`;
const results = [];

const check = (name, ok, detail = '') => {
  results.push({ name, ok, detail });
  console.log(`  ${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? `  -> ${detail}` : ''}`);
};

async function call(path, { method = 'GET', token, body } = {}) {
  const res = await fetch(BASE + path, {
    method,
    headers: {
      'Content-Type': 'application/json',
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
    ...(body ? { body: JSON.stringify(body) } : {}),
  });
  let json = null;
  try { json = await res.json(); } catch (_) { /* empty body */ }
  return { status: res.status, body: json };
}

const login = async (email, password) => {
  const r = await call('/auth/login', { method: 'POST', body: { email, password } });
  if (r.status !== 200) throw new Error(`login failed for ${email}: ${JSON.stringify(r.body)}`);
  return r.body.token;
};

async function main() {
  console.log('\nVerifying the API against the Phase 1 plan\n');

  // -- 2. server is up -------------------------------------------------------
  const health = await call('/health');
  check('API responds on /api/health', health.status === 200);

  // -- 9. auth ---------------------------------------------------------------
  const ownerT = await login('owner@sia.local', 'Owner@123');
  const managerT = await login('manager@sia.local', 'Manager@123');
  const staffT = await login('staff1@sia.local', 'Staff@123');
  check('All three roles can sign in', Boolean(ownerT && managerT && staffT));

  const badLogin = await call('/auth/login', {
    method: 'POST', body: { email: 'staff1@sia.local', password: 'wrong' },
  });
  check('Wrong password is rejected', badLogin.status === 401);

  const tampered = `${staffT.slice(0, -4)}AAAA`;
  const tamperRes = await call('/auth/me', { token: tampered });
  check('Tampered JWT is rejected with 401', tamperRes.status === 401,
    `got ${tamperRes.status}`);

  const noToken = await call('/products');
  check('A protected route without a token returns 401', noToken.status === 401);

  // Manager-only route with a Staff token.
  const staffTriesApprove = await call('/products', {
    method: 'POST', token: staffT,
    body: { sku: 'X', name: 'X', category: 'Dairy', price: 1, threshold: 1, reorder_qty: 1, supplier_id: new mongoose.Types.ObjectId() },
  });
  check('Manager-only route with a Staff token returns 403', staffTriesApprove.status === 403,
    `got ${staffTriesApprove.status}`);

  // -- billing is denied to the Owner ---------------------------------------
  const suppliers = await call('/suppliers', { token: managerT });
  const supplierId = suppliers.body.suppliers[0]._id;
  const anyProduct = (await call('/products?limit=1', { token: managerT })).body.products[0];

  const ownerSale = await call('/sales', {
    method: 'POST', token: ownerT,
    body: { items: [{ productId: anyProduct._id, qty: 1 }] },
  });
  check('The Owner cannot bill a sale (403)', ownerSale.status === 403, `got ${ownerSale.status}`);

  // -- create a throwaway product so demo stock is untouched -----------------
  const made = await call('/products', {
    method: 'POST', token: managerT,
    body: {
      sku: `TEST-${Date.now()}`, name: 'Test Harness Product', category: 'Staples',
      unit: 'pc', price: 100, cost: 70, stock: 0, threshold: 5, reorder_qty: 40,
      supplier_id: supplierId,
    },
  });
  check('Manager can create a product', made.status === 201, `got ${made.status}`);
  const testProduct = made.body.product;

  // Give it stock through the stock service, one above threshold.
  await call('/stock/adjust', {
    method: 'POST', token: managerT,
    body: { productId: testProduct._id, quantityChange: 6, entryType: 'received', reason: 'Test harness opening stock' },
  });

  // -- 3. auto-restock, end to end ------------------------------------------
  const sale1 = await call('/sales', {
    method: 'POST', token: staffT,
    body: { items: [{ productId: testProduct._id, qty: 1 }] },
  });
  check('Staff can complete a sale', sale1.status === 201, `got ${sale1.status}`);
  check('Selling past the threshold raised a restock request automatically',
    sale1.body.restock_raised && sale1.body.restock_raised.length === 1,
    JSON.stringify(sale1.body.restock_raised));

  const openReqs = await call(`/restock?status=pending`, { token: managerT });
  const mine = openReqs.body.requests.filter((r) => String(r.product_id._id) === String(testProduct._id));
  check('The request was written by the server, not by a person',
    mine.length === 1 && mine[0].raised_by === null && mine[0].trigger === 'auto');

  // Sell again - must NOT raise a second request.
  const sale2 = await call('/sales', {
    method: 'POST', token: staffT,
    body: { items: [{ productId: testProduct._id, qty: 1 }] },
  });
  check('Selling again does NOT raise a duplicate request',
    sale2.status === 201 && sale2.body.restock_raised.length === 0);

  const stillOne = (await call('/restock?status=pending', { token: managerT }))
    .body.requests.filter((r) => String(r.product_id._id) === String(testProduct._id));
  check('Exactly one pending request exists for that product', stillOne.length === 1,
    `${stillOne.length} found`);

  // -- 4. receive stock ------------------------------------------------------
  const reqId = mine[0]._id;
  const approved = await call(`/restock/${reqId}/approve`, { method: 'POST', token: managerT, body: {} });
  check('Manager can approve the request', approved.status === 200 && approved.body.request.status === 'approved');

  const staffApprove = await call(`/restock/${reqId}/approve`, { method: 'POST', token: staffT, body: {} });
  check('Staff cannot approve a restock request (403)', staffApprove.status === 403);

  const received = await call(`/restock/${reqId}/receive`, { method: 'POST', token: managerT, body: {} });
  check('Receiving raises stock and closes the request',
    received.status === 200
    && received.body.request.status === 'received'
    && received.body.stock_after === received.body.stock_before + received.body.request.qty,
    `${received.body.stock_before} -> ${received.body.stock_after}`);

  // -- 5. walk-in sale -------------------------------------------------------
  const walkIn = await call('/sales', {
    method: 'POST', token: staffT,
    body: { items: [{ productId: testProduct._id, qty: 1 }] },
  });
  check('A sale with no phone completes normally (walk-in)',
    walkIn.status === 201 && walkIn.body.sale.customer_id === null);

  // -- 6. customer created at the till ---------------------------------------
  const phone = `9${String(Date.now()).slice(-9)}`;
  const till1 = await call('/sales', {
    method: 'POST', token: staffT,
    body: { items: [{ productId: testProduct._id, qty: 1 }], customer: { phone, name: 'Test Customer' } },
  });
  check('An unknown phone creates the customer as part of the sale',
    till1.status === 201 && till1.body.customer && till1.body.customer.phone === phone);

  const till2 = await call('/sales', {
    method: 'POST', token: staffT,
    body: { items: [{ productId: testProduct._id, qty: 1 }], customer: { phone, name: 'Test Customer Corrected' } },
  });
  check('Billing the same phone again updates rather than duplicating',
    till2.status === 201 && String(till2.body.customer._id) === String(till1.body.customer._id));

  const lookup = await call(`/customers/by-phone/${phone}`, { token: staffT });
  check('The customer now shows two visits and the corrected name',
    lookup.body.customer.visits === 2 && lookup.body.customer.name === 'Test Customer Corrected',
    `visits=${lookup.body.customer.visits}, name=${lookup.body.customer.name}`);

  // -- 7. phone edit keeps history -------------------------------------------
  const customerId = till1.body.customer._id;
  const newPhone = `8${String(Date.now()).slice(-9)}`;
  const edited = await call(`/customers/${customerId}`, {
    method: 'PATCH', token: managerT, body: { phone: newPhone },
  });
  check('Manager can change a customer phone number', edited.status === 200);

  const after = await call(`/customers/${customerId}`, { token: managerT });
  check('Past sales still appear in that customer history after the phone change',
    after.body.sales.length === 2,
    `${after.body.sales.length} sales still linked`);
  check('Old bills still show the number that was printed on them',
    after.body.sales.every((s) => s.customer_phone === phone),
    'customer_phone snapshot preserved');

  const staffEdit = await call(`/customers/${customerId}`, {
    method: 'PATCH', token: staffT, body: { name: 'Nope' },
  });
  check('Staff cannot edit customer records (403)', staffEdit.status === 403);

  // -- 8. public QR feedback, no auth ---------------------------------------
  const ctx = await call(`/feedback/public/context?product=${testProduct._id}`);
  check('Public feedback context loads with NO token and no redirect',
    ctx.status === 200 && ctx.body.product !== null);

  const anon = await call('/feedback/public', {
    method: 'POST',
    body: { productId: testProduct._id, rating: 5, comment: 'Anonymous test feedback' },
  });
  check('Feedback can be submitted with no phone at all', anon.status === 201);

  const linked = await call('/feedback/public', {
    method: 'POST',
    body: { productId: testProduct._id, rating: 4, comment: 'Linked test feedback', phone: newPhone },
  });
  check('Feedback with a known phone is accepted', linked.status === 201);

  const badReview = await call('/feedback/public', {
    method: 'POST',
    body: { productId: testProduct._id, rating: 2, comment: 'Two star test' },
  });
  check('A 2-star review is accepted', badReview.status === 201);

  const notifs = await call('/notifications', { token: managerT });
  check('The 2-star review fired a notification to the Manager',
    notifs.body.notifications.some((n) => n.type === 'bad_review'));

  const invalidRating = await call('/feedback/public', {
    method: 'POST', body: { productId: testProduct._id, rating: 9 },
  });
  check('An out-of-range rating is rejected', invalidRating.status === 400);

  // -- QR generation ---------------------------------------------------------
  const qr = await call(`/feedback/qr?type=product&id=${testProduct._id}`, { token: managerT });
  check('Product QR is generated server-side as a data URL',
    qr.status === 200 && String(qr.body.dataUrl).startsWith('data:image/png;base64,'),
    qr.body.target);

  // -- stock guards ----------------------------------------------------------
  const oversell = await call('/sales', {
    method: 'POST', token: staffT,
    body: { items: [{ productId: testProduct._id, qty: 99999 }] },
  });
  check('Overselling is refused (409) rather than going negative', oversell.status === 409);

  // -- adjustment tolerance --------------------------------------------------
  const tol = await call(`/stock/tolerance/${testProduct._id}`, { token: staffT });
  const current = tol.body.system_stock;
  const smallCount = await call('/stock/count', {
    method: 'POST', token: staffT,
    body: { productId: testProduct._id, countedStock: current - 1, reason: 'Small miscount' },
  });
  check('A count within tolerance applies immediately', smallCount.body.applied === true);

  const bigCount = await call('/stock/count', {
    method: 'POST', token: staffT,
    body: { productId: testProduct._id, countedStock: 1, reason: 'Large discrepancy' },
  });
  check('A count beyond tolerance raises an approval instead of applying',
    bigCount.body.applied === false && bigCount.body.needsApproval === true);

  // -- dashboard -------------------------------------------------------------
  const dash = await call('/dashboard', { token: ownerT });
  check('Dashboard aggregates load for the Owner',
    dash.status === 200 && dash.body.totals.products > 0 && dash.body.sales_by_day.length > 0,
    `${dash.body.sales_by_day?.length} days of sales`);

  // -- cleanup ---------------------------------------------------------------
  await call(`/products/${testProduct._id}`, { method: 'DELETE', token: managerT });
  const gone = await call(`/products/${testProduct._id}`, { token: managerT });
  check('Deleting a product deactivates it rather than removing it',
    gone.status === 200 && gone.body.product.active === false);

  // --------------------------------------------------------------------------
  const failed = results.filter((r) => !r.ok);
  console.log(`\n${results.length - failed.length}/${results.length} checks passed`);
  if (failed.length) {
    console.log('\nFAILED:');
    failed.forEach((f) => console.log(`  - ${f.name}${f.detail ? ` (${f.detail})` : ''}`));
  }
  console.log('');
  process.exit(failed.length ? 1 : 0);
}

main().catch((err) => {
  console.error('\n[apitest] ERROR:', err.message);
  process.exit(1);
});
