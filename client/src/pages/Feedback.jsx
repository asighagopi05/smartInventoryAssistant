import { useEffect, useState } from 'react';
import Layout from '../components/Layout';
import { Card, Loading, ErrorNote, EmptyState, Stars, Chip, StatTile } from '../components/ui';
import { api, longDate } from '../api/client';

const SOURCE_LABEL = {
  product_qr: ['Shelf QR', 'brand'],
  shop_qr: ['Shop QR', 'info'],
  bill_qr: ['Receipt QR', 'plum'],
  staff: ['Staff', 'neutral'],
};

export default function Feedback() {
  const [data, setData] = useState(null);
  const [filter, setFilter] = useState('');
  const [error, setError] = useState(null);

  useEffect(() => {
    setData(null);
    api.get(filter ? `/feedback?rating=${filter}&limit=200` : '/feedback?limit=200')
      .then(setData).catch(setError);
  }, [filter]);

  if (error) return <Layout title="Feedback"><ErrorNote error={error} /></Layout>;

  const summary = data?.summary || {};
  const total = Object.values(summary).reduce((a, b) => a + b, 0);
  const avg = total
    ? Object.entries(summary).reduce((s, [r, n]) => s + Number(r) * n, 0) / total
    : 0;
  const poor = (summary[1] || 0) + (summary[2] || 0);

  return (
    <Layout
      title="Customer feedback"
      subtitle="Submitted by QR — no account, no login, nothing asked of the customer"
    >
      <div className="stat-grid mb-4">
        <StatTile tone="amber" icon="bi-star-fill" label="Average rating" value={avg.toFixed(2)} foot={`across ${total} reviews`} />
        <StatTile tone="sage" icon="bi-hand-thumbs-up-fill" label="4 stars and up" value={(summary[4] || 0) + (summary[5] || 0)} />
        <StatTile tone="coral" icon="bi-hand-thumbs-down-fill" label="2 stars and under" value={poor} foot="each one notified the Manager" />
        <StatTile tone="plum" icon="bi-chat-square-heart-fill" label="Total reviews" value={total} />
      </div>

      <Card
        bodyClass=""
        title="Reviews"
        subtitle={data ? `${data.notes.length} shown` : 'Loading…'}
        actions={(
          <div className="d-flex gap-2">
            <button className={`btn btn-sm ${filter === '' ? 'btn-primary' : 'btn-ghost'}`} onClick={() => setFilter('')}>All</button>
            {[5, 4, 3, 2, 1].map((r) => (
              <button
                key={r}
                className={`btn btn-sm ${filter === String(r) ? 'btn-primary' : 'btn-ghost'}`}
                onClick={() => setFilter(String(r))}
              >
                {r}★
              </button>
            ))}
          </div>
        )}
      >
        {!data ? <Loading rows={8} /> : data.notes.length === 0 ? (
          <EmptyState icon="bi-chat-heart" title="No feedback with that rating" />
        ) : (
          <div style={{ overflowX: 'auto' }}>
            <table className="table-soft">
              <thead>
                <tr>
                  <th>Rating</th>
                  <th>Product</th>
                  <th>Comment</th>
                  <th>Source</th>
                  <th>Customer</th>
                  <th>When</th>
                </tr>
              </thead>
              <tbody>
                {data.notes.map((n) => {
                  const [label, tone] = SOURCE_LABEL[n.source] || ['—', 'neutral'];
                  return (
                    <tr key={n._id} className={n.rating <= 2 ? 'row-flag flag-danger' : ''}>
                      <td><Stars value={n.rating} /></td>
                      <td className="td-strong">{n.product_id?.name || <span className="td-muted">The shop</span>}</td>
                      <td className="td-muted" style={{ maxWidth: 340, fontStyle: n.body ? 'italic' : 'normal' }}>
                        {n.body ? `“${n.body}”` : '—'}
                      </td>
                      <td><Chip tone={tone}>{label}</Chip></td>
                      <td className="td-muted">
                        {n.customer_id
                          ? <>{n.customer_id.name || n.customer_id.phone}</>
                          : <span className="chip chip-neutral">Anonymous</span>}
                      </td>
                      <td className="td-muted" style={{ whiteSpace: 'nowrap' }}>{longDate(n.createdAt)}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </Card>

      <div className="td-muted mt-3">
        <i className="bi bi-info-circle me-1" />
        A customer who gives their phone number has their feedback linked to their purchase history.
        One who does not is simply anonymous — nothing is ever withheld for not giving it.
      </div>
    </Layout>
  );
}
