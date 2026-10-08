import { useEffect, useMemo, useState } from 'react';
import { useParams, useNavigate, Link } from 'react-router-dom';
import Layout from '../components/Layout';
import { Card, Loading, ErrorNote, EmptyState, CategoryChip, StatTile } from '../components/ui';
import { api, inr, longDate } from '../api/client';
import { useAuth } from '../context/AuthContext';

/**
 * The customer record.
 *
 * Details, then history, then a product search - so the Manager can browse
 * stock from this screen and go straight to billing with the customer already
 * attached. That last part is what makes this worth having rather than being
 * a read-only profile page.
 */
export default function CustomerDetail() {
  const { id } = useParams();
  const navigate = useNavigate();
  const { isRole } = useAuth();

  const [data, setData] = useState(null);
  const [error, setError] = useState(null);
  const [editing, setEditing] = useState(false);
  const [form, setForm] = useState({});
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState(null);

  const [products, setProducts] = useState([]);
  const [search, setSearch] = useState('');
  const [basket, setBasket] = useState([]);

  const load = () => api.get(`/customers/${id}`).then((d) => {
    setData(d);
    setForm({ name: d.customer.name || '', phone: d.customer.phone, address: d.customer.address || '' });
  }).catch(setError);

  useEffect(() => { load(); }, [id]);
  useEffect(() => { api.get('/products?limit=500').then((d) => setProducts(d.products)).catch(() => {}); }, []);

  const matches = useMemo(() => {
    const term = search.trim().toLowerCase();
    if (!term) return [];
    return products.filter((p) => p.stock > 0 && p.name.toLowerCase().includes(term)).slice(0, 8);
  }, [products, search]);

  const save = async () => {
    setSaving(true); setSaveError(null);
    try {
      await api.patch(`/customers/${id}`, form);
      setEditing(false);
      await load();
    } catch (err) { setSaveError(err); } finally { setSaving(false); }
  };

  const proceedToBilling = () => {
    navigate(`/billing?phone=${data.customer.phone}`);
  };

  if (error) return <Layout title="Customer"><ErrorNote error={error} /></Layout>;
  if (!data) return <Layout title="Customer"><Loading rows={6} /></Layout>;

  const { customer, sales } = data;

  return (
    <Layout
      title={customer.name || 'Customer'}
      subtitle={customer.phone}
      actions={(
        <Link to="/customers" className="btn btn-ghost">
          <i className="bi bi-arrow-left me-2" />All customers
        </Link>
      )}
    >
      <div className="stat-grid mb-4">
        <StatTile tone="indigo" icon="bi-bag-check-fill" label="Visits" value={customer.visits} />
        <StatTile tone="sage" icon="bi-currency-rupee" label="Total spent" value={inr(customer.total_spent, { compact: true })} />
        <StatTile tone="sky" icon="bi-calendar-check" label="First seen" value={new Date(customer.first_seen).toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: '2-digit' })} />
        <StatTile tone="rose" icon="bi-clock-history" label="Last seen" value={new Date(customer.last_seen).toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: '2-digit' })} />
      </div>

      <div className="row g-4">
        <div className="col-12 col-lg-5">
          <Card
            title="Details"
            subtitle="Maintained by the Manager"
            actions={isRole('Manager') && !editing && (
              <button className="btn btn-soft btn-sm" onClick={() => setEditing(true)}>
                <i className="bi bi-pencil me-1" />Edit
              </button>
            )}
          >
            {saveError && (
              <div className="mb-3" style={{ background: 'var(--coral-soft)', color: 'var(--coral-deep)', padding: 'var(--sp-3)', borderRadius: 'var(--radius-sm)', fontSize: 'var(--text-sm)' }}>
                {saveError.message}
              </div>
            )}

            {editing ? (
              <>
                <div className="mb-3">
                  <label className="form-label">Name</label>
                  <input className="form-control" value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} />
                </div>
                <div className="mb-3">
                  <label className="form-label">Phone</label>
                  <input className="form-control" value={form.phone} maxLength={10} onChange={(e) => setForm({ ...form, phone: e.target.value })} />
                  <div className="td-muted mt-1">
                    Changing this is safe. Past sales stay linked, and old bills still show the
                    number that was printed on them.
                  </div>
                </div>
                <div className="mb-3">
                  <label className="form-label">Billing address</label>
                  <textarea className="form-control" rows={3} value={form.address} onChange={(e) => setForm({ ...form, address: e.target.value })} />
                </div>
                <div className="d-flex gap-2">
                  <button className="btn btn-primary" onClick={save} disabled={saving}>
                    {saving ? 'Saving…' : 'Save changes'}
                  </button>
                  <button className="btn btn-ghost" onClick={() => { setEditing(false); load(); }}>Cancel</button>
                </div>
              </>
            ) : (
              <dl style={{ margin: 0 }}>
                <Field label="Name" value={customer.name || <span className="td-muted">Not given</span>} />
                <Field label="Phone" value={customer.phone} />
                <Field label="Billing address" value={customer.address || <span className="td-muted">Not given</span>} />
                <Field label="Account" value={<span className="chip chip-neutral">No login — phone-keyed record</span>} />
              </dl>
            )}
          </Card>
        </div>

        <div className="col-12 col-lg-7">
          <Card
            title="Shop for this customer"
            subtitle="Browse stock here, then go straight to billing with them attached"
          >
            <div className="search-wrap">
              <i className="bi bi-search" />
              <input
                className="form-control"
                placeholder="Search products…"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
              />
            </div>

            {matches.length > 0 && (
              <div className="mt-3">
                {matches.map((p) => (
                  <div
                    key={p._id}
                    className="product-pick"
                    onClick={() => setBasket((b) => (b.find((x) => x._id === p._id) ? b : [...b, p]))}
                  >
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <div className="td-strong text-truncate">{p.name}</div>
                      <div className="d-flex gap-2 align-items-center mt-1">
                        <CategoryChip category={p.category} />
                        <span className="td-muted">{p.stock} in stock</span>
                      </div>
                    </div>
                    <div className="td-strong num">{inr(p.price)}</div>
                  </div>
                ))}
              </div>
            )}

            {basket.length > 0 && (
              <div className="mt-3" style={{ background: 'var(--teal-soft)', padding: 'var(--sp-4)', borderRadius: 'var(--radius)' }}>
                <div style={{ fontWeight: 'var(--weight-bold)', color: 'var(--teal-deep)', fontSize: 'var(--text-sm)' }}>
                  {basket.length} item{basket.length === 1 ? '' : 's'} picked out
                </div>
                <div className="td-muted mb-3">{basket.map((b) => b.name).join(', ')}</div>
                <button className="btn btn-accent" onClick={proceedToBilling}>
                  <i className="bi bi-receipt me-2" />Proceed to billing
                </button>
                <button className="btn btn-ghost ms-2" onClick={() => setBasket([])}>Clear</button>
              </div>
            )}

            {search && matches.length === 0 && (
              <div className="td-muted mt-3">Nothing in stock matches that.</div>
            )}
          </Card>
        </div>

        <div className="col-12">
          <Card title="Purchase history" subtitle={`${sales.length} bill${sales.length === 1 ? '' : 's'}`} bodyClass="">
            {sales.length === 0 ? (
              <EmptyState icon="bi-receipt" title="No purchases yet" />
            ) : (
              <div style={{ overflowX: 'auto' }}>
                <table className="table-soft">
                  <thead>
                    <tr>
                      <th>Bill</th>
                      <th>When</th>
                      <th>Items</th>
                      <th>Phone on the bill</th>
                      <th>Billed by</th>
                      <th className="text-end">Total</th>
                    </tr>
                  </thead>
                  <tbody>
                    {sales.map((s) => (
                      <tr key={s._id}>
                        <td className="td-strong">{s.bill_no}</td>
                        <td className="td-muted" style={{ whiteSpace: 'nowrap' }}>{longDate(s.createdAt)}</td>
                        <td className="td-muted">
                          {s.items.slice(0, 2).map((i) => i.name).join(', ')}
                          {s.items.length > 2 && ` +${s.items.length - 2} more`}
                        </td>
                        <td className="td-muted num">{s.customer_phone || '—'}</td>
                        <td className="td-muted">{s.billed_by?.name || '—'}</td>
                        <td className="text-end num td-strong">{inr(s.total)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </Card>
        </div>
      </div>
    </Layout>
  );
}

function Field({ label, value }) {
  return (
    <div style={{ paddingBottom: 'var(--sp-4)' }}>
      <dt style={{ fontSize: 'var(--text-sm)', color: 'var(--ink-400)', fontWeight: 'var(--weight-medium)' }}>{label}</dt>
      <dd style={{ margin: 0, color: 'var(--ink-900)', fontWeight: 'var(--weight-medium)' }}>{value}</dd>
    </div>
  );
}
