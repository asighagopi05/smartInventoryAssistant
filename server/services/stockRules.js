/**
 * The stock rules, as pure functions.
 *
 * These are deliberately dependency-free so that BOTH the live stock service
 * and the seed's 90-day replay can call them. The previous build's worst bug
 * was having two copies of this logic - one that ran at seed time and one that
 * was supposed to run at runtime but never did - so the headline feature
 * existed only in the demo data. There is one copy here, and it cannot drift.
 */

/** Has this product crossed its reorder level? */
function shouldRestock(product, newStock) {
  return newStock <= product.threshold;
}

/** How much to ask the supplier for. */
function restockQty(product) {
  return Math.max(product.reorder_qty || 0, 1);
}

/**
 * A stock correction is allowed to differ from system stock by a little -
 * miscounts happen. Beyond a tolerance it stops being a correction and
 * becomes something a Manager should see, so it raises an adjustment request
 * instead of applying silently.
 *
 * Tolerance: 5% of system stock, or 3 units, whichever is larger.
 */
const TOLERANCE_PCT = 0.05;
const TOLERANCE_MIN_UNITS = 3;

function adjustmentTolerance(systemStock) {
  return Math.max(TOLERANCE_MIN_UNITS, Math.ceil(Math.abs(systemStock) * TOLERANCE_PCT));
}

function needsApproval(systemStock, countedStock) {
  return Math.abs(countedStock - systemStock) > adjustmentTolerance(systemStock);
}

module.exports = {
  shouldRestock,
  restockQty,
  adjustmentTolerance,
  needsApproval,
  TOLERANCE_PCT,
  TOLERANCE_MIN_UNITS,
};
