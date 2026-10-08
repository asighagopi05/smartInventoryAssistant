const mongoose = require('mongoose');

const STATUSES = ['pending', 'approved', 'rejected', 'received'];

const restockRequestSchema = new mongoose.Schema(
  {
    product_id: { type: mongoose.Schema.Types.ObjectId, ref: 'Product', required: true },
    supplier_id: { type: mongoose.Schema.Types.ObjectId, ref: 'Supplier', required: true },
    qty: { type: Number, required: true, min: 1 },
    status: { type: String, enum: STATUSES, default: 'pending' },
    trigger: { type: String, enum: ['auto', 'manual'], default: 'auto' },

    // What the shelf actually held when the rule fired. Recording these makes
    // a historical request explainable months later.
    stock_at_request: { type: Number, min: 0 },
    threshold_at_request: { type: Number, min: 0 },

    // null when the server raised it automatically - which is the normal case.
    raised_by: { type: mongoose.Schema.Types.ObjectId, ref: 'User', default: null },
    approved_by: { type: mongoose.Schema.Types.ObjectId, ref: 'User', default: null },
    approved_at: { type: Date, default: null },
    received_at: { type: Date, default: null },
    received_qty: { type: Number, min: 0, default: null },
    note: { type: String, trim: true, maxlength: 300 },
  },
  { timestamps: true, toJSON: { virtuals: true } }
);

restockRequestSchema.index({ product_id: 1, status: 1 });
restockRequestSchema.index({ status: 1, createdAt: -1 });

/**
 * One OPEN request per product, enforced by the database rather than by an
 * `if` in the service. The application guard can be raced by two concurrent
 * sales crossing the threshold at the same moment; a unique index cannot.
 *
 * "Open" deliberately covers `approved` as well as `pending`. A product stays
 * below its threshold for the whole lead time between approval and delivery,
 * so guarding only `pending` means every sale in that window raises another
 * request - a fast-moving line then orders itself over and over and ends up
 * holding months of stock it never needed.
 */
restockRequestSchema.index(
  { product_id: 1 },
  {
    unique: true,
    partialFilterExpression: { status: { $in: ['pending', 'approved'] } },
    name: 'one_open_per_product',
  }
);

restockRequestSchema.virtual('is_open').get(function isOpen() {
  return this.status === 'pending' || this.status === 'approved';
});

restockRequestSchema.statics.STATUSES = STATUSES;

module.exports = mongoose.model('RestockRequest', restockRequestSchema);
