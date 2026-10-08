const router = require('express').Router();
const asyncHandler = require('../utils/asyncHandler');
const ApiError = require('../utils/ApiError');
const { requireAuth, requireRole } = require('../middleware/auth');
const { Customer, Sale } = require('../models');

router.use(requireAuth);

router.get('/', asyncHandler(async (req, res) => {
  const { q, limit = 100 } = req.query;
  const filter = {};
  if (q) {
    const term = String(q).trim();
    filter.$or = [
      { phone: { $regex: term, $options: 'i' } },
      { name: { $regex: term, $options: 'i' } },
    ];
  }
  const customers = await Customer.find(filter)
    .sort({ last_seen: -1 })
    .limit(Math.min(Number(limit) || 100, 300))
    .lean({ getters: true });
  res.json({ customers });
}));

/**
 * Lookup by phone, used by the till as the number is typed.
 * A miss is a normal outcome, not an error - it opens the inline new-customer
 * form rather than blocking the sale.
 */
router.get('/by-phone/:phone', asyncHandler(async (req, res) => {
  const customer = await Customer.findOne({ phone: String(req.params.phone).trim() })
    .lean({ getters: true });
  if (!customer) return res.json({ customer: null, known: false });

  const recent = await Sale.find({ customer_id: customer._id })
    .sort({ createdAt: -1 }).limit(5)
    .select('bill_no total createdAt items')
    .lean({ getters: true });

  return res.json({ customer, known: true, recent_sales: recent });
}));

router.get('/:id', asyncHandler(async (req, res) => {
  const customer = await Customer.findById(req.params.id).lean({ getters: true });
  if (!customer) throw ApiError.notFound('Customer not found');

  const sales = await Sale.find({ customer_id: customer._id })
    .sort({ createdAt: -1 }).limit(50)
    .populate('billed_by', 'name')
    .lean({ getters: true });

  res.json({ customer, sales });
}));

/**
 * Maintenance by the Manager: fix a name, an address, or a changed number.
 *
 * Changing the phone is safe precisely because Sale stores customer_id as the
 * durable link and customer_phone only as a snapshot of what was printed.
 * History follows the customer; old bills still show the number they were
 * handed at the time.
 */
router.patch('/:id', requireRole('Manager'), asyncHandler(async (req, res) => {
  const { name, address, email, phone } = req.body;
  const customer = await Customer.findById(req.params.id);
  if (!customer) throw ApiError.notFound('Customer not found');

  if (phone && phone !== customer.phone) {
    const clash = await Customer.findOne({ phone: String(phone).trim() });
    if (clash) {
      throw ApiError.conflict(
        `${clash.name || 'Another customer'} already uses ${phone}. Merge the records rather than duplicating the number.`
      );
    }
    customer.phone = String(phone).trim();
  }
  if (name !== undefined) customer.name = name;
  if (address !== undefined) customer.address = address;
  if (email !== undefined) customer.email = email;

  await customer.save();
  res.json({ customer });
}));

module.exports = router;
