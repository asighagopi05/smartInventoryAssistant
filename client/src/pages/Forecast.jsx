import { useCallback, useEffect, useState } from 'react';
import {
  ResponsiveContainer, BarChart, Bar, ComposedChart, Line, XAxis, YAxis, Tooltip, CartesianGrid, Legend,
} from 'recharts';
import Layout from '../components/Layout';
import { Card, Chip, StatTile, Loading, ErrorNote, EmptyState, CategoryChip, StatusChip } from '../components/ui';
import { api, longDate, shortDate } from '../api/client';

const pct = (n) => (n == null ? '—' : `${(n * 100).toFixed(1)}%`);
const AXIS = { tick: { fontSize: 14, fill: 'var(--ink-400)' }, axisLine: false, tickLine: false };

/** Daily sales for the last 8 weeks, then the model's next 7 days. Remounted per product via `key`. */
function ProductChart({ productId }) {
  const [data, setData] = useState(null);
  useEffect(() => {
    api.get(`/forecast/product/${productId}`).then(setData).catch(() => setData(false));
  }, [productId]);

  if (data === null) return <Loading rows={4} />;
  if (data === false) return <EmptyState icon="bi-graph-up" title="Could not load this product" />;

  const rows = [
    ...data.history.map((h) => ({ date: h.date, sold: h.sold })),
    ...data.forecast.map((f) => ({ date: f.date, predicted: Math.round(f.predicted * 10) / 10 })),
  ];
  return (
    <>
      <div className="td-strong mb-1">{data.product.name}</div>
      <div className="td-muted mb-3">Bars: units sold each day. Line: what the model expects for the next 7 days.</div>
      <div style={{ height: 240 }}>
        <ResponsiveContainer width="100%" height="100%">
          <ComposedChart data={rows} margin={{ top: 6, right: 6, left: -18, bottom: 0 }}>
            <CartesianGrid strokeDasharray="3 3" stroke="var(--ink-100)" vertical={false} />
            <XAxis dataKey="date" tickFormatter={shortDate} minTickGap={24} {...AXIS} />
            <YAxis allowDecimals={false} {...AXIS} />
            <Tooltip labelFormatter={shortDate} />
            <Bar dataKey="sold" name="Sold" fill="#6aa5d8" radius={[3, 3, 0, 0]} />
            <Line dataKey="predicted" name="Forecast" stroke="#e08370" strokeWidth={2.4} dot={{ r: 3 }} />
          </ComposedChart>
        </ResponsiveContainer>
      </div>
    </>
  );
}

export default function Forecast() {
  const [data, setData] = useState(null);
  const [error, setError] = useState(null);
  const [running, setRunning] = useState(false);
  const [selected, setSelected] = useState(null);
  const [onlyRisk, setOnlyRisk] = useState(true);

  const load = useCallback(() => api.get('/forecast').then((d) => {
    setData(d);
    setSelected((s) => s || d.products[0]?.product._id || null);
  }).catch(setError), []);

  useEffect(() => { load(); }, [load]);

  const run = async () => {
    setRunning(true);
    setError(null);
    try {
      await api.post('/forecast/generate');
      await load();
    } catch (err) {
      setError(err);
    } finally {
      setRunning(false);
    }
  };

  const actions = (
    <button className="btn btn-primary" onClick={run} disabled={running}>
      <i className={`bi ${running ? 'bi-hourglass-split' : 'bi-cpu'} me-2`} />
      {running ? 'Forecasting…' : 'Run forecast'}
    </button>
  );

  const layout = (children) => (
    <Layout
      title="Sales forecast"
      subtitle="Units each product is expected to sell in the next 7 days, from a LinearRegression model trained on every bill."
      actions={actions}
    >
      {error && <div className="mb-3"><ErrorNote error={error} /></div>}
      {children}
    </Layout>
  );

  if (!data) return layout(error ? null : <Loading rows={6} />);
  if (data.products.length === 0) {
    return layout(
      <Card>
        <EmptyState icon="bi-graph-up-arrow" title="No forecast yet">
          Press <strong>Run forecast</strong>. The ML service must be running on port 8000.
        </EmptyState>
      </Card>
    );
  }

  const atRisk = data.products.filter((p) => p.runs_out);
  const uncovered = atRisk.filter((p) => !p.restock_status);
  const rows = onlyRisk ? atRisk : data.products;
  const weeks = data.backtest.weeks.map((w) => ({
    week: shortDate(w.window_start),
    Actual: w.actual_units,
    Model: w.predicted_units,
    '4-week average': w.naive_units,
  }));

  return layout(
    <>
      <div className="stat-grid mb-4">
        <StatTile
          tone="sky" icon="bi-graph-up-arrow" label="Forecast window"
          value={`${shortDate(data.window_start)} – ${shortDate(new Date(new Date(data.window_end) - 1))}`}
          foot={`Run ${longDate(data.generated_at)}`}
        />
        <StatTile
          tone="coral" icon="bi-exclamation-triangle-fill" label="Will run out this week"
          value={atRisk.length}
          foot={`${uncovered.length} with no restock requested`}
        />
        <StatTile
          tone="sage" icon="bi-bullseye" label="Model accuracy"
          value={pct(data.backtest.model_accuracy)}
          foot={`4-week average: ${pct(data.backtest.naive_accuracy)}`}
        />
      </div>

      <div className="row g-4 mb-4">
        <div className="col-12 col-xl-6">
          <Card
            title="How accurate is it?"
            subtitle="Each past week was hidden from the model, predicted from the weeks before it, then compared with what really sold."
          >
            <div style={{ height: 240 }}>
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={weeks} margin={{ top: 6, right: 6, left: -10, bottom: 0 }}>
                  <CartesianGrid strokeDasharray="3 3" stroke="var(--ink-100)" vertical={false} />
                  <XAxis dataKey="week" {...AXIS} />
                  <YAxis {...AXIS} />
                  <Tooltip />
                  <Legend wrapperStyle={{ fontSize: 14 }} />
                  <Bar dataKey="Actual" fill="#626c82" radius={[3, 3, 0, 0]} />
                  <Bar dataKey="Model" fill="#6b7bd6" radius={[3, 3, 0, 0]} />
                  <Bar dataKey="4-week average" fill="#e0a458" radius={[3, 3, 0, 0]} />
                </BarChart>
              </ResponsiveContainer>
            </div>
            <div className="d-flex flex-wrap gap-2 mt-3">
              {data.backtest.weeks.map((w) => (
                <Chip key={w.window_start} tone={w.model_accuracy >= w.naive_accuracy ? 'ok' : 'warn'}>
                  Week of {shortDate(w.window_start)}: model {pct(w.model_accuracy)} vs {pct(w.naive_accuracy)}
                </Chip>
              ))}
            </div>
          </Card>
        </div>
        <div className="col-12 col-xl-6">
          <Card title="One product up close" subtitle="Click any row below to change the product.">
            {selected ? <ProductChart key={selected} productId={selected} /> : <EmptyState title="Pick a product" />}
          </Card>
        </div>
      </div>

      <Card
        title="Next 7 days, product by product"
        subtitle="Days of cover = stock ÷ forecast daily sales. Below 7 means it runs out before the week ends."
        bodyClass=""
        actions={(
          <div className="d-flex gap-2">
            <button className={`btn btn-sm ${onlyRisk ? 'btn-primary' : 'btn-ghost'}`} onClick={() => setOnlyRisk(true)}>
              Runs out ({atRisk.length})
            </button>
            <button className={`btn btn-sm ${!onlyRisk ? 'btn-primary' : 'btn-ghost'}`} onClick={() => setOnlyRisk(false)}>
              All ({data.products.length})
            </button>
          </div>
        )}
      >
        <div style={{ overflowX: 'auto' }}>
          <table className="table-soft">
            <thead>
              <tr>
                <th>Product</th>
                <th>Aisle</th>
                <th className="text-end">Stock</th>
                <th className="text-end">Forecast, 7 days</th>
                <th className="text-end">Days of cover</th>
                <th>Restock</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((p) => (
                <tr
                  key={p.product._id}
                  className={p.runs_out ? `row-flag ${p.restock_status ? 'flag-warn' : 'flag-danger'}` : ''}
                  onClick={() => setSelected(p.product._id)}
                  style={{ cursor: 'pointer', background: selected === p.product._id ? 'var(--ink-50)' : undefined }}
                >
                  <td>
                    <div className="td-strong">{p.product.name}</div>
                    <div className="td-muted">{p.product.sku}</div>
                  </td>
                  <td><CategoryChip category={p.product.category} /></td>
                  <td className="text-end num td-strong">{p.product.stock}</td>
                  <td className="text-end num td-strong">{Math.round(p.predicted_units)}</td>
                  <td className="text-end num">{p.days_of_cover ?? '—'}</td>
                  <td>
                    {p.restock_status ? <StatusChip status={p.restock_status} />
                      : p.runs_out ? <Chip tone="danger" icon="bi-exclamation-octagon-fill">Not requested</Chip>
                        : <span className="td-muted">—</span>}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Card>

      {data.checked.length > 0 && (
        <div className="mt-4">
          <Card
            title="Forecasts checked against real sales"
            subtitle="Live forecasts and restock approvals whose week has passed. Checked every hour."
            bodyClass=""
          >
            <div style={{ overflowX: 'auto' }}>
              <table className="table-soft">
                <thead>
                  <tr>
                    <th>Product</th>
                    <th>Made</th>
                    <th>For</th>
                    <th className="text-end">Predicted</th>
                    <th className="text-end">Actual</th>
                    <th className="text-end">Accuracy</th>
                  </tr>
                </thead>
                <tbody>
                  {data.checked.map((c) => (
                    <tr key={c._id}>
                      <td>
                        <div className="td-strong">{c.product_id?.name}</div>
                        <div className="td-muted">{c.kind === 'approval' ? 'Restock approval' : 'Live forecast'}</div>
                      </td>
                      <td className="td-muted">{shortDate(c.generated_at)}</td>
                      <td className="td-muted">{shortDate(c.window_start)} – {shortDate(c.window_end)}</td>
                      <td className="text-end num">{Math.round(c.predicted_units)}</td>
                      <td className="text-end num td-strong">{c.actual_units}</td>
                      <td className="text-end num">{pct(c.accuracy)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </Card>
        </div>
      )}
    </>
  );
}
