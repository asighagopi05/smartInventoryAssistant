const mongoose = require('mongoose');

const STATUSES = ['open', 'done', 'cancelled'];

/**
 * Work the Manager hands to someone on the floor: "face the biscuit aisle",
 * "move the near-expiry bread to the front".
 *
 * Deliberately separate from Issue. An issue is a report of a problem, raised
 * by whoever spots it; a task is an instruction, given by the Manager to a
 * named person, with a due date. One issue can lead to a task (issue_id), but
 * plenty of tasks have no issue behind them and most issues need no task.
 *
 * Never deleted: a task that is no longer needed is cancelled, so the record
 * of what was asked of whom survives.
 */
const taskSchema = new mongoose.Schema(
  {
    title: { type: String, required: [true, 'Give the task a short title'], trim: true, maxlength: 160 },
    description: { type: String, trim: true, maxlength: 1000 },
    assigned_to: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: [true, 'Choose who the task is for'] },
    created_by: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
    product_id: { type: mongoose.Schema.Types.ObjectId, ref: 'Product', default: null },
    issue_id: { type: mongoose.Schema.Types.ObjectId, ref: 'Issue', default: null },
    due_date: { type: Date, default: null },
    status: { type: String, enum: STATUSES, default: 'open' },
    done_at: { type: Date, default: null },
    done_note: { type: String, trim: true, maxlength: 500, default: null },
  },
  { timestamps: true, toJSON: { virtuals: true } }
);

taskSchema.index({ assigned_to: 1, status: 1, due_date: 1 });
taskSchema.index({ status: 1, createdAt: -1 });

taskSchema.statics.STATUSES = STATUSES;

module.exports = mongoose.model('Task', taskSchema);
