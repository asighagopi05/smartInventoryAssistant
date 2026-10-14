const router = require('express').Router();
const asyncHandler = require('../utils/asyncHandler');
const { requireAuth, requireRole } = require('../middleware/auth');
const { Sale, Product, ComboCache } = require('../models');

router.use(requireAuth, requireRole('Owner', 'Manager'));

const WINDOW_DAYS = 30;
const MIN_RATINGS = 3;   // fewer than this and one angry customer decides the verdict
const GOOD_RATING = 3.5;

/**
 * Sales and QR ratings side by side. A product that sells badly is either
 * unwanted (customers who try it rate it low - a delisting candidate) or
 * unseen (customers who try it like it - a pairing problem: put it next to
 * something that sells). Sales alone cannot tell those two apart.
 */
const GROUPS = {
  star: { label: 'Star', advice: 'Sells well and customers like it. Keep it stocked.' },
  fix: { label: 'Fix quality', advice: 'Sells well but rates poorly. Check the supplier or the product.' },
  pair: { label: 'Pairing problem', advice: 'Customers like it but few buy it. Place it next to its combo partner.' },
  delist: { label: 'Delisting candidate', advice: 'Sells little and rates poorly.' },
  unrated: { label: 'Not enough ratings', advice: `Needs at least ${MIN_RATINGS} QR ratings before it can be judged.` },
};

// GET /api/insights/performance
router.get('/performance', asyncHandler(async (_req, res) => {
  // The 30 days up to the most recent sale, so the screen still means
  // something if the shop has not billed anything for a few days.
  const latest = await Sale.findOne().sort({ createdAt: -1 }).select('createdAt').lean();
  const to = latest ? latest.createdAt : new Date();
  const from = new Date(to.getTime() - WINDOW_DAYS * 24 * 60 * 60 * 1000);

  const [sold, products, combos] = await Promise.all([
    Sale.aggregate([
      { $match: { createdAt: { $gte: from, $lte: to } } },
      { $unwind: '$items' },
      { $group: { _id: '$items.product_id', units: { $sum: '$items.qty' }, revenue: { $sum: '$items.line_total' }, bills: { $sum: 1 } } },
    ]),
    Product.find({ active: true }).select('name sku category rating_avg rating_count stock').lean(),
    ComboCache.findById('latest').select('rules').lean(),
  ]);

  const soldBy = new Map(sold.map((s) => [String(s._id), s]));
  const unitsSorted = products.map((p) => soldBy.get(String(p._id))?.units || 0).sort((a, b) => a - b);
  const medianUnits = unitsSorted.length ? unitsSorted[Math.floor(unitsSorted.length / 2)] : 0;

  // Best combo partner per product, by lift, from the last combo run
  const partnerOf = new Map();
  for (const r of combos?.rules || []) {
    for (const [self, other] of [[r.if_bought, r.also_bought], [r.also_bought, r.if_bought]]) {
      if (!partnerOf.has(self) || partnerOf.get(self).lift < r.lift) partnerOf.set(self, { name: other, lift: r.lift });
    }
  }

  const rows = products.map((p) => {
    const s = soldBy.get(String(p._id));
    const units = s?.units || 0;
    const highSales = units >= medianUnits;
    let group;
    if (p.rating_count < MIN_RATINGS) group = 'unrated';
    else if (p.rating_avg >= GOOD_RATING) group = highSales ? 'star' : 'pair';
    else group = highSales ? 'fix' : 'delist';
    return {
      _id: p._id,
      name: p.name,
      sku: p.sku,
      category: p.category,
      units,
      bills: s?.bills || 0,
      revenue: (s?.revenue || 0) / 100, // paise -> rupees
      rating_avg: p.rating_avg,
      rating_count: p.rating_count,
      group,
      partner: group === 'pair' ? partnerOf.get(p.name) || null : null,
    };
  });

  const counts = Object.fromEntries(Object.keys(GROUPS).map((g) => [g, rows.filter((r) => r.group === g).length]));
  res.json({
    window: { from, to, days: WINDOW_DAYS },
    rules: { median_units: medianUnits, min_ratings: MIN_RATINGS, good_rating: GOOD_RATING },
    groups: GROUPS,
    counts,
    products: rows.sort((a, b) => b.units - a.units),
  });
}));

module.exports = router;
