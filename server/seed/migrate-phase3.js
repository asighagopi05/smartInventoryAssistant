/* eslint-disable no-console */
/**
 * Brings a database seeded before Phase 3 up to the Phase 3 schema.
 *
 * A fresh `npm run seed` already produces this shape; this exists so a
 * database that has been used (bills rung up, counts recorded) does not have
 * to be thrown away. Safe to run more than once - every step checks first.
 *
 *   1. Stock adjustments were stored as plain restock requests. Tag them
 *      kind: 'adjustment' and recover counted_stock / difference from the note
 *      the old code wrote ("counted X against system Y (difference D)").
 *   2. Replace the one-open-request-per-product index with one per product
 *      AND kind, so a pending count no longer blocks the automatic reorder.
 *   3. Close open requests on deactivated products - stock cannot move on an
 *      inactive product, so they can never be received or applied.
 *
 * Anything it cannot fix safely is reported, not hidden.
 *
 * Run: npm run migrate   (from the repo root)
 */

require('dotenv').config({ path: `${__dirname}/../.env` });
const { connectDB, closeDB } = require('../config/db');
const { RestockRequest, Product } = require('../models');

const OLD_NOTE = /counted (\d+) against system (\d+) \(difference (-?\d+)\)/;

async function main() {
  await connectDB(process.env.MONGODB_URI);
  const coll = RestockRequest.collection;

  // -- 1. tag adjustments ----------------------------------------------------
  const legacy = await coll.find({ kind: { $exists: false } }).toArray();
  let tagged = 0;
  let restock = 0;
  const unparsed = [];
  for (const r of legacy) {
    const m = r.trigger === 'manual' && r.raised_by && OLD_NOTE.exec(r.note || '');
    if (m) {
      const [, counted, , diff] = m;
      const reason = (r.note || '').replace(/^Adjustment request: counted .*?\(difference -?\d+\)\.\s*/, '').trim();
      await coll.updateOne({ _id: r._id }, {
        $set: {
          kind: 'adjustment',
          counted_stock: Number(counted),
          difference: Number(diff),
          note: reason || null,
        },
      });
      tagged += 1;
    } else {
      if (r.trigger === 'manual' && r.raised_by) unparsed.push(r._id);
      await coll.updateOne({ _id: r._id }, { $set: { kind: 'restock' } });
      restock += 1;
    }
  }
  console.log(`[migrate] tagged ${tagged} adjustment(s), ${restock} restock request(s)`);
  if (unparsed.length) {
    console.log(`[migrate] WARNING: ${unparsed.length} manual request(s) had no readable count in the note; left as restock: ${unparsed.join(', ')}`);
  }

  // The old bug: an adjustment approved as if it were an order. Report it.
  const broken = await coll.find({ kind: 'adjustment', status: { $in: ['approved', 'received'] } }).toArray();
  if (broken.length) {
    console.log(`[migrate] WARNING: ${broken.length} adjustment(s) were approved under the old flow (status approved/received).`);
    console.log('          Their stock effect, if any, was a delivery, not the counted correction. Review by hand:');
    broken.forEach((b) => console.log(`          - ${b._id}  status ${b.status}  difference ${b.difference}`));
  }

  // -- 2. index -------------------------------------------------------------
  const indexes = await coll.indexes();
  if (indexes.some((i) => i.name === 'one_open_per_product')) {
    await coll.dropIndex('one_open_per_product');
    console.log('[migrate] dropped old index one_open_per_product');
  }
  await RestockRequest.syncIndexes();
  const names = (await coll.indexes()).map((i) => i.name);
  console.log(`[migrate] indexes now: ${names.join(', ')}`);
  if (!names.includes('one_open_per_product_kind')) throw new Error('one_open_per_product_kind index is missing');

  // -- 3. open requests on inactive products --------------------------------
  const inactive = await Product.find({ active: false }).distinct('_id');
  const closed = await coll.updateMany(
    { product_id: { $in: inactive }, status: { $in: ['pending', 'approved'] } },
    { $set: { status: 'rejected', approved_at: new Date(), note: 'Closed: product deactivated' } }
  );
  console.log(`[migrate] closed ${closed.modifiedCount} open request(s) on ${inactive.length} deactivated product(s)`);

  await closeDB();
  console.log('[migrate] done');
}

main().catch(async (err) => {
  console.error('[migrate] FAILED:', err);
  try { await closeDB(); } catch (_) { /* already closed */ }
  process.exit(1);
});
