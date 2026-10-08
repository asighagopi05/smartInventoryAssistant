const router = require('express').Router();
const jwt = require('jsonwebtoken');
const rateLimit = require('express-rate-limit');
const asyncHandler = require('../utils/asyncHandler');
const ApiError = require('../utils/ApiError');
const { requireAuth, requireRole } = require('../middleware/auth');
const { User } = require('../models');

const loginLimiter = rateLimit({ windowMs: 15 * 60 * 1000, max: 40, standardHeaders: true, legacyHeaders: false });

router.post('/login', loginLimiter, asyncHandler(async (req, res) => {
  const { email, password } = req.body;
  if (!email || !password) throw ApiError.badRequest('Email and password are required');

  // password_hash is select:false, so it must be asked for explicitly.
  const user = await User.findOne({ email: String(email).toLowerCase() }).select('+password_hash');
  if (!user || !user.active) throw ApiError.unauthorized('Email or password is incorrect');

  const ok = await user.verifyPassword(password);
  if (!ok) throw ApiError.unauthorized('Email or password is incorrect');

  user.last_login = new Date();
  await user.save();

  const token = jwt.sign({ sub: String(user._id), role: user.role }, process.env.JWT_SECRET, {
    expiresIn: process.env.JWT_EXPIRES_IN || '8h',
  });

  res.json({ token, user: { id: user._id, name: user.name, email: user.email, role: user.role } });
}));

router.get('/me', requireAuth, (req, res) => res.json({ user: req.user }));

/** Accounts are created down a chain: Owner makes Managers, Managers make Staff. */
router.post('/users', requireAuth, requireRole('Owner', 'Manager'), asyncHandler(async (req, res) => {
  const { name, email, password, role, phone } = req.body;
  if (!name || !email || !password || !role) throw ApiError.badRequest('name, email, password and role are required');

  const allowed = req.user.role === 'Owner' ? ['Manager', 'Staff'] : ['Staff'];
  if (!allowed.includes(role)) {
    throw ApiError.forbidden(`A ${req.user.role} can only create: ${allowed.join(', ')}`);
  }

  const user = new User({ name, email, role, phone, created_by: req.user.id });
  await user.setPassword(password);
  await user.save();
  res.status(201).json({ user });
}));

router.get('/users', requireAuth, requireRole('Owner', 'Manager'), asyncHandler(async (_req, res) => {
  const users = await User.find().sort({ role: 1, name: 1 }).populate('created_by', 'name role').lean();
  res.json({ users });
}));

module.exports = router;
