const mongoose = require('mongoose');

/** Floor problems flagged by Staff - damage, expiry, a mispriced shelf. */
const issueSchema = new mongoose.Schema(
  {
    title: { type: String, required: true, trim: true, maxlength: 160 },
    description: { type: String, trim: true, maxlength: 1000 },
    product_id: { type: mongoose.Schema.Types.ObjectId, ref: 'Product', default: null },
    category: {
      type: String,
      enum: ['damage', 'expiry', 'shelf', 'pricing', 'equipment', 'other'],
      default: 'other',
    },
    severity: { type: String, enum: ['low', 'medium', 'high'], default: 'medium' },
    status: { type: String, enum: ['open', 'acknowledged', 'resolved'], default: 'open' },

    raised_by: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
    resolved_by: { type: mongoose.Schema.Types.ObjectId, ref: 'User', default: null },
    resolved_at: { type: Date, default: null },
  },
  { timestamps: true, toJSON: { virtuals: true } }
);

issueSchema.index({ status: 1, createdAt: -1 });
issueSchema.index({ raised_by: 1 });

module.exports = mongoose.model('Issue', issueSchema);
