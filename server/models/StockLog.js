const mongoose = require('mongoose');

const ENTRY_TYPES = ['sale', 'received', 'count', 'damage', 'return', 'adjustment'];

/**
 * An append-only ledger of stock movement. Never updated, never deleted -
 * a correction is a new row. stock_before/stock_after make the whole history
 * auditable and let the ledger be reconciled against current stock.
 */
const stockLogSchema = new mongoose.Schema(
  {
    product_id: { type: mongoose.Schema.Types.ObjectId, ref: 'Product', required: true },
    entry_type: { type: String, required: true, enum: ENTRY_TYPES },
    quantity_change: { type: Number, required: true }, // signed: -3, +50
    stock_before: { type: Number, required: true, min: 0 },
    stock_after: { type: Number, required: true, min: 0 },
    reason: { type: String, trim: true, maxlength: 300 },
    source: { type: String, enum: ['billing', 'manual', 'restock', 'seed'], default: 'manual' },

    // Accountability is per-person. This is what removes the need for a
    // separate till-vs-stock role split.
    user_id: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },

    sale_id: { type: mongoose.Schema.Types.ObjectId, ref: 'Sale', default: null },
    restock_request_id: { type: mongoose.Schema.Types.ObjectId, ref: 'RestockRequest', default: null },
  },
  { timestamps: true, toJSON: { virtuals: true } }
);

stockLogSchema.index({ product_id: 1, createdAt: -1 });
stockLogSchema.index({ user_id: 1 });
stockLogSchema.index({ entry_type: 1 });

stockLogSchema.statics.ENTRY_TYPES = ENTRY_TYPES;

module.exports = mongoose.model('StockLog', stockLogSchema);
