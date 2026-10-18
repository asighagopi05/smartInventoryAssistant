const router = require('express').Router();
const asyncHandler = require('../utils/asyncHandler');
const { requireAuth } = require('../middleware/auth');
const { toRupees } = require('../utils/money');
const { Product, Sale, RestockRequest, Customer, Note, Issue, Task } = require('../models');

router.use(requireAuth);

/**
 * Everything the dashboard needs, in one request.
 *
 * All money aggregation happens in paise - aggregation pipelines bypass the
 * Mongoose getters - and converts to rupees once, here at the edge.
 */
router.get('/', asyncHandler(async (req, res) => {
  const now = new Date();
  const startOfToday = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const thirtyDaysAgo = new Date(startOfToday.getTime() - 30 * 86400000);

  const [
    productCount, lowStock, openRequests, pendingRequests,
    customerCount, todayAgg, thirtyDayAgg, salesByDay,
    topProducts, categoryMix, recentFeedback, openIssues, openTasks, stockValueAgg,
  ] = await Promise.all([
    Product.countDocuments({ active: true }),
    Product.countDocuments({ active: true, $expr: { $lte: ['$stock', '$threshold'] } }),
    RestockRequest.countDocuments({ kind: { $ne: 'adjustment' }, status: { $in: ['pending', 'approved'] } }),
    RestockRequest.countDocuments({ kind: { $ne: 'adjustment' }, status: 'pending' }),
    Customer.countDocuments(),

    Sale.aggregate([
      { $match: { createdAt: { $gte: startOfToday } } },
      { $group: { _id: null, revenue: { $sum: '$total' }, bills: { $sum: 1 } } },
    ]),

    Sale.aggregate([
      { $match: { createdAt: { $gte: thirtyDaysAgo } } },
      { $group: { _id: null, revenue: { $sum: '$total' }, bills: { $sum: 1 } } },
    ]),

    Sale.aggregate([
      { $match: { createdAt: { $gte: thirtyDaysAgo } } },
      {
        $group: {
          _id: { $dateToString: { format: '%Y-%m-%d', date: '$createdAt' } },
          revenue: { $sum: '$total' },
          bills: { $sum: 1 },
        },
      },
      { $sort: { _id: 1 } },
    ]),

    Sale.aggregate([
      { $match: { createdAt: { $gte: thirtyDaysAgo } } },
      { $unwind: '$items' },
      {
        $group: {
          _id: '$items.product_id',
          name: { $first: '$items.name' },
          units: { $sum: '$items.qty' },
          revenue: { $sum: '$items.line_total' },
        },
      },
      { $sort: { units: -1 } },
      { $limit: 8 },
    ]),

    Sale.aggregate([
      { $match: { createdAt: { $gte: thirtyDaysAgo } } },
      { $unwind: '$items' },
      {
        $lookup: {
          from: 'products', localField: 'items.product_id',
          foreignField: '_id', as: 'p',
        },
      },
      { $unwind: '$p' },
      { $group: { _id: '$p.category', revenue: { $sum: '$items.line_total' }, units: { $sum: '$items.qty' } } },
      { $sort: { revenue: -1 } },
    ]),

    Note.find({ type: 'feedback' }).sort({ createdAt: -1 }).limit(5)
      .populate('product_id', 'name').lean(),

    Issue.countDocuments({ status: { $in: ['open', 'acknowledged'] } }),
    Task.countDocuments({ status: 'open' }),

    Product.aggregate([
      { $match: { active: true } },
      { $group: { _id: null, value: { $sum: { $multiply: ['$stock', '$cost'] } } } },
    ]),
  ]);

  res.json({
    totals: {
      products: productCount,
      low_stock: lowStock,
      open_restock: openRequests,
      pending_approval: pendingRequests,
      customers: customerCount,
      open_issues: openIssues,
      open_tasks: openTasks,
      stock_value: toRupees(stockValueAgg[0] ? stockValueAgg[0].value : 0),
    },
    today: {
      revenue: toRupees(todayAgg[0] ? todayAgg[0].revenue : 0),
      bills: todayAgg[0] ? todayAgg[0].bills : 0,
    },
    last_30_days: {
      revenue: toRupees(thirtyDayAgg[0] ? thirtyDayAgg[0].revenue : 0),
      bills: thirtyDayAgg[0] ? thirtyDayAgg[0].bills : 0,
    },
    sales_by_day: salesByDay.map((d) => ({ date: d._id, revenue: toRupees(d.revenue), bills: d.bills })),
    top_products: topProducts.map((p) => ({
      id: p._id, name: p.name, units: p.units, revenue: toRupees(p.revenue),
    })),
    category_mix: categoryMix.map((c) => ({ category: c._id, revenue: toRupees(c.revenue), units: c.units })),
    recent_feedback: recentFeedback,
  });
}));

/**
 * The small counts on the sidebar, in one request so the shell polls once.
 *   approvals: reorders and stock counts waiting on a Manager decision
 *   issues:    flagged and not yet acknowledged
 *   tasks:     open tasks given to whoever is signed in
 */
router.get('/badges', asyncHandler(async (req, res) => {
  const [approvals, issues, tasks] = await Promise.all([
    RestockRequest.countDocuments({ status: 'pending' }),
    Issue.countDocuments({ status: 'open' }),
    req.user.role === 'Owner' ? 0 : Task.countDocuments({ assigned_to: req.user.id, status: 'open' }),
  ]);
  res.json({ approvals, issues, tasks });
}));

/** The low-stock list, which is what the Manager actually acts on. */
router.get('/low-stock', asyncHandler(async (_req, res) => {
  const products = await Product.find({ active: true, $expr: { $lte: ['$stock', '$threshold'] } })
    .populate('supplier_id', 'name')
    .sort({ stock: 1 })
    .limit(100)
    .lean({ getters: true });

  const openIds = await RestockRequest.find({ kind: { $ne: 'adjustment' }, status: { $in: ['pending', 'approved'] } })
    .distinct('product_id');
  const open = new Set(openIds.map(String));

  res.json({
    products: products.map((p) => ({ ...p, has_open_request: open.has(String(p._id)) })),
  });
}));

module.exports = router;
