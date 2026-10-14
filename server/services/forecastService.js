const { Sale, Product, Prediction } = require('../models');
const { callML } = require('./mlClient');

/**
 * Sales forecasting: builds daily unit series from Sale documents, asks the ML
 * service for predictions, stores them as Prediction documents, and later fills
 * in what actually sold.
 *
 * Days are shop days in India time (UTC+5:30), so a sale at 00:30 IST counts
 * towards that morning, not the previous UTC day. A day is held as an integer:
 * whole days since 1 Jan 1970, IST.
 *
 * A day on which the whole shop recorded no sales at all is treated as MISSING,
 * not as zero demand: a supermarket always sells something, so an empty day
 * means the system was not in use. Counting those days as zeros taught the
 * model that demand had collapsed, and put backtest weeks where nothing could
 * be checked. Only trading days are trained on and backtested.
 */
const DAY_MS = 24 * 60 * 60 * 1000;
const IST_MS = (5 * 60 + 30) * 60 * 1000;
const HORIZON = 7;
const BACKTEST_WEEKS = 3;

const dayOf = (date) => Math.floor((new Date(date).getTime() + IST_MS) / DAY_MS);
const dayStart = (day) => new Date(day * DAY_MS - IST_MS);
const weekdayOf = (day) => (new Date(day * DAY_MS).getUTCDay() + 6) % 7; // Monday = 0

/** 1 = exact. Measured against what sold; 0 once the miss is as big as the sales. */
const accuracyOf = (predicted, actual) =>
  Math.max(0, 1 - Math.abs(predicted - actual) / Math.max(actual, 1));

/** Units sold per product per day: Map(productId -> Map(day -> units)), plus the day range. */
async function loadDailyUnits() {
  const rows = await Sale.aggregate([
    { $unwind: '$items' },
    {
      $group: {
        _id: {
          p: '$items.product_id',
          d: { $floor: { $divide: [{ $add: [{ $toLong: '$createdAt' }, IST_MS] }, DAY_MS] } },
        },
        units: { $sum: '$items.qty' },
      },
    },
  ]);

  const byProduct = new Map();
  const trading = new Set();
  for (const r of rows) {
    const pid = String(r._id.p);
    if (!byProduct.has(pid)) byProduct.set(pid, new Map());
    byProduct.get(pid).set(r._id.d, r.units);
    trading.add(r._id.d);
  }
  const tradingDays = [...trading].sort((a, b) => a - b);
  return {
    byProduct,
    tradingDays,
    firstDay: tradingDays.length ? tradingDays[0] : Infinity,
    lastDay: tradingDays.length ? tradingDays[tradingDays.length - 1] : -Infinity,
  };
}

const unitsBetween = (byDay, from, to) => {
  let n = 0;
  for (let d = from; d < to; d += 1) n += byDay?.get(d) || 0;
  return n;
};

/** Ask the ML service to forecast the `HORIZON` days from `forecastDay`, trained on `trainDays`. */
async function predict(productIds, daily, trainDays, forecastDay) {
  const series = productIds.map((pid) => {
    const byDay = daily.byProduct.get(pid);
    return { key: pid, values: trainDays.map((d) => byDay?.get(d) || 0) };
  });
  const forecastDays = Array.from({ length: HORIZON }, (_, i) => forecastDay + i);
  const out = await callML('/forecast', {
    train_weekdays: trainDays.map(weekdayOf),
    forecast_weekdays: forecastDays.map(weekdayOf),
    series,
  });
  return out.forecasts;
}

/**
 * The most recent `count` 7-day windows in which every day is a trading day,
 * newest last, each with at least 4 weeks of trading days before it to train on.
 */
function completeWeeks(tradingDays, count) {
  const trading = new Set(tradingDays);
  const weeks = [];
  let end = tradingDays[tradingDays.length - 1] + 1; // exclusive
  while (weeks.length < count) {
    const start = end - HORIZON;
    const before = tradingDays.filter((d) => d < start).length;
    if (before < 28) break;
    let full = true;
    for (let d = start; d < end; d += 1) if (!trading.has(d)) { full = false; break; }
    if (full) {
      weeks.unshift(start);
      end = start;
    } else {
      end -= 1;
    }
  }
  return weeks;
}

/**
 * "Run forecast": a live forecast for the next 7 days, plus backtests.
 *
 * The live forecast trains on every trading day and predicts the 7 days from
 * today. Each backtest hides one of the last few complete trading weeks,
 * trains on the days before it only, and predicts it - so its accuracy is
 * known straight away instead of after a week of waiting.
 */
async function generateForecasts() {
  const daily = await loadDailyUnits();
  if (daily.tradingDays.length === 0) return { live: 0, backtests: 0 };

  const products = await Product.find({ active: true }).select('_id').lean();
  const productIds = products.map((p) => String(p._id));
  const now = new Date();
  const today = dayOf(now);

  // Live forecast for the coming week
  const live = await predict(productIds, daily, daily.tradingDays, today);
  await Prediction.deleteMany({ kind: 'live', actual_units: null }); // the newest run replaces pending ones
  await Prediction.insertMany(live.map((f) => ({
    product_id: f.key,
    kind: 'live',
    window_start: dayStart(today),
    window_end: dayStart(today + HORIZON),
    horizon_days: HORIZON,
    predicted_units: f.predicted_units,
    naive_units: f.naive_units,
    daily: f.daily,
    generated_at: now,
  })));

  // Backtests over the last complete trading weeks
  await Prediction.deleteMany({ kind: 'backtest' });
  let backtests = 0;
  for (const cut of completeWeeks(daily.tradingDays, BACKTEST_WEEKS)) {
    const trainDays = daily.tradingDays.filter((d) => d < cut);
    const forecasts = await predict(productIds, daily, trainDays, cut);
    await Prediction.insertMany(forecasts.map((f) => {
      const actual = unitsBetween(daily.byProduct.get(f.key), cut, cut + HORIZON);
      return {
        product_id: f.key,
        kind: 'backtest',
        window_start: dayStart(cut),
        window_end: dayStart(cut + HORIZON),
        horizon_days: HORIZON,
        predicted_units: f.predicted_units,
        naive_units: f.naive_units,
        daily: f.daily,
        generated_at: dayStart(cut), // backdated: as if made at the start of that week
        actual_units: actual,
        accuracy: accuracyOf(f.predicted_units, actual),
        evaluated_at: now,
      };
    }));
    backtests += 1;
  }

  return {
    live: live.length,
    backtests,
    trading_days: daily.tradingDays.length,
    history_from: dayStart(daily.firstDay),
    history_to: dayStart(daily.lastDay),
  };
}

/**
 * Fill in actual sales for every prediction whose window has ended.
 * Runs at startup and then hourly from index.js.
 */
async function evaluateDuePredictions() {
  const due = await Prediction.find({ actual_units: null, window_end: { $lte: new Date() } }).lean();
  if (due.length === 0) return 0;

  // One aggregation per distinct window, not one per prediction
  const windows = new Map();
  for (const p of due) {
    const key = `${p.window_start.getTime()}|${p.window_end.getTime()}`;
    if (!windows.has(key)) windows.set(key, []);
    windows.get(key).push(p);
  }

  const now = new Date();
  for (const preds of windows.values()) {
    const { window_start: from, window_end: to } = preds[0];
    const sold = await Sale.aggregate([
      { $match: { createdAt: { $gte: from, $lt: to } } },
      { $unwind: '$items' },
      { $group: { _id: '$items.product_id', units: { $sum: '$items.qty' } } },
    ]);
    const unitsOf = new Map(sold.map((s) => [String(s._id), s.units]));
    await Prediction.bulkWrite(preds.map((p) => {
      const actual = unitsOf.get(String(p.product_id)) || 0;
      return {
        updateOne: {
          filter: { _id: p._id },
          update: { $set: { actual_units: actual, accuracy: accuracyOf(p.predicted_units, actual), evaluated_at: now } },
        },
      };
    }));
  }
  return due.length;
}

/**
 * When a Manager approves a restock, record what the model expected that
 * product to sell over the next week, so the approval can be checked later.
 */
async function recordApprovalForecast(request) {
  const latest = await Prediction.findOne({ kind: 'live', product_id: request.product_id })
    .sort({ generated_at: -1 }).lean();
  if (!latest) return null;
  const now = new Date();
  return Prediction.create({
    product_id: request.product_id,
    kind: 'approval',
    window_start: now,
    window_end: new Date(now.getTime() + latest.horizon_days * DAY_MS),
    horizon_days: latest.horizon_days,
    predicted_units: latest.predicted_units,
    naive_units: latest.naive_units,
    daily: latest.daily,
    generated_at: now,
    restock_request_id: request._id,
  });
}

module.exports = {
  generateForecasts, evaluateDuePredictions, recordApprovalForecast,
  loadDailyUnits, accuracyOf, dayOf, dayStart, HORIZON,
};
