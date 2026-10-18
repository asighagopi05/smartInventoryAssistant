const router = require('express').Router();
const asyncHandler = require('../utils/asyncHandler');
const ApiError = require('../utils/ApiError');
const { requireAuth, requireRole } = require('../middleware/auth');
const { Issue, Product, Notification } = require('../models');

router.use(requireAuth);

const POPULATE = [
  ['product_id', 'name sku category'],
  ['raised_by', 'name role'],
  ['acknowledged_by', 'name'],
  ['resolved_by', 'name'],
];
const populated = (q) => POPULATE.reduce((acc, [path, fields]) => acc.populate(path, fields), q);

const SEVERITY_ORDER = { high: 0, medium: 1, low: 2 };

/**
 * Everyone on the floor sees every issue: in a shop this size the point of
 * flagging something is that the next person on shift knows about it too.
 */
router.get('/', asyncHandler(async (req, res) => {
  const { status = 'active', mine, limit = 200 } = req.query;
  const filter = {};
  if (status === 'active') filter.status = { $in: ['open', 'acknowledged'] };
  else if (status !== 'all') {
    if (!Issue.STATUSES.includes(status)) throw ApiError.badRequest(`Unknown status ${status}`);
    filter.status = status;
  }
  if (mine === '1') filter.raised_by = req.user.id;

  const issues = await populated(Issue.find(filter))
    .sort({ createdAt: -1 })
    .limit(Math.min(Number(limit) || 200, 500))
    .lean();

  // Unresolved work reads most urgent first; history reads newest first.
  if (status !== 'resolved' && status !== 'all') {
    issues.sort((a, b) => SEVERITY_ORDER[a.severity] - SEVERITY_ORDER[b.severity]
      || new Date(b.createdAt) - new Date(a.createdAt));
  }

  const [counts, highOpen] = await Promise.all([
    Issue.aggregate([{ $group: { _id: '$status', n: { $sum: 1 } } }]),
    Issue.countDocuments({ severity: 'high', status: { $in: ['open', 'acknowledged'] } }),
  ]);

  res.json({
    issues,
    counts: { ...Object.fromEntries(counts.map((c) => [c._id, c.n])), high_active: highOpen },
  });
}));

/** Flag a problem. Staff and the Manager are on the floor; the Owner reviews. */
router.post('/', requireRole('Manager', 'Staff'), asyncHandler(async (req, res) => {
  const { title, description, productId, category, severity } = req.body;

  let product = null;
  if (productId) {
    product = await Product.findById(productId).select('name').lean();
    if (!product) throw ApiError.badRequest('That product does not exist');
  }

  const issue = await Issue.create({
    title, description, category, severity,
    product_id: product ? product._id : null,
    raised_by: req.user.id,
  });

  await Notification.create({
    type: 'issue_raised',
    title: `${severity === 'high' ? 'High-severity issue' : 'Issue'} flagged: ${issue.title}`.slice(0, 160),
    body: `${req.user.name} flagged a ${issue.severity} ${issue.category} issue${product ? ` on ${product.name}` : ''}.`
      + `${issue.description ? ` "${issue.description}"` : ''}`.slice(0, 500),
    for_role: 'Manager',
    ref_type: 'Issue',
    ref_id: issue._id,
    link: '/issues',
  });

  res.status(201).json({ issue: await populated(Issue.findById(issue._id)).lean() });
}));

/**
 * Move an issue along. Only the Manager decides, and only forward in order -
 * except reopening, for when a "fixed" chiller is warm again the next day.
 */
const TRANSITIONS = {
  acknowledge: { from: ['open'], to: 'acknowledged' },
  resolve: { from: ['open', 'acknowledged'], to: 'resolved' },
  reopen: { from: ['resolved'], to: 'open' },
};

router.post('/:id/:action(acknowledge|resolve|reopen)', requireRole('Manager'), asyncHandler(async (req, res) => {
  const { action } = req.params;
  const rule = TRANSITIONS[action];
  const issue = await Issue.findById(req.params.id);
  if (!issue) throw ApiError.notFound('Issue not found');
  if (!rule.from.includes(issue.status)) {
    throw ApiError.badRequest(`Cannot ${action} an issue that is ${issue.status}`);
  }

  const now = new Date();
  issue.status = rule.to;
  if (action === 'acknowledge') {
    issue.acknowledged_by = req.user.id;
    issue.acknowledged_at = now;
  } else if (action === 'resolve') {
    issue.resolved_by = req.user.id;
    issue.resolved_at = now;
    issue.resolution_note = req.body.note ? String(req.body.note).trim().slice(0, 500) : null;
  } else {
    issue.resolved_by = null;
    issue.resolved_at = null;
    issue.resolution_note = null;
  }
  await issue.save();

  // The person who flagged it hears what happened, unless they did it themselves.
  if (String(issue.raised_by) !== req.user.id) {
    const verb = { acknowledge: 'acknowledged', resolve: 'resolved', reopen: 'reopened' }[action];
    await Notification.create({
      type: 'issue_updated',
      title: `Your issue was ${verb}: ${issue.title}`.slice(0, 160),
      body: `${req.user.name} ${verb} it.${issue.resolution_note ? ` "${issue.resolution_note}"` : ''}`.slice(0, 500),
      for_user_id: issue.raised_by,
      ref_type: 'Issue',
      ref_id: issue._id,
      link: '/issues',
    });
  }

  res.json({ issue: await populated(Issue.findById(issue._id)).lean() });
}));

module.exports = router;
