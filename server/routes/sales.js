const router = require('express').Router();
const asyncHandler = require('../utils/asyncHandler');
const ApiError = require('../utils/ApiError');
const { requireAuth, requireRole } = require('../middleware/auth');
const { toPaise } = require('../utils/money');
const { adjustStock } = require('../services/stockService');
const { Sale, Product, Customer } = require('../models');

router.use(requireAuth);

/**
 * Complete a sale.
 *
 * Billing is done by Staff and Manager, never the Owner - the account that
 * reviews the takings should not be able to create them.
 *
 * The phone field drives customer capture:
 *   blank        -> walk-in, completes normally. Nothing is ever gated on it.
 *   new number   -> the Customer is created as part of completing this sale.
 *   known number -> details load and can be corrected inline here.
 */
router.post('/', requireRole('Manager', 'Staff'), asyncHandler(async (req, res) => {
  const { items, customer, payment_method = 'cash', discount = 0 } = req.body;

  if (!Array.isArray(items) || items.length === 0) {
    throw ApiError.badRequest('A sale needs at least one item');
  }

  // Load every product first and check stock up front. Mongo is standalone here
  // so there are no multi-document transactions: decrementing item 1 and then
  // failing on item 3 would leave the sale half-applied. Checking first makes
  // that outcome very unlikely rather than routine.
  const ids = items.map((i) => i.productId);
  const products = await Product.find({ _id: { $in: ids }, active: true });
  const byId = new Map(products.map((p) => [String(p._id), p]));

  const shortfalls = [];
  for (const line of items) {
    const product = byId.get(String(line.productId));
    const qty = Number(line.qty);
    if (!product) throw ApiError.badRequest(`Product ${line.productId} not found or inactive`);
    if (!Number.isInteger(qty) || qty < 1) throw ApiError.badRequest(`Invalid quantity for ${product.name}`);
    if (product.stock < qty) shortfalls.push(`${product.name} (${product.stock} left, asked for ${qty})`);
  }
  if (shortfalls.length) {
    throw ApiError.conflict(`Not enough stock for: ${shortfalls.join('; ')}`);
  }

  // Customer upsert. Created here, as part of the sale - there is no separate
  // "add customer" step and no screen to leave.
  let customerDoc = null;
  if (customer && customer.phone) {
    const phone = String(customer.phone).trim();
    customerDoc = await Customer.findOne({ phone });
    if (customerDoc) {
      // Inline correction: moved house, name spelled wrong.
      if (customer.name && customer.name !== customerDoc.name) customerDoc.name = customer.name;
      if (customer.address && customer.address !== customerDoc.address) customerDoc.address = customer.address;
    } else {
      customerDoc = new Customer({
        phone,
        name: customer.name,
        address: customer.address,
        created_by: req.user.id,
        first_seen: new Date(),
      });
    }
  }

  const saleItems = [];
  const restockRaised = [];

  for (const line of items) {
    const product = byId.get(String(line.productId));
    const qty = Number(line.qty);

    // Stock moves through the one service, so the threshold check runs here
    // at runtime - this is what raises the restock request during the demo.
    const result = await adjustStock({
      productId: product._id,
      quantityChange: -qty,
      entryType: 'sale',
      reason: 'Sold at till',
      source: 'billing',
      userId: req.user.id,
    });

    if (result.restockRequest) {
      restockRaised.push({
        product: product.name,
        sku: product.sku,
        stock_now: result.stockAfter,
        threshold: product.threshold,
        qty_requested: result.restockRequest.qty,
      });
    }

    const unitPrice = product.get('price', null, { getters: false });
    saleItems.push({
      product_id: product._id,
      name: product.name,
      sku: product.sku,
      qty,
      unit_price: unitPrice,
      line_total: unitPrice * qty,
    });
  }

  const sale = new Sale({
    bill_no: await Sale.nextBillNo(),
    items: saleItems,
    discount: toPaise(discount),
    tax: 0,
    subtotal: 0, // recomputed by the pre-validate hook from items
    total: 0,
    payment_method,
    customer_id: customerDoc ? customerDoc._id : null,
    customer_phone: customerDoc ? customerDoc.phone : null,
    billed_by: req.user.id,
  });
  await sale.save();

  if (customerDoc) {
    customerDoc.visits += 1;
    customerDoc.total_spent = (customerDoc.get('total_spent', null, { getters: false }) || 0)
      + sale.get('total', null, { getters: false });
    customerDoc.last_seen = new Date();
    await customerDoc.save();
  }

  // restock_raised is surfaced so the till can tell the person at the counter
  // that a request went up by itself - the headline behaviour, made visible.
  res.status(201).json({
    sale: await sale.populate('billed_by', 'name role'),
    customer: customerDoc,
    restock_raised: restockRaised,
  });
}));

router.get('/', asyncHandler(async (req, res) => {
  const { limit = 50, customer, from, to } = req.query;
  const filter = {};
  if (customer) filter.customer_id = customer;
  if (from || to) {
    filter.createdAt = {};
    if (from) filter.createdAt.$gte = new Date(from);
    if (to) filter.createdAt.$lte = new Date(to);
  }

  const sales = await Sale.find(filter)
    .sort({ createdAt: -1 })
    .limit(Math.min(Number(limit) || 50, 200))
    .populate('billed_by', 'name role')
    .populate('customer_id', 'name phone')
    .lean({ getters: true });

  res.json({ sales });
}));

router.get('/:id', asyncHandler(async (req, res) => {
  const sale = await Sale.findById(req.params.id)
    .populate('billed_by', 'name role')
    .populate('customer_id', 'name phone address');
  if (!sale) throw ApiError.notFound('Sale not found');
  res.json({ sale });
}));

module.exports = router;
