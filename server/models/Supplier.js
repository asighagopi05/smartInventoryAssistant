const mongoose = require('mongoose');

const supplierSchema = new mongoose.Schema(
  {
    name: { type: String, required: [true, 'Supplier name is required'], trim: true, maxlength: 120 },
    contact_person: { type: String, trim: true, maxlength: 80 },
    phone: { type: String, trim: true, match: [/^[6-9]\d{9}$/, 'Phone must be a 10-digit Indian mobile number'] },
    email: { type: String, trim: true, lowercase: true },
    address: { type: String, trim: true, maxlength: 300 },
    categories: [{ type: String, trim: true }],
    active: { type: Boolean, default: true },
  },
  { timestamps: true, toJSON: { virtuals: true } }
);

supplierSchema.index({ name: 1 });
supplierSchema.query.activeOnly = function activeOnly() {
  return this.where({ active: true });
};

module.exports = mongoose.model('Supplier', supplierSchema);
