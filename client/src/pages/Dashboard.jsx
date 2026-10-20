import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import {
  ResponsiveContainer, AreaChart, Area, XAxis, YAxis, Tooltip, CartesianGrid,
  BarChart, Bar, Cell,
} from 'recharts';
import Layout from '../components/Layout';
import { Card, StatTile, Loading, ErrorNote, EmptyState, Stars, CategoryChip } from '../components/ui';
import { api, inr, shortDate } from '../api/client';
import { useAuth } from '../context/AuthContext';

/** Category colours are the same tokens the chips use, so nothing drifts. */
const CATEGORY_COLOR = {
  Dairy: '#6aa5d8', Bakery: '#e0a458', Produce: '#86ab6e', Meat: '#e08370',
  Frozen: '#4fa8a0', Beverages: '#6b7bd6', Alcohol: '#a87bb8', Snacks: '#d47b9a',
  Staples: '#b07c33', Household: '#357a74', 'Personal Care': '#7e5590', Electronics: '#626c82',
};

function ChartTooltip({ active, payload, label, prefix = '' }) {
  if (!active || !payload?.length) return null;
  return (
    <div
      style={{
        background: 'var(--paper)', border: 'var(--border)', borderRadius: 'var(--radius-sm)',
        padding: '8px 12px', boxShadow: 'var(--shadow)', fontSize: 'var(--text-sm)',
      }}
    >
      <div style={{ color: 'var(--ink-400)', fontSize: 'var(--text-xs)', marginBottom: 2 }}>{label}</div>
      <strong style={{ color: 'var(--ink-900)' }}>
        {prefix}{typeof payload[0].value === 'number' ? payload[0].value.toLocaleString('en-IN') : payload[0].value}
      </strong>
    </div>
  );
}

export default function Dashboard() {
  const { user } = useAuth();
  const [data, setData] = useState(null);
  const [lowStock, setLowStock] = useState([]);
  const [error, setError] = useState(null);

  useEffect(() => {
    (async () => {
      try {
        const [d, l] = await Promise.all([api.get('/dashboard'), api.get('/dashboard/low-stock')]);
        setData(d);
        setLowStock(l.products);
      } catch (err) {
        setError(err);
      }
    })();
  }, []);

  if (error) return <Layout title="Dashboard"><ErrorNote error={error} /></Layout>;
  if (!data) return <Layout title="Dashboard"><Loading rows={6} /></Layout>;

  const { totals, today, last_30_days: last30, sales_by_day: byDay, top_products: top, category_mix: mix } = data;

  const greeting = new Date().getHours() < 12 ? 'Good morning'
    : new Date().getHours() < 17 ? 'Good afternoon' : 'Good evening';

  return (
    <Layout
      title={`${greeting}, ${user.name.split(' ')[0]}`}
      subtitle={`${user.role} view — everything below is live from the database`}
    >
      <div className="stat-grid mb-4">
        <StatTile
          tone="indigo" icon="bi-currency-rupee" label="Revenue today"
          value={inr(today.revenue, { compact: true })}
          foot={`${today.bills} bill${today.bills === 1 ? '' : 's'} so far`}
        />
        <StatTile
          tone="teal" icon="bi-graph-up-arrow" label="Last 30 days"
          value={inr(last30.revenue, { compact: true })}
          foot={`${last30.bills.toLocaleString('en-IN')} bills`}
        />
        <StatTile
          tone="amber" icon="bi-exclamation-triangle-fill" label="Below threshold"
          value={totals.low_stock}
          foot={`of ${totals.products} products`}
        />
        <StatTile
          tone="coral" icon="bi-arrow-repeat" label="Open restock requests"
          value={totals.open_restock}
          foot={`${totals.pending_approval} awaiting approval`}
        />
        <StatTile
          tone="sage" icon="bi-box-seam-fill" label="Stock value"
          value={inr(totals.stock_value, { compact: true })}
          foot="at cost price"
        />
        <StatTile
          tone="rose" icon="bi-people-fill" label="Customers"
          value={totals.customers.toLocaleString('en-IN')}
          foot="phone-keyed, no accounts"
        />
        <Link to="/issues" className="stat-link">
          <StatTile
            tone="plum" icon="bi-flag-fill" label="Open issues"
            value={totals.open_issues}
            foot="flagged on the floor, not yet resolved"
          />
        </Link>
        <Link to="/tasks" className="stat-link">
          <StatTile
            tone="sky" icon="bi-check2-square" label="Open tasks"
            value={totals.open_tasks}
            foot="handed out and not yet done"
          />
        </Link>
      </div>

      <div className="row g-4">
        <div className="col-12 col-xl-8">
          <Card
            title="Revenue, last 30 days"
            subtitle="Daily takings across every till"
          >
            <div style={{ height: 260 }}>
              <ResponsiveContainer width="100%" height="100%">
                <AreaChart data={byDay} margin={{ top: 6, right: 6, left: -18, bottom: 0 }}>
                  <defs>
                    <linearGradient id="revFill" x1="0" y1="0" x2="0" y2="1">
                      <stop offset="0%" stopColor="#6b7bd6" stopOpacity={0.34} />
                      <stop offset="100%" stopColor="#6b7bd6" stopOpacity={0.02} />
                    </linearGradient>
                  </defs>
                  <CartesianGrid strokeDasharray="3 3" stroke="var(--ink-100)" vertical={false} />
                  <XAxis
                    dataKey="date" tickFormatter={shortDate}
                    tick={{ fontSize: 14, fill: 'var(--ink-400)' }}
                    axisLine={false} tickLine={false} minTickGap={24}
                  />
                  <YAxis
                    tick={{ fontSize: 14, fill: 'var(--ink-400)' }}
                    axisLine={false} tickLine={false}
                    tickFormatter={(v) => (v >= 1000 ? `${(v / 1000).toFixed(0)}k` : v)}
                  />
                  <Tooltip content={<ChartTooltip prefix="₹" />} labelFormatter={shortDate} />
                  <Area
                    type="monotone" dataKey="revenue" stroke="#6b7bd6"
                    strokeWidth={2.2} fill="url(#revFill)"
                  />
                </AreaChart>
              </ResponsiveContainer>
            </div>
          </Card>
        </div>

        <div className="col-12 col-xl-4">
          <Card
            title="Needs restocking"
            subtitle={`${lowStock.length} at or below threshold`}
            actions={<Link to="/restock" className="btn btn-soft btn-sm">View all</Link>}
            bodyClass=""
          >
            <div style={{ maxHeight: 260, overflowY: 'auto' }}>
              {lowStock.length === 0 ? (
                <EmptyState icon="bi-check-circle" title="Everything is stocked">
                  No product is below its threshold right now.
                </EmptyState>
              ) : (
                lowStock.slice(0, 12).map((p) => (
                  <div
                    key={p._id}
                    className="d-flex align-items-center gap-3"
                    style={{ padding: 'var(--sp-3) var(--sp-5)', borderBottom: 'var(--border-light)' }}
                  >
                    <div style={{ minWidth: 0, flex: 1 }}>
                      <div className="td-strong text-truncate" style={{ fontSize: 'var(--text-sm)' }}>
                        {p.name}
                      </div>
                      <div className="td-muted">
                        {p.stock} left · threshold {p.threshold}
                      </div>
                    </div>
                    {p.has_open_request
                      ? <span className="chip chip-info">Requested</span>
                      : <span className="chip chip-warn">Low</span>}
                  </div>
                ))
              )}
            </div>
          </Card>
        </div>

        <div className="col-12 col-lg-7">
          <Card title="Best sellers" subtitle="Units sold in the last 30 days">
            <div style={{ height: 280 }}>
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={top} layout="vertical" margin={{ top: 0, right: 16, left: 8, bottom: 0 }}>
                  <CartesianGrid strokeDasharray="3 3" stroke="var(--ink-100)" horizontal={false} />
                  <XAxis type="number" tick={{ fontSize: 14, fill: 'var(--ink-400)' }} axisLine={false} tickLine={false} />
                  <YAxis
                    type="category" dataKey="name" width={150}
                    tick={{ fontSize: 14, fill: 'var(--ink-500)' }} axisLine={false} tickLine={false}
                    tickFormatter={(v) => (v.length > 22 ? `${v.slice(0, 21)}…` : v)}
                  />
                  <Tooltip content={<ChartTooltip />} cursor={{ fill: 'var(--ink-50)' }} />
                  <Bar dataKey="units" radius={[0, 6, 6, 0]} barSize={16}>
                    {top.map((_, i) => (
                      <Cell key={i} fill={['#6b7bd6', '#4fa8a0', '#e0a458', '#86ab6e', '#d47b9a', '#a87bb8', '#6aa5d8', '#e08370'][i % 8]} />
                    ))}
                  </Bar>
                </BarChart>
              </ResponsiveContainer>
            </div>
          </Card>
        </div>

        <div className="col-12 col-lg-5">
          <Card title="Revenue by aisle" subtitle="Where the money comes from" bodyClass="">
            <div style={{ padding: 'var(--sp-4) var(--sp-5)' }}>
              {mix.map((c) => {
                const max = Math.max(...mix.map((m) => m.revenue));
                const pct = max ? (c.revenue / max) * 100 : 0;
                const color = CATEGORY_COLOR[c.category] || 'var(--ink-400)';
                return (
                  <div key={c.category} className="mb-3">
                    <div className="d-flex justify-content-between align-items-center mb-1">
                      <CategoryChip category={c.category} />
                      <span className="num" style={{ fontSize: 'var(--text-sm)', color: 'var(--ink-700)', fontWeight: 'var(--weight-medium)' }}>
                        {inr(c.revenue, { compact: true })}
                      </span>
                    </div>
                    <div style={{ height: 7, background: 'var(--ink-100)', borderRadius: 99, overflow: 'hidden' }}>
                      <div style={{ width: `${pct}%`, height: '100%', background: color, borderRadius: 99, transition: 'width .5s var(--ease)' }} />
                    </div>
                  </div>
                );
              })}
            </div>
          </Card>
        </div>

        <div className="col-12">
          <Card
            title="Latest customer feedback"
            subtitle="Submitted by QR — no account, no login"
            actions={<Link to="/feedback" className="btn btn-soft btn-sm">Open feedback</Link>}
            bodyClass=""
          >
            {data.recent_feedback.length === 0 ? (
              <EmptyState icon="bi-chat-heart" title="No feedback yet" />
            ) : (
              <div className="row g-0">
                {data.recent_feedback.map((n) => (
                  <div key={n._id} className="col-12 col-md-6 col-xl-4" style={{ padding: 'var(--sp-4) var(--sp-5)', borderBottom: 'var(--border-light)' }}>
                    <div className="d-flex align-items-center gap-2 mb-1">
                      <Stars value={n.rating} />
                      <span className="td-muted">{n.source?.replace('_', ' ')}</span>
                    </div>
                    <div className="td-strong" style={{ fontSize: 'var(--text-sm)' }}>
                      {n.product_id?.name || 'The shop'}
                    </div>
                    {n.body && (
                      <div className="td-muted" style={{ fontStyle: 'italic' }}>&ldquo;{n.body}&rdquo;</div>
                    )}
                  </div>
                ))}
              </div>
            )}
          </Card>
        </div>
      </div>
    </Layout>
  );
}
