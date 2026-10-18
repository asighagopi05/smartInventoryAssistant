import { useEffect, useState } from 'react';
import Layout from '../components/Layout';
import { Card, Chip, Loading, ErrorNote, EmptyState } from '../components/ui';
import { api, longDate } from '../api/client';
import { useAuth } from '../context/AuthContext';

const ENTRY_META = {
  sale: ['bi-receipt', 'coral', 'Sale'],
  received: ['bi-box-seam', 'sage', 'Received'],
  count: ['bi-clipboard-check', 'sky', 'Count'],
  damage: ['bi-exclamation-octagon', 'coral', 'Damage'],
  return: ['bi-arrow-return-left', 'plum', 'Return'],
  adjustment: ['bi-sliders', 'amber', 'Adjustment'],
};

export default function Stock() {
  const { isRole } = useAuth();
  const [logs, setLogs] = useState(null);
  const [products, setProducts] = useState([]);
  const [filter, setFilter] = useState('');
  const [error, setError] = useState(null);
  const [countOpen, setCountOpen] = useState(false);

  const load = () => {
    const q = filter ? `/stock/logs?limit=200&product=${filter}` : '/stock/logs?limit=200';
    api.get(q).then((d) => setLogs(d.logs)).catch(setError);
  };

  useEffect(() => { load(); }, [filter]);
  useEffect(() => { api.get('/products?limit=500').then((d) => setProducts(d.products)).catch(() => {}); }, []);

  if (error) return <Layout title="Stock ledger"><ErrorNote error={error} /></Layout>;

  return (
    <Layout
      title="Stock ledger"
      subtitle="Append-only. A correction is a new row, never an edit."
      actions={isRole('Manager', 'Staff') && (
        <button className="btn btn-primary" onClick={() => setCountOpen(true)}>
          <i className="bi bi-clipboard-check me-2" />Record a count
        </button>
      )}
    >
      {countOpen && (
        <CountPanel
          products={products}
          onClose={() => setCountOpen(false)}
          onDone={() => { setCountOpen(false); load(); }}
        />
      )}

      <Card bodyClass="" className="mb-4">
        <div style={{ padding: 'var(--sp-4) var(--sp-5)' }}>
          <select className="form-select" value={filter} onChange={(e) => setFilter(e.target.value)} style={{ maxWidth: 420 }}>
            <option value="">Every product</option>
            {products.map((p) => <option key={p._id} value={p._id}>{p.name}</option>)}
          </select>
        </div>
      </Card>

      <Card bodyClass="">
        {!logs ? <Loading rows={10} /> : logs.length === 0 ? (
          <EmptyState icon="bi-clipboard" title="No movements recorded" />
        ) : (
          <div style={{ overflowX: 'auto' }}>
            <table className="table-soft">
              <thead>
                <tr>
                  <th>When</th>
                  <th>Product</th>
                  <th>Type</th>
                  <th className="text-end">Change</th>
                  <th className="text-end">Before</th>
                  <th className="text-end">After</th>
                  <th>By</th>
                  <th>Reason</th>
                </tr>
              </thead>
              <tbody>
                {logs.map((l) => {
                  const [icon, tone, label] = ENTRY_META[l.entry_type] || ['bi-dot', 'neutral', l.entry_type];
                  const up = l.quantity_change > 0;
                  return (
                    <tr key={l._id}>
                      <td className="td-muted" style={{ whiteSpace: 'nowrap' }}>{longDate(l.createdAt)}</td>
                      <td className="td-strong">{l.product_id?.name || '—'}</td>
                      <td><Chip tone={tone === 'coral' ? 'danger' : tone === 'sage' ? 'ok' : tone === 'amber' ? 'warn' : tone === 'sky' ? 'info' : 'plum'} icon={icon}>{label}</Chip></td>
                      <td className="text-end num" style={{ color: up ? 'var(--sage-deep)' : 'var(--coral-deep)', fontWeight: 'var(--weight-bold)' }}>
                        {up ? '+' : ''}{l.quantity_change}
                      </td>
                      <td className="text-end num td-muted">{l.stock_before}</td>
                      <td className="text-end num td-strong">{l.stock_after}</td>
                      <td className="td-muted">{l.user_id?.name || '—'}</td>
                      <td className="td-muted">{l.reason || '—'}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </Card>

      <div className="td-muted mt-3">
        <i className="bi bi-shield-check me-1" />
        Every row carries the person responsible. Because before and after are both recorded, the
        ledger reconciles exactly to the stock each product currently holds.
      </div>
    </Layout>
  );
}

/**
 * Recording a physical count.
 *
 * Small differences apply straight away. Beyond the tolerance it stops being a
 * correction and needs the Manager, so it raises an adjustment request instead
 * of quietly rewriting stock. That is the shrinkage control, in the workflow.
 */
function CountPanel({ products, onClose, onDone }) {
  const [productId, setProductId] = useState('');
  const [counted, setCounted] = useState('');
  const [reason, setReason] = useState('');
  const [tolerance, setTolerance] = useState(null);
  const [result, setResult] = useState(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);

  const product = products.find((p) => p._id === productId);

  useEffect(() => {
    if (!productId) { setTolerance(null); return; }
    api.get(`/stock/tolerance/${productId}`).then(setTolerance).catch(() => {});
  }, [productId]);

  const diff = product && counted !== '' ? Number(counted) - product.stock : null;
  const willNeedApproval = tolerance && diff !== null && Math.abs(diff) > tolerance.tolerance;

  const submit = async () => {
    setBusy(true); setError(null);
    try {
      const r = await api.post('/stock/count', { productId, countedStock: Number(counted), reason });
      setResult(r);
    } catch (err) { setError(err); } finally { setBusy(false); }
  };

  if (result) {
    return (
      <Card className="mb-4">
        <div className={result.applied ? '' : 'restock-flash'}>
          <h3 style={{ fontSize: 'var(--text-md)' }}>
            <i className={`bi ${result.applied ? 'bi-check-circle-fill' : 'bi-shield-exclamation'} me-2`} />
            {result.applied ? 'Count applied' : 'Sent to the Manager for approval'}
          </h3>
          <p style={{ color: 'var(--ink-500)', marginTop: 8, marginBottom: 0, fontSize: 'var(--text-sm)' }}>
            {result.applied
              ? `Difference of ${result.difference} was within tolerance, so stock was corrected and a ledger row written.`
              : `A difference of ${result.difference} is beyond tolerance. Stock has not changed: the count is waiting on the Restock page for the Manager to approve or reject, and you will be notified either way.`}
          </p>
        </div>
        <button className="btn btn-primary mt-3" onClick={onDone}>Done</button>
      </Card>
    );
  }

  return (
    <Card title="Record a physical count" subtitle="What is actually on the shelf right now" className="mb-4"
      actions={<button className="icon-btn" onClick={onClose}><i className="bi bi-x-lg" /></button>}
    >
      {error && <div className="mb-3" style={{ color: 'var(--coral-deep)', fontSize: 'var(--text-sm)' }}>{error.message}</div>}

      <div className="row g-3">
        <div className="col-12 col-md-5">
          <label className="form-label">Product</label>
          <select className="form-select" value={productId} onChange={(e) => setProductId(e.target.value)}>
            <option value="">Choose a product…</option>
            {products.map((p) => <option key={p._id} value={p._id}>{p.name}</option>)}
          </select>
        </div>
        <div className="col-6 col-md-2">
          <label className="form-label">System says</label>
          <input className="form-control" disabled value={product ? product.stock : '—'} />
        </div>
        <div className="col-6 col-md-2">
          <label className="form-label">You counted</label>
          <input
            className="form-control" type="number" value={counted}
            onChange={(e) => setCounted(e.target.value)} placeholder="0"
          />
        </div>
        <div className="col-12 col-md-3">
          <label className="form-label">Reason</label>
          <input className="form-control" value={reason} onChange={(e) => setReason(e.target.value)} placeholder="Optional note" />
        </div>
      </div>

      {tolerance && diff !== null && counted !== '' && (
        <div
          className="mt-3"
          style={{
            background: willNeedApproval ? 'var(--amber-soft)' : 'var(--sage-soft)',
            padding: 'var(--sp-3) var(--sp-4)', borderRadius: 'var(--radius-sm)', fontSize: 'var(--text-sm)',
            color: willNeedApproval ? 'var(--amber-deep)' : 'var(--sage-deep)',
          }}
        >
          <i className={`bi ${willNeedApproval ? 'bi-shield-exclamation' : 'bi-check-circle'} me-2`} />
          Difference of <strong>{diff > 0 ? `+${diff}` : diff}</strong>, tolerance is <strong>{tolerance.tolerance}</strong>.{' '}
          {willNeedApproval
            ? 'This will raise an adjustment request rather than applying.'
            : 'This will apply immediately.'}
        </div>
      )}

      <button
        className="btn btn-primary mt-3"
        disabled={!productId || counted === '' || busy}
        onClick={submit}
      >
        {busy ? 'Recording…' : 'Record count'}
      </button>
    </Card>
  );
}
