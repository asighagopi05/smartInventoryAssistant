const router = require('express').Router();
const asyncHandler = require('../utils/asyncHandler');
const ApiError = require('../utils/ApiError');
const { requireAuth, requireRole } = require('../middleware/auth');
const { toPaise } = require('../utils/money');
const { Product, RestockRequest } = require('../models');

router.use(requireAuth);

/** List and search. Powers the product screen and the inline till search. */
router.get('/', asyncHandler(async (req, res) => {
  const { q, category, low, limit = 200, page = 1 } = req.query;
  const filter = { active: true };
  if (category && category !== 'all') filter.category = category;
  if (q) filter.name = { $regex: String(q).trim(), $options: 'i' };

  const perPage = Math.min(Number(limit) || 200, 500);
  let products = await Product.find(filter)
    .populate('supplier_id', 'name')
    .sort({ name: 1 })
    .skip((Number(page) - 1) * perPage)
    .limit(perPage)
    .lean({ getters: true });

  products = products.map((p) => ({ ...p, is_low_stock: p.stock <= p.threshold }));
  if (low === 'true') products = products.filter((p) => p.is_low_stock);

  res.json({ products, total: await Product.countDocuments(filter) });
}));

router.get('/categories', asyncHandler(async (_req, res) => {
  const categories = await Product.distinct('category', { active: true });
  res.json({ categories: categories.sort() });
}));

router.get('/:id', asyncHandler(async (req, res) => {
  const product = await Product.findById(req.params.id).populate('supplier_id', 'name phone');
  if (!product) throw ApiError.notFound('Product not found');
  res.json({ product });
}));

router.post('/', requireRole('Manager'), asyncHandler(async (req, res) => {
  const body = { ...req.body };
  if (body.price !== undefined) body.price = toPaise(body.price);
  if (body.cost !== undefined) body.cost = toPaise(body.cost);
  const product = await Product.create(body);
  res.status(201).json({ product });
}));

router.patch('/:id', requireRole('Manager'), asyncHandler(async (req, res) => {
  const body = { ...req.body };
  delete body.stock; // stock only ever moves through the stock service
  if (body.price !== undefined) body.price = toPaise(body.price);
  if (body.cost !== undefined) body.cost = toPaise(body.cost);

  const product = await Product.findByIdAndUpdate(req.params.id, body, { new: true, runValidators: true });
  if (!product) throw ApiError.notFound('Product not found');
  res.json({ product });
}));

/**
 * Soft delete. Old bills and stock logs reference this product forever.
 *
 * Its open requests are closed as rejected: stock can no longer move on an
 * inactive product, so they could never be received or applied and would sit
 * in the Manager's queue for good.
 */
router.delete('/:id', requireRole('Manager'), asyncHandler(async (req, res) => {
  const product = await Product.findByIdAndUpdate(req.params.id, { active: false }, { new: true });
  if (!product) throw ApiError.notFound('Product not found');
  const closed = await RestockRequest.updateMany(
    { product_id: product._id, status: { $in: ['pending', 'approved'] } },
    { $set: { status: 'rejected', approved_by: req.user.id, approved_at: new Date(), note: 'Closed: product deactivated' } }
  );
  res.json({
    product,
    closed_requests: closed.modifiedCount,
    note: 'Deactivated, not deleted - historical records still reference it',
  });
}));

module.exports = router;
