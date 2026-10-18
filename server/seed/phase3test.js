/* eslint-disable no-console */
/**
 * Walks the Phase 3 verification list from docs/PLAN.md against the running API,
 * plus the edge cases each workflow has to get right.
 *
 * Like apitest, it creates its own throwaway product so the demo data is left
 * alone, and deactivates it at the end. The issues, tasks and posts it creates
 * are titled "[test]" and closed before it finishes.
 *
 * Run: npm run phase3test   (with the server already running)
 */

require('dotenv').config({ path: `${__dirname}/../.env` });

const BASE = `http://localhost:${process.env.PORT || 5000}/api`;
const results = [];

const check = (name, ok, detail = '') => {
  results.push({ name, ok, detail });
  console.log(`  ${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? `  -> ${detail}` : ''}`);
};
const heading = (text) => console.log(`\n-- ${text} ${'-'.repeat(Math.max(0, 66 - text.length))}`);

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
  try { json = await res.json(); } catch { /* empty body */ }
  return { status: res.status, body: json };
}

const login = async (email, password) => {
  const r = await call('/auth/login', { method: 'POST', body: { email, password } });
  if (r.status !== 200) throw new Error(`login failed for ${email}: ${JSON.stringify(r.body)}`);
  return { token: r.body.token, user: r.body.user };
};

const stockOf = async (token, id) => (await call(`/products/${id}`, { token })).body.product.stock;

async function main() {
  console.log('\nVerifying Phase 3 against the running API');

  const owner = await login('owner@sia.local', 'Owner@123');
  const manager = await login('manager@sia.local', 'Manager@123');
  const staff = await login('staff1@sia.local', 'Staff@123');
  const staff2 = await login('staff2@sia.local', 'Staff@123');

  const suppliers = await call('/suppliers', { token: manager.token });
  const made = await call('/products', {
    method: 'POST', token: manager.token,
    body: {
      sku: `P3TEST-${Date.now()}`, name: 'Phase 3 Test Product', category: 'Household', unit: 'pc',
      price: 50, cost: 30, stock: 0, threshold: 5, reorder_qty: 40,
      supplier_id: suppliers.body.suppliers[0]._id,
    },
  });
  if (made.status !== 201) throw new Error(`could not create the test product: ${JSON.stringify(made.body)}`);
  const product = made.body.product;
  await call('/stock/adjust', {
    method: 'POST', token: manager.token,
    body: { productId: product._id, quantityChange: 10, entryType: 'received', reason: 'Phase 3 test opening stock' },
  });

  try {
    await adjustments({ owner, manager, staff, product });
    await issues({ owner, manager, staff, staff2, product });
    await tasks({ owner, manager, staff, staff2, product });
    await discussion({ owner, manager, staff, staff2 });
    await notificationCentre({ manager, staff, staff2 });
  } finally {
    // -- cleanup: deactivating closes the product's open requests ---------------
    heading('Cleanup');
    const del = await call(`/products/${product._id}`, { method: 'DELETE', token: manager.token });
    const left = await call('/restock?kind=adjustment&status=pending&limit=500', { token: manager.token });
    const leftRestock = await call('/restock?status=open&limit=500', { token: manager.token });
    const stillOpen = [...left.body.requests, ...leftRestock.body.requests]
      .filter((r) => String(r.product_id?._id) === String(product._id));
    check('Deactivating a product closes its open requests', del.status === 200 && stillOpen.length === 0,
      `${del.body?.closed_requests} closed, ${stillOpen.length} still open`);
  }

  const failed = results.filter((r) => !r.ok);
  console.log(`\n${results.length - failed.length}/${results.length} checks passed`);
  if (failed.length) {
    console.log('\nFAILED:');
    failed.forEach((f) => console.log(`  - ${f.name}${f.detail ? ` (${f.detail})` : ''}`));
  }
  console.log('');
  process.exit(failed.length ? 1 : 0);
}

// ---------------------------------------------------------------------------
// 3.3  Adjustment requests
// ---------------------------------------------------------------------------
async function adjustments({ manager, staff, product }) {
  heading('3.3  Stock counts beyond tolerance need the Manager');
  const pid = product._id;
  const start = await stockOf(manager.token, pid);

  const big = await call('/stock/count', {
    method: 'POST', token: staff.token,
    body: { productId: pid, countedStock: start - 8, reason: '[test] shelf short' },
  });
  const req = big.body?.request;
  check('An out-of-tolerance count raises an adjustment instead of applying',
    big.status === 200 && big.body.applied === false && req?.kind === 'adjustment',
    `system ${start}, counted ${start - 8}, kind ${req?.kind}`);
  check('Stock is unchanged until the Manager decides', (await stockOf(manager.token, pid)) === start);
  check('The adjustment records the count and the signed difference',
    req?.counted_stock === start - 8 && req?.difference === -8 && req?.stock_at_request === start,
    `counted ${req?.counted_stock}, difference ${req?.difference}`);

  const again = await call('/stock/count', {
    method: 'POST', token: staff.token,
    body: { productId: pid, countedStock: 0, reason: '[test] second count' },
  });
  check('A second count while one is waiting is refused (409)', again.status === 409, again.body?.error);

  // Before Phase 3 a pending adjustment held the product's only open slot, so
  // crossing the threshold here would have raised NO restock request.
  const sale = await call('/sales', {
    method: 'POST', token: staff.token,
    body: { items: [{ productId: pid, qty: start - 5 }] },
  });
  check('A pending count does not block the automatic restock',
    sale.status === 201 && sale.body.restock_raised?.length === 1,
    `${sale.body?.restock_raised?.length ?? 0} restock request(s) raised at stock 5`);

  const queue = await call('/restock?kind=adjustment&status=pending', { token: manager.token });
  const restockQueue = await call('/restock?status=pending', { token: manager.token });
  check('Adjustments and restock orders are listed separately',
    queue.body.requests.some((r) => r._id === req._id)
      && !restockQueue.body.requests.some((r) => r._id === req._id)
      && restockQueue.body.pending_adjustments >= 1,
    `${queue.body.requests.length} adjustment(s) waiting`);

  const staffApprove = await call(`/restock/${req._id}/approve`, { method: 'POST', token: staff.token, body: { approve: true } });
  check('Staff cannot approve an adjustment (403)', staffApprove.status === 403);

  // Stock is now 5 and the count says 8 fewer: applying would go negative.
  const tooFar = await call(`/restock/${req._id}/approve`, { method: 'POST', token: manager.token, body: { approve: true } });
  check('Approving a correction larger than current stock is refused, not clamped (409)',
    tooFar.status === 409, tooFar.body?.error);
  check('...and the refused approval left the request pending',
    (await call('/restock?kind=adjustment&status=pending', { token: manager.token }))
      .body.requests.some((r) => r._id === req._id));

  const rejected = await call(`/restock/${req._id}/approve`, { method: 'POST', token: manager.token, body: { approve: false } });
  check('The Manager can reject a count; stock is unchanged',
    rejected.status === 200 && rejected.body.request.status === 'rejected' && (await stockOf(manager.token, pid)) === 5,
    `status ${rejected.body?.request?.status}`);

  const staffNotes = await call('/notifications?limit=50', { token: staff.token });
  check('The person who counted is told it was rejected',
    staffNotes.body.notifications.some((n) => n.type === 'adjustment_decided' && String(n.ref_id) === req._id && /rejected/.test(n.title)));

  // -- approve a shortage ----------------------------------------------------
  const short = await call('/stock/count', {
    method: 'POST', token: staff.token, body: { productId: pid, countedStock: 1, reason: '[test] four missing' },
  });
  const sreq = short.body.request;
  const before = await stockOf(manager.token, pid);
  const ok = await call(`/restock/${sreq._id}/approve`, { method: 'POST', token: manager.token, body: { approve: true } });
  const after = await stockOf(manager.token, pid);
  check('Approving a shortage REMOVES the difference from stock',
    ok.status === 200 && ok.body.request.status === 'applied' && after === before - 4,
    `${before} -> ${after}, status ${ok.body?.request?.status}`);
  check('No forecast is recorded for an adjustment (it is not an order)', ok.body.forecast === null);

  const logs = await call(`/stock/logs?product=${pid}&limit=5`, { token: manager.token });
  const row = logs.body.logs[0];
  check('The ledger row is an adjustment, in the counter\'s name, citing the approver',
    row.entry_type === 'adjustment' && row.quantity_change === -4
      && String(row.user_id?._id) === String(staff.user.id) && /approved by/i.test(row.reason),
    `${row.entry_type} ${row.quantity_change} by ${row.user_id?.name}: "${row.reason}"`);

  const receive = await call(`/restock/${sreq._id}/receive`, { method: 'POST', token: manager.token, body: {} });
  check('An adjustment can never be "received" as a delivery', receive.status === 400, receive.body?.error);

  // -- approve a surplus -----------------------------------------------------
  const surplus = await call('/stock/count', {
    method: 'POST', token: staff.token, body: { productId: pid, countedStock: after + 6, reason: '[test] found a carton' },
  });
  const plus = await call(`/restock/${surplus.body.request._id}/approve`, { method: 'POST', token: manager.token, body: { approve: true } });
  check('Approving a surplus adds the difference',
    plus.status === 200 && (await stockOf(manager.token, pid)) === after + 6, `${after} -> ${after + 6}`);

  // -- the direct-adjust route obeys the same tolerance ----------------------
  const sneak = await call('/stock/adjust', {
    method: 'POST', token: staff.token,
    body: { productId: pid, quantityChange: -6, entryType: 'damage', reason: '[test] large write-off' },
  });
  check('Staff cannot write off more than the tolerance directly (403)', sneak.status === 403, sneak.body?.error);
  const small = await call('/stock/adjust', {
    method: 'POST', token: staff.token,
    body: { productId: pid, quantityChange: -1, entryType: 'damage', reason: '[test] one damaged' },
  });
  check('A write-off within tolerance still applies', small.status === 200, `stock now ${small.body?.stock_after}`);
}

// ---------------------------------------------------------------------------
// The sections below are filled in as each Phase 3 step lands.
// ---------------------------------------------------------------------------
async function issues() {}
async function tasks() {}
async function discussion() {}
async function notificationCentre() {}

main().catch((err) => {
  console.error('\n[phase3test] ERROR:', err);
  process.exit(1);
});
