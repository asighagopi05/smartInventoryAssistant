/**
 * Money is stored as an integer number of paise, never as a float.
 *
 * Repeatedly summing floating-point rupees across a bill's items, and then
 * across 90 days of bills, accumulates error until the totals stop reconciling.
 * Integers cannot drift.
 *
 * Design note: these fields have a GETTER but deliberately no setter. A setter
 * would re-multiply values that are already in paise whenever a pre-save hook
 * recomputes a total from other stored fields - a subtle double-conversion bug.
 * Instead, conversion happens explicitly at the API edge via toPaise(), and
 * everything inside the model layer speaks paise.
 *
 * Aggregation pipelines bypass getters too, so they also work in paise -
 * divide once at the end of the pipeline, not per document.
 */

/** Rupees (what a user types) -> paise (what we store). */
const toPaise = (rupees) => {
  if (rupees === null || rupees === undefined || rupees === '') return rupees;
  return Math.round(Number(rupees) * 100);
};

/** Paise -> rupees, for display. */
const toRupees = (paise) => {
  if (paise === null || paise === undefined) return paise;
  return paise / 100;
};

/** Format for screens and printed bills. */
const formatINR = (paise) =>
  new Intl.NumberFormat('en-IN', { style: 'currency', currency: 'INR' }).format(toRupees(paise) || 0);

/** Schema fragment for a money field, stored in paise. */
const money = (options = {}) => ({
  type: Number,
  min: 0,
  get: toRupees,
  ...options,
});

/** Schemas holding money need getters applied on serialisation. */
const withGetters = {
  toJSON: { getters: true, virtuals: true },
  toObject: { getters: true, virtuals: true },
};

module.exports = { toPaise, toRupees, formatINR, money, withGetters };
