const router = require('express').Router();
const asyncHandler = require('../utils/asyncHandler');
const { requireAuth, requireRole } = require('../middleware/auth');
const { Sale, ComboCache } = require('../models');
const { callML } = require('../services/mlClient');

// Measured on the seed data: good rules sit at 0.33%-0.65% support, so the
// textbook 0.01 returns nothing. Confidence 0.2 keeps Atta -> Sugar (28.7%).
const MIN_SUPPORT = 0.003;
const MIN_CONFIDENCE = 0.2;

router.use(requireAuth);

// GET /api/combos  -> the last saved rule set. Works with Python switched off.
router.get('/', requireRole('Owner', 'Manager'), asyncHandler(async (_req, res) => {
  const cache = await ComboCache.findById('latest').populate('generated_by', 'name').lean();
  res.json({ combos: cache || null });
}));

// POST /api/combos/generate  -> run Apriori on every sale and save the result
router.post('/generate', requireRole('Owner', 'Manager'), asyncHandler(async (req, res) => {
  // 1. Read only the item names from every sale
  const sales = await Sale.find({}, { 'items.name': 1 }).lean();

  // 2. One basket per sale
  const baskets = sales.map((s) => s.items.map((i) => i.name));

  // 3. Ask the Python service
  const data = await callML('/combos', { baskets, min_support: MIN_SUPPORT, min_confidence: MIN_CONFIDENCE });

  // 4. Save it, replacing the previous run
  const cache = await ComboCache.findByIdAndUpdate(
    'latest',
    {
      basket_count: data.basket_count,
      min_support: MIN_SUPPORT,
      min_confidence: MIN_CONFIDENCE,
      rules: data.rules,
      generated_at: new Date(),
      generated_by: req.user.id,
    },
    { upsert: true, returnDocument: 'after', runValidators: true }
  ).populate('generated_by', 'name').lean();

  res.json({ combos: cache });
}));

module.exports = router;
