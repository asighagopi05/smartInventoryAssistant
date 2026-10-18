const router = require('express').Router();
const mongoose = require('mongoose');
const asyncHandler = require('../utils/asyncHandler');
const ApiError = require('../utils/ApiError');
const { requireAuth, requireRole } = require('../middleware/auth');
const { Task, User, Product, Issue, Notification } = require('../models');

router.use(requireAuth);

const populated = (q) => q
  .populate('assigned_to', 'name role')
  .populate('created_by', 'name')
  .populate('product_id', 'name sku')
  .populate('issue_id', 'title status');

const startOfToday = () => {
  const d = new Date();
  return new Date(d.getFullYear(), d.getMonth(), d.getDate());
};

/**
 * Staff see the tasks given to them. The Manager and Owner see everyone's,
 * because checking that the floor work got done is part of their job.
 */
router.get('/', asyncHandler(async (req, res) => {
  const { status = 'open', assignee, limit = 200 } = req.query;
  const filter = {};
  if (status !== 'all') {
    if (!Task.STATUSES.includes(status)) throw ApiError.badRequest(`Unknown status ${status}`);
    filter.status = status;
  }
  if (req.user.role === 'Staff') filter.assigned_to = req.user.id;
  else if (assignee) filter.assigned_to = assignee;

  const tasks = await populated(Task.find(filter))
    // Open work by due date (undated last); finished work newest first.
    .sort(status === 'open' ? { due_date: 1, createdAt: -1 } : { updatedAt: -1 })
    .limit(Math.min(Number(limit) || 200, 500))
    .lean();
  if (status === 'open') {
    tasks.sort((a, b) => (a.due_date ? 0 : 1) - (b.due_date ? 0 : 1));
  }

  // aggregate() does not cast strings to ObjectIds the way find() does.
  const scope = req.user.role === 'Staff' ? { assigned_to: new mongoose.Types.ObjectId(req.user.id) } : {};
  const today = startOfToday();
  const [counts, overdue] = await Promise.all([
    Task.aggregate([{ $match: scope }, { $group: { _id: '$status', n: { $sum: 1 } } }]),
    Task.countDocuments({ ...scope, status: 'open', due_date: { $lt: today } }),
  ]);

  res.json({
    tasks: tasks.map((t) => ({ ...t, overdue: t.status === 'open' && !!t.due_date && new Date(t.due_date) < today })),
    counts: { ...Object.fromEntries(counts.map((c) => [c._id, c.n])), overdue },
  });
}));

/** The people a task can be given to: everyone active on the floor. */
router.get('/assignees', requireRole('Manager'), asyncHandler(async (_req, res) => {
  const users = await User.find({ active: true, role: { $in: ['Staff', 'Manager'] } })
    .select('name role').sort({ role: -1, name: 1 }).lean();
  res.json({ users });
}));

router.post('/', requireRole('Manager'), asyncHandler(async (req, res) => {
  const { title, description, assignedTo, productId, issueId, dueDate } = req.body;

  const assignee = assignedTo ? await User.findById(assignedTo).select('name role active').lean() : null;
  if (!assignee || !assignee.active || !['Staff', 'Manager'].includes(assignee.role)) {
    throw ApiError.badRequest('A task must go to an active Staff member or Manager');
  }
  if (productId && !(await Product.exists({ _id: productId }))) throw ApiError.badRequest('That product does not exist');
  if (issueId && !(await Issue.exists({ _id: issueId }))) throw ApiError.badRequest('That issue does not exist');

  let due = null;
  if (dueDate) {
    due = new Date(dueDate);
    if (Number.isNaN(due.getTime())) throw ApiError.badRequest('Due date is not a valid date');
    if (due < startOfToday()) throw ApiError.badRequest('Due date cannot be in the past');
  }

  const task = await Task.create({
    title, description,
    assigned_to: assignee._id,
    created_by: req.user.id,
    product_id: productId || null,
    issue_id: issueId || null,
    due_date: due,
  });

  if (String(assignee._id) !== req.user.id) {
    await Notification.create({
      type: 'task_assigned',
      title: `New task: ${task.title}`.slice(0, 160),
      body: `${req.user.name} gave you a task${due ? `, due ${due.toLocaleDateString('en-IN', { day: '2-digit', month: 'short' })}` : ''}.`
        + `${task.description ? ` "${task.description}"` : ''}`.slice(0, 500),
      for_user_id: assignee._id,
      ref_type: 'Task',
      ref_id: task._id,
      link: '/tasks',
    });
  }

  res.status(201).json({ task: await populated(Task.findById(task._id)).lean() });
}));

/**
 * done:      the assignee (or the Manager) marks it finished, with an optional note.
 * reopen:    the Manager sends finished work back.
 * cancel:    the Manager withdraws a task that is no longer needed.
 */
router.post('/:id/:action(done|reopen|cancel)', asyncHandler(async (req, res) => {
  const { action } = req.params;
  const task = await Task.findById(req.params.id);
  if (!task) throw ApiError.notFound('Task not found');

  const isManager = req.user.role === 'Manager';
  const isAssignee = String(task.assigned_to) === req.user.id;

  if (action === 'done') {
    if (!isManager && !isAssignee) throw ApiError.forbidden('Only the person it was given to, or the Manager, can finish a task');
    if (task.status !== 'open') throw ApiError.badRequest(`This task is already ${task.status}`);
    task.status = 'done';
    task.done_at = new Date();
    task.done_note = req.body.note ? String(req.body.note).trim().slice(0, 500) : null;
  } else {
    if (!isManager) throw ApiError.forbidden(`Only the Manager can ${action} a task`);
    if (action === 'reopen' && task.status !== 'done') throw ApiError.badRequest(`Only a finished task can be reopened - this one is ${task.status}`);
    if (action === 'cancel' && task.status !== 'open') throw ApiError.badRequest(`Only an open task can be cancelled - this one is ${task.status}`);
    task.status = action === 'reopen' ? 'open' : 'cancelled';
    task.done_at = null;
    if (action === 'reopen') task.done_note = null;
  }
  await task.save();

  // Tell the other side of the hand-off.
  const notify = action === 'done'
    ? (String(task.created_by) !== req.user.id && {
      type: 'task_done', for_user_id: task.created_by,
      title: `Task done: ${task.title}`, body: `${req.user.name} finished it.${task.done_note ? ` "${task.done_note}"` : ''}`,
    })
    : (!isAssignee && {
      type: 'task_assigned', for_user_id: task.assigned_to,
      title: action === 'reopen' ? `Task reopened: ${task.title}` : `Task cancelled: ${task.title}`,
      body: action === 'reopen' ? `${req.user.name} sent it back to you.` : `${req.user.name} withdrew it; nothing more to do.`,
    });
  if (notify) {
    await Notification.create({
      ...notify,
      title: notify.title.slice(0, 160),
      body: notify.body.slice(0, 500),
      ref_type: 'Task', ref_id: task._id, link: '/tasks',
    });
  }

  res.json({ task: await populated(Task.findById(task._id)).lean() });
}));

module.exports = router;
