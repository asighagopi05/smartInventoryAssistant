import { useEffect, useState } from 'react';
import {
  ResponsiveContainer, ScatterChart, Scatter, XAxis, YAxis, ZAxis, Tooltip, CartesianGrid, ReferenceLine, Legend,
} from 'recharts';
import Layout from '../components/Layout';
import { Card, Chip, StatTile, Loading, ErrorNote, EmptyState, CategoryChip, Stars } from '../components/ui';
import { api, inr, shortDate } from '../api/client';

const GROUP_STYLE = {
  star: { tone: 'sage', chip: 'ok', color: '#86ab6e', icon: 'bi-star-fill' },
  fix: { tone: 'amber', chip: 'warn', color: '#e0a458', icon: 'bi-tools' },
  pair: { tone: 'indigo', chip: 'brand', color: '#6b7bd6', icon: 'bi-signpost-split' },
  delist: { tone: 'coral', chip: 'danger', color: '#e08370', icon: 'bi-trash3' },
  unrated: { tone: 'sky', chip: 'neutral', color: '#9aa3b5', icon: 'bi-question-circle' },
};
const ORDER = ['star', 'fix', 'pair', 'delist', 'unrated'];
const AXIS = { tick: { fontSize: 14, fill: 'var(--ink-400)' }, axisLine: false, tickLine: false };

function PointTooltip({ active, payload }) {
  if (!active || !payload?.length) return null;
  const p = payload[0].payload;
  return (
    <div style={{
      background: 'var(--paper)', border: 'var(--border)', borderRadius: 'var(--radius-sm)',
      padding: '8px 12px', boxShadow: 'var(--shadow)', fontSize: 'var(--text-sm)',
    }}
    >
      <strong style={{ color: 'var(--ink-900)' }}>{p.name}</strong>
      <div style={{ color: 'var(--ink-500)' }}>{p.units} units · {p.rating_avg}★ from {p.rating_count} ratings</div>
    </div>
  );
}

export default function Performance() {
  const [data, setData] = useState(null);
  const [error, setError] = useState(null);
  const [group, setGroup] = useState('pair');

  useEffect(() => {
    api.get('/insights/performance').then(setData).catch(setError);
  }, []);

  if (error) return <Layout title="Product performance"><ErrorNote error={error} /></Layout>;

  const subtitle = data
    ? `Sales from ${shortDate(data.window.from)} to ${shortDate(data.window.to)} combined with customers' QR ratings.`
    : 'Sales combined with customers\' QR ratings.';

  if (!data) return <Layout title="Product performance" subtitle={subtitle}><Loading rows={6} /></Layout>;

  const rated = data.products.filter((p) => p.group !== 'unrated');
  const rows = data.products.filter((p) => p.group === group);

  return (
    <Layout title="Product performance" subtitle={subtitle}>
      <div className="stat-grid mb-4">
        {ORDER.map((g) => (
          <StatTile
            key={g}
            tone={GROUP_STYLE[g].tone}
            icon={GROUP_STYLE[g].icon}
            label={data.groups[g].label}
            value={data.counts[g]}
            foot={g === group ? 'Shown below' : 'products'}
          />
        ))}
      </div>

      <div className="row g-4 mb-4">
        <div className="col-12 col-xl-7">
          <Card
            title="Sales against ratings"
            subtitle={`Each dot is a product with at least ${data.rules.min_ratings} ratings. Lines: median sales (${data.rules.median_units} units) and ${data.rules.good_rating}★.`}
          >
            <div style={{ height: 300 }}>
              <ResponsiveContainer width="100%" height="100%">
                <ScatterChart margin={{ top: 6, right: 12, left: -12, bottom: 0 }}>
                  <CartesianGrid strokeDasharray="3 3" stroke="var(--ink-100)" />
                  <XAxis type="number" dataKey="units" name="Units sold" {...AXIS} />
                  <YAxis type="number" dataKey="rating_avg" name="Rating" domain={[1, 5]} {...AXIS} />
                  <ZAxis range={[46, 46]} />
                  <ReferenceLine x={data.rules.median_units} stroke="var(--ink-300)" strokeDasharray="4 4" />
                  <ReferenceLine y={data.rules.good_rating} stroke="var(--ink-300)" strokeDasharray="4 4" />
                  <Tooltip content={<PointTooltip />} />
                  <Legend wrapperStyle={{ fontSize: 14 }} />
                  {ORDER.filter((g) => g !== 'unrated').map((g) => (
                    <Scatter
                      key={g}
                      name={data.groups[g].label}
                      data={rated.filter((p) => p.group === g)}
                      fill={GROUP_STYLE[g].color}
                      onClick={() => setGroup(g)}
                      cursor="pointer"
                    />
                  ))}
                </ScatterChart>
              </ResponsiveContainer>
            </div>
          </Card>
        </div>
        <div className="col-12 col-xl-5">
          <Card title="How to read it">
            {ORDER.map((g) => (
              <div key={g} className="d-flex gap-2 mb-3">
                <Chip tone={GROUP_STYLE[g].chip} icon={GROUP_STYLE[g].icon}>{data.groups[g].label}</Chip>
                <span className="td-muted">{data.groups[g].advice}</span>
              </div>
            ))}
            <p className="td-muted mb-0">
              Sales alone can&apos;t tell a product nobody wants from one nobody notices. The rating can:
              low sales with good ratings means customers like it once they find it.
            </p>
          </Card>
        </div>
      </div>

      <Card
        bodyClass=""
        actions={(
          <div className="d-flex flex-wrap gap-2">
            {ORDER.map((g) => (
              <button
                key={g}
                className={`btn btn-sm ${group === g ? 'btn-primary' : 'btn-ghost'}`}
                onClick={() => setGroup(g)}
              >
                {data.groups[g].label} ({data.counts[g]})
              </button>
            ))}
          </div>
        )}
      >
        {rows.length === 0 ? <EmptyState icon="bi-inbox" title="No products in this group" /> : (
          <div style={{ overflowX: 'auto' }}>
            <table className="table-soft">
              <thead>
                <tr>
                  <th>Product</th>
                  <th>Aisle</th>
                  <th className="text-end">Units, 30 days</th>
                  <th className="text-end">Revenue</th>
                  <th>Rating</th>
                  {group === 'pair' && <th>Place next to</th>}
                </tr>
              </thead>
              <tbody>
                {rows.map((p) => (
                  <tr key={p._id}>
                    <td>
                      <div className="td-strong">{p.name}</div>
                      <div className="td-muted">{p.sku}</div>
                    </td>
                    <td><CategoryChip category={p.category} /></td>
                    <td className="text-end num td-strong">{p.units}</td>
                    <td className="text-end num">{inr(p.revenue, { compact: true })}</td>
                    <td>
                      {p.rating_count > 0 ? (
                        <span className="d-inline-flex align-items-center gap-2">
                          <Stars value={p.rating_avg} />
                          <span className="td-muted">{p.rating_avg} ({p.rating_count})</span>
                        </span>
                      ) : <span className="td-muted">—</span>}
                    </td>
                    {group === 'pair' && (
                      <td>
                        {p.partner ? (
                          <>
                            <div className="td-strong">{p.partner.name}</div>
                            <div className="td-muted">combo lift {p.partner.lift.toFixed(1)}×</div>
                          </>
                        ) : <span className="td-muted">No strong combo partner found</span>}
                      </td>
                    )}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>
    </Layout>
  );
}
