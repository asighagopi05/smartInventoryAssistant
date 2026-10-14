const mongoose = require('mongoose');

/**
 * Internal supporting collection - not a domain entity.
 *
 * One sales forecast for one product over one window, and later what actually
 * sold in that window. Keeping both is what turns a forecast from a claim into
 * something checked:
 *
 *   live      - made by "Run forecast" for the next 7 days; marked once they pass
 *   approval  - copied from the live forecast when a Manager approves a restock,
 *               so each approval records what the model expected to sell
 *   backtest  - made for a week already in the history, trained ONLY on the days
 *               before it, so its accuracy is known immediately. These are
 *               backdated: generated_at is the start of that past week.
 */
const KINDS = ['live', 'approval', 'backtest'];

const predictionSchema = new mongoose.Schema(
  {
    product_id: { type: mongoose.Schema.Types.ObjectId, ref: 'Product', required: true },
    kind: { type: String, enum: KINDS, required: true },

    window_start: { type: Date, required: true },
    window_end: { type: Date, required: true },
    horizon_days: { type: Number, required: true, min: 1 },

    predicted_units: { type: Number, required: true, min: 0 },
    naive_units: { type: Number, required: true, min: 0 }, // last-4-weeks average, for comparison
    daily: { type: [Number], default: [] },

    generated_at: { type: Date, required: true },
    restock_request_id: { type: mongoose.Schema.Types.ObjectId, ref: 'RestockRequest', default: null },

    // Filled in once window_end has passed
    actual_units: { type: Number, default: null },
    accuracy: { type: Number, default: null, min: 0, max: 1 },
    evaluated_at: { type: Date, default: null },
  },
  { versionKey: false }
);

predictionSchema.index({ kind: 1, product_id: 1, window_start: -1 });
// The evaluator's query: predictions whose window has ended but have no actual yet
predictionSchema.index({ actual_units: 1, window_end: 1 });

predictionSchema.statics.KINDS = KINDS;

module.exports = mongoose.model('Prediction', predictionSchema);
