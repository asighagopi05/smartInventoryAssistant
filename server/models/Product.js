const mongoose = require('mongoose');
const { money, withGetters } = require('../utils/money');

const CATEGORIES = [
  'Dairy', 'Bakery', 'Produce', 'Meat', 'Frozen', 'Beverages',
  'Alcohol', 'Snacks', 'Staples', 'Household', 'Personal Care', 'Electronics',
];

const productSchema = new mongoose.Schema(
  {
    sku: { type: String, required: true, unique: true, uppercase: true, trim: true },
    name: { type: String, required: [true, 'Product name is required'], trim: true, maxlength: 140 },
    category: { type: String, required: true, enum: { values: CATEGORIES, message: '{VALUE} is not a known category' } },
    unit: { type: String, enum: ['pc', 'kg', 'litre', 'pack'], default: 'pc' },

    price: money({ required: true }),
    cost: money({ default: 0 }),

    stock: { type: Number, required: true, default: 0, min: [0, 'Stock cannot go negative'] },
    threshold: { type: Number, required: true, min: 0 },
    reorder_qty: { type: Number, required: true, min: 1 },

    supplier_id: { type: mongoose.Schema.Types.ObjectId, ref: 'Supplier', required: true },
    active: { type: Boolean, default: true },

    // Denormalised from Note so the product list can sort by rating without
    // aggregating feedback on every page load. Maintained by a hook, never by callers.
    rating_avg: { type: Number, default: 0, min: 0, max: 5 },
    rating_count: { type: Number, default: 0, min: 0 },
  },
  { timestamps: true, ...withGetters }
);

productSchema.index({ category: 1 });
productSchema.index({ supplier_id: 1 });
productSchema.index({ stock: 1 });
// Powers the inline product search on the till and the customer record screen.
// Without it, every keystroke is a collection scan behind a regex.
productSchema.index({ name: 'text', category: 'text' }, { weights: { name: 10, category: 2 }, name: 'product_search' });

// Derived, never stored - a stored flag is one more thing that can disagree with reality.
productSchema.virtual('is_low_stock').get(function isLowStock() {
  return this.stock <= this.threshold;
});

productSchema.virtual('stock_value').get(function stockValue() {
  return (this.stock * (this.get('cost', null, { getters: false }) || 0)) / 100;
});

productSchema.query.activeOnly = function activeOnly() {
  return this.where({ active: true });
};

productSchema.statics.CATEGORIES = CATEGORIES;

module.exports = mongoose.model('Product', productSchema);
