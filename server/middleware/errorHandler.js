/* eslint-disable no-unused-vars */
const notFound = (req, _res, next) => {
  const ApiError = require('../utils/ApiError');
  next(ApiError.notFound(`No route for ${req.method} ${req.originalUrl}`));
};

const errorHandler = (err, _req, res, _next) => {
  let status = err.status || 500;
  let message = err.message || 'Something went wrong';
  let details = err.details;

  // Mongoose validation - surface the field messages, they are useful.
  if (err.name === 'ValidationError') {
    status = 400;
    message = 'Validation failed';
    details = Object.fromEntries(Object.entries(err.errors).map(([k, v]) => [k, v.message]));
  }
  if (err.name === 'CastError') {
    status = 400;
    message = `Invalid value for ${err.path}`;
  }
  if (err.code === 11000) {
    status = 409;
    const field = Object.keys(err.keyPattern || {})[0] || 'value';
    message = field === 'product_id'
      ? 'An open request of this kind already exists for this product'
      : `That ${field} is already in use`;
  }

  if (status >= 500) console.error('[error]', err);
  res.status(status).json({ error: message, ...(details ? { details } : {}) });
};

module.exports = { notFound, errorHandler };
