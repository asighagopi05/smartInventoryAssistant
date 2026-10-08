const mongoose = require('mongoose');
const { money, withGetters } = require('../utils/money');

/**
 * A customer is a phone-keyed record, not an account.
 *
 * There is no password field and there never will be - customers do not log in.
 * Records are created at the till as part of completing a sale, not through a
 * separate registration step.
 */
const customerSchema = new mongoose.Schema(
  {
    phone: {
      type: String,
      required: [true, 'Phone is required'],
      unique: true,
      trim: true,
      match: [/^[6-9]\d{9}$/, 'Phone must be a 10-digit Indian mobile number'],
    },
    name: { type: String, trim: true, maxlength: 80 },
    address: { type: String, trim: true, maxlength: 300 },
    email: { type: String, trim: true, lowercase: true },

    first_seen: { type: Date, default: Date.now },
    last_seen: { type: Date, default: Date.now },
    visits: { type: Number, default: 0, min: 0 },
    total_spent: money({ default: 0 }),

    created_by: { type: mongoose.Schema.Types.ObjectId, ref: 'User', default: null },
  },
  { timestamps: true, ...withGetters }
);

customerSchema.virtual('display_name').get(function displayName() {
  return this.name || `Walk-in (${this.phone})`;
});

module.exports = mongoose.model('Customer', customerSchema);
