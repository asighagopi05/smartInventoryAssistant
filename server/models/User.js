const mongoose = require('mongoose');
const bcrypt = require('bcryptjs');

const ROLES = ['Owner', 'Manager', 'Staff'];

const userSchema = new mongoose.Schema(
  {
    name: { type: String, required: [true, 'Name is required'], trim: true, maxlength: 80 },
    email: {
      type: String,
      required: [true, 'Email is required'],
      unique: true,
      lowercase: true,
      trim: true,
      match: [/^[^\s@]+@[^\s@]+\.[^\s@]+$/, 'Not a valid email address'],
    },
    // select:false so a careless res.json(user) can never leak the hash.
    password_hash: { type: String, required: true, select: false },
    role: { type: String, required: true, enum: { values: ROLES, message: '{VALUE} is not a valid role' } },
    phone: { type: String, trim: true, match: [/^[6-9]\d{9}$/, 'Phone must be a 10-digit Indian mobile number'] },
    active: { type: Boolean, default: true },
    // Accounts are created down a chain: Owner -> Manager -> Staff.
    // Null only for the bootstrap Owner, who is created by the seed.
    created_by: { type: mongoose.Schema.Types.ObjectId, ref: 'User', default: null },
    last_login: { type: Date, default: null },
  },
  {
    timestamps: true,
    toJSON: {
      virtuals: true,
      transform(_doc, ret) {
        delete ret.password_hash;
        return ret;
      },
    },
  }
);

userSchema.index({ role: 1 });

userSchema.query.activeOnly = function activeOnly() {
  return this.where({ active: true });
};

userSchema.methods.setPassword = async function setPassword(plain) {
  this.password_hash = await bcrypt.hash(plain, 10);
};

userSchema.methods.verifyPassword = function verifyPassword(plain) {
  return bcrypt.compare(plain, this.password_hash);
};

userSchema.statics.ROLES = ROLES;

module.exports = mongoose.model('User', userSchema);
