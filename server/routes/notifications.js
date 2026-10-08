const router = require('express').Router();
const asyncHandler = require('../utils/asyncHandler');
const { requireAuth } = require('../middleware/auth');
const { Notification } = require('../models');

router.use(requireAuth);

/** Notifications aimed at this user, or at their role. */
router.get('/', asyncHandler(async (req, res) => {
  const filter = {
    $or: [{ for_role: req.user.role }, { for_user_id: req.user.id }],
  };
  const notifications = await Notification.find(filter)
    .sort({ createdAt: -1 })
    .limit(Math.min(Number(req.query.limit) || 50, 200))
    .lean();

  const unread = notifications.filter(
    (n) => !(n.read_by || []).some((u) => String(u) === req.user.id)
  ).length;

  res.json({
    notifications: notifications.map((n) => ({
      ...n,
      read: (n.read_by || []).some((u) => String(u) === req.user.id),
    })),
    unread,
  });
}));

router.post('/:id/read', asyncHandler(async (req, res) => {
  await Notification.updateOne(
    { _id: req.params.id },
    { $addToSet: { read_by: req.user.id } }
  );
  res.json({ ok: true });
}));

router.post('/read-all', asyncHandler(async (req, res) => {
  await Notification.updateMany(
    { $or: [{ for_role: req.user.role }, { for_user_id: req.user.id }] },
    { $addToSet: { read_by: req.user.id } }
  );
  res.json({ ok: true });
}));

module.exports = router;
