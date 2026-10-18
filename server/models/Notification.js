const mongoose = require('mongoose');

const TYPES = [
  'low_stock', 'restock_request', 'restock_approved', 'stock_received',
  'adjustment_request', 'adjustment_decided', 'bad_review',
  'issue_raised', 'issue_updated', 'task_assigned', 'task_done', 'discussion_reply',
];

/**
 * Notifications are written by the events that cause them, never seeded in bulk
 * and never hardcoded. ref_type/ref_id point back at the document responsible,
 * so a notification can always be traced to the thing that triggered it.
 */
const notificationSchema = new mongoose.Schema(
  {
    type: { type: String, required: true, enum: TYPES },
    title: { type: String, required: true, trim: true, maxlength: 160 },
    body: { type: String, trim: true, maxlength: 500 },

    for_role: { type: String, enum: ['Owner', 'Manager', 'Staff'], default: null },
    for_user_id: { type: mongoose.Schema.Types.ObjectId, ref: 'User', default: null },

    ref_type: { type: String, default: null },
    ref_id: { type: mongoose.Schema.Types.ObjectId, default: null },
    link: { type: String, default: null },

    read_by: [{ type: mongoose.Schema.Types.ObjectId, ref: 'User' }],
  },
  { timestamps: true, toJSON: { virtuals: true } }
);

notificationSchema.index({ for_role: 1, createdAt: -1 });
notificationSchema.index({ read_by: 1 });

notificationSchema.statics.TYPES = TYPES;

module.exports = mongoose.model('Notification', notificationSchema);
