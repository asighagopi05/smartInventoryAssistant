const router = require('express').Router();
const mongoose = require('mongoose');
const asyncHandler = require('../utils/asyncHandler');
const ApiError = require('../utils/ApiError');
const { requireAuth, requireRole } = require('../middleware/auth');
const { Prediction, Product, RestockRequest } = require('../models');
const {
  generateForecasts, evaluateDuePredictions, loadDailyUnits, dayOf, dayStart,
} = require('../services/forecastService');

router.use(requireAuth, requireRole('Owner', 'Manager'));

/** Weighted accuracy over many predictions: 1 - total miss / total sold. */
const weightedAccuracy = (rows, field) => {
  const sold = rows.reduce((n, r) => n + r.actual_units, 0);
  const miss = rows.reduce((n, r) => n + Math.abs(r[field] - r.actual_units), 0);
  return sold > 0 ? Math.max(0, 1 - miss / sold) : null;
};

// GET /api/forecast  -> the latest forecast per product, and how accurate past ones were
router.get('/', asyncHandler(async (_req, res) => {
  await evaluateDuePredictions();

  const live = await Prediction.find({ kind: 'live', actual_units: null })
    .populate('product_id', 'name sku category unit stock threshold active')
    .lean();

  const open = await RestockRequest.find({ kind: { $ne: 'adjustment' }, status: { $in: ['pending', 'approved'] } })
    .select('product_id status').lean();
  const restockOf = new Map(open.map((r) => [String(r.product_id), r.status]));

  const products = live
    .filter((p) => p.product_id?.active)
    .map((p) => {
      const perDay = p.predicted_units / p.horizon_days;
      const stock = p.product_id.stock;
      return {
        product: p.product_id,
        predicted_units: p.predicted_units,
        naive_units: p.naive_units,
        days_of_cover: perDay > 0 ? Math.round((stock / perDay) * 10) / 10 : null,
        runs_out: stock < p.predicted_units,
        restock_status: restockOf.get(String(p.product_id._id)) || null,
      };
    })
    .sort((a, b) => (a.days_of_cover ?? Infinity) - (b.days_of_cover ?? Infinity));

  // Backtests, one group per hidden week
  const backtests = await Prediction.find({ kind: 'backtest' }).lean();
  const weeks = new Map();
  for (const b of backtests) {
    const key = b.window_start.toISOString();
    if (!weeks.has(key)) weeks.set(key, []);
    weeks.get(key).push(b);
  }
  const backtestWeeks = [...weeks.entries()].sort().map(([start, rows]) => ({
    window_start: start,
    window_end: rows[0].window_end,
    actual_units: rows.reduce((n, r) => n + r.actual_units, 0),
    predicted_units: Math.round(rows.reduce((n, r) => n + r.predicted_units, 0)),
    naive_units: Math.round(rows.reduce((n, r) => n + r.naive_units, 0)),
    model_accuracy: weightedAccuracy(rows, 'predicted_units'),
    naive_accuracy: weightedAccuracy(rows, 'naive_units'),
  }));

  // Live and approval forecasts whose week has passed
  const checked = await Prediction.find({ kind: { $in: ['live', 'approval'] }, actual_units: { $ne: null } })
    .sort({ window_end: -1 }).limit(30)
    .populate('product_id', 'name sku')
    .lean();

  res.json({
    generated_at: live[0]?.generated_at || null,
    window_start: live[0]?.window_start || null,
    window_end: live[0]?.window_end || null,
    products,
    backtest: {
      weeks: backtestWeeks,
      model_accuracy: weightedAccuracy(backtests, 'predicted_units'),
      naive_accuracy: weightedAccuracy(backtests, 'naive_units'),
    },
    checked,
  });
}));

// POST /api/forecast/generate  -> run the model for every product
router.post('/generate', asyncHandler(async (_req, res) => {
  const result = await generateForecasts();
  res.json(result);
}));

// GET /api/forecast/product/:id  -> the last 8 weeks of daily sales and the forecast, for the chart
router.get('/product/:id', asyncHandler(async (req, res) => {
  if (!mongoose.isValidObjectId(req.params.id)) throw ApiError.badRequest('Invalid product id');
  const product = await Product.findById(req.params.id).select('name sku stock threshold unit').lean();
  if (!product) throw ApiError.notFound('Product not found');

  const daily = await loadDailyUnits();
  const byDay = daily.byProduct.get(String(product._id));
  // Days the shop recorded nothing at all are missing data: sent as null so the chart leaves a gap
  const trading = new Set(daily.tradingDays);
  const history = [];
  if (Number.isFinite(daily.lastDay)) {
    for (let d = Math.max(daily.firstDay, daily.lastDay - 55); d <= daily.lastDay; d += 1) {
      history.push({ date: dayStart(d), sold: trading.has(d) ? byDay?.get(d) || 0 : null });
    }
  }

  const live = await Prediction.findOne({ kind: 'live', product_id: product._id })
    .sort({ generated_at: -1 }).lean();
  const forecast = live
    ? live.daily.map((units, i) => ({ date: dayStart(dayOf(live.window_start) + i), predicted: units }))
    : [];

  res.json({ product, history, forecast });
}));

module.exports = router;
