const router = require('express').Router();
const asyncHandler = require('../utils/asyncHandler');
const ApiError = require('../utils/ApiError');
const { requireAuth } = require('../middleware/auth');
const { Note, Notification } = require('../models');

router.use(requireAuth);

/**
 * The internal discussion board: Note documents with type 'discussion'.
 *
 * Threads are one level deep - a post and its replies. A reply to a reply is
 * attached to the original post, so a thread never turns into a staircase that
 * nobody can follow on a phone.
 */
router.get('/', asyncHandler(async (req, res) => {
  const limit = Math.min(Number(req.query.limit) || 30, 100);
  const filter = { type: 'discussion', parent_id: null };
  if (req.query.before) {
    const before = new Date(req.query.before);
    if (Number.isNaN(before.getTime())) throw ApiError.badRequest('before must be a date');
    filter.createdAt = { $lt: before };
  }

  const posts = await Note.find(filter)
    .sort({ createdAt: -1 })
    .limit(limit + 1)
    .populate('author_id', 'name role')
    .lean();
  const hasMore = posts.length > limit;
  const page = posts.slice(0, limit);

  const replies = await Note.find({ type: 'discussion', parent_id: { $in: page.map((p) => p._id) } })
    .sort({ createdAt: 1 })
    .populate('author_id', 'name role')
    .lean();
  const byParent = new Map();
  replies.forEach((r) => {
    const k = String(r.parent_id);
    if (!byParent.has(k)) byParent.set(k, []);
    byParent.get(k).push(r);
  });

  res.json({
    posts: page.map((p) => ({ ...p, replies: byParent.get(String(p._id)) || [] })),
    has_more: hasMore,
  });
}));

router.post('/', asyncHandler(async (req, res) => {
  const body = typeof req.body.body === 'string' ? req.body.body.trim() : '';
  if (!body) throw ApiError.badRequest('Write something before posting');
  if (body.length > 1000) throw ApiError.badRequest('Keep it under 1000 characters');

  let root = null;
  if (req.body.parentId) {
    const parent = await Note.findOne({ _id: req.body.parentId, type: 'discussion' }).lean();
    if (!parent) throw ApiError.badRequest('That post no longer exists');
    root = parent.parent_id ? await Note.findById(parent.parent_id).lean() : parent;
  }

  const note = await Note.create({
    type: 'discussion',
    body,
    author_id: req.user.id,
    source: 'staff',
    parent_id: root ? root._id : null,
  });

  if (root && root.author_id && String(root.author_id) !== req.user.id) {
    await Notification.create({
      type: 'discussion_reply',
      title: `${req.user.name} replied to your post`.slice(0, 160),
      body: `"${body.length > 140 ? `${body.slice(0, 140)}…` : body}"`,
      for_user_id: root.author_id,
      ref_type: 'Note',
      ref_id: root._id,
      link: '/discussion',
    });
  }

  res.status(201).json({ note: await Note.findById(note._id).populate('author_id', 'name role').lean() });
}));

module.exports = router;
