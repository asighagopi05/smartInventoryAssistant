require('dotenv').config({ path: `${__dirname}/.env` });
const express = require('express');
const cors = require('cors');
const morgan = require('morgan');

const { connectDB, closeDB } = require('./config/db');
const { notFound, errorHandler } = require('./middleware/errorHandler');

const app = express();

/**
 * CORS reflects whatever origin asks.
 *
 * The screens are served from localhost:5173 on this machine, but a phone
 * scanning a QR code loads them from the LAN address instead - a different
 * origin. Pinning this to one hostname would make the public feedback page
 * fail on exactly the device it exists for. This is a single-shop deployment
 * on a private network; a public one would list its origins explicitly.
 */
app.use(cors({ origin: true, credentials: true }));
app.use(express.json({ limit: '1mb' }));
if (process.env.NODE_ENV !== 'test') app.use(morgan('dev'));

app.get('/api/health', (_req, res) => res.json({ ok: true, service: 'sia-api', time: new Date() }));

app.use('/api/auth', require('./routes/auth'));
app.use('/api/products', require('./routes/products'));
app.use('/api/suppliers', require('./routes/suppliers'));
app.use('/api/stock', require('./routes/stock'));
app.use('/api/restock', require('./routes/restock'));
app.use('/api/sales', require('./routes/sales'));
app.use('/api/customers', require('./routes/customers'));
app.use('/api/feedback', require('./routes/feedback'));   // contains the PUBLIC routes
app.use('/api/notifications', require('./routes/notifications'));
app.use('/api/dashboard', require('./routes/dashboard'));

app.use(notFound);
app.use(errorHandler);

const PORT = process.env.PORT || 5000;

(async () => {
  await connectDB(process.env.MONGODB_URI);
  const server = app.listen(PORT, () => {
    console.log(`[api] SIA API listening on http://localhost:${PORT}`);
  });

  const shutdown = async (signal) => {
    console.log(`\n[api] ${signal} received, shutting down`);
    server.close(async () => { await closeDB(); process.exit(0); });
  };
  process.on('SIGINT', () => shutdown('SIGINT'));
  process.on('SIGTERM', () => shutdown('SIGTERM'));
})();

module.exports = app;
