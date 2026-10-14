const router = require('express').Router();
const asyncHandler = require('../utils/asyncHandler');
const { requireAuth, requireRole } = require('../middleware/auth');
const { approveRestock, receiveRestock } = require('../services/stockService');
const { RestockRequest } = require('../models');
const { recordApprovalForecast } = require('../services/forecastService');

router.use(requireAuth);

router.get('/', asyncHandler(async (req, res) => {
  const { status = 'open', limit = 100 } = req.query;
  let filter;
  if (status === 'open') filter = { status: { $in: ['pending', 'approved'] } };
  else if (status === 'all') filter = {};
  else filter = { status };

  const requests = await RestockRequest.find(filter)
    .sort({ createdAt: -1 })
    .limit(Math.min(Number(limit) || 100, 500))
    .populate('product_id', 'name sku stock threshold unit category')
    .populate('supplier_id', 'name phone')
    .populate('approved_by', 'name')
    .lean();

  const counts = await RestockRequest.aggregate([{ $group: { _id: '$status', n: { $sum: 1 } } }]);
  res.json({
    requests,
    counts: Object.fromEntries(counts.map((c) => [c._id, c.n])),
  });
}));

router.post('/:id/approve', requireRole('Manager'), asyncHandler(async (req, res) => {
  const request = await approveRestock({
    requestId: req.params.id,
    userId: req.user.id,
    approve: req.body.approve !== false,
    note: req.body.note,
  });
  // Record what the model expected this product to sell, so the approval can be checked later
  const forecast = request.status === 'approved' ? await recordApprovalForecast(request) : null;
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
