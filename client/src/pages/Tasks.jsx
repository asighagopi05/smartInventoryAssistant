import { useCallback, useEffect, useState } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import Layout from '../components/Layout';
import { Card, Chip, StatTile, Loading, ErrorNote, EmptyState } from '../components/ui';
import { api, longDate, shortDate } from '../api/client';
import { useAuth } from '../context/AuthContext';

const FILTERS = [['open', 'To do'], ['done', 'Done'], ['cancelled', 'Cancelled'], ['all', 'All']];

/** yyyy-mm-dd for today, in local time, for the date input's min. */
const todayIso = () => {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
};

export default function Tasks() {
  const { isRole } = useAuth();
  const location = useLocation();
  const navigate = useNavigate();
  const fromIssue = location.state?.fromIssue || null;

  const [data, setData] = useState(null);
  const [status, setStatus] = useState('open');
  const [assignee, setAssignee] = useState('');
  const [people, setPeople] = useState([]);
  const [error, setError] = useState(null);
  const [formOpen, setFormOpen] = useState(Boolean(fromIssue));
  const [flash, setFlash] = useState(null);

  const isManager = isRole('Manager');

  const load = useCallback(() => api.get(`/tasks?status=${status}${assignee ? `&assignee=${assignee}` : ''}`)
    .then((d) => { setData(d); setError(null); })
    .catch(setError), [status, assignee]);
  useEffect(() => { load(); }, [load]);
  useEffect(() => {
    if (isManager) api.get('/tasks/assignees').then((d) => setPeople(d.users)).catch(setError);
  }, [isManager]);

  const counts = data?.counts || {};

  return (
    <Layout
      title="Tasks"
      subtitle={isManager ? 'Work you hand to the floor, and whether it got done' : 'What the Manager has asked you to do'}
      actions={isManager && (
        <button className="btn btn-accent" onClick={() => { setFormOpen(true); setFlash(null); }}>
          <i className="bi bi-plus-lg me-2" />New task
        </button>
      )}
    >
      <div className="stat-grid mb-4">
        <StatTile tone="teal" icon="bi-list-check" label="To do" value={counts.open || 0} foot={isManager ? 'across the team' : 'given to you'} />
        <StatTile tone="coral" icon="bi-alarm" label="Overdue" value={counts.overdue || 0} foot="past their due date" />
        <StatTile tone="sage" icon="bi-check2-all" label="Done" value={counts.done || 0} foot="all time" />
      </div>

      {flash && (
        <div className="restock-flash mb-4">
          <strong><i className="bi bi-check-circle-fill me-2" />{flash}</strong>
        </div>
      )}

      {formOpen && isManager && (
        <TaskForm
          people={people}
          fromIssue={fromIssue}
          onClose={() => { setFormOpen(false); navigate('.', { replace: true, state: null }); }}
          onDone={(task) => {
            setFormOpen(false);
            navigate('.', { replace: true, state: null });
            setFlash(`Task given to ${task.assigned_to?.name}. They have been notified.`);
            setStatus('open');
            load();
          }}
        />
      )}

      <Card
        bodyClass=""
        title={isManager ? 'Team tasks' : 'Your tasks'}
        subtitle={data ? `${data.tasks.length} shown` : 'Loading…'}
        actions={(
          <div className="d-flex flex-wrap align-items-center gap-2">
            {FILTERS.map(([v, label]) => (
              <button key={v} className={`btn btn-sm ${status === v ? 'btn-primary' : 'btn-ghost'}`} onClick={() => setStatus(v)}>
                {label}
              </button>
            ))}
            {isManager && (
              <select
                className="form-select" style={{ width: 'auto', minWidth: 170 }} aria-label="Filter by person"
                value={assignee} onChange={(e) => setAssignee(e.target.value)}
              >
                <option value="">Everyone</option>
                {people.map((p) => <option key={p._id} value={p._id}>{p.name}</option>)}
              </select>
            )}
          </div>
        )}
      >
        {error && <div className="p-3"><ErrorNote error={error} /></div>}
        {!data ? <Loading rows={4} /> : data.tasks.length === 0 ? (
          <EmptyState icon="bi-cup-hot" title={status === 'open' ? 'Nothing to do' : 'No tasks here'}>
            {status === 'open' && !isManager ? 'When the Manager gives you a task it appears here, and you get a notification.' : null}
          </EmptyState>
        ) : (
          <div>
            {data.tasks.map((t) => <TaskRow key={t._id} task={t} onChanged={load} onError={setError} />)}
          </div>
        )}
      </Card>
    </Layout>
  );
}

function DueChip({ task }) {
  if (!task.due_date) return null;
  if (task.status !== 'open') return <Chip tone="neutral" icon="bi-calendar">Due {shortDate(task.due_date)}</Chip>;
  if (task.overdue) return <Chip tone="danger" icon="bi-alarm">Overdue · {shortDate(task.due_date)}</Chip>;
  const today = new Date().toDateString() === new Date(task.due_date).toDateString();
  return <Chip tone={today ? 'warn' : 'info'} icon="bi-calendar-event">{today ? 'Due today' : `Due ${shortDate(task.due_date)}`}</Chip>;
}

function TaskRow({ task, onChanged, onError }) {
  const { user, isRole } = useAuth();
  const [busy, setBusy] = useState(false);
  const [finishing, setFinishing] = useState(false);
  const [note, setNote] = useState('');

  const isManager = isRole('Manager');
  const isMine = String(task.assigned_to?._id) === String(user.id);
  const bar = task.status === 'done' ? 'var(--sage)' : task.status === 'cancelled' ? 'var(--ink-200)'
    : task.overdue ? 'var(--coral)' : 'var(--teal)';

  const act = async (action, body = {}) => {
    setBusy(true);
    try {
      await api.post(`/tasks/${task._id}/${action}`, body);
      setFinishing(false);
      await onChanged();
    } catch (err) { onError(err); } finally { setBusy(false); }
  };

  return (
    <div className="list-row" style={{ '--bar': bar }}>
      <div className="list-row-main">
        <div className="d-flex flex-wrap align-items-center gap-2 mb-1">
          <h4 className="list-row-title" style={task.status === 'cancelled' ? { textDecoration: 'line-through', color: 'var(--ink-400)' } : undefined}>
            {task.title}
          </h4>
          {task.status === 'done' && <Chip tone="ok" icon="bi-check2-all">Done</Chip>}
          {task.status === 'cancelled' && <Chip tone="neutral" icon="bi-slash-circle">Cancelled</Chip>}
          <DueChip task={task} />
          {!isMine && task.assigned_to && <Chip tone="brand" icon="bi-person">{task.assigned_to.name}</Chip>}
          {isMine && isManager && <Chip tone="brand" icon="bi-person">You</Chip>}
        </div>
        {task.description && <p className="list-row-body">{task.description}</p>}
        <div className="list-row-meta">
          {task.product_id && <><i className="bi bi-box-seam me-1" />{task.product_id.name} · </>}
          {task.issue_id && <><i className="bi bi-flag me-1" />From issue: {task.issue_id.title} · </>}
          Given by <strong>{task.created_by?.name || '—'}</strong> · {longDate(task.createdAt)}
        </div>
        {task.status === 'done' && (
          <div className="list-row-resolution">
            <i className="bi bi-check-circle-fill me-2" />
            Done {longDate(task.done_at)}{task.done_note && <>: {task.done_note}</>}
          </div>
        )}

        {finishing && (
          <div className="d-flex flex-wrap gap-2 mt-3">
            <input
              className="form-control" style={{ flex: '1 1 260px' }} autoFocus maxLength={500}
              placeholder="Anything the Manager should know? (optional)" value={note}
              onChange={(e) => setNote(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && act('done', { note })}
            />
            <button className="btn btn-accent" disabled={busy} onClick={() => act('done', { note })}>Mark done</button>
            <button className="btn btn-ghost" onClick={() => setFinishing(false)}>Cancel</button>
          </div>
        )}
      </div>

      {!finishing && (
        <div className="list-row-actions">
          {task.status === 'open' && (isMine || isManager) && (
            <button className="btn btn-accent btn-sm" disabled={busy} onClick={() => setFinishing(true)}>
              <i className="bi bi-check2 me-1" />Mark done
            </button>
          )}
          {task.status === 'open' && isManager && (
            <button className="btn btn-danger-soft btn-sm" disabled={busy} onClick={() => act('cancel')}>Cancel task</button>
          )}
          {task.status === 'done' && isManager && (
            <button className="btn btn-ghost btn-sm" disabled={busy} onClick={() => act('reopen')}>
              <i className="bi bi-arrow-counterclockwise me-1" />Send back
            </button>
          )}
        </div>
      )}
    </div>
  );
}

function TaskForm({ people, fromIssue, onClose, onDone }) {
  const [products, setProducts] = useState([]);
  const [form, setForm] = useState({
    title: fromIssue ? `Fix: ${fromIssue.title}`.slice(0, 160) : '',
    assignedTo: '',
    dueDate: todayIso(),
    productId: fromIssue?.product_id?._id || '',
    description: fromIssue?.description || '',
  });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);

  useEffect(() => {
    api.get('/products?limit=500').then((d) => setProducts(d.products)).catch(setError);
  }, []);

  const set = (k) => (e) => setForm((f) => ({ ...f, [k]: e.target.value }));

  const submit = async (e) => {
    e.preventDefault();
    setBusy(true); setError(null);
    try {
      const { task } = await api.post('/tasks', {
        ...form,
        productId: form.productId || undefined,
        dueDate: form.dueDate || undefined,
        issueId: fromIssue?._id,
      });
      onDone(task);
    } catch (err) { setError(err); } finally { setBusy(false); }
  };

  return (
    <Card
      title={fromIssue ? 'Turn this issue into a task' : 'New task'}
      subtitle={fromIssue ? `From the issue "${fromIssue.title}". Resolve the issue once the work is done.` : 'The person you choose is notified straight away'}
      className="mb-4"
      actions={<button className="icon-btn" onClick={onClose} title="Close"><i className="bi bi-x-lg" /></button>}
    >
      <form onSubmit={submit}>
        {error && <div className="mb-3"><ErrorNote error={error} /></div>}
        <div className="row g-3">
          <div className="col-12 col-md-6">
            <label className="form-label" htmlFor="task-title">Task</label>
            <input id="task-title" className="form-control" required maxLength={160} value={form.title} onChange={set('title')} placeholder="e.g. Face up the biscuit aisle" />
          </div>
          <div className="col-6 col-md-3">
            <label className="form-label" htmlFor="task-who">Give it to</label>
            <select id="task-who" className="form-select" required value={form.assignedTo} onChange={set('assignedTo')}>
              <option value="">Choose…</option>
              {people.map((p) => <option key={p._id} value={p._id}>{p.name} ({p.role})</option>)}
            </select>
          </div>
          <div className="col-6 col-md-3">
            <label className="form-label" htmlFor="task-due">Due</label>
            <input id="task-due" className="form-control" type="date" min={todayIso()} value={form.dueDate} onChange={set('dueDate')} />
          </div>
          <div className="col-12 col-md-6">
            <label className="form-label" htmlFor="task-product">Product (optional)</label>
            <select id="task-product" className="form-select" value={form.productId} onChange={set('productId')}>
              <option value="">Not about one product</option>
              {products.map((p) => <option key={p._id} value={p._id}>{p.name}</option>)}
            </select>
          </div>
          <div className="col-12 col-md-6">
            <label className="form-label" htmlFor="task-desc">Details (optional)</label>
            <input id="task-desc" className="form-control" maxLength={1000} value={form.description} onChange={set('description')} placeholder="How, where, anything to watch for" />
          </div>
        </div>
        <button className="btn btn-accent mt-3" type="submit" disabled={busy || !form.title.trim() || !form.assignedTo}>
          {busy ? 'Saving…' : 'Give task'}
        </button>
      </form>
    </Card>
  );
}
