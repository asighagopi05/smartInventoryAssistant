const jwt = require('jsonwebtoken');
const ApiError = require('../utils/ApiError');
const { User } = require('../models');

/**
 * Verifies the bearer token and loads the user.
 *
 * The previous build kept {id,name,email,role} in localStorage and trusted it,
 * so setting localStorage.session = {role:"Owner"} granted Owner. Here the role
 * is read from a signed token and re-checked against the database on every
 * request, so a tampered token fails signature verification and a deactivated
 * account stops working immediately.
 */
const requireAuth = async (req, _res, next) => {
  try {
    const header = req.headers.authorization || '';
    const token = header.startsWith('Bearer ') ? header.slice(7) : null;
    if (!token) throw ApiError.unauthorized('Missing bearer token');

    let payload;
    try {
      payload = jwt.verify(token, process.env.JWT_SECRET);
    } catch (err) {
      throw ApiError.unauthorized(err.name === 'TokenExpiredError' ? 'Session expired' : 'Invalid token');
    }

    const user = await User.findById(payload.sub).lean();
    if (!user || !user.active) throw ApiError.unauthorized('Account is not active');

    req.user = { id: String(user._id), name: user.name, email: user.email, role: user.role };
    next();
  } catch (err) {
    next(err);
  }
};

/** Role gate. Checked on the server, never inferred from the client. */
const requireRole = (...roles) => (req, _res, next) => {
  if (!req.user) return next(ApiError.unauthorized());
  if (!roles.includes(req.user.role)) {
    return next(ApiError.forbidden(`This action is restricted to: ${roles.join(', ')}`));
  }
  return next();
};

module.exports = { requireAuth, requireRole };
