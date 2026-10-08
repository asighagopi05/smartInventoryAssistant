const { Product, StockLog, RestockRequest, Notification } = require('../models');
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
  const product = await Product.findById(productId);
  if (!product) throw ApiError.notFound('Product not found');

  const difference = countedStock - product.stock;
  if (difference === 0) return { applied: true, difference: 0, product };

  if (needsApproval(product.stock, countedStock)) {
    const request = await RestockRequest.create({
      product_id: product._id,
      supplier_id: product.supplier_id,
      qty: Math.abs(difference),
      status: 'pending',
      trigger: 'manual',
      stock_at_request: product.stock,
      threshold_at_request: product.threshold,
      raised_by: userId,
      note: `Adjustment request: counted ${countedStock} against system ${product.stock} (difference ${difference}). ${reason || ''}`.trim(),
    }).catch((err) => {
      if (err.code === 11000) throw ApiError.conflict('An approval is already pending for this product');
      throw err;
    });

    await Notification.create({
      type: 'adjustment_request',
      title: 'Stock adjustment needs approval',
      body: `${product.name}: counted ${countedStock} against system ${product.stock}, a difference of ${difference} (tolerance ${adjustmentTolerance(product.stock)}).`,
      for_role: 'Manager',
      ref_type: 'RestockRequest',
      ref_id: request._id,
      link: '/restock',
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

/** Goods arrive. Stock rises through the same service, and the request closes. */
async function receiveRestock({ requestId, userId, receivedQty }) {
  const request = await RestockRequest.findById(requestId);
  if (!request) throw ApiError.notFound('Restock request not found');
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
