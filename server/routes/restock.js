const router = require('express').Router();
const asyncHandler = require('../utils/asyncHandler');
const ApiError = require('../utils/ApiError');
const { requireAuth, requireRole } = require('../middleware/auth');
const { approveRestock, receiveRestock } = require('../services/stockService');
const { RestockRequest } = require('../models');
const { recordApprovalForecast } = require('../services/forecastService');

router.use(requireAuth);

/**
 * The approvals queue. `kind` picks restock orders (the default) or stock
 * adjustments from out-of-tolerance counts; they share a collection but not a
 * list, because approving them does different things.
 */
router.get('/', asyncHandler(async (req, res) => {
  const { status = 'open', limit = 100, kind = 'restock' } = req.query;
  if (!['restock', 'adjustment'].includes(kind)) throw ApiError.badRequest('kind must be restock or adjustment');
  const kindFilter = kind === 'adjustment' ? { kind: 'adjustment' } : { kind: { $ne: 'adjustment' } };

  let filter;
  if (status === 'open') filter = { status: { $in: ['pending', 'approved'] } };
  else if (status === 'closed') filter = { status: { $in: ['received', 'rejected', 'applied'] } };
  else if (status === 'all') filter = {};
  else filter = { status };

  const requests = await RestockRequest.find({ ...filter, ...kindFilter })
    .sort({ createdAt: -1 })
    .limit(Math.min(Number(limit) || 100, 500))
    .populate('product_id', 'name sku stock threshold unit category active')
    .populate('supplier_id', 'name phone')
    .populate('approved_by', 'name')
    .populate('raised_by', 'name role')
    .lean();

  const [counts, pendingAdjustments] = await Promise.all([
    RestockRequest.aggregate([
      { $match: kindFilter },
      { $group: { _id: '$status', n: { $sum: 1 } } },
    ]),
    RestockRequest.countDocuments({ kind: 'adjustment', status: 'pending' }),
  ]);
  res.json({
    requests,
    counts: Object.fromEntries(counts.map((c) => [c._id, c.n])),
    pending_adjustments: pendingAdjustments,
  });
}));

router.post('/:id/approve', requireRole('Manager'), asyncHandler(async (req, res) => {
  const request = await approveRestock({
    requestId: req.params.id,
    userId: req.user.id,
    approve: req.body.approve !== false,
    note: req.body.note,
  });
  // Record what the model expected this product to sell, so the approval can be checked later.
  // Only for a real order: an adjustment is a correction, not a bet on demand.
  const forecast = request.kind !== 'adjustment' && request.status === 'approved'
    ? await recordApprovalForecast(request) : null;
  res.json({ request, forecast });
}));

router.post('/:id/receive', requireRole('Manager', 'Staff'), asyncHandler(async (req, res) => {
  const result = await receiveRestock({
    requestId: req.params.id,
    userId: req.user.id,
    receivedQty: req.body.receivedQty !== undefined ? Number(req.body.receivedQty) : undefined,
  });
  res.json({
    request: result.request,
    product: result.product,
    stock_before: result.stockBefore,
    stock_after: result.stockAfter,
  });
}));

module.exports = router;
