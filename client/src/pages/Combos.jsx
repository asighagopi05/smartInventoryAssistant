import { useEffect, useState } from 'react';
import Layout from '../components/Layout';
import { Card, Chip, Loading, ErrorNote, EmptyState } from '../components/ui';
import { api, longDate } from '../api/client';

const pct = (n) => `${Math.round(n * 100)}%`;

/** How strong the link is, from lift. 1 = chance, so these are multiples of it. */
function Strength({ lift }) {
  if (lift >= 5) return <Chip tone="brand" icon="bi-lightning-charge-fill">Very strong</Chip>;
  if (lift >= 2) return <Chip tone="ok">Strong</Chip>;
  return <Chip tone="info">Mild</Chip>;
}

export default function Combos() {
  const [combos, setCombos] = useState(undefined); // undefined = loading, null = never generated
  const [error, setError] = useState(null);
  const [running, setRunning] = useState(false);
  const [search, setSearch] = useState('');
  const [sort, setSort] = useState('score');
  const [storiesOnly, setStoriesOnly] = useState(false);

  useEffect(() => {
    api.get('/combos').then((d) => setCombos(d.combos)).catch(setError);
  }, []);

  const generate = async () => {
    setRunning(true);
    setError(null);
    try {
      const d = await api.post('/combos/generate');
      setCombos(d.combos);
    } catch (err) {
      setError(err);
    } finally {
      setRunning(false);
    }
  };

  const q = search.trim().toLowerCase();
  const rules = (combos?.rules || [])
    .filter((r) => !q || r.if_bought.toLowerCase().includes(q) || r.also_bought.toLowerCase().includes(q))
    .filter((r) => !storiesOnly || r.slow_strong)
    .sort((a, b) => (sort === 'lift' ? b.lift - a.lift : (b.score ?? b.lift) - (a.score ?? a.lift)));
  const storyCount = (combos?.rules || []).filter((r) => r.slow_strong).length;

  const actions = (
    <button className="btn btn-primary" onClick={generate} disabled={running}>
      <i className={`bi ${running ? 'bi-hourglass-split' : 'bi-cpu'} me-2`} />
      {running ? 'Analysing bills…' : 'Run analysis'}
    </button>
  );

  return (
    <Layout
      title="Combos"
      subtitle="Products customers buy together, found by the Apriori algorithm from every bill."
      actions={actions}
    >
      {error && <div className="mb-3"><ErrorNote error={error} /></div>}

      {combos === undefined ? <Loading rows={6} /> : combos === null ? (
        <Card>
          <EmptyState icon="bi-diagram-3" title="No analysis yet">
            Press <strong>Run analysis</strong>. The ML service must be running on port 8000.
          </EmptyState>
        </Card>
      ) : (
        <>
          <div className="d-flex flex-wrap align-items-center gap-2 mb-3">
            <Chip tone="brand">{combos.rules.length} combos</Chip>
            <Chip tone="info">{combos.basket_count.toLocaleString('en-IN')} bills analysed</Chip>
            {combos.rules[0]?.p_value != null && (
              <Chip tone="neutral" icon="bi-shield-check">Each passed a 1-in-100 coincidence test</Chip>
            )}
            <span className="td-muted">
              Last run {longDate(combos.generated_at)}
              {combos.generated_by?.name && ` by ${combos.generated_by.name}`}
            </span>
            <input
              className="form-control ms-auto"
              style={{ maxWidth: 260 }}
              placeholder="Search a product…"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
            />
          </div>

          <div className="d-flex flex-wrap align-items-center gap-2 mb-3">
            <button
              className={`btn btn-sm ${sort === 'score' ? 'btn-primary' : 'btn-ghost'}`}
              onClick={() => setSort('score')}
              title="Lift, boosted when the 'also bought' product sells far more than the first one"
            >
              Best opportunities
            </button>
            <button
              className={`btn btn-sm ${sort === 'lift' ? 'btn-primary' : 'btn-ghost'}`}
              onClick={() => setSort('lift')}
            >
              Highest lift
            </button>
            <button
              className={`btn btn-sm ${storiesOnly ? 'btn-primary' : 'btn-ghost'}`}
              onClick={() => setStoriesOnly((v) => !v)}
            >
              <i className="bi bi-signpost-split me-1" />Slow mover + strong seller ({storyCount})
            </button>
          </div>

          {rules.length === 0 ? (
            <Card><EmptyState icon="bi-search" title="No combos match that search" /></Card>
          ) : (
            <div className="row g-3">
              {rules.map((r) => (
                <div className="col-12 col-md-6 col-xl-4" key={`${r.if_bought}|${r.also_bought}`}>
                  <div className="card-soft h-100" style={{ padding: 'var(--sp-5)' }}>
                    <div className="d-flex justify-content-between align-items-start gap-2">
                      <div style={{ minWidth: 0 }}>
                        <div className="td-strong">{r.if_bought}</div>
                        <div className="td-muted"><i className="bi bi-arrow-down me-1" />also buy</div>
                        <div className="td-strong">{r.also_bought}</div>
                      </div>
                      <Strength lift={r.lift} />
                    </div>

                    <p className="td-muted mt-3 mb-3">
                      {pct(r.confidence)} of bills with {r.if_bought} also contain {r.also_bought},{' '}
                      {r.lift.toFixed(1)}× more often than chance, across {r.bill_count} bills.
                    </p>

                    {r.slow_strong && (
                      <p className="td-muted mb-3" style={{ color: 'var(--indigo-deep)' }}>
                        <i className="bi bi-signpost-split me-1" />
                        {r.if_bought} is a slow seller and {r.also_bought} is one of the best sellers.
                        Shelving them together puts the slow one in front of more customers.
                      </p>
                    )}

                    <div className="d-flex flex-wrap gap-2">
                      <Chip tone="neutral">Confidence {pct(r.confidence)}</Chip>
                      <Chip tone="neutral">Lift {r.lift.toFixed(1)}×</Chip>
                      <Chip tone="neutral">Support {(r.support * 100).toFixed(2)}%</Chip>
                      {r.p_value != null && (
                        <Chip tone="neutral">
                          Chance {r.p_value < 0.0001 ? '< 0.01%' : `${(r.p_value * 100).toFixed(2)}%`}
                        </Chip>
                      )}
                    </div>
                  </div>
                </div>
              ))}
            </div>
          )}
        </>
      )}
    </Layout>
  );
}
