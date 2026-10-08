const mongoose = require('mongoose');
const { money, withGetters } = require('../utils/money');
const Counter = require('./Counter');

/**
 * Line items are EMBEDDED, unlike every other relationship in this schema.
 * A bill is always read as one unit, is never queried across, and its contents
 * must freeze at the moment of sale - renaming a product or changing its price
 * tomorrow must not rewrite yesterday's receipt. Hence the name/sku/unit_price
 * snapshots alongside the product reference.
 */
const saleItemSchema = new mongoose.Schema(
  {
    product_id: { type: mongoose.Schema.Types.ObjectId, ref: 'Product', required: true },
    name: { type: String, required: true },
    sku: { type: String, required: true },
    qty: { type: Number, required: true, min: 1 },
    unit_price: money({ required: true }),
    line_total: money({ required: true }),
  },
  { _id: false, ...withGetters }
);

const saleSchema = new mongoose.Schema(
  {
    bill_no: { type: String, required: true, unique: true },
    items: {
      type: [saleItemSchema],
      validate: [(v) => Array.isArray(v) && v.length > 0, 'A sale must contain at least one item'],
    },

    subtotal: money({ required: true }),
    discount: money({ default: 0 }),
    tax: money({ default: 0 }),
    total: money({ required: true }),

    payment_method: { type: String, enum: ['cash', 'card', 'upi'], default: 'cash' },

    // customer_id is the durable link; customer_phone is a snapshot of what was
    // printed on this bill. Keeping both means editing a customer's phone number
    // later never orphans their purchase history, while a reprint still shows
    // exactly what they were handed. Null customer_id = walk-in.
    customer_id: { type: mongoose.Schema.Types.ObjectId, ref: 'Customer', default: null },
    customer_phone: { type: String, default: null, trim: true },

    billed_by: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
  },
  { timestamps: true, ...withGetters }
);

saleSchema.index({ createdAt: -1 });
saleSchema.index({ customer_id: 1, createdAt: -1 });
saleSchema.index({ billed_by: 1 });

saleSchema.virtual('item_count').get(function itemCount() {
  return this.items.reduce((n, i) => n + i.qty, 0);
});

/**
 * Totals are derived here, not trusted from the caller, so a bill can never be
 * persisted with numbers that do not add up. All arithmetic is in paise.
 */
saleSchema.pre('validate', function computeTotals(next) {
  if (Array.isArray(this.items)) {
    this.items.forEach((item) => {
      const unitPrice = item.get('unit_price', null, { getters: false }) || 0;
      item.set('line_total', unitPrice * item.qty);
    });
    const subtotal = this.items.reduce(
      (sum, item) => sum + (item.get('line_total', null, { getters: false }) || 0),
      0
    );
    this.set('subtotal', subtotal);
    const discount = this.get('discount', null, { getters: false }) || 0;
    const tax = this.get('tax', null, { getters: false }) || 0;
    this.set('total', Math.max(0, subtotal - discount + tax));
  }
  next();
});

/** Atomic bill number - two concurrent tills cannot be handed the same one. */
saleSchema.statics.nextBillNo = async function nextBillNo(when = new Date()) {
  const seq = await Counter.next('bill');
  const stamp = when.toISOString().slice(0, 10).replace(/-/g, '');
  return `SIA-${stamp}-${String(seq).padStart(5, '0')}`;
};

module.exports = mongoose.model('Sale', saleSchema);
