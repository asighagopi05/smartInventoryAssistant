const router = require('express').Router();
const mongoose = require('mongoose');
const asyncHandler = require('../utils/asyncHandler');
const ApiError = require('../utils/ApiError');
const { requireAuth } = require('../middleware/auth');
const { Notification } = require('../models');

router.use(requireAuth);

/** Notification types, grouped the way the notification centre filters them. */
const GROUPS = {
  stock: ['low_stock', 'restock_request', 'restock_approved', 'stock_received', 'adjustment_request', 'adjustment_decided'],
  floor: ['issue_raised', 'issue_updated', 'task_assigned', 'task_done', 'discussion_reply'],
  feedback: ['bad_review'],
};

/** What this user may see: aimed at their role, or at them by name. */
const visibleTo = (user) => ({ $or: [{ for_role: user.role }, { for_user_id: user.id }] });

/**
 * The full history, newest first, a page at a time.
 *   ?unread=1        only what this user has not read
 *   ?group=stock     stock | floor | feedback
 *   ?after=<cursor>  the page after the last one shown (the `next` value returned)
 *
 * The cursor is the last row's date and id together: two notifications written
 * in the same millisecond (a sale raising several requests) must not fall
 * between two pages.
 */
router.get('/', asyncHandler(async (req, res) => {
  const limit = Math.min(Number(req.query.limit) || 50, 200);
  const base = visibleTo(req.user);
  const filter = { $and: [base] };

  if (req.query.unread === '1') filter.$and.push({ read_by: { $ne: req.user.id } });
  if (req.query.group) {
    if (!GROUPS[req.query.group]) throw ApiError.badRequest(`group must be one of: ${Object.keys(GROUPS).join(', ')}`);
    filter.$and.push({ type: { $in: GROUPS[req.query.group] } });
  }
  if (req.query.after) {
    const [at, id] = String(req.query.after).split('_');
    const when = new Date(at);
    if (Number.isNaN(when.getTime()) || !mongoose.isValidObjectId(id)) throw ApiError.badRequest('after is not a valid cursor');
    filter.$and.push({ $or: [{ createdAt: { $lt: when } }, { createdAt: when, _id: { $lt: new mongoose.Types.ObjectId(id) } }] });
  }

  const [rows, unread] = await Promise.all([
    Notification.find(filter).sort({ createdAt: -1, _id: -1 }).limit(limit + 1).lean(),
    // The real count, not just how many of this page are unread: the bell
    // used to say "9+" or less because it only counted what it had fetched.
    Notification.countDocuments({ ...base, read_by: { $ne: req.user.id } }),
  ]);

  const page = rows.slice(0, limit);
  const last = page[page.length - 1];
  res.json({
    notifications: page.map(({ read_by: readBy, ...n }) => ({
      ...n,
      read: (readBy || []).some((u) => String(u) === req.user.id),
    })),
    unread,
    has_more: rows.length > limit,
    next: rows.length > limit ? `${new Date(last.createdAt).toISOString()}_${last._id}` : null,
  });
}));

/** Only a notification addressed to you can be marked as read by you. */
router.post('/:id/read', asyncHandler(async (req, res) => {
  const r = await Notification.updateOne(
    { _id: req.params.id, ...visibleTo(req.user) },
    { $addToSet: { read_by: req.user.id } }
  );
  if (r.matchedCount === 0) throw ApiError.notFound('Notification not found');
  res.json({ ok: true });
}));

router.post('/read-all', asyncHandler(async (req, res) => {
  const r = await Notification.updateMany(
    { ...visibleTo(req.user), read_by: { $ne: req.user.id } },
    { $addToSet: { read_by: req.user.id } }
  );
  res.json({ ok: true, marked: r.modifiedCount });
}));

module.exports = router;
