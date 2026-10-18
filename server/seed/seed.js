/* eslint-disable no-console */
/**
 * Seeds the `sia` database from real grocery basket data.
 *
 * The important property of this script is that it does NOT fabricate stock.
 * It replays 90 days chronologically: opening stock, then each day's sales
 * decrementing it through the SAME threshold rule the live service uses
 * (services/stockRules.js), raising a restock request when a product crosses
 * and receiving it a few days later.
 *
 * That means stock_before/stock_after on every ledger row are genuinely
 * consecutive, the ledger reconciles to current stock exactly, and every
 * historical restock request exists because the rule actually fired.
 *
 * Run: npm run seed
 */

require('dotenv').config({ path: `${__dirname}//../.env` });
const fs = require('fs');
const path = require('path');
const mongoose = require('mongoose');
const bcrypt = require('bcryptjs');

const { connectDB, closeDB } = require('../config/db');
const { toPaise } = require('../utils/money');
const { shouldRestock, restockQty, adjustmentTolerance } = require('../services/stockRules');
const {
  Counter, User, Supplier, Product, StockLog,
  RestockRequest, Sale, Customer, Note, Notification, Issue, Task,
} = require('../models');

// ---------------------------------------------------------------------------
// Deterministic randomness - the same database every run, so a demo is
// reproducible and so is any bug found in it.
// ---------------------------------------------------------------------------
function mulberry32(seed) {
  return function rand() {
    let t = (seed += 0x6d2b79f5);
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
const rand = mulberry32(20260925);
const randInt = (min, max) => Math.floor(rand() * (max - min + 1)) + min;
const pick = (arr) => arr[Math.floor(rand() * arr.length)];
const chance = (p) => rand() < p;

// ---------------------------------------------------------------------------
const DAYS = 90;
// The replay's last trading day closes at 22:00 (baskets run 08:00-21:59), so
// the whole history must end before the moment the seed runs. A fixed date in
// the future breaks the ledger: a live sale made at the demo would sort BETWEEN
// seeded sales dated later that evening, and the before/after chain would no
// longer join up. The anchor moves forward in whole weeks only, so the
// day-of-week pattern - and with it every random draw - stays identical; only
// the dates change.
const ANCHOR = new Date('2026-09-24T21:00:00');
const WEEK_MS = 7 * 86400000;
const HISTORY_ENDS_AFTER_ANCHOR_MS = 2 * 3600 * 1000; // last baskets + the demo-tuning count
const TODAY = new Date(ANCHOR.getTime()
  + Math.floor((Date.now() - HISTORY_ENDS_AFTER_ANCHOR_MS - ANCHOR.getTime()) / WEEK_MS) * WEEK_MS);
const DOW_WEIGHT = [1.3, 0.8, 0.85, 0.9, 0.95, 1.2, 1.5]; // Sun..Sat - weekends busier
const LEAD_TIME_DAYS = () => randInt(2, 4);
const RECENT_PENDING_DAYS = 6; // requests newer than this may still be awaiting the Manager
const CUSTOMER_COUNT = 400;
const CUSTOMER_SALE_SHARE = 0.4; // the rest are walk-ins

const dataDir = path.join(__dirname, 'data');

const FIRST_NAMES = ['Aarav', 'Vivaan', 'Aditya', 'Vihaan', 'Arjun', 'Sai', 'Reyansh', 'Krishna', 'Ishaan', 'Rohan',
  'Ananya', 'Diya', 'Saanvi', 'Aadhya', 'Kiara', 'Myra', 'Anika', 'Navya', 'Riya', 'Pooja',
  'Karthik', 'Praveen', 'Nithya', 'Lakshmi', 'Meena', 'Suresh', 'Ramesh', 'Deepa', 'Kavya', 'Harini'];
const LAST_NAMES = ['Sharma', 'Verma', 'Iyer', 'Nair', 'Menon', 'Reddy', 'Rao', 'Patel', 'Gupta', 'Kumar',
  'Krishnan', 'Subramanian', 'Pillai', 'Desai', 'Joshi', 'Chandran', 'Balan', 'Varghese', 'Shetty', 'Bhat'];
const AREAS = ['Anna Nagar', 'T Nagar', 'Adyar', 'Velachery', 'Guindy', 'Mylapore', 'Porur', 'Tambaram',
  'Ambattur', 'Chromepet', 'Perungudi', 'Saidapet'];

const SUPPLIERS = [
  { name: 'Annapurna Dairy Distributors', categories: ['Dairy'] },
  { name: 'Sri Balaji Bakery Supplies', categories: ['Bakery'] },
  { name: 'Green Valley Farm Fresh', categories: ['Produce'] },
  { name: 'Coastal Meat and Seafood Co', categories: ['Meat'] },
  { name: 'ColdChain Frozen Foods', categories: ['Frozen'] },
  { name: 'Sunrise Beverages Agency', categories: ['Beverages'] },
  { name: 'Metro Wines and Spirits', categories: ['Alcohol'] },
  { name: 'Crunch Time Snack Traders', categories: ['Snacks'] },
  { name: 'Bharat Staples and Provisions', categories: ['Staples'] },
  { name: 'HomeCare Wholesale Mart', categories: ['Household', 'Personal Care', 'Electronics'] },
];

// ---------------------------------------------------------------------------
async function main() {
  const started = Date.now();
  await connectDB(process.env.MONGODB_URI);

  console.log('\n[seed] dropping database...');
  await mongoose.connection.dropDatabase();

  // -- load source data ------------------------------------------------------
  const catalogue = JSON.parse(fs.readFileSync(path.join(dataDir, 'catalogue.json'), 'utf8'));
  delete catalogue._comment;

  const baskets = fs.readFileSync(path.join(dataDir, 'groceries.csv'), 'utf8')
    .split(/\r?\n/)
    .map((line) => line.split(',').map((s) => s.trim()).filter(Boolean))
    .filter((b) => b.length > 0);

  console.log(`[seed] ${baskets.length} real baskets, ${Object.keys(catalogue).length} catalogue items`);

  // -- users -----------------------------------------------------------------
  // Created down a chain: Owner -> Manager -> Staff. Nobody self-registers.
  const hash = (pw) => bcrypt.hashSync(pw, 10);
  const owner = await User.create({
    name: 'Rajesh Kumar', email: 'owner@sia.local', password_hash: hash('Owner@123'),
    role: 'Owner', phone: '9840012001', created_by: null,
  });
  const manager = await User.create({
    name: 'Priya Menon', email: 'manager@sia.local', password_hash: hash('Manager@123'),
    role: 'Manager', phone: '9840012002', created_by: owner._id,
  });
  const staff1 = await User.create({
    name: 'Arun Pillai', email: 'staff1@sia.local', password_hash: hash('Staff@123'),
    role: 'Staff', phone: '9840012003', created_by: manager._id,
  });
  const staff2 = await User.create({
    name: 'Divya Raman', email: 'staff2@sia.local', password_hash: hash('Staff@123'),
    role: 'Staff', phone: '9840012004', created_by: manager._id,
  });
  const tillUsers = [staff1, staff2, manager];
  console.log('[seed] users: 4');

  // -- suppliers -------------------------------------------------------------
  const supplierDocs = await Supplier.insertMany(SUPPLIERS.map((s, i) => ({
    name: s.name,
    categories: s.categories,
    contact_person: `${pick(FIRST_NAMES)} ${pick(LAST_NAMES)}`,
    phone: `9${randInt(400000000, 899999999)}`,
    email: `orders@${s.name.toLowerCase().replace(/[^a-z]+/g, '')}.co.in`,
    address: `${randInt(1, 200)}, ${pick(AREAS)}, Chennai ${randInt(600001, 600120)}`,
  })));
  const supplierByCategory = {};
  supplierDocs.forEach((doc, i) => {
    SUPPLIERS[i].categories.forEach((c) => { supplierByCategory[c] = doc._id; });
  });
  console.log(`[seed] suppliers: ${supplierDocs.length}`);

  // -- plan the 90 days ------------------------------------------------------
  // Spread the real baskets over 90 days, weighted by day of week.
  const dayWeights = [];
  for (let d = 0; d < DAYS; d += 1) {
    const date = new Date(TODAY);
    date.setDate(date.getDate() - (DAYS - 1 - d));
    dayWeights.push({ date, weight: DOW_WEIGHT[date.getDay()] });
  }
  const totalWeight = dayWeights.reduce((s, d) => s + d.weight, 0);
  let assigned = 0;
  dayWeights.forEach((d, i) => {
    d.count = i === DAYS - 1
      ? baskets.length - assigned
      : Math.round((d.weight / totalWeight) * baskets.length);
    assigned += d.count;
  });

  // Pre-assign a quantity to every basket line so product velocity can be
  // computed BEFORE thresholds are set. Thresholds must reflect real demand.
  const basketPlans = [];
  let cursor = 0;
  const unitsByItem = {};
  for (const day of dayWeights) {
    for (let k = 0; k < day.count && cursor < baskets.length; k += 1, cursor += 1) {
      const items = baskets[cursor].map((itemName) => {
        const qty = chance(0.72) ? 1 : chance(0.75) ? 2 : 3;
        unitsByItem[itemName] = (unitsByItem[itemName] || 0) + qty;
        return { itemName, qty };
      });
      const when = new Date(day.date);
      when.setHours(randInt(8, 21), randInt(0, 59), randInt(0, 59), 0);
      basketPlans.push({ when, items });
    }
  }
  basketPlans.sort((a, b) => a.when - b.when);

  // -- products --------------------------------------------------------------
  // Thresholds are derived from REAL sales velocity, not random numbers:
  // a product selling 40/week gets a threshold near 40, one selling 2/week gets 2.
  const products = [];
  let sku = 0;
  for (const [itemName, entry] of Object.entries(catalogue)) {
    sku += 1;
    const unitsSold = unitsByItem[itemName] || 0;
    const perDay = unitsSold / DAYS;
    const threshold = Math.max(5, Math.ceil(perDay * 7));
    const reorder = Math.max(10, Math.ceil(perDay * 21));
    products.push({
      _id: new mongoose.Types.ObjectId(),
      sku: `SIA-${String(sku).padStart(4, '0')}`,
      name: entry.name,
      category: entry.category,
      unit: entry.unit,
      price: toPaise(entry.price),
      cost: toPaise(Math.round(entry.price * (0.70 + rand() * 0.10))),
      stock: threshold + reorder, // ~28 days cover at opening
      threshold,
      reorder_qty: reorder,
      supplier_id: supplierByCategory[entry.category],
      active: true,
      _itemName: itemName,
    });
  }
  const productByItem = {};
  products.forEach((p) => { productByItem[p._itemName] = p; });
  await Product.insertMany(products.map(({ _itemName, ...p }) => p));
  console.log(`[seed] products: ${products.length}`);

  // -- customers -------------------------------------------------------------
  // Long-tail visit distribution: a few regulars, most occasional. A uniform
  // spread makes the customer screen look synthetic.
  const customers = [];
  const usedPhones = new Set();
  for (let i = 0; i < CUSTOMER_COUNT; i += 1) {
    let phone;
    do { phone = `${pick([6, 7, 8, 9])}${randInt(100000000, 999999999)}`; } while (usedPhones.has(phone));
    usedPhones.add(phone);
    customers.push({
      _id: new mongoose.Types.ObjectId(),
      phone,
      name: `${pick(FIRST_NAMES)} ${pick(LAST_NAMES)}`,
      address: chance(0.55) ? `${randInt(1, 120)}, ${pick(AREAS)}, Chennai ${randInt(600001, 600120)}` : undefined,
      visits: 0,
      total_spent: 0,
      created_by: pick(tillUsers)._id,
      _weight: Math.pow(rand(), 2.6), // squashed toward zero -> long tail
    });
  }
  const weightTotal = customers.reduce((s, c) => s + c._weight, 0);
  const cumulative = [];
  let acc = 0;
  customers.forEach((c) => { acc += c._weight / weightTotal; cumulative.push(acc); });
  const pickCustomer = () => {
    const r = rand();
    let lo = 0; let hi = cumulative.length - 1;
    while (lo < hi) { const mid = (lo + hi) >> 1; if (cumulative[mid] < r) lo = mid + 1; else hi = mid; }
    return customers[lo];
  };

  // -- the replay ------------------------------------------------------------
  console.log(`[seed] replaying ${DAYS} days of trading...`);
  const stockNow = {};
  products.forEach((p) => { stockNow[p.sku] = p.stock; });

  const sales = [];
  const stockLogs = [];
  const restockRequests = [];
  const pendingByProduct = {};   // sku -> restock request doc
  const inbound = [];            // { arrivesAt, request }
  let billSeq = 0;

  const receiveDue = (now) => {
    // Deliveries must be applied in arrival order, oldest first. Draining them
    // in array order records stock_before/stock_after values that do not chain
    // together once the ledger is read back sorted by time - which is exactly
    // how anyone auditing it will read it.
    inbound.sort((a, b) => a.arrivesAt - b.arrivesAt);
    while (inbound.length && inbound[0].arrivesAt <= now) {
      const { request, product, arrivesAt } = inbound.shift();
      const before = stockNow[product.sku];
      const after = before + request.qty;
      stockNow[product.sku] = after;
      request.status = 'received';
      request.received_at = arrivesAt;
      request.received_qty = request.qty;
      // Now, and only now, the product may raise a fresh request if it falls
      // below its threshold again.
      delete pendingByProduct[product.sku];
      stockLogs.push({
        product_id: product._id, entry_type: 'received',
        quantity_change: request.qty, stock_before: before, stock_after: after,
        reason: 'Restock received from supplier', source: 'restock',
        user_id: request.approved_by, restock_request_id: request._id,
        createdAt: arrivesAt, updatedAt: arrivesAt,
      });
    }
  };

  for (const plan of basketPlans) {
    receiveDue(plan.when);

    const cashier = pick(tillUsers);
    const attachCustomer = chance(CUSTOMER_SALE_SHARE);
    const customer = attachCustomer ? pickCustomer() : null;

    const saleId = new mongoose.Types.ObjectId();
    const items = [];
    let subtotal = 0;

    for (const line of plan.items) {
      const product = productByItem[line.itemName];
      if (!product) continue;
      const available = stockNow[product.sku];
      const qty = Math.min(line.qty, available);
      if (qty <= 0) continue;

      const lineTotal = product.price * qty;
      subtotal += lineTotal;
      items.push({
        product_id: product._id, name: product.name, sku: product.sku,
        qty, unit_price: product.price, line_total: lineTotal,
      });

      const before = available;
      const after = before - qty;
      stockNow[product.sku] = after;
      stockLogs.push({
        product_id: product._id, entry_type: 'sale',
        quantity_change: -qty, stock_before: before, stock_after: after,
        reason: 'Sold at till', source: 'billing',
        user_id: cashier._id, sale_id: saleId,
        createdAt: plan.when, updatedAt: plan.when,
      });

      // The threshold check - the same pure function the live service calls.
      if (shouldRestock(product, after) && !pendingByProduct[product.sku]) {
        const req = {
          _id: new mongoose.Types.ObjectId(),
          product_id: product._id, supplier_id: product.supplier_id,
          qty: restockQty(product), status: 'pending', trigger: 'auto',
          stock_at_request: after, threshold_at_request: product.threshold,
          raised_by: null, // raised by the server, not a person
          createdAt: plan.when, updatedAt: plan.when,
        };
        restockRequests.push(req);
        pendingByProduct[product.sku] = req;

        // The Manager works through the queue, but has not caught up on the
        // last few days - so recent requests are still genuinely waiting for a
        // decision, and the approvals screen has real work on it.
        const daysOld = (TODAY - plan.when) / 86400000;
        const decided = daysOld > RECENT_PENDING_DAYS || chance(0.3);

        if (decided) {
          const approvedAt = new Date(plan.when.getTime() + randInt(2, 20) * 3600 * 1000);
          req.status = 'approved';
          req.approved_by = manager._id;
          req.approved_at = approvedAt;
          const arrivesAt = new Date(approvedAt.getTime() + LEAD_TIME_DAYS() * 86400 * 1000);
          if (arrivesAt <= TODAY) {
            inbound.push({ arrivesAt, request: req, product });
          }
        }
        // The product stays in pendingByProduct until the goods actually
        // ARRIVE, not merely until the request is approved. It sits below its
        // threshold for the whole lead time, so releasing the guard at
        // approval would let every subsequent sale raise another order.
      }
    }

    if (items.length === 0) continue;

    billSeq += 1;
    const billDate = plan.when.toISOString().slice(0, 10).replace(/-/g, '');
    sales.push({
      _id: saleId,
      bill_no: `SIA-${billDate}-${String(billSeq).padStart(5, '0')}`,
      items, subtotal, discount: 0, tax: 0, total: subtotal,
      payment_method: pick(['cash', 'cash', 'upi', 'upi', 'card']),
      customer_id: customer ? customer._id : null,
      customer_phone: customer ? customer.phone : null,
      billed_by: cashier._id,
      createdAt: plan.when, updatedAt: plan.when,
    });

    if (customer) {
      customer.visits += 1;
      customer.total_spent += subtotal;
      customer.last_seen = plan.when;
      if (!customer.first_seen || plan.when < customer.first_seen) customer.first_seen = plan.when;
    }
  }
  receiveDue(TODAY);

  // Any request still in flight stays legitimately open for the Manager queue.
  inbound.forEach(({ request, product }) => { pendingByProduct[product.sku] = request; });

  // -- persist ---------------------------------------------------------------
  const writeCustomers = customers
    .filter((c) => c.visits > 0)
    .map(({ _weight, ...c }) => ({
      ...c,
      first_seen: c.first_seen || TODAY,
      last_seen: c.last_seen || TODAY,
    }));
  await Customer.insertMany(writeCustomers);
  console.log(`[seed] customers: ${writeCustomers.length} (with at least one visit)`);

  await RestockRequest.insertMany(restockRequests);
  console.log(`[seed] restock requests: ${restockRequests.length}`);

  await bulk(Sale, sales, 'sales');
  await bulk(StockLog, stockLogs, 'stock logs');

  // Current stock is whatever the replay actually arrived at.
  await Product.bulkWrite(products.map((p) => ({
    updateOne: { filter: { _id: p._id }, update: { $set: { stock: stockNow[p.sku] } } },
  })));

  await Counter.create({ _id: 'bill', seq: billSeq });

  // -- feedback --------------------------------------------------------------
  const COMMENTS_GOOD = ['Very fresh, will buy again.', 'Good quality for the price.', 'Always in stock here.',
    'Packaging was neat.', 'My family likes this one.', 'Better than the other shop nearby.'];
  const COMMENTS_BAD = ['Packet was damaged.', 'Near expiry date, please check stock.',
    'Price went up too much.', 'Not fresh this time.'];
  const notes = [];
  const soldProducts = products.filter((p) => (unitsByItem[p._itemName] || 0) > 0);
  for (let i = 0; i < 600; i += 1) {
    const product = pick(soldProducts);
    const good = chance(0.78);
    const rating = good ? pick([4, 5, 5, 4, 3]) : pick([1, 2, 2]);
    const when = new Date(TODAY.getTime() - randInt(0, DAYS) * 86400 * 1000);
    const linkedCustomer = chance(0.35) ? pick(writeCustomers) : null;
    notes.push({
      type: 'feedback', rating,
      body: good ? pick(COMMENTS_GOOD) : pick(COMMENTS_BAD),
      author_id: null,
      product_id: product._id,
      contact_phone: linkedCustomer ? linkedCustomer.phone : null,
      customer_id: linkedCustomer ? linkedCustomer._id : null,
      source: pick(['product_qr', 'shop_qr', 'bill_qr']),
      createdAt: when, updatedAt: when,
    });
  }
  await Note.insertMany(notes);
  console.log(`[seed] feedback notes: ${notes.length}`);

  // Recompute the denormalised rating fields from the notes just written.
  const ratingAgg = await Note.aggregate([
    { $match: { type: 'feedback', rating: { $ne: null } } },
    { $group: { _id: '$product_id', avg: { $avg: '$rating' }, count: { $sum: 1 } } },
  ]);
  await Product.bulkWrite(ratingAgg.map((r) => ({
    updateOne: {
      filter: { _id: r._id },
      update: { $set: { rating_avg: Math.round(r.avg * 10) / 10, rating_count: r.count } },
    },
  })));

  // -- floor: issues, tasks, discussion (Phase 3) ---------------------------
  // History is dated relative to the replay's last day; due dates relative to
  // the real today, so "due today" and "overdue" mean what they say at the demo.
  const ago = (days, hour = 10) => {
    const d = new Date(TODAY.getTime() - days * 86400000);
    d.setHours(hour, 0, 0, 0);
    return d;
  };
  const realToday = new Date();
  realToday.setHours(0, 0, 0, 0);
  const dueIn = (days) => new Date(realToday.getTime() + days * 86400000 + 12 * 3600000);
  const at = (date) => ({ createdAt: date, updatedAt: date });

  const [chiller, label, leak] = await Issue.insertMany([
    { title: 'Chiller 2 temperature fluctuating', description: 'Reads 9C in the evening instead of 4C.', category: 'equipment', severity: 'high', status: 'open', raised_by: staff1._id, ...at(ago(1, 18)) },
    { title: 'Shelf label wrong for Amul Butter', description: 'Shelf shows the old price.', category: 'pricing', severity: 'medium', status: 'open', raised_by: staff2._id, ...at(ago(2, 11)) },
    { title: 'Water leak near the produce rack', description: 'Small puddle forming each morning.', category: 'shelf', severity: 'medium', status: 'acknowledged', raised_by: staff1._id, acknowledged_by: manager._id, acknowledged_at: ago(3, 12), ...at(ago(4, 9)) },
    { title: 'Damaged carton of noodles', description: 'Six packets crushed in transit.', category: 'damage', severity: 'low', status: 'resolved', raised_by: staff2._id, resolved_by: manager._id, resolved_at: ago(3, 16), resolution_note: 'Written off and claimed from the supplier.', ...at(ago(4, 14)) },
    { title: 'Bread near expiry on shelf', description: 'Two loaves dated tomorrow, moved to front.', category: 'expiry', severity: 'low', status: 'resolved', raised_by: staff1._id, resolved_by: manager._id, resolved_at: ago(6, 17), resolution_note: 'Sold by evening at the reduced price.', ...at(ago(6, 9)) },
    { title: 'Billing counter scanner intermittent', description: 'Fails to read every few scans.', category: 'equipment', severity: 'medium', status: 'open', raised_by: staff2._id, ...at(ago(0, 15)) },
  ]);

  const tasks = await Task.insertMany([
    { title: 'Call the technician about Chiller 2', description: 'Ask for a visit before the weekend. Log the evening temperature until then.', assigned_to: staff1._id, created_by: manager._id, issue_id: chiller._id, due_date: dueIn(0), ...at(ago(0, 19)) },
    { title: 'Re-label the Amul Butter shelf with the new price', assigned_to: staff2._id, created_by: manager._id, issue_id: label._id, due_date: dueIn(-1), ...at(ago(1, 12)) },
    { title: 'Clear the drain under the produce rack', description: 'Bucket and gloves are in the back store.', assigned_to: staff1._id, created_by: manager._id, issue_id: leak._id, due_date: dueIn(2), ...at(ago(3, 12)) },
    { title: 'Move near-expiry bread to the front', assigned_to: staff2._id, created_by: manager._id, due_date: dueIn(1), ...at(ago(0, 9)) },
    { title: 'Face up the biscuit aisle before the weekend', assigned_to: staff1._id, created_by: manager._id, status: 'done', done_at: ago(2, 18), done_note: 'Done, and refilled the Parle-G facing.', ...at(ago(2, 10)) },
    { title: 'Count the chiller stock after the defrost', assigned_to: staff2._id, created_by: manager._id, status: 'done', done_at: ago(5, 16), done_note: 'All counts within tolerance.', ...at(ago(5, 9)) },
    { title: 'Rearrange the festival gift packs display', assigned_to: staff2._id, created_by: manager._id, status: 'cancelled', ...at(ago(7, 11)) },
  ]);

  // One level of replies: a reply points at its post through parent_id.
  const post = (author, body, when, parent = null) => ({
    _id: new mongoose.Types.ObjectId(), type: 'discussion', body, author_id: author._id,
    source: 'staff', parent_id: parent ? parent._id : null, ...at(when),
  });
  const p1 = post(staff1, 'Chiller 2 is running warm, please check before the evening rush.', ago(1, 17));
  const p2 = post(staff2, 'Dairy delivery arrived an hour late again this week.', ago(3, 9));
  const p3 = post(manager, 'Reminder: the weekly count is on Sunday morning. Please be in by 8.', ago(4, 20));
  const discussion = [
    p1,
    post(manager, 'Noted. Raising it with the technician today, and I have made it a task.', ago(1, 19), p1),
    post(staff1, 'Thanks. I will log the temperature every hour until they come.', ago(0, 9), p1),
    p2,
    post(manager, 'I will speak to Annapurna Dairy. Tell me if it happens again.', ago(3, 11), p2),
    p3,
  ];
  await Note.insertMany(discussion);
  console.log(`[seed] issues: 6, tasks: ${tasks.length}, discussion posts: ${discussion.length}`);

  // -- a handful of historical notifications --------------------------------
  // These are normally written by their triggers; only a few exist here so the
  // bell is not empty on first login. Each points at a real document.
  const openRequests = await RestockRequest.find({ status: { $in: ['pending', 'approved'] } })
    .sort({ createdAt: -1 }).limit(3).populate('product_id', 'name').lean();
  await Notification.insertMany([
    ...openRequests.map((r) => ({
      type: 'restock_request',
      title: 'Restock request raised',
      body: `${r.product_id?.name || 'A product'} crossed its threshold and a request was raised automatically.`,
      for_role: 'Manager', ref_type: 'RestockRequest', ref_id: r._id, link: '/restock',
      createdAt: r.createdAt, updatedAt: r.createdAt,
    })),
    {
      type: 'issue_raised', title: `High-severity issue flagged: ${chiller.title}`,
      body: `${staff1.name} flagged a high equipment issue. "${chiller.description}"`,
      for_role: 'Manager', ref_type: 'Issue', ref_id: chiller._id, link: '/issues', ...at(chiller.createdAt),
    },
    ...tasks.filter((t) => t.status === 'open').map((t) => ({
      type: 'task_assigned', title: `New task: ${t.title}`,
      body: `${manager.name} gave you a task.`,
      for_user_id: t.assigned_to, ref_type: 'Task', ref_id: t._id, link: '/tasks', ...at(t.createdAt),
    })),
  ]);

  // -- tune the live demo ----------------------------------------------------
  // Leave a few products one sale above their threshold so the auto-restock
  // demo fires on the first sale rather than the twentieth.
  const demoCandidates = await Product.find({
    _id: { $nin: Object.values(pendingByProduct).map((r) => r.product_id) },
  }).sort({ rating_count: -1 }).limit(60).lean();
  const demoPicks = demoCandidates.filter((p) => p.threshold >= 5).slice(0, 6);
  await Product.bulkWrite(demoPicks.map((p) => ({
    updateOne: { filter: { _id: p._id }, update: { $set: { stock: p.threshold + 1 } } },
  })));
  // Every change to stock must leave a ledger row behind, including this one.
  // Writing the product without the matching StockLog would break the very
  // reconciliation the replay exists to guarantee.
  // This correction must be the LAST movement for these products, otherwise a
  // delivery that landed after it would sort later and the ledger would no
  // longer end at the stock the product actually carries.
  const [newest] = await StockLog.find({}).sort({ createdAt: -1 }).limit(1).select('createdAt').lean();
  const tuneAt = new Date((newest ? newest.createdAt.getTime() : TODAY.getTime()) + 60 * 1000);
  await StockLog.insertMany(demoPicks.map((p) => ({
    product_id: p._id,
    entry_type: 'count',
    quantity_change: (p.threshold + 1) - p.stock,
    stock_before: p.stock,
    stock_after: p.threshold + 1,
    reason: 'Physical count correction during evening shift',
    source: 'manual',
    user_id: staff1._id,
    createdAt: tuneAt,
    updatedAt: tuneAt,
  })));

  // -- one stock count waiting for the Manager ------------------------------
  // So the approvals queue shows the adjustment flow on first login. Raised
  // last, against the stock the product holds now, exactly as a live count
  // through the stock service would be.
  const parked = new Set(demoPicks.map((p) => String(p._id)));
  const countTarget = (await Product.find({ active: true, stock: { $gte: 20 } }).sort({ rating_count: -1 }).limit(40).lean())
    .find((p) => !parked.has(String(p._id)));
  if (countTarget) {
    const off = adjustmentTolerance(countTarget.stock) + 3;
    const adj = await RestockRequest.create({
      product_id: countTarget._id, supplier_id: countTarget.supplier_id,
      kind: 'adjustment', trigger: 'manual', status: 'pending',
      qty: off, counted_stock: countTarget.stock - off, difference: -off,
      stock_at_request: countTarget.stock, threshold_at_request: countTarget.threshold,
      raised_by: staff2._id, note: 'Two cartons missing from the back store',
    });
    await Notification.create({
      type: 'adjustment_request', title: 'Stock adjustment needs approval',
      body: `${countTarget.name}: counted ${countTarget.stock - off} against system ${countTarget.stock}, a difference of ${-off} (tolerance ${adjustmentTolerance(countTarget.stock)}).`,
      for_role: 'Manager', ref_type: 'RestockRequest', ref_id: adj._id, link: '/restock#adjustments',
    });
    console.log(`[seed] pending stock count: ${countTarget.name} (${countTarget.stock} -> counted ${countTarget.stock - off})`);
  }

  // -- report ----------------------------------------------------------------
  const counts = {};
  for (const [name, Model] of Object.entries({ User, Supplier, Product, StockLog, RestockRequest, Sale, Customer, Note, Notification, Issue, Task })) {
    counts[name] = await Model.countDocuments();
  }

  console.log('\n===================== SEED COMPLETE =====================');
  console.table(counts);
  console.log('\nDemo logins');
  console.log('  Owner    owner@sia.local     Owner@123    (sees all, cannot bill)');
  console.log('  Manager  manager@sia.local   Manager@123  (approves restock, bills)');
  console.log('  Staff    staff1@sia.local    Staff@123    (till and floor)');
  console.log('  Staff    staff2@sia.local    Staff@123');
  console.log('\nProducts parked one sale above threshold - sell any of these to fire auto-restock live:');
  demoPicks.forEach((p) => console.log(`  ${p.sku}  ${p.name}  (stock ${p.threshold + 1}, threshold ${p.threshold})`));
  console.log(`\nDone in ${((Date.now() - started) / 1000).toFixed(1)}s`);
  console.log('=========================================================\n');

  await closeDB();
}

async function bulk(Model, docs, label, size = 2000) {
  for (let i = 0; i < docs.length; i += size) {
    await Model.insertMany(docs.slice(i, i + size), { ordered: false });
  }
  console.log(`[seed] ${label}: ${docs.length}`);
}

main().catch(async (err) => {
  console.error('\n[seed] FAILED:', err);
  try { await closeDB(); } catch (_) { /* already closed */ }
  process.exit(1);
});
