import { useEffect, useState } from 'react';
import Layout from '../components/Layout';
import { Card, Loading, ErrorNote, EmptyState, CategoryChip } from '../components/ui';
import { api } from '../api/client';

export default function Suppliers() {
  const [suppliers, setSuppliers] = useState(null);
  const [error, setError] = useState(null);

  useEffect(() => {
    api.get('/suppliers').then((d) => setSuppliers(d.suppliers)).catch(setError);
  }, []);

  if (error) return <Layout title="Suppliers"><ErrorNote error={error} /></Layout>;

  return (
    <Layout
      title="Suppliers"
      subtitle="Where restock requests are sent. Each supplier covers one or two aisles."
    >
      {!suppliers ? <Loading rows={6} /> : suppliers.length === 0 ? (
        <Card><EmptyState icon="bi-truck" title="No suppliers yet" /></Card>
      ) : (
        <div className="row g-3">
          {suppliers.map((s) => (
            <div className="col-12 col-md-6 col-xl-4" key={s._id}>
              <div className="card-soft h-100" style={{ padding: 'var(--sp-5)' }}>
                <div className="d-flex align-items-start gap-3">
                  <div
                    style={{
                      width: 42, height: 42, borderRadius: 'var(--radius)',
                      background: 'var(--coral-soft)', color: 'var(--coral-deep)',
                      display: 'grid', placeItems: 'center', fontSize: '1.2rem', flex: '0 0 auto',
                    }}
                  >
                    <i className="bi bi-truck" />
                  </div>
                  <div style={{ minWidth: 0 }}>
                    <div className="td-strong">{s.name}</div>
                    <div className="td-muted">{s.contact_person}</div>
                  </div>
                </div>

                <div className="d-flex flex-wrap gap-1 mt-3">
                  {(s.categories || []).map((c) => <CategoryChip key={c} category={c} />)}
                </div>

                <div className="d-flex gap-2 mt-3">
                  <span className="chip chip-brand">{s.product_count} products</span>
                  {s.low_stock_count > 0 && (
                    <span className="chip chip-warn">{s.low_stock_count} low</span>
                  )}
                </div>

                <div className="td-muted mt-3" style={{ borderTop: 'var(--border-light)', paddingTop: 'var(--sp-3)' }}>
                  <div><i className="bi bi-telephone me-2" />{s.phone}</div>
                  <div className="text-truncate"><i className="bi bi-envelope me-2" />{s.email}</div>
                  <div className="mt-1"><i className="bi bi-geo-alt me-2" />{s.address}</div>
                </div>
              </div>
            </div>
          ))}
        </div>
      )}
    </Layout>
  );
}
