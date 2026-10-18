const router = require('express').Router();
const rateLimit = require('express-rate-limit');
const QRCode = require('qrcode');
const asyncHandler = require('../utils/asyncHandler');
const ApiError = require('../utils/ApiError');
const { requireAuth, requireRole } = require('../middleware/auth');
const { Note, Product, Customer, Notification, Sale } = require('../models');

/**
 * PUBLIC ROUTES - deliberately no auth, no redirect to login, no account prompt.
 *
 * A customer scanning a shelf QR has no account and never will. Anything that
 * asked them to sign in would end the interaction. The trade-off is that this
 * is an unauthenticated write, so it is rate limited per IP: without that, the
 * bad-review notification to the Manager is trivially spammable.
 */
const publicLimiter = rateLimit({
  windowMs: 10 * 60 * 1000,
  max: 20,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Too many submissions from this device. Please try again later.' },
});

/** What the public feedback page needs to render. No auth. */
router.get('/public/context', publicLimiter, asyncHandler(async (req, res) => {
  const { product: productId, sale: saleId } = req.query;

  let product = null;
  if (productId) {
    product = await Product.findOne({ _id: productId, active: true })
      .select('name sku category unit rating_avg rating_count')
      .lean();
  }

  // The bill QR already knows what they bought, so nothing is asked of them.
  let saleItems = null;
  if (saleId) {
    const sale = await Sale.findById(saleId).select('items customer_phone').lean();
    if (sale) {
      saleItems = sale.items.map((i) => ({ product_id: i.product_id, name: i.name, sku: i.sku }));
    }
  }

  const products = product || saleItems
    ? []
    : await Product.find({ active: true }).select('name sku category').sort({ name: 1 }).limit(200).lean();

  res.json({ product, sale_items: saleItems, products });
}));

/** Submit feedback. Public. */
router.post('/public', publicLimiter, asyncHandler(async (req, res) => {
  const { productId, rating, comment, phone, saleId, source = 'shop_qr' } = req.body;

  const score = Number(rating);
  if (!Number.isInteger(score) || score < 1 || score > 5) {
    throw ApiError.badRequest('Please give a rating between 1 and 5');
  }

  const product = productId ? await Product.findById(productId).lean() : null;

  // A phone is optional. If it matches a known customer the feedback links to
  // their history; if it does not, the feedback is simply anonymous. Nothing
  // is gated on giving it.
  let customer = null;
  if (phone) customer = await Customer.findOne({ phone: String(phone).trim() }).lean();

  const note = await Note.create({
    type: 'feedback',
    rating: score,
    body: comment,
    author_id: null, // null author means this came from a customer, not staff
    product_id: product ? product._id : null,
    sale_id: saleId || null,
    contact_phone: phone ? String(phone).trim() : null,
    customer_id: customer ? customer._id : null,
    source,
  });

  // Keep the denormalised product rating in step with the feedback.
  if (product) {
    const agg = await Note.aggregate([
      { $match: { type: 'feedback', product_id: product._id, rating: { $ne: null } } },
      { $group: { _id: null, avg: { $avg: '$rating' }, count: { $sum: 1 } } },
    ]);
    if (agg[0]) {
      await Product.updateOne(
        { _id: product._id },
        { $set: { rating_avg: Math.round(agg[0].avg * 10) / 10, rating_count: agg[0].count } }
      );
    }
  }

  if (score <= 2) {
    await Notification.create({
      type: 'bad_review',
      title: `${score}-star review received`,
      body: `${product ? product.name : 'The shop'} was rated ${score}/5.${comment ? ` "${comment}"` : ''}`,
      for_role: 'Manager',
      ref_type: 'Note',
      ref_id: note._id,
      link: '/feedback',
    });
  }

  res.status(201).json({ ok: true, message: 'Thank you for the feedback.' });
}));

// --------------------------------------------------------------------------
// Staff-facing from here down.
// --------------------------------------------------------------------------
router.use(requireAuth);

router.get('/', asyncHandler(async (req, res) => {
  const { rating, limit = 100 } = req.query;
  const filter = { type: 'feedback' };
  if (rating) filter.rating = Number(rating);

  const notes = await Note.find(filter)
    .sort({ createdAt: -1 })
    .limit(Math.min(Number(limit) || 100, 300))
    .populate('product_id', 'name sku category')
    .populate('customer_id', 'name phone')
    .lean();

  const summary = await Note.aggregate([
    { $match: { type: 'feedback', rating: { $ne: null } } },
    { $group: { _id: '$rating', n: { $sum: 1 } } },
  ]);

  res.json({
    notes,
    summary: Object.fromEntries(summary.map((s) => [s._id, s.n])),
  });
}));

// The internal discussion board lives in routes/discussion.js (/api/discussion).

/**
 * QR generation, server-side. The Manager prints these.
 *
 * PUBLIC_BASE_URL must point at an address a phone can actually reach - the
 * machine LAN IP, not localhost. No internet is needed, but the phone and the
 * laptop do need to be on the same network.
 */
router.get('/qr', requireRole('Manager', 'Owner', 'Staff'), asyncHandler(async (req, res) => {
  const { type = 'shop', id } = req.query;
  // Staff bill at the till, so the receipt QR must work for them; shelf and
  // shop QRs are printed by management only.
  if (req.user.role === 'Staff' && type !== 'bill') {
    throw ApiError.forbidden('Staff can only generate the QR printed on a bill');
  }
  const base = process.env.PUBLIC_BASE_URL || 'http://localhost:5173';

  let target;
  if (type === 'product') {
    if (!id) throw ApiError.badRequest('A product id is required for a product QR');
    target = `${base}/feedback/${id}`;
  } else if (type === 'bill') {
    if (!id) throw ApiError.badRequest('A sale id is required for a bill QR');
    target = `${base}/feedback?sale=${id}`;
  } else {
    target = `${base}/feedback`;
  }

  const dataUrl = await QRCode.toDataURL(target, { width: 420, margin: 2 });
  res.json({ type, target, dataUrl });
}));

module.exports = router;
