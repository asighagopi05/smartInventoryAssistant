const mongoose = require('mongoose');

/**
 * Internal supporting collection - not a domain entity.
 *
 * Bill numbers must be unique and gap-free-ish under concurrent tills.
 * Deriving one from `countDocuments() + 1` or from a timestamp hands two
 * simultaneous sales the same number. A single atomic $inc cannot.
 */
const counterSchema = new mongoose.Schema(
  {
    _id: { type: String, required: true },
    seq: { type: Number, required: true, default: 0 },
  },
  { versionKey: false }
);

counterSchema.statics.next = async function next(key) {
  const doc = await this.findOneAndUpdate(
    { _id: key },
    { $inc: { seq: 1 } },
    { upsert: true, returnDocument: 'after', setDefaultsOnInsert: true }
  ).lean();
  return doc.seq;
};

module.exports = mongoose.model('Counter', counterSchema);
