const mongoose = require('mongoose');

/**
 * Customer feedback and internal discussion share a collection because they
 * are genuinely the same shape - a body, an author, a timestamp, a thread -
 * differing only in whether the author is a logged-in user.
 *
 * author_id === null means the note came from a customer via a QR code.
 */
const noteSchema = new mongoose.Schema(
  {
    type: { type: String, required: true, enum: ['feedback', 'discussion'] },
    body: { type: String, trim: true, maxlength: 1000 },

    author_id: { type: mongoose.Schema.Types.ObjectId, ref: 'User', default: null },

    rating: { type: Number, min: 1, max: 5, default: null },
    product_id: { type: mongoose.Schema.Types.ObjectId, ref: 'Product', default: null },
    sale_id: { type: mongoose.Schema.Types.ObjectId, ref: 'Sale', default: null },

    contact_phone: { type: String, trim: true, default: null },
    customer_id: { type: mongoose.Schema.Types.ObjectId, ref: 'Customer', default: null },

    source: { type: String, enum: ['product_qr', 'shop_qr', 'bill_qr', 'staff'], default: 'staff' },
    parent_id: { type: mongoose.Schema.Types.ObjectId, ref: 'Note', default: null },
  },
  { timestamps: true, toJSON: { virtuals: true } }
);

noteSchema.index({ type: 1, createdAt: -1 });
noteSchema.index({ product_id: 1 });
noteSchema.index({ rating: 1 });

noteSchema.virtual('is_customer_feedback').get(function isCustomerFeedback() {
  return this.type === 'feedback' && this.author_id === null;
});

module.exports = mongoose.model('Note', noteSchema);
