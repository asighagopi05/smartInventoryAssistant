/* eslint-disable no-console */
/**
 * Walks the Phase 3 verification list from docs/PLAN.md against the running API,
 * plus the edge cases each workflow has to get right.
 *
 * Like apitest, it creates its own throwaway product so the demo data is left
 * alone, and deactivates it at the end. The issues, tasks and discussion posts
 * it creates all start with "[test]"; once every check has run they are
 * removed straight from the database, with the notifications they caused, so
 * repeated runs do not fill the demo boards with test chatter.
 *
 * Run: npm run phase3test   (with the server already running)
 */

require('dotenv').config({ path: `${__dirname}/../.env` });
const mongoose = require('mongoose');

const BASE = `http://localhost:${process.env.PORT || 5000}/api`;
const results = [];

const check = (name, ok, detail = '') => {
  results.push({ name, ok, detail });
  console.log(`  ${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? `  -> ${detail}` : ''}`);
};
const heading = (text) => console.log(`\n-- ${text} ${'-'.repeat(Math.max(0, 66 - text.length))}`);

async function call(path, { method = 'GET', token, body } = {}) {
  const res = await fetch(BASE + path, {
    method,
    headers: {
      'Content-Type': 'application/json',
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
    ...(body ? { body: JSON.stringify(body) } : {}),
  });
  let json = null;
  try { json = await res.json(); } catch { /* empty body */ }
  return { status: res.status, body: json };
}

const login = async (email, password) => {
  const r = await call('/auth/login', { method: 'POST', body: { email, password } });
  if (r.status !== 200) throw new Error(`login failed for ${email}: ${JSON.stringify(r.body)}`);
  return { token: r.body.token, user: r.body.user };
};

const stockOf = async (token, id) => (await call(`/products/${id}`, { token })).body.product.stock;

async function main() {
  console.log('\nVerifying Phase 3 against the running API');

  const owner = await login('owner@sia.local', 'Owner@123');
  const manager = await login('manager@sia.local', 'Manager@123');
  const staff = await login('staff1@sia.local', 'Staff@123');
  const staff2 = await login('staff2@sia.local', 'Staff@123');

  const suppliers = await call('/suppliers', { token: manager.token });
  const made = await call('/products', {
    method: 'POST', token: manager.token,
    body: {
      sku: `P3TEST-${Date.now()}`, name: 'Phase 3 Test Product', category: 'Household', unit: 'pc',
      price: 50, cost: 30, stock: 0, threshold: 5, reorder_qty: 40,
      supplier_id: suppliers.body.suppliers[0]._id,
    },
  });
  if (made.status !== 201) throw new Error(`could not create the test product: ${JSON.stringify(made.body)}`);
  const product = made.body.product;
  await call('/stock/adjust', {
    method: 'POST', token: manager.token,
    body: { productId: product._id, quantityChange: 10, entryType: 'received', reason: 'Phase 3 test opening stock' },
  });

  try {
    await adjustments({ owner, manager, staff, product });
    await issues({ owner, manager, staff, staff2, product });
    await tasks({ owner, manager, staff, staff2, product });
    await discussion({ owner, manager, staff, staff2 });
    await notificationCentre({ manager, staff, staff2 });
  } finally {
    // -- cleanup: deactivating closes the product's open requests ---------------
    heading('Cleanup');
    const del = await call(`/products/${product._id}`, { method: 'DELETE', token: manager.token });
    const left = await call('/restock?kind=adjustment&status=pending&limit=500', { token: manager.token });
    const leftRestock = await call('/restock?status=open&limit=500', { token: manager.token });
    const stillOpen = [...left.body.requests, ...leftRestock.body.requests]
      .filter((r) => String(r.product_id?._id) === String(product._id));
    check('Deactivating a product closes its open requests', del.status === 200 && stillOpen.length === 0,
      `${del.body?.closed_requests} closed, ${stillOpen.length} still open`);
    await removeTestRecords();
  }

  const failed = results.filter((r) => !r.ok);
  console.log(`\n${results.length - failed.length}/${results.length} checks passed`);
  if (failed.length) {
    console.log('\nFAILED:');
    failed.forEach((f) => console.log(`  - ${f.name}${f.detail ? ` (${f.detail})` : ''}`));
  }
  console.log('');
  process.exit(failed.length ? 1 : 0);
}

// ---------------------------------------------------------------------------
// 3.3  Adjustment requests
// ---------------------------------------------------------------------------
async function adjustments({ manager, staff, product }) {
  heading('3.3  Stock counts beyond tolerance need the Manager');
  const pid = product._id;
  const start = await stockOf(manager.token, pid);

  const big = await call('/stock/count', {
    method: 'POST', token: staff.token,
    body: { productId: pid, countedStock: start - 8, reason: '[test] shelf short' },
  });
  const req = big.body?.request;
  check('An out-of-tolerance count raises an adjustment instead of applying',
    big.status === 200 && big.body.applied === false && req?.kind === 'adjustment',
    `system ${start}, counted ${start - 8}, kind ${req?.kind}`);
  check('Stock is unchanged until the Manager decides', (await stockOf(manager.token, pid)) === start);
  check('The adjustment records the count and the signed difference',
    req?.counted_stock === start - 8 && req?.difference === -8 && req?.stock_at_request === start,
    `counted ${req?.counted_stock}, difference ${req?.difference}`);

  const again = await call('/stock/count', {
    method: 'POST', token: staff.token,
    body: { productId: pid, countedStock: 0, reason: '[test] second count' },
  });
  check('A second count while one is waiting is refused (409)', again.status === 409, again.body?.error);

  // Before Phase 3 a pending adjustment held the product's only open slot, so
  // crossing the threshold here would have raised NO restock request.
  const sale = await call('/sales', {
    method: 'POST', token: staff.token,
    body: { items: [{ productId: pid, qty: start - 5 }] },
  });
  check('A pending count does not block the automatic restock',
    sale.status === 201 && sale.body.restock_raised?.length === 1,
    `${sale.body?.restock_raised?.length ?? 0} restock request(s) raised at stock 5`);

  const queue = await call('/restock?kind=adjustment&status=pending', { token: manager.token });
  const restockQueue = await call('/restock?status=pending', { token: manager.token });
  check('Adjustments and restock orders are listed separately',
    queue.body.requests.some((r) => r._id === req._id)
      && !restockQueue.body.requests.some((r) => r._id === req._id)
      && restockQueue.body.pending_adjustments >= 1,
    `${queue.body.requests.length} adjustment(s) waiting`);

  const staffApprove = await call(`/restock/${req._id}/approve`, { method: 'POST', token: staff.token, body: { approve: true } });
  check('Staff cannot approve an adjustment (403)', staffApprove.status === 403);

  // Stock is now 5 and the count says 8 fewer: applying would go negative.
  const tooFar = await call(`/restock/${req._id}/approve`, { method: 'POST', token: manager.token, body: { approve: true } });
  check('Approving a correction larger than current stock is refused, not clamped (409)',
    tooFar.status === 409, tooFar.body?.error);
  check('...and the refused approval left the request pending',
    (await call('/restock?kind=adjustment&status=pending', { token: manager.token }))
      .body.requests.some((r) => r._id === req._id));

  const rejected = await call(`/restock/${req._id}/approve`, { method: 'POST', token: manager.token, body: { approve: false } });
  check('The Manager can reject a count; stock is unchanged',
    rejected.status === 200 && rejected.body.request.status === 'rejected' && (await stockOf(manager.token, pid)) === 5,
    `status ${rejected.body?.request?.status}`);

  const staffNotes = await call('/notifications?limit=50', { token: staff.token });
  check('The person who counted is told it was rejected',
    staffNotes.body.notifications.some((n) => n.type === 'adjustment_decided' && String(n.ref_id) === req._id && /rejected/.test(n.title)));

  // -- approve a shortage ----------------------------------------------------
  const short = await call('/stock/count', {
    method: 'POST', token: staff.token, body: { productId: pid, countedStock: 1, reason: '[test] four missing' },
  });
  const sreq = short.body.request;
  const before = await stockOf(manager.token, pid);
  const ok = await call(`/restock/${sreq._id}/approve`, { method: 'POST', token: manager.token, body: { approve: true } });
  const after = await stockOf(manager.token, pid);
  check('Approving a shortage REMOVES the difference from stock',
    ok.status === 200 && ok.body.request.status === 'applied' && after === before - 4,
    `${before} -> ${after}, status ${ok.body?.request?.status}`);
  check('No forecast is recorded for an adjustment (it is not an order)', ok.body.forecast === null);

  const logs = await call(`/stock/logs?product=${pid}&limit=5`, { token: manager.token });
  const row = logs.body.logs[0];
  check('The ledger row is an adjustment, in the counter\'s name, citing the approver',
    row.entry_type === 'adjustment' && row.quantity_change === -4
      && String(row.user_id?._id) === String(staff.user.id) && /approved by/i.test(row.reason),
    `${row.entry_type} ${row.quantity_change} by ${row.user_id?.name}: "${row.reason}"`);

  const receive = await call(`/restock/${sreq._id}/receive`, { method: 'POST', token: manager.token, body: {} });
  check('An adjustment can never be "received" as a delivery', receive.status === 400, receive.body?.error);

  // -- approve a surplus -----------------------------------------------------
  const surplus = await call('/stock/count', {
    method: 'POST', token: staff.token, body: { productId: pid, countedStock: after + 6, reason: '[test] found a carton' },
  });
  const plus = await call(`/restock/${surplus.body.request._id}/approve`, { method: 'POST', token: manager.token, body: { approve: true } });
  check('Approving a surplus adds the difference',
    plus.status === 200 && (await stockOf(manager.token, pid)) === after + 6, `${after} -> ${after + 6}`);

  // -- the direct-adjust route obeys the same tolerance ----------------------
  const sneak = await call('/stock/adjust', {
    method: 'POST', token: staff.token,
    body: { productId: pid, quantityChange: -6, entryType: 'damage', reason: '[test] large write-off' },
  });
  check('Staff cannot write off more than the tolerance directly (403)', sneak.status === 403, sneak.body?.error);
  const small = await call('/stock/adjust', {
    method: 'POST', token: staff.token,
    body: { productId: pid, quantityChange: -1, entryType: 'damage', reason: '[test] one damaged' },
  });
  check('A write-off within tolerance still applies', small.status === 200, `stock now ${small.body?.stock_after}`);
}

// ---------------------------------------------------------------------------
// 3.1  Issues
// ---------------------------------------------------------------------------
const created = { issues: [], tasks: [] };

async function issues({ owner, manager, staff, staff2, product }) {
  heading('3.1  Issues: Staff flag, the Manager sees and resolves');

  const raised = await call('/issues', {
    method: 'POST', token: staff.token,
    body: { title: '[test] Freezer door not sealing', description: 'Gap at the bottom left', category: 'equipment', severity: 'high', productId: product._id },
  });
  const issue = raised.body?.issue;
  if (issue) created.issues.push(issue._id);
  check('Staff can flag an issue', raised.status === 201 && issue?.status === 'open'
    && issue?.raised_by?.name === staff.user.name && issue?.product_id?.name === product.name,
    `${raised.status}, raised by ${issue?.raised_by?.name}`);

  const ownerRaise = await call('/issues', { method: 'POST', token: owner.token, body: { title: '[test] owner' } });
  check('The Owner reviews issues but does not flag them (403)', ownerRaise.status === 403);
  const blank = await call('/issues', { method: 'POST', token: staff.token, body: { title: '   ' } });
  check('An issue with no title is rejected (400)', blank.status === 400, blank.body?.details?.title || blank.body?.error);
  const badCat = await call('/issues', { method: 'POST', token: staff.token, body: { title: '[test] x', category: 'aliens' } });
  check('An unknown category is rejected (400)', badCat.status === 400);

  const mgrList = await call('/issues?status=active', { token: manager.token });
  check('The Manager sees it in the active list, high severity first',
    mgrList.body.issues.some((i) => i._id === issue._id) && mgrList.body.issues[0].severity === 'high',
    `${mgrList.body.issues.length} active, first is ${mgrList.body.issues[0]?.severity}`);

  const mgrNotes = await call('/notifications?limit=100', { token: manager.token });
  check('Flagging it notified the Manager',
    mgrNotes.body.notifications.some((n) => n.type === 'issue_raised' && String(n.ref_id) === issue._id));

  const other = await call('/issues?status=active', { token: staff2.token });
  check('Other staff on the floor can see it too', other.body.issues.some((i) => i._id === issue._id));
  const mine = await call('/issues?status=all&mine=1', { token: staff2.token });
  check('"Only mine" shows only issues that person flagged',
    mine.status === 200 && mine.body.issues.every((i) => String(i.raised_by?._id) === String(staff2.user.id)));

  const staffResolve = await call(`/issues/${issue._id}/resolve`, { method: 'POST', token: staff.token, body: {} });
  check('Staff cannot resolve an issue (403)', staffResolve.status === 403);

  const ack = await call(`/issues/${issue._id}/acknowledge`, { method: 'POST', token: manager.token });
  check('The Manager acknowledges it; who and when are recorded',
    ack.status === 200 && ack.body.issue.status === 'acknowledged' && ack.body.issue.acknowledged_by?.name === manager.user.name
      && !!ack.body.issue.acknowledged_at);
  const ackAgain = await call(`/issues/${issue._id}/acknowledge`, { method: 'POST', token: manager.token });
  check('It cannot be acknowledged twice (400)', ackAgain.status === 400, ackAgain.body?.error);

  const res = await call(`/issues/${issue._id}/resolve`, { method: 'POST', token: manager.token, body: { note: 'Seal replaced' } });
  check('Resolving it closes it, with the note',
    res.status === 200 && res.body.issue.status === 'resolved' && res.body.issue.resolution_note === 'Seal replaced'
      && res.body.issue.resolved_by?.name === manager.user.name);
  const active = await call('/issues?status=active', { token: manager.token });
  check('A resolved issue leaves the active list', !active.body.issues.some((i) => i._id === issue._id));

  const staffNotes = await call('/notifications?limit=100', { token: staff.token });
  const updates = staffNotes.body.notifications.filter((n) => n.type === 'issue_updated' && String(n.ref_id) === issue._id);
  check('The person who flagged it was told at each step', updates.length === 2,
    updates.map((u) => u.title.split(':')[0]).join(' / '));

  const reopen = await call(`/issues/${issue._id}/reopen`, { method: 'POST', token: manager.token });
  check('A resolved issue can be reopened, clearing the resolution',
    reopen.status === 200 && reopen.body.issue.status === 'open' && reopen.body.issue.resolved_at === null);
  await call(`/issues/${issue._id}/resolve`, { method: 'POST', token: manager.token, body: { note: '[test] done' } });

  const missing = await call('/issues/000000000000000000000000/acknowledge', { method: 'POST', token: manager.token });
  check('Acting on an issue that does not exist is a 404', missing.status === 404);
}

// ---------------------------------------------------------------------------
// 3.2  Tasks
// ---------------------------------------------------------------------------
async function tasks({ owner, manager, staff, staff2, product }) {
  heading('3.2  Tasks: the Manager hands out work, Staff finish it');

  const today = new Date();
  const iso = (d) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;

  const made = await call('/tasks', {
    method: 'POST', token: manager.token,
    body: { title: '[test] Face up aisle 3', assignedTo: staff.user.id, dueDate: iso(today), productId: product._id },
  });
  const task = made.body?.task;
  if (task) created.tasks.push(task._id);
  check('The Manager can give a task to a Staff member', made.status === 201 && task?.assigned_to?.name === staff.user.name,
    `${made.status}, to ${task?.assigned_to?.name}`);

  const staffMake = await call('/tasks', { method: 'POST', token: staff.token, body: { title: '[test] x', assignedTo: staff2.user.id } });
  check('Staff cannot hand out tasks (403)', staffMake.status === 403);
  const toOwner = await call('/tasks', { method: 'POST', token: manager.token, body: { title: '[test] x', assignedTo: owner.user.id } });
  check('A task cannot be given to the Owner (400)', toOwner.status === 400, toOwner.body?.error);
  const past = new Date(today.getTime() - 3 * 86400000);
  const late = await call('/tasks', { method: 'POST', token: manager.token, body: { title: '[test] x', assignedTo: staff.user.id, dueDate: iso(past) } });
  check('A due date in the past is rejected (400)', late.status === 400, late.body?.error);

  const n1 = await call('/notifications?limit=100', { token: staff.token });
  check('The Staff member was notified of the task',
    n1.body.notifications.some((n) => n.type === 'task_assigned' && String(n.ref_id) === task._id));

  const theirs = await call('/tasks?status=open', { token: staff.token });
  const others = await call('/tasks?status=all', { token: staff2.token });
  check('Staff see their own tasks only',
    theirs.body.tasks.some((t) => t._id === task._id) && !others.body.tasks.some((t) => t._id === task._id));
  const ownerView = await call('/tasks?status=open', { token: owner.token });
  check('The Owner can see every task', ownerView.body.tasks.some((t) => t._id === task._id));

  const stranger = await call(`/tasks/${task._id}/done`, { method: 'POST', token: staff2.token, body: {} });
  check('Someone else cannot finish your task (403)', stranger.status === 403);
  const cancelByStaff = await call(`/tasks/${task._id}/cancel`, { method: 'POST', token: staff.token });
  check('Staff cannot cancel a task (403)', cancelByStaff.status === 403);

  const done = await call(`/tasks/${task._id}/done`, { method: 'POST', token: staff.token, body: { note: 'All faced up' } });
  check('The assignee marks it done, with a note',
    done.status === 200 && done.body.task.status === 'done' && done.body.task.done_note === 'All faced up' && !!done.body.task.done_at);
  const twice = await call(`/tasks/${task._id}/done`, { method: 'POST', token: staff.token, body: {} });
  check('A finished task cannot be finished again (400)', twice.status === 400);

  const n2 = await call('/notifications?limit=100', { token: manager.token });
  check('The Manager was told it is done',
    n2.body.notifications.some((n) => n.type === 'task_done' && String(n.ref_id) === task._id));

  const back = await call(`/tasks/${task._id}/reopen`, { method: 'POST', token: manager.token });
  check('The Manager can send finished work back', back.status === 200 && back.body.task.status === 'open' && back.body.task.done_note === null);
  const cancel = await call(`/tasks/${task._id}/cancel`, { method: 'POST', token: manager.token });
  check('The Manager can cancel a task; it is kept, not deleted',
    cancel.status === 200 && cancel.body.task.status === 'cancelled'
      && (await call('/tasks?status=cancelled', { token: manager.token })).body.tasks.some((t) => t._id === task._id));

  // An issue can become a task, and the task remembers it.
  const issueId = created.issues[0];
  const fromIssue = await call('/tasks', {
    method: 'POST', token: manager.token,
    body: { title: '[test] Fix freezer seal', assignedTo: staff2.user.id, issueId },
  });
  if (fromIssue.body?.task) created.tasks.push(fromIssue.body.task._id);
  check('A task can be made from an issue and links back to it',
    fromIssue.status === 201 && String(fromIssue.body.task.issue_id?._id) === String(issueId),
    fromIssue.body?.task?.issue_id?.title);
  await call(`/tasks/${fromIssue.body.task._id}/cancel`, { method: 'POST', token: manager.token });

  const badges = await call('/dashboard/badges', { token: staff.token });
  check('The sidebar badge endpoint answers for every role',
    badges.status === 200 && ['approvals', 'issues', 'tasks'].every((k) => typeof badges.body[k] === 'number'),
    JSON.stringify(badges.body));
}

// ---------------------------------------------------------------------------
// 3.2  Discussion
// ---------------------------------------------------------------------------
async function discussion({ owner, manager, staff, staff2 }) {
  heading('3.2  Discussion: an internal board, one level of replies');

  const post = await call('/discussion', { method: 'POST', token: staff.token, body: { body: '[test] Bread delivery is late again' } });
  check('Staff can post', post.status === 201 && post.body.note.author_id?.name === staff.user.name);
  const empty = await call('/discussion', { method: 'POST', token: staff.token, body: { body: '   ' } });
  check('An empty post is rejected (400)', empty.status === 400, empty.body?.error);
  const huge = await call('/discussion', { method: 'POST', token: staff.token, body: { body: 'x'.repeat(1001) } });
  check('A post over 1000 characters is rejected (400)', huge.status === 400);

  const reply = await call('/discussion', { method: 'POST', token: manager.token, body: { body: '[test] Calling them now', parentId: post.body.note._id } });
  const deep = await call('/discussion', { method: 'POST', token: staff2.token, body: { body: '[test] Same at my shift', parentId: reply.body.note._id } });
  check('A reply to a reply attaches to the original post',
    reply.status === 201 && deep.status === 201 && String(deep.body.note.parent_id) === String(post.body.note._id));

  const ownerPost = await call('/discussion', { method: 'POST', token: owner.token, body: { body: '[test] Owner here' } });
  check('The Owner can take part', ownerPost.status === 201);

  const board = await call('/discussion?limit=50', { token: staff2.token });
  const thread = board.body.posts.find((p) => p._id === post.body.note._id);
  check('The board returns threads with their replies in order',
    thread && thread.replies.length === 2 && thread.replies[0]._id === reply.body.note._id,
    `${thread?.replies?.length} replies`);
  check('Replies are not listed as top-level posts', !board.body.posts.some((p) => p._id === reply.body.note._id));

  const n = await call('/notifications?limit=100', { token: staff.token });
  const pings = n.body.notifications.filter((x) => x.type === 'discussion_reply' && String(x.ref_id) === post.body.note._id);
  check('The original poster is told about each reply from someone else', pings.length === 2, `${pings.length} notification(s)`);

  const fb = await call('/feedback?limit=300', { token: manager.token });
  check('Discussion posts never show up as customer feedback', !fb.body.notes.some((x) => (x.body || '').startsWith('[test]')));
}

// ---------------------------------------------------------------------------
// 3.4  Notification centre
// ---------------------------------------------------------------------------
async function allPages(token, extra = '') {
  const seen = [];
  let after = null;
  for (let i = 0; i < 100; i += 1) {
    const r = await call(`/notifications?limit=7${extra}${after ? `&after=${encodeURIComponent(after)}` : ''}`, { token });
    if (r.status !== 200) throw new Error(`notifications page failed: ${JSON.stringify(r.body)}`);
    seen.push(...r.body.notifications);
    after = r.body.next;
    if (!after) break;
  }
  return seen;
}

async function notificationCentre({ manager, staff, staff2 }) {
  heading('3.4  Notification centre: the full history, not the last 20');

  const one = await call('/notifications?limit=200', { token: manager.token });
  const paged = await allPages(manager.token);
  const ids = paged.map((n) => n._id);
  check('Paging through the history returns every notification exactly once',
    new Set(ids).size === ids.length && (one.body.has_more || ids.length === one.body.notifications.length),
    `${ids.length} via pages of 7, ${one.body.notifications.length} in one page of 200`);
  check('Newest first, across page boundaries',
    paged.every((n, i) => i === 0 || new Date(paged[i - 1].createdAt) >= new Date(n.createdAt)));

  const unreadPaged = await allPages(manager.token, '&unread=1');
  check('The unread count is the true total, not just the latest page',
    one.body.unread === unreadPaged.length && unreadPaged.every((n) => !n.read),
    `count ${one.body.unread}, listed ${unreadPaged.length}`);

  const floor = await call('/notifications?limit=200&group=floor', { token: manager.token });
  check('Filtering by group returns only that group',
    floor.body.notifications.length > 0
      && floor.body.notifications.every((n) => ['issue_raised', 'issue_updated', 'task_assigned', 'task_done', 'discussion_reply'].includes(n.type)),
    `${floor.body.notifications.length} floor notification(s)`);
  const badGroup = await call('/notifications?group=weather', { token: manager.token });
  const badCursor = await call('/notifications?after=yesterday', { token: manager.token });
  check('A bad group or cursor is a 400, not an empty list', badGroup.status === 400 && badCursor.status === 400);

  const staffAll = await call('/notifications?limit=200', { token: staff.token });
  check('Staff never see notifications meant for the Manager',
    staffAll.body.notifications.every((n) => n.for_role !== 'Manager'));

  const mineOnly = staffAll.body.notifications.find((n) => String(n.for_user_id) === String(staff.user.id));
  const poke = mineOnly && await call(`/notifications/${mineOnly._id}/read`, { method: 'POST', token: staff2.token });
  check('Nobody can mark someone else\'s notification as read (404)', poke?.status === 404, mineOnly ? `got ${poke?.status}` : 'no personal notification to test with');

  const before = (await call('/notifications?limit=1', { token: staff2.token })).body.unread;
  const target = (await call('/notifications?limit=1&unread=1', { token: staff2.token })).body.notifications[0];
  if (target) {
    await call(`/notifications/${target._id}/read`, { method: 'POST', token: staff2.token });
    const after = await call('/notifications?limit=200&unread=1', { token: staff2.token });
    check('Marking one read lowers the count by one and drops it from Unread',
      after.body.unread === before - 1 && !after.body.notifications.some((n) => n._id === target._id),
      `${before} -> ${after.body.unread}`);
  } else {
    check('Marking one read lowers the count by one and drops it from Unread', false, 'staff2 had nothing unread to test with');
  }

  const all = await call('/notifications/read-all', { method: 'POST', token: staff2.token });
  const zero = await call('/notifications?limit=1', { token: staff2.token });
  check('Mark all read clears the count', all.status === 200 && zero.body.unread === 0, `${all.body?.marked} marked`);
}

/** Delete what this script created on the floor boards, and what it notified. */
async function removeTestRecords() {
  await mongoose.connect(process.env.MONGODB_URI);
  const { Issue, Task, Note, Notification, Product, RestockRequest } = require('../models');
  const test = /^\[test\]/;
  // The test product's requests stay (its ledger rows point at them); only the
  // alerts about them are removed from people's bells.
  const testProducts = await Product.find({ name: 'Phase 3 Test Product' }).distinct('_id');
  const ids = [
    ...await Issue.find({ title: test }).distinct('_id'),
    ...await Task.find({ title: test }).distinct('_id'),
    ...await Note.find({ type: 'discussion', body: test }).distinct('_id'),
    ...await RestockRequest.find({ product_id: { $in: testProducts } }).distinct('_id'),
  ];
  const n = await Notification.deleteMany({ ref_id: { $in: ids } });
  const i = await Issue.deleteMany({ title: test });
  const t = await Task.deleteMany({ title: test });
  const d = await Note.deleteMany({ type: 'discussion', body: test });
  await mongoose.disconnect();
  console.log(`  (removed test records: ${i.deletedCount} issue(s), ${t.deletedCount} task(s), `
    + `${d.deletedCount} post(s), ${n.deletedCount} notification(s))`);
}

main().catch((err) => {
  console.error('\n[phase3test] ERROR:', err);
  process.exit(1);
});
