import { useEffect, useState } from 'react';
import Layout from '../components/Layout';
import { Card, StatusChip, Loading, ErrorNote, EmptyState, StatTile } from '../components/ui';
import { api, longDate } from '../api/client';
import { useAuth } from '../context/AuthContext';

export default function Restock() {
  const { isRole } = useAuth();
  const [data, setData] = useState(null);
  const [status, setStatus] = useState('open');
  const [error, setError] = useState(null);
  const [busyId, setBusyId] = useState(null);

  const load = () => api.get(`/restock?status=${status}&limit=200`).then(setData).catch(setError);
  useEffect(() => { setData(null); load(); }, [status]);

  const act = async (id, action, body = {}) => {
    setBusyId(id);
    try {
      await api.post(`/restock/${id}/${action}`, body);
      await load();
    } catch (err) { setError(err); } finally { setBusyId(null); }
  };

  if (error) return <Layout title="Restock requests"><ErrorNote error={error} /></Layout>;

  const counts = data?.counts || {};

  return (
    <Layout
      title="Restock requests"
      subtitle="Raised by the system when stock crosses a threshold — not by a person"
    >
      <div className="stat-grid mb-4">
        <StatTile tone="amber" icon="bi-hourglass-split" label="Awaiting approval" value={counts.pending || 0} foot="Manager decides" />
        <StatTile tone="sky" icon="bi-check2-circle" label="Approved, in transit" value={counts.approved || 0} foot="waiting on the supplier" />
        <StatTile tone="sage" icon="bi-box-seam-fill" label="Received" value={counts.received || 0} foot="closed and stocked" />
        <StatTile tone="coral" icon="bi-x-circle" label="Rejected" value={counts.rejected || 0} />
      </div>

      <Card
        bodyClass=""
        actions={(
          <div className="d-flex flex-wrap gap-2">
            {['open', 'pending', 'approved', 'received', 'all'].map((s) => (
              <button
                key={s}
                className={`btn btn-sm ${status === s ? 'btn-primary' : 'btn-ghost'}`}
                onClick={() => setStatus(s)}
                style={{ textTransform: 'capitalize' }}
              >
                {s}
              </button>
            ))}
          </div>
        )}
        title="Requests"
        subtitle={data ? `${data.requests.length} shown` : 'Loading…'}
      >
        {!data ? <Loading rows={8} /> : data.requests.length === 0 ? (
          <EmptyState icon="bi-check-circle" title="Nothing here">
            No requests with that status.
          </EmptyState>
        ) : (
          <div style={{ overflowX: 'auto' }}>
            <table className="table-soft">
              <thead>
                <tr>
                  <th>Product</th>
                  <th>Raised</th>
                  <th className="text-end">Stock then</th>
                  <th className="text-end">Threshold</th>
                  <th className="text-end">Qty</th>
                  <th>Supplier</th>
                  <th>Status</th>
                  <th>Source</th>
                  {isRole('Manager', 'Staff') && <th />}
                </tr>
              </thead>
              <tbody>
                {data.requests.map((r) => (
                  <tr key={r._id} className={r.status === 'pending' ? 'row-flag flag-warn' : ''}>
                    <td>
                      <div className="td-strong">{r.product_id?.name || '—'}</div>
                      <div className="td-muted">{r.product_id?.sku}</div>
                    </td>
                    <td className="td-muted" style={{ minWidth: 120 }}>{longDate(r.createdAt)}</td>
                    <td className="text-end num td-strong">{r.stock_at_request}</td>
                    <td className="text-end num td-muted">{r.threshold_at_request}</td>
                    <td className="text-end num td-strong">{r.qty}</td>
                    <td className="td-muted">{r.supplier_id?.name || '—'}</td>
                    <td><StatusChip status={r.status} /></td>
                    <td>
                      {r.raised_by === null
                        ? <span className="chip chip-brand" title="No person raised this"><i className="bi bi-cpu" />Automatic</span>
                        : <span className="chip chip-neutral">Manual</span>}
                    </td>
                    {isRole('Manager', 'Staff') && (
                      <td className="text-end" style={{ whiteSpace: 'nowrap' }}>
                        {r.status === 'pending' && isRole('Manager') && (
                          <>
                            <button
                              className="btn btn-accent btn-sm me-2"
                              disabled={busyId === r._id}
                              onClick={() => act(r._id, 'approve', { approve: true })}
                            >
                              Approve
                            </button>
                            <button
                              className="btn btn-danger-soft btn-sm"
                              disabled={busyId === r._id}
                              onClick={() => act(r._id, 'approve', { approve: false })}
                            >
                              Reject
                            </button>
                          </>
                        )}
                        {r.status === 'pending' && !isRole('Manager') && (
                          <span className="td-muted">Manager decides</span>
                        )}
                        {r.status === 'approved' && (
                          <button
                            className="btn btn-primary btn-sm"
                            disabled={busyId === r._id}
                            onClick={() => act(r._id, 'receive', {})}
                          >
                            <i className="bi bi-box-seam me-1" />Mark received
                          </button>
                        )}
                      </td>
                    )}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>

      <div className="td-muted mt-3">
        <i className="bi bi-info-circle me-1" />
        A product can only ever have one open request. That is enforced by a unique index in the
        database, not only by a check in the code, so two tills selling the last unit at the same
        moment still cannot produce a duplicate.
      </div>
    </Layout>
  );
}
