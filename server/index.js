require('dotenv').config({ path: `${__dirname}/.env` });
const fs = require('fs');
const path = require('path');
const express = require('express');
const cors = require('cors');
const morgan = require('morgan');

const { connectDB, closeDB } = require('./config/db');
const { notFound, errorHandler } = require('./middleware/errorHandler');
const { evaluateDuePredictions } = require('./services/forecastService');

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
app.use('/api/combos', require('./routes/combos'));
app.use('/api/forecast', require('./routes/forecast'));
app.use('/api/insights', require('./routes/insights'));
app.use('/api/issues', require('./routes/issues'));
app.use('/api/tasks', require('./routes/tasks'));
app.use('/api/discussion', require('./routes/discussion'));

/**
 * The built screens, when there are any (`npm start` builds them).
 *
 * Serving them from the API puts the whole app on one port, so a phone needs
 * one address and the screens can call /api on the same origin. Any non-API
 * path gets index.html because the client uses BrowserRouter: a QR code that
 * opens /feedback/<id> directly must still load the app.
 */
const clientDist = path.join(__dirname, '..', 'client', 'dist');
if (fs.existsSync(path.join(clientDist, 'index.html'))) {
  app.use(express.static(clientDist));
  app.get(/^(?!\/api(\/|$)).*/, (_req, res) => res.sendFile(path.join(clientDist, 'index.html')));
}

app.use(notFound);
app.use(errorHandler);

const PORT = process.env.PORT || 5000;

(async () => {
  await connectDB(process.env.MONGODB_URI);
  const server = app.listen(PORT, () => {
    console.log(`[api] SIA API listening on http://localhost:${PORT}`);
  });

  // Fill in actual sales for forecasts whose week has ended: now, then hourly.
  // A plain timer rather than node-cron: one fixed interval needs no new package.
  const evaluate = () => evaluateDuePredictions()
    .then((n) => n && console.log(`[forecast] checked ${n} prediction(s) against actual sales`))
    .catch((err) => console.error('[forecast] evaluation failed:', err.message));
  evaluate();
  const evaluator = setInterval(evaluate, 60 * 60 * 1000);

  const shutdown = async (signal) => {
    console.log(`\n[api] ${signal} received, shutting down`);
    clearInterval(evaluator);
    server.close(async () => { await closeDB(); process.exit(0); });
  };
  process.on('SIGINT', () => shutdown('SIGINT'));
  process.on('SIGTERM', () => shutdown('SIGTERM'));
})();

module.exports = app;
