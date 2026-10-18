const { Product, StockLog, RestockRequest, Notification, User } = require('../models');
const { shouldRestock, restockQty, needsApproval, adjustmentTolerance } = require('./stockRules');
const ApiError = require('../utils/ApiError');

/**
 * The single place stock moves.
 *
 * Every path that changes stock - a sale, a delivery, a physical count, a
 * damage write-off - goes through adjustStock, and the threshold check lives
 * INSIDE it. That is the whole fix for the previous build, where the restock
 * logic ran once at seed time over products that were already low, and the
 * runtime path wrote a stock log but never re-checked the threshold. The
 * headline feature existed only in the demo data.
 */

/**
 * @param {object} opts
 * @param {string} opts.productId
 * @param {number} opts.quantityChange  signed: -3 for a sale, +50 for a delivery
 * @param {string} opts.entryType       sale | received | count | damage | return | adjustment
 * @param {string} opts.userId          who is accountable for this movement
 */
async function adjustStock({
  productId, quantityChange, entryType, reason, source = 'manual',
  userId, saleId = null, restockRequestId = null,
}) {
  if (!Number.isInteger(quantityChange) || quantityChange === 0) {
    throw ApiError.badRequest('quantityChange must be a non-zero integer');
  }

  // Atomic and guarded: the filter refuses the update if it would take stock
  // negative, so two concurrent sales cannot oversell the last unit.
  const filter = { _id: productId, active: true };
  if (quantityChange < 0) filter.stock = { $gte: -quantityChange };

  const product = await Product.findOneAndUpdate(
    filter,
    { $inc: { stock: quantityChange } },
    { returnDocument: 'after' }
  );

  if (!product) {
    const exists = await Product.findById(productId).lean();
    if (!exists) throw ApiError.notFound('Product not found');
    if (!exists.active) throw ApiError.badRequest(`${exists.name} is not active`);
    throw ApiError.conflict(
      `Not enough stock for ${exists.name} - ${exists.stock} left, tried to remove ${-quantityChange}`
    );
  }

  const stockAfter = product.stock;
  const stockBefore = stockAfter - quantityChange;

  await StockLog.create({
    product_id: product._id,
    entry_type: entryType,
    quantity_change: quantityChange,
    stock_before: stockBefore,
    stock_after: stockAfter,
    reason,
    source,
    user_id: userId,
    sale_id: saleId,
    restock_request_id: restockRequestId,
  });

  // The threshold check, at runtime, on the way out - not at seed time.
  const restock = quantityChange < 0 ? await maybeRaiseRestock(product) : null;

  return { product, stockBefore, stockAfter, restockRequest: restock };
}

/**
 * Raises a restock request if the product has crossed its threshold.
 *
 * Duplicate suppression is enforced by a partial unique index on
 * RestockRequest (product_id, where status is pending) rather than by an
 * existence check alone. A check-then-insert can be raced by two concurrent
 * sales crossing the threshold in the same instant; the index cannot be.
 * The duplicate-key error is the expected, non-exceptional outcome here.
 */
async function maybeRaiseRestock(product) {
  if (!shouldRestock(product, product.stock)) return null;

  try {
    const request = await RestockRequest.create({
      product_id: product._id,
      supplier_id: product.supplier_id,
      qty: restockQty(product),
      kind: 'restock',
      status: 'pending',
      trigger: 'auto',
      stock_at_request: product.stock,
      threshold_at_request: product.threshold,
      raised_by: null, // raised by the server, not by a person
    });

    await Notification.create({
      type: 'restock_request',
      title: 'Restock request raised automatically',
      body: `${product.name} fell to ${product.stock}, at or below its threshold of ${product.threshold}. A request for ${request.qty} units was raised.`,
      for_role: 'Manager',
      ref_type: 'RestockRequest',
      ref_id: request._id,
      link: '/restock',
    });

    return request;
  } catch (err) {
    if (err.code === 11000) return null; // already an open request - correct outcome
    throw err;
  }
}

/**
 * A physical count from the floor.
 *
 * Small differences are ordinary miscounts and apply straight away. Beyond the
 * tolerance it stops being a correction, so it raises an adjustment request for
 * the Manager instead of silently rewriting stock. That is the shrinkage
 * control, placed in the workflow rather than in a separate role.
 */
async function recordCount({ productId, countedStock, userId, reason }) {
  if (!Number.isInteger(countedStock) || countedStock < 0) {
    throw ApiError.badRequest('The count must be a whole number, 0 or more');
  }
  const product = await Product.findById(productId);
  if (!product) throw ApiError.notFound('Product not found');
  if (!product.active) throw ApiError.badRequest(`${product.name} is not active`);

  const difference = countedStock - product.stock;
  if (difference === 0) return { applied: true, difference: 0, product };

  if (needsApproval(product.stock, countedStock)) {
    const request = await RestockRequest.create({
      product_id: product._id,
      supplier_id: product.supplier_id,
      qty: Math.abs(difference),
      kind: 'adjustment',
      counted_stock: countedStock,
      difference,
      status: 'pending',
      trigger: 'manual',
      stock_at_request: product.stock,
      threshold_at_request: product.threshold,
      raised_by: userId,
      note: reason ? String(reason).slice(0, 400) : undefined,
    }).catch((err) => {
      if (err.code === 11000) {
        throw ApiError.conflict(`A stock count for ${product.name} is already waiting for the Manager. It must be approved or rejected before another one.`);
      }
      throw err;
    });

    await Notification.create({
      type: 'adjustment_request',
      title: 'Stock adjustment needs approval',
      body: `${product.name}: counted ${countedStock} against system ${product.stock}, a difference of ${difference} (tolerance ${adjustmentTolerance(product.stock)}).`,
      for_role: 'Manager',
      ref_type: 'RestockRequest',
      ref_id: request._id,
      link: '/restock#adjustments',
    });

    return { applied: false, difference, needsApproval: true, request, product };
  }

  const result = await adjustStock({
    productId, quantityChange: difference, entryType: 'count',
    reason: reason || `Physical count: ${countedStock}`, source: 'manual', userId,
  });
  return { applied: true, difference, ...result };
}

/** Manager approves an open request. */
async function approveRestock({ requestId, userId, approve = true, note }) {
  const request = await RestockRequest.findById(requestId);
  if (!request) throw ApiError.notFound('Restock request not found');
  if (request.status !== 'pending') {
    throw ApiError.badRequest(`This request is already ${request.status}`);
  }
  if (request.kind === 'adjustment') return decideAdjustment({ request, userId, approve, note });

  request.status = approve ? 'approved' : 'rejected';
  request.approved_by = userId;
  request.approved_at = new Date();
  if (note) request.note = note;
  await request.save();

  const product = await Product.findById(request.product_id).lean();
  await Notification.create({
    type: 'restock_approved',
    title: approve ? 'Restock approved' : 'Restock rejected',
    body: `${product?.name || 'A product'}: request for ${request.qty} units was ${request.status}.`,
    for_role: 'Staff',
    ref_type: 'RestockRequest',
    ref_id: request._id,
    link: '/restock',
  });

  return request;
}

/**
 * The Manager decides an out-of-tolerance count.
 *
 * Approving applies the counted difference straight away, through adjustStock
 * like every other movement, and closes the request as `applied`. Before
 * Phase 3 an adjustment was stored as an ordinary restock request, so
 * approving one left it "in transit" and "Mark received" then ADDED the
 * difference as a delivery - a shortage of 10 became 10 extra units.
 *
 * The difference, not the counted figure, is what gets applied. Sales made
 * between the count and the approval moved the system stock and the real shelf
 * by the same amount, so the gap between them is still exactly `difference`.
 */
async function decideAdjustment({ request, userId, approve, note }) {
  const product = await Product.findById(request.product_id).lean();
  const counter = await User.findById(request.raised_by).select('name').lean();
  const approver = await User.findById(userId).select('name').lean();

  if (approve) {
    try {
      await adjustStock({
        productId: request.product_id,
        quantityChange: request.difference,
        entryType: 'adjustment',
        reason: `Count by ${counter?.name || 'staff'} approved by ${approver?.name || 'the Manager'}: `
          + `counted ${request.counted_stock}, system had ${request.stock_at_request}`,
        source: 'manual',
        userId: request.raised_by || userId,
        restockRequestId: request._id,
      });
    } catch (err) {
      if (err.status === 409) {
        throw ApiError.conflict(
          `Cannot apply: ${product?.name || 'the product'} now holds less than the ${-request.difference} units this count would remove. `
          + 'Stock has moved since the count - reject this one and count again.'
        );
      }
      throw err;
    }
  }

  request.status = approve ? 'applied' : 'rejected';
  request.approved_by = userId;
  request.approved_at = new Date();
  if (note) request.note = [request.note, `Manager: ${note}`].filter(Boolean).join(' | ').slice(0, 400);
  await request.save();

  const signed = request.difference > 0 ? `+${request.difference}` : String(request.difference);
  await Notification.create({
    type: 'adjustment_decided',
    title: approve ? 'Your stock count was approved' : 'Your stock count was rejected',
    body: approve
      ? `${product?.name || 'A product'}: the ${signed} correction from your count of ${request.counted_stock} is now applied.`
      : `${product?.name || 'A product'}: your count of ${request.counted_stock} (${signed}) was not applied. Stock is unchanged.`,
    for_user_id: request.raised_by,
    ref_type: 'RestockRequest',
    ref_id: request._id,
    link: '/stock',
  });

  return request;
}

/** Goods arrive. Stock rises through the same service, and the request closes. */
async function receiveRestock({ requestId, userId, receivedQty }) {
  const request = await RestockRequest.findById(requestId);
  if (!request) throw ApiError.notFound('Restock request not found');
  if (request.kind === 'adjustment') {
    throw ApiError.badRequest('A stock adjustment is applied when it is approved; there is nothing to receive');
  }
  if (request.status !== 'approved') {
    throw ApiError.badRequest(`Only an approved request can be received - this one is ${request.status}`);
  }

  const qty = Number.isInteger(receivedQty) && receivedQty > 0 ? receivedQty : request.qty;

  const result = await adjustStock({
    productId: request.product_id,
    quantityChange: qty,
    entryType: 'received',
    reason: `Received against request ${request._id}`,
    source: 'restock',
    userId,
    restockRequestId: request._id,
  });

  request.status = 'received';
  request.received_at = new Date();
  request.received_qty = qty;
  await request.save();

  await Notification.create({
    type: 'stock_received',
    title: 'Stock received',
    body: `${result.product.name}: ${qty} units received, stock now ${result.stockAfter}.`,
    for_role: 'Manager',
    ref_type: 'RestockRequest',
    ref_id: request._id,
    link: '/stock',
  });

  return { request, ...result };
}

module.exports = { adjustStock, maybeRaiseRestock, recordCount, approveRestock, receiveRestock };
