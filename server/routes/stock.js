const router = require('express').Router();
const asyncHandler = require('../utils/asyncHandler');
const ApiError = require('../utils/ApiError');
const { requireAuth, requireRole } = require('../middleware/auth');
const { adjustStock, recordCount } = require('../services/stockService');
const { adjustmentTolerance } = require('../services/stockRules');
const { StockLog, Product } = require('../models');

router.use(requireAuth);

/** The ledger. Read-only by design: a correction is a new row, never an edit. */
router.get('/logs', asyncHandler(async (req, res) => {
  const { product, limit = 100 } = req.query;
  const filter = product ? { product_id: product } : {};
  const logs = await StockLog.find(filter)
    .sort({ createdAt: -1 })
    .limit(Math.min(Number(limit) || 100, 500))
    .populate('product_id', 'name sku unit')
    .populate('user_id', 'name role')
    .lean();
  res.json({ logs });
}));

/**
 * Direct movement: damage, returns, a manual correction within tolerance.
 *
 * Staff are held to the same tolerance as a count. Without that, writing 50
 * units off as "damage" here would skip the very approval the count screen
 * enforces, which is the shrinkage control the design relies on.
 */
const DIRECT_TYPES = ['damage', 'return', 'adjustment', 'received'];
router.post('/adjust', requireRole('Manager', 'Staff'), asyncHandler(async (req, res) => {
  const { productId, quantityChange, entryType = 'adjustment', reason } = req.body;
  if (!DIRECT_TYPES.includes(entryType)) {
    throw ApiError.badRequest(`entryType must be one of: ${DIRECT_TYPES.join(', ')}`);
  }
  if (req.user.role === 'Staff') {
    if (entryType === 'received') {
      throw ApiError.forbidden('Deliveries are received against an approved restock request');
    }
    const product = await Product.findById(productId).lean();
    if (!product) throw ApiError.notFound('Product not found');
    const tolerance = adjustmentTolerance(product.stock);
    if (Math.abs(Number(quantityChange)) > tolerance) {
      throw ApiError.forbidden(
        `A change of ${quantityChange} is beyond the tolerance of ${tolerance} for ${product.name}. `
        + 'Record a count instead, so the Manager can approve it.'
      );
    }
  }
  const result = await adjustStock({
    productId,
    quantityChange: Number(quantityChange),
    entryType,
    reason,
    source: 'manual',
    userId: req.user.id,
  });
  res.json({
    product: result.product,
    stock_before: result.stockBefore,
    stock_after: result.stockAfter,
    restock_raised: Boolean(result.restockRequest),
    restock_request: result.restockRequest,
  });
}));

/**
 * A physical count from the floor. Within tolerance it applies immediately;
 * beyond it, an adjustment request goes to the Manager rather than silently
 * rewriting stock.
 */
router.post('/count', requireRole('Manager', 'Staff'), asyncHandler(async (req, res) => {
  const { productId, countedStock, reason } = req.body;
  const result = await recordCount({
    productId,
    countedStock: Number(countedStock),
    userId: req.user.id,
    reason,
  });
  res.json(result);
}));

router.get('/tolerance/:id', asyncHandler(async (req, res) => {
  const product = await Product.findById(req.params.id).lean();
  res.json({
    system_stock: product ? product.stock : 0,
    tolerance: adjustmentTolerance(product ? product.stock : 0),
  });
}));

module.exports = router;
