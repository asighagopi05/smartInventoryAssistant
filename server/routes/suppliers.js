const router = require('express').Router();
const asyncHandler = require('../utils/asyncHandler');
const ApiError = require('../utils/ApiError');
const { requireAuth, requireRole } = require('../middleware/auth');
const { Supplier, Product } = require('../models');

router.use(requireAuth);

router.get('/', asyncHandler(async (_req, res) => {
  const suppliers = await Supplier.find({ active: true }).sort({ name: 1 }).lean();
  const counts = await Product.aggregate([
    { $match: { active: true } },
    { $group: { _id: '$supplier_id', products: { $sum: 1 }, low: { $sum: { $cond: [{ $lte: ['$stock', '$threshold'] }, 1, 0] } } } },
  ]);
  const byId = Object.fromEntries(counts.map((c) => [String(c._id), c]));
  res.json({
    suppliers: suppliers.map((s) => ({
      ...s,
      product_count: byId[String(s._id)]?.products || 0,
      low_stock_count: byId[String(s._id)]?.low || 0,
    })),
  });
}));

router.post('/', requireRole('Manager'), asyncHandler(async (req, res) => {
  const supplier = await Supplier.create(req.body);
  res.status(201).json({ supplier });
}));

router.patch('/:id', requireRole('Manager'), asyncHandler(async (req, res) => {
  const supplier = await Supplier.findByIdAndUpdate(req.params.id, req.body, { new: true, runValidators: true });
  if (!supplier) throw ApiError.notFound('Supplier not found');
  res.json({ supplier });
}));

module.exports = router;
