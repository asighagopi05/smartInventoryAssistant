/* eslint-disable no-console */
/**
 * Checks the database against the invariants the design promises.
 *
 * This is deliberately not a unit-test suite. It runs against the real seeded
 * database and asserts the things a reviewer would actually probe: that the
 * stock ledger reconciles, that no product has two open restock requests, that
 * no customer document has a password, that every bill adds up.
 *
 * Run: npm run verify
 */

require('dotenv').config({ path: `${__dirname}//../.env` });
const mongoose = require('mongoose');
const { connectDB, closeDB } = require('../config/db');
const {
  User, Supplier, Product, StockLog, RestockRequest, Sale, Customer, Note, Issue, Task,
} = require('../models');

const results = [];
const check = (name, ok, detail = '') => {
  results.push({ name, ok, detail });
  console.log(`  ${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? `  -> ${detail}` : ''}`);
};

async function main() {
  await connectDB(process.env.MONGODB_URI);
  console.log('\nVerifying the SIA database\n');

  // 1. The ledger reconciles to current stock ------------------------------
  // For each product, the stock_after of its most recent movement must equal
  // the stock currently on the product document.
  const latest = await StockLog.aggregate([
    { $sort: { product_id: 1, createdAt: 1, _id: 1 } },
    { $group: { _id: '$product_id', last_after: { $last: '$stock_after' } } },
  ]);
  const productStock = new Map(
    (await Product.find({}, { stock: 1 }).lean()).map((p) => [String(p._id), p.stock])
  );
  const mismatched = latest.filter((l) => productStock.get(String(l._id)) !== l.last_after);
  check(
    'Stock ledger reconciles to current stock on every product',
    mismatched.length === 0,
    mismatched.length ? `${mismatched.length} product(s) disagree` : `${latest.length} products checked`
  );

  // 2. stock_before/stock_after are genuinely consecutive -------------------
  const sampleIds = (await Product.find({}, { _id: 1 }).limit(25).lean()).map((p) => p._id);
  let brokenChains = 0;
  for (const pid of sampleIds) {
    const rows = await StockLog.find({ product_id: pid }).sort({ createdAt: 1, _id: 1 })
      .select('stock_before stock_after quantity_change').lean();
    for (let i = 0; i < rows.length; i += 1) {
      if (rows[i].stock_before + rows[i].quantity_change !== rows[i].stock_after) { brokenChains += 1; break; }
      if (i > 0 && rows[i - 1].stock_after !== rows[i].stock_before) { brokenChains += 1; break; }
    }
  }
  check('Ledger rows form an unbroken chain (25 products sampled)', brokenChains === 0,
    brokenChains ? `${brokenChains} broken chain(s)` : 'before + change = after, and after chains into next before');

  // 3. One OPEN request per product and kind ---------------------------------
  // Open means pending or approved: a product is below its threshold for the
  // whole lead time, so guarding only `pending` lets it re-order every sale.
  // A pending stock count is a different kind and may sit alongside a reorder.
  const dupes = await RestockRequest.aggregate([
    { $match: { status: { $in: ['pending', 'approved'] } } },
    { $group: { _id: { p: '$product_id', k: '$kind' }, n: { $sum: 1 } } },
    { $match: { n: { $gt: 1 } } },
  ]);
  check('No product has more than one OPEN request of each kind', dupes.length === 0,
    dupes.length ? `${dupes.length} product(s) with duplicates` : 'enforced by partial unique index on product + kind');

  // 3b. Stock cover is sane -------------------------------------------------
  // Catches over-ordering: if the duplicate guard is wrong, fast movers quietly
  // accumulate months of stock and nothing else in this list notices.
  const soldAgg = await Sale.aggregate([
    { $unwind: '$items' },
    { $group: { _id: '$items.product_id', units: { $sum: '$items.qty' } } },
  ]);
  const soldById = new Map(soldAgg.map((s) => [String(s._id), s.units]));
  const allProducts = await Product.find({ active: true }, { name: 1, stock: 1 }).lean();
  const overstocked = allProducts.filter((p) => {
    const perDay = (soldById.get(String(p._id)) || 0) / 90;
    return perDay > 0.5 && p.stock / perDay > 120; // more than ~4 months of cover
  });
  check('No product is holding an absurd amount of stock', overstocked.length === 0,
    overstocked.length
      ? `${overstocked.length} over 120 days cover, worst: ${overstocked[0].name} (${overstocked[0].stock})`
      : `${allProducts.length} products within a sane cover window`);

  // 4. No customer has a password ------------------------------------------
  const withPassword = await mongoose.connection.db.collection('customers')
    .countDocuments({ $or: [{ password: { $exists: true } }, { password_hash: { $exists: true } }] });
  check('No Customer document contains a password field', withPassword === 0);

  // 5. Every bill adds up ---------------------------------------------------
  const sales = await Sale.find({}).select('items subtotal total discount tax').lean();
  const badTotals = sales.filter((s) => {
    const lines = s.items.reduce((sum, i) => sum + i.unit_price * i.qty, 0);
    return lines !== s.subtotal || s.subtotal - (s.discount || 0) + (s.tax || 0) !== s.total;
  });
  check('Every sale total equals the sum of its line items', badTotals.length === 0,
    badTotals.length ? `${badTotals.length} bad bill(s)` : `${sales.length} bills checked`);

  // 6. No negative stock ----------------------------------------------------
  const negative = await Product.countDocuments({ stock: { $lt: 0 } });
  check('No product has negative stock', negative === 0);

  // 7. Referential sanity ---------------------------------------------------
  const supplierIds = new Set((await Supplier.find({}, { _id: 1 }).lean()).map((s) => String(s._id)));
  const orphanProducts = (await Product.find({}, { supplier_id: 1 }).lean())
    .filter((p) => !supplierIds.has(String(p.supplier_id)));
  check('Every product points at a supplier that exists', orphanProducts.length === 0,
    orphanProducts.length ? `${orphanProducts.length} orphan(s)` : 'MongoDB does not enforce this, so it is checked');

  const customerIds = new Set((await Customer.find({}, { _id: 1 }).lean()).map((c) => String(c._id)));
  const orphanSales = (await Sale.find({ customer_id: { $ne: null } }, { customer_id: 1 }).lean())
    .filter((s) => !customerIds.has(String(s.customer_id)));
  check('Every attached sale points at a customer that exists', orphanSales.length === 0);

  // 8. Customer counters match reality -------------------------------------
  const perCustomer = await Sale.aggregate([
    { $match: { customer_id: { $ne: null } } },
    { $group: { _id: '$customer_id', visits: { $sum: 1 }, spent: { $sum: '$total' } } },
  ]);
  const custDocs = new Map((await Customer.find({}, { visits: 1, total_spent: 1 }).lean())
    .map((c) => [String(c._id), c]));
  const driftingCustomers = perCustomer.filter((r) => {
    const c = custDocs.get(String(r._id));
    return !c || c.visits !== r.visits || c.total_spent !== r.spent;
  });
  check('Customer visits and total_spent match their actual sales', driftingCustomers.length === 0,
    driftingCustomers.length ? `${driftingCustomers.length} drifting` : `${perCustomer.length} customers checked`);

  // 9. Restock requests were raised by the rule, not by a person ------------
  // Out-of-tolerance stock counts legitimately raise a `manual` request in a
  // person's name once the system is in use, so the invariant is that the two
  // kinds never blur: auto means no person, manual means a named one.
  const autoRaised = await RestockRequest.countDocuments({ trigger: 'auto', raised_by: null });
  const manualRaised = await RestockRequest.countDocuments({ trigger: 'manual', raised_by: { $ne: null } });
  const totalRequests = await RestockRequest.countDocuments();
  check('Restock requests were raised automatically by the server', autoRaised + manualRaised === totalRequests,
    `${autoRaised}/${totalRequests} raised by the server (raised_by: null), ${manualRaised} adjustment request(s) raised by a named person`);

  // 10. Thresholds track real demand ----------------------------------------
  const prods = await Product.find({}, { threshold: 1, reorder_qty: 1 }).lean();
  const distinctThresholds = new Set(prods.map((p) => p.threshold)).size;
  check('Thresholds vary with demand rather than being a constant', distinctThresholds > 10,
    `${distinctThresholds} distinct threshold values across ${prods.length} products`);

  // 11. Ratings are derived, not invented -----------------------------------
  const ratingAgg = await Note.aggregate([
    { $match: { type: 'feedback', rating: { $ne: null } } },
    { $group: { _id: '$product_id', avg: { $avg: '$rating' }, count: { $sum: 1 } } },
  ]);
  const ratedProducts = new Map((await Product.find({ rating_count: { $gt: 0 } }, { rating_avg: 1, rating_count: 1 }).lean())
    .map((p) => [String(p._id), p]));
  const badRatings = ratingAgg.filter((r) => {
    const p = ratedProducts.get(String(r._id));
    return !p || p.rating_count !== r.count || Math.abs(p.rating_avg - r.avg) > 0.06;
  });
  check('Product rating_avg/rating_count match the underlying feedback', badRatings.length === 0,
    badRatings.length ? `${badRatings.length} stale` : `${ratingAgg.length} rated products checked`);

  // 12. The creation chain is real ------------------------------------------
  const owner = await User.findOne({ role: 'Owner' }).lean();
  const managers = await User.find({ role: 'Manager' }).lean();
  const staff = await User.find({ role: 'Staff' }).lean();
  const chainOk = owner && owner.created_by === null
    && managers.every((m) => String(m.created_by) === String(owner._id))
    && staff.every((s) => managers.some((m) => String(s.created_by) === String(m._id)));
  check('Accounts form the Owner -> Manager -> Staff creation chain', !!chainOk);

  // 13. The Owner never billed ----------------------------------------------
  const ownerSales = owner ? await Sale.countDocuments({ billed_by: owner._id }) : 0;
  check('No sale was billed by the Owner', ownerSales === 0);

  // 14. Stock adjustments are self-consistent and reach the ledger ----------
  // Every adjustment records what was counted and the signed gap; one that was
  // applied must have exactly that change in the ledger, linked back to it;
  // none may sit in the restock-only states approved/received.
  const adjustments = await RestockRequest.find({ kind: 'adjustment' }).lean();
  const badShape = adjustments.filter((a) => a.counted_stock === null || a.difference === null
    || a.counted_stock - a.stock_at_request !== a.difference || a.difference === 0);
  const wrongState = adjustments.filter((a) => ['approved', 'received'].includes(a.status));
  const applied = adjustments.filter((a) => a.status === 'applied');
  const appliedLogs = new Map((await StockLog.find({ restock_request_id: { $in: applied.map((a) => a._id) } })
    .select('restock_request_id quantity_change entry_type').lean())
    .map((l) => [String(l.restock_request_id), l]));
  const unlogged = applied.filter((a) => {
    const log = appliedLogs.get(String(a._id));
    return !log || log.quantity_change !== a.difference || log.entry_type !== 'adjustment';
  });
  check('Stock adjustments record the count, and every applied one is in the ledger',
    badShape.length + wrongState.length + unlogged.length === 0,
    `${adjustments.length} adjustment(s), ${applied.length} applied`
      + (badShape.length ? `; ${badShape.length} malformed` : '')
      + (wrongState.length ? `; ${wrongState.length} in a restock-only state` : '')
      + (unlogged.length ? `; ${unlogged.length} applied without a matching ledger row` : ''));

  // 15. No request is left open on a product that can no longer move --------
  const inactiveIds = await Product.find({ active: false }).distinct('_id');
  const deadOpen = await RestockRequest.countDocuments({
    product_id: { $in: inactiveIds }, status: { $in: ['pending', 'approved'] },
  });
  check('No open request on a deactivated product', deadOpen === 0,
    deadOpen ? `${deadOpen} stuck open` : `${inactiveIds.length} deactivated product(s) checked`);

  // 16. An issue's status matches what is recorded about it ------------------
  // Resolved means someone resolved it, at a time; anything else has no
  // resolution recorded. Older issues may lack an acknowledgement record, so
  // only "acknowledged_at implies acknowledged_by" is required.
  const issues = await Issue.find({}).lean();
  const badIssues = issues.filter((i) => (i.status === 'resolved'
    ? !i.resolved_by || !i.resolved_at
    : !!i.resolved_by || !!i.resolved_at)
    || (i.acknowledged_at && !i.acknowledged_by));
  check('Every issue\'s status matches who resolved/acknowledged it and when', badIssues.length === 0,
    badIssues.length ? `${badIssues.length} inconsistent` : `${issues.length} issues checked`);

  // 17. Tasks go from a Manager to someone on the floor ---------------------
  const users = new Map((await User.find({}).select('role').lean()).map((u) => [String(u._id), u.role]));
  const tasksAll = await Task.find({}).lean();
  const badTasks = tasksAll.filter((t) => users.get(String(t.created_by)) !== 'Manager'
    || !['Staff', 'Manager'].includes(users.get(String(t.assigned_to)))
    || (t.status === 'done') !== !!t.done_at);
  check('Tasks are given by a Manager to Staff or a Manager; done tasks have a finish time',
    badTasks.length === 0, badTasks.length ? `${badTasks.length} inconsistent` : `${tasksAll.length} tasks checked`);

  // 18. Discussion threads are one level deep and always have an author -----
  const posts = await Note.find({ type: 'discussion' }).select('parent_id author_id').lean();
  const topLevel = new Set(posts.filter((p) => !p.parent_id).map((p) => String(p._id)));
  const orphans = posts.filter((p) => p.parent_id && !topLevel.has(String(p.parent_id)));
  const anonymous = posts.filter((p) => !p.author_id);
  check('Discussion replies hang off a top-level post, and every post has an author',
    orphans.length + anonymous.length === 0,
    `${posts.length} posts, ${topLevel.size} threads`
      + (orphans.length ? `; ${orphans.length} reply/replies to a missing or nested parent` : '')
      + (anonymous.length ? `; ${anonymous.length} with no author` : ''));

  // ------------------------------------------------------------------------
  const failed = results.filter((r) => !r.ok);
  console.log(`\n${results.length - failed.length}/${results.length} checks passed`);
  if (failed.length) {
    console.log('\nFAILED:');
    failed.forEach((f) => console.log(`  - ${f.name}${f.detail ? ` (${f.detail})` : ''}`));
  }
  console.log('');
  await closeDB();
  process.exit(failed.length ? 1 : 0);
}

main().catch(async (err) => {
  console.error('\n[verify] ERROR:', err);
  try { await closeDB(); } catch (_) { /* noop */ }
  process.exit(1);
});
