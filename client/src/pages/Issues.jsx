import { useCallback, useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import Layout from '../components/Layout';
import { Card, Chip, StatusChip, StatTile, Loading, ErrorNote, EmptyState } from '../components/ui';
import { api, longDate } from '../api/client';
import { useAuth } from '../context/AuthContext';

const CATEGORY_LABEL = {
  damage: ['bi-box2', 'Damage'],
  expiry: ['bi-calendar-x', 'Expiry'],
  shelf: ['bi-bookshelf', 'Shelf'],
  pricing: ['bi-tag', 'Pricing'],
  equipment: ['bi-tools', 'Equipment'],
  other: ['bi-three-dots', 'Other'],
};
const SEVERITY = {
  high: ['danger', 'High', 'var(--coral)'],
  medium: ['warn', 'Medium', 'var(--amber)'],
  low: ['neutral', 'Low', 'var(--ink-300)'],
};
const FILTERS = [['active', 'Needs attention'], ['open', 'Open'], ['acknowledged', 'Acknowledged'], ['resolved', 'Resolved'], ['all', 'All']];

export default function Issues() {
  const { isRole } = useAuth();
  const [data, setData] = useState(null);
  const [status, setStatus] = useState('active');
  const [mine, setMine] = useState(false);
  const [error, setError] = useState(null);
  const [formOpen, setFormOpen] = useState(false);
  const [flash, setFlash] = useState(null);

  const load = useCallback(() => api.get(`/issues?status=${status}${mine ? '&mine=1' : ''}`)
    .then((d) => { setData(d); setError(null); })
    .catch(setError), [status, mine]);
  useEffect(() => { load(); }, [load]);

  const counts = data?.counts || {};
  const canFlag = isRole('Manager', 'Staff');

  return (
    <Layout
      title="Issues"
      subtitle="Problems spotted on the floor. Anyone can flag one; the Manager closes it."
      actions={canFlag && (
        <button className="btn btn-warm" onClick={() => { setFormOpen(true); setFlash(null); }}>
          <i className="bi bi-flag-fill me-2" />Flag an issue
        </button>
      )}
    >
      <div className="stat-grid mb-4">
        <StatTile tone="coral" icon="bi-exclamation-circle" label="Open" value={counts.open || 0} foot="not yet seen by the Manager" />
        <StatTile tone="sky" icon="bi-eye" label="Acknowledged" value={counts.acknowledged || 0} foot="being dealt with" />
        <StatTile tone="amber" icon="bi-lightning-charge-fill" label="High severity" value={counts.high_active || 0} foot="still unresolved" />
        <StatTile tone="sage" icon="bi-check-circle" label="Resolved" value={counts.resolved || 0} foot="all time" />
      </div>

      {flash && (
        <div className="restock-flash mb-4">
          <strong><i className="bi bi-check-circle-fill me-2" />{flash}</strong>
        </div>
      )}

      {formOpen && (
        <IssueForm
          onClose={() => setFormOpen(false)}
          onDone={(issue) => {
            setFormOpen(false);
            setFlash(`Flagged "${issue.title}". The Manager has been notified.`);
            setStatus('active');
            load();
          }}
        />
      )}

      <Card
        bodyClass=""
        title="Flagged issues"
        subtitle={data ? `${data.issues.length} shown` : 'Loading…'}
        actions={(
          <div className="d-flex flex-wrap align-items-center gap-2">
            {FILTERS.map(([v, label]) => (
              <button key={v} className={`btn btn-sm ${status === v ? 'btn-primary' : 'btn-ghost'}`} onClick={() => setStatus(v)}>
                {label}
              </button>
            ))}
            {canFlag && (
              <label className="check-pill">
                <input type="checkbox" checked={mine} onChange={(e) => setMine(e.target.checked)} />
                Only mine
              </label>
            )}
          </div>
        )}
      >
        {error && <div className="p-3"><ErrorNote error={error} /></div>}
        {!data ? <Loading rows={4} /> : data.issues.length === 0 ? (
          <EmptyState icon="bi-emoji-smile" title="Nothing here">
            {status === 'active' ? 'No unresolved issues. The floor is in good shape.' : 'No issues with that status.'}
          </EmptyState>
        ) : (
          <div>
            {data.issues.map((issue) => (
              <IssueRow key={issue._id} issue={issue} onChanged={load} onError={setError} />
            ))}
          </div>
        )}
      </Card>
    </Layout>
  );
}

function IssueRow({ issue, onChanged, onError }) {
  const { isRole } = useAuth();
  const navigate = useNavigate();
  const [busy, setBusy] = useState(false);
  const [resolving, setResolving] = useState(false);
  const [note, setNote] = useState('');

  const [sevTone, sevLabel, sevColor] = SEVERITY[issue.severity] || SEVERITY.medium;
  const [catIcon, catLabel] = CATEGORY_LABEL[issue.category] || CATEGORY_LABEL.other;

  const act = async (action, body = {}) => {
    setBusy(true);
    try {
      await api.post(`/issues/${issue._id}/${action}`, body);
      setResolving(false);
      await onChanged();
    } catch (err) { onError(err); } finally { setBusy(false); }
  };

  return (
    <div className="list-row" style={{ '--bar': issue.status === 'resolved' ? 'var(--sage)' : sevColor }}>
      <div className="list-row-main">
        <div className="d-flex flex-wrap align-items-center gap-2 mb-1">
          <h4 className="list-row-title">{issue.title}</h4>
          <StatusChip status={issue.status} />
          <Chip tone={sevTone} icon="bi-lightning-charge">{sevLabel}</Chip>
          <Chip tone="neutral" icon={catIcon}>{catLabel}</Chip>
        </div>
        {issue.product_id && (
          <div className="list-row-meta"><i className="bi bi-box-seam me-1" />{issue.product_id.name}</div>
        )}
        {issue.description && <p className="list-row-body">{issue.description}</p>}
        <div className="list-row-meta">
          Flagged by <strong>{issue.raised_by?.name || '—'}</strong> · {longDate(issue.createdAt)}
          {issue.acknowledged_by && <> · acknowledged by <strong>{issue.acknowledged_by.name}</strong> {longDate(issue.acknowledged_at)}</>}
        </div>
        {issue.status === 'resolved' && (
          <div className="list-row-resolution">
            <i className="bi bi-check-circle-fill me-2" />
            Resolved by <strong>{issue.resolved_by?.name}</strong> · {longDate(issue.resolved_at)}
            {issue.resolution_note && <>: {issue.resolution_note}</>}
          </div>
        )}

        {resolving && (
          <div className="d-flex flex-wrap gap-2 mt-3">
            <input
              className="form-control" style={{ flex: '1 1 260px' }} autoFocus
              placeholder="What was done? (optional)" value={note} maxLength={500}
              onChange={(e) => setNote(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && act('resolve', { note })}
            />
            <button className="btn btn-accent" disabled={busy} onClick={() => act('resolve', { note })}>Mark resolved</button>
            <button className="btn btn-ghost" onClick={() => setResolving(false)}>Cancel</button>
          </div>
        )}
      </div>

      {isRole('Manager') && !resolving && (
        <div className="list-row-actions">
          {issue.status === 'open' && (
            <button className="btn btn-soft btn-sm" disabled={busy} onClick={() => act('acknowledge')}>
              <i className="bi bi-eye me-1" />Acknowledge
            </button>
          )}
          {issue.status !== 'resolved' && (
            <>
              <button className="btn btn-accent btn-sm" disabled={busy} onClick={() => setResolving(true)}>
                <i className="bi bi-check2 me-1" />Resolve
              </button>
              <button
                className="btn btn-ghost btn-sm" disabled={busy}
                onClick={() => navigate('/tasks', { state: { fromIssue: issue } })}
                title="Give someone a task to fix this"
              >
                <i className="bi bi-person-check me-1" />Make a task
              </button>
            </>
          )}
          {issue.status === 'resolved' && (
            <button className="btn btn-ghost btn-sm" disabled={busy} onClick={() => act('reopen')}>
              <i className="bi bi-arrow-counterclockwise me-1" />Reopen
            </button>
          )}
        </div>
      )}
    </div>
  );
}

function IssueForm({ onClose, onDone }) {
  const [products, setProducts] = useState([]);
  const [form, setForm] = useState({ title: '', category: 'other', severity: 'medium', productId: '', description: '' });
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
      const { issue } = await api.post('/issues', { ...form, productId: form.productId || undefined });
      onDone(issue);
    } catch (err) { setError(err); } finally { setBusy(false); }
  };

  return (
    <Card
      title="Flag an issue" subtitle="The Manager is notified as soon as you send it" className="mb-4"
      actions={<button className="icon-btn" onClick={onClose} title="Close"><i className="bi bi-x-lg" /></button>}
    >
      <form onSubmit={submit}>
        {error && <div className="mb-3"><ErrorNote error={error} /></div>}
        <div className="row g-3">
          <div className="col-12 col-md-6">
            <label className="form-label" htmlFor="issue-title">What is wrong?</label>
            <input id="issue-title" className="form-control" required maxLength={160} value={form.title} onChange={set('title')} placeholder="e.g. Chiller 2 is running warm" />
          </div>
          <div className="col-6 col-md-3">
            <label className="form-label" htmlFor="issue-cat">Kind of problem</label>
            <select id="issue-cat" className="form-select" value={form.category} onChange={set('category')}>
              {Object.entries(CATEGORY_LABEL).map(([v, [, label]]) => <option key={v} value={v}>{label}</option>)}
            </select>
          </div>
          <div className="col-6 col-md-3">
            <label className="form-label" htmlFor="issue-sev">How urgent?</label>
            <select id="issue-sev" className="form-select" value={form.severity} onChange={set('severity')}>
              <option value="high">High: needs action now</option>
              <option value="medium">Medium: today</option>
              <option value="low">Low: when there is time</option>
            </select>
          </div>
          <div className="col-12 col-md-6">
            <label className="form-label" htmlFor="issue-product">Product (optional)</label>
            <select id="issue-product" className="form-select" value={form.productId} onChange={set('productId')}>
              <option value="">Not about one product</option>
              {products.map((p) => <option key={p._id} value={p._id}>{p.name}</option>)}
            </select>
          </div>
          <div className="col-12 col-md-6">
            <label className="form-label" htmlFor="issue-desc">Details (optional)</label>
            <input id="issue-desc" className="form-control" maxLength={1000} value={form.description} onChange={set('description')} placeholder="Where, since when, anything already tried" />
          </div>
        </div>
        <button className="btn btn-warm mt-3" type="submit" disabled={busy || !form.title.trim()}>
          {busy ? 'Sending…' : 'Flag it'}
        </button>
      </form>
    </Card>
  );
}
