const mongoose = require('mongoose');

/**
 * Internal supporting collection - not a domain entity.
 *
 * Holds the last rule set the ML service returned, as one document with
 * _id 'latest'. The combo screen reads from here, never from the ML service
 * directly, so it still renders if the Python process is not running.
 */
const ruleSchema = new mongoose.Schema(
  {
    if_bought: { type: String, required: true },
    also_bought: { type: String, required: true },
    support: { type: Number, required: true },
    confidence: { type: Number, required: true },
    lift: { type: Number, required: true },
    bill_count: { type: Number, required: true },
    // Share of all bills each side appears in, and the ranking built from them
    if_support: { type: Number, required: true },
    also_support: { type: Number, required: true },
    // Chance this many shared bills is coincidence (Fisher's exact test); only < 0.01 is kept
    p_value: { type: Number, default: null },
    slow_strong: { type: Boolean, default: false },
    score: { type: Number, required: true },
  },
  { _id: false }
);

const comboCacheSchema = new mongoose.Schema(
  {
    _id: { type: String, required: true },
    basket_count: { type: Number, required: true },
    min_support: { type: Number, required: true },
    min_confidence: { type: Number, required: true },
    rules: { type: [ruleSchema], default: [] },
    generated_at: { type: Date, required: true },
    generated_by: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
  },
  { versionKey: false }
);

module.exports = mongoose.model('ComboCache', comboCacheSchema);
