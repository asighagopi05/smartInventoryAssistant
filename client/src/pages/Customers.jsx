import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import Layout from '../components/Layout';
import { Card, Loading, ErrorNote, EmptyState } from '../components/ui';
import { api, inr, longDate } from '../api/client';

const initials = (n = '', phone = '') =>
  (n ? n.split(' ').slice(0, 2).map((w) => w[0]).join('') : phone.slice(-2)).toUpperCase();

const AVATAR_HUES = ['--indigo', '--teal', '--coral', '--amber', '--sage', '--plum', '--rose', '--sky'];
const hueFor = (id = '') => AVATAR_HUES[(id.charCodeAt(id.length - 1) || 0) % AVATAR_HUES.length];

export default function Customers() {
  const [customers, setCustomers] = useState(null);
  const [search, setSearch] = useState('');
  const [error, setError] = useState(null);

  useEffect(() => {
    const t = setTimeout(() => {
      const q = search.trim() ? `/customers?q=${encodeURIComponent(search.trim())}` : '/customers?limit=200';
      api.get(q).then((d) => setCustomers(d.customers)).catch(setError);
    }, 250);
    return () => clearTimeout(t);
  }, [search]);

  if (error) return <Layout title="Customers"><ErrorNote error={error} /></Layout>;

  return (
    <Layout
      title="Customers"
      subtitle="Keyed by phone number. No accounts, no passwords — most are created at the till."
    >
      <Card bodyClass="" className="mb-4">
        <div style={{ padding: 'var(--sp-4) var(--sp-5)' }}>
          <div className="search-wrap">
            <i className="bi bi-search" />
            <input
              className="form-control"
              placeholder="Search by name or phone number…"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
            />
          </div>
        </div>
      </Card>

      {!customers ? <Loading rows={8} /> : customers.length === 0 ? (
        <Card><EmptyState icon="bi-people" title="No customers found">
          Customers appear here once someone gives a phone number at the till.
        </EmptyState></Card>
      ) : (
        <div className="row g-3">
          {customers.map((c) => (
            <div className="col-12 col-md-6 col-xl-4" key={c._id}>
              <Link to={`/customers/${c._id}`} style={{ color: 'inherit' }}>
                <div className="card-soft h-100" style={{ padding: 'var(--sp-4)', transition: 'transform .16s var(--ease), box-shadow .16s var(--ease)' }}
                  onMouseEnter={(e) => { e.currentTarget.style.transform = 'translateY(-2px)'; e.currentTarget.style.boxShadow = 'var(--shadow)'; }}
                  onMouseLeave={(e) => { e.currentTarget.style.transform = ''; e.currentTarget.style.boxShadow = ''; }}
                >
                  <div className="d-flex align-items-center gap-3">
                    <div className="user-avatar" style={{ background: `var(${hueFor(c._id)})`, width: 42, height: 42 }}>
                      {initials(c.name, c.phone)}
                    </div>
                    <div style={{ minWidth: 0, flex: 1 }}>
                      <div className="td-strong text-truncate">{c.name || 'Unnamed customer'}</div>
                      <div className="td-muted">
                        <i className="bi bi-telephone me-1" />{c.phone}
                      </div>
                    </div>
                  </div>

                  <div className="d-flex gap-2 mt-3">
                    <span className="chip chip-brand">{c.visits} visit{c.visits === 1 ? '' : 's'}</span>
                    <span className="chip chip-ok num">{inr(c.total_spent, { compact: true })}</span>
                  </div>

                  <div className="td-muted mt-2">
                    Last seen {longDate(c.last_seen)}
                  </div>
                </div>
              </Link>
            </div>
          ))}
        </div>
      )}
    </Layout>
  );
}
