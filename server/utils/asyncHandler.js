/** Wraps an async route so a rejected promise reaches the error middleware. */
module.exports = (fn) => (req, res, next) => Promise.resolve(fn(req, res, next)).catch(next);
