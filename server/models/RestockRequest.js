const mongoose = require('mongoose');

// `applied` is only reached by an adjustment: approving one writes the
// correction to stock there and then, so there is nothing left to receive.
const STATUSES = ['pending', 'approved', 'rejected', 'received', 'applied'];
const KINDS = ['restock', 'adjustment'];

const restockRequestSchema = new mongoose.Schema(
  {
    product_id: { type: mongoose.Schema.Types.ObjectId, ref: 'Product', required: true },
    supplier_id: { type: mongoose.Schema.Types.ObjectId, ref: 'Supplier', required: true },
    qty: { type: Number, required: true, min: 1 },

    // restock: order more from the supplier. adjustment: a physical count that
    // differed from system stock by more than the tolerance, waiting for the
    // Manager. They share the approvals queue, but approving them does
    // different things, so the kind is stored rather than guessed.
    kind: { type: String, enum: KINDS, default: 'restock' },
    counted_stock: { type: Number, min: 0, default: null },  // adjustment only
    difference: { type: Number, default: null },             // adjustment only: counted - system, signed
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
    note: { type: String, trim: true, maxlength: 400 },
  },
  { timestamps: true, toJSON: { virtuals: true } }
);

restockRequestSchema.index({ product_id: 1, status: 1 });
restockRequestSchema.index({ status: 1, createdAt: -1 });
restockRequestSchema.index({ kind: 1, status: 1, createdAt: -1 });

/**
 * One OPEN request per product and kind, enforced by the database rather than
 * by an `if` in the service. The application guard can be raced by two concurrent
 * sales crossing the threshold at the same moment; a unique index cannot.
 *
 * "Open" deliberately covers `approved` as well as `pending`. A product stays
 * below its threshold for the whole lead time between approval and delivery,
 * so guarding only `pending` means every sale in that window raises another
 * request - a fast-moving line then orders itself over and over and ends up
 * holding months of stock it never needed.
 */
/*
 * The kind is part of the key so a pending stock count never blocks the
 * automatic reorder for the same product (and vice versa). Before Phase 3 the
 * key was product_id alone; server/seed/migrate-phase3.js replaces that index
 * on an existing database.
 */
restockRequestSchema.index(
  { product_id: 1, kind: 1 },
  {
    unique: true,
    partialFilterExpression: { status: { $in: ['pending', 'approved'] } },
    name: 'one_open_per_product_kind',
  }
);

restockRequestSchema.virtual('is_open').get(function isOpen() {
  return this.status === 'pending' || this.status === 'approved';
});

restockRequestSchema.statics.STATUSES = STATUSES;
restockRequestSchema.statics.KINDS = KINDS;

module.exports = mongoose.model('RestockRequest', restockRequestSchema);
