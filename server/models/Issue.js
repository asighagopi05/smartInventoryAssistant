const mongoose = require('mongoose');

const CATEGORIES = ['damage', 'expiry', 'shelf', 'pricing', 'equipment', 'other'];
const SEVERITIES = ['low', 'medium', 'high'];
const STATUSES = ['open', 'acknowledged', 'resolved'];

/**
 * Floor problems flagged by Staff - damage, expiry, a mispriced shelf.
 *
 * open -> acknowledged -> resolved, decided by the Manager. Each step records
 * who took it and when, so "who knew about the broken chiller, and since
 * when" has an answer.
 */
const issueSchema = new mongoose.Schema(
  {
    title: { type: String, required: [true, 'Give the issue a short title'], trim: true, maxlength: 160 },
    description: { type: String, trim: true, maxlength: 1000 },
    product_id: { type: mongoose.Schema.Types.ObjectId, ref: 'Product', default: null },
    category: { type: String, enum: CATEGORIES, default: 'other' },
    severity: { type: String, enum: SEVERITIES, default: 'medium' },
    status: { type: String, enum: STATUSES, default: 'open' },

    raised_by: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
    acknowledged_by: { type: mongoose.Schema.Types.ObjectId, ref: 'User', default: null },
    acknowledged_at: { type: Date, default: null },
    resolved_by: { type: mongoose.Schema.Types.ObjectId, ref: 'User', default: null },
    resolved_at: { type: Date, default: null },
    resolution_note: { type: String, trim: true, maxlength: 500, default: null },
  },
  { timestamps: true, toJSON: { virtuals: true } }
);

issueSchema.index({ status: 1, createdAt: -1 });
issueSchema.index({ raised_by: 1 });

issueSchema.statics.CATEGORIES = CATEGORIES;
issueSchema.statics.SEVERITIES = SEVERITIES;
issueSchema.statics.STATUSES = STATUSES;

module.exports = mongoose.model('Issue', issueSchema);
