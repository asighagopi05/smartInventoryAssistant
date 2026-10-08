import { useEffect, useMemo, useState } from 'react';
import Layout from '../components/Layout';
import { Card, CategoryChip, StockChip, Loading, ErrorNote, EmptyState, Stars } from '../components/ui';
import { api, inr } from '../api/client';
import { useAuth } from '../context/AuthContext';

export default function Products() {
  const { isRole } = useAuth();
  const [products, setProducts] = useState(null);
  const [categories, setCategories] = useState([]);
  const [search, setSearch] = useState('');
  const [category, setCategory] = useState('all');
  const [lowOnly, setLowOnly] = useState(false);
  const [sort, setSort] = useState('name');
  const [error, setError] = useState(null);

  useEffect(() => {
    Promise.all([api.get('/products?limit=500'), api.get('/products/categories')])
      .then(([p, c]) => { setProducts(p.products); setCategories(c.categories); })
      .catch(setError);
  }, []);

  const rows = useMemo(() => {
    if (!products) return [];
    const term = search.trim().toLowerCase();
    let list = products.filter((p) => {
      if (category !== 'all' && p.category !== category) return false;
      if (lowOnly && !p.is_low_stock) return false;
      if (term && !p.name.toLowerCase().includes(term) && !p.sku.toLowerCase().includes(term)) return false;
      return true;
    });
    const by = {
      name: (a, b) => a.name.localeCompare(b.name),
      stock: (a, b) => a.stock - b.stock,
      price: (a, b) => b.price - a.price,
      rating: (a, b) => (b.rating_avg || 0) - (a.rating_avg || 0),
    };
    return [...list].sort(by[sort]);
  }, [products, search, category, lowOnly, sort]);

  if (error) return <Layout title="Products"><ErrorNote error={error} /></Layout>;

  const lowCount = products?.filter((p) => p.is_low_stock).length || 0;

  return (
    <Layout
      title="Products"
      subtitle={products ? `${products.length} active products across ${categories.length} aisles` : 'Loading…'}
    >
      <Card bodyClass="" className="mb-4">
        <div style={{ padding: 'var(--sp-4) var(--sp-5)' }} className="d-flex flex-wrap gap-3 align-items-center">
          <div className="search-wrap" style={{ flex: '1 1 260px' }}>
            <i className="bi bi-search" />
            <input
              className="form-control"
              placeholder="Search by name or SKU…"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
            />
          </div>

          <select className="form-select" style={{ width: 'auto' }} value={category} onChange={(e) => setCategory(e.target.value)}>
            <option value="all">All aisles</option>
            {categories.map((c) => <option key={c} value={c}>{c}</option>)}
          </select>

          <select className="form-select" style={{ width: 'auto' }} value={sort} onChange={(e) => setSort(e.target.value)}>
            <option value="name">Sort: name</option>
            <option value="stock">Sort: lowest stock</option>
            <option value="price">Sort: highest price</option>
            <option value="rating">Sort: best rated</option>
          </select>

          <button
            className={`btn ${lowOnly ? 'btn-warm' : 'btn-ghost'}`}
            onClick={() => setLowOnly((v) => !v)}
          >
            <i className="bi bi-exclamation-triangle-fill me-2" />
            Below threshold {lowCount > 0 && `(${lowCount})`}
          </button>
        </div>
      </Card>

      <Card bodyClass="">
        {!products ? <Loading rows={8} /> : rows.length === 0 ? (
          <EmptyState icon="bi-search" title="No products match">
            Try clearing the filters.
          </EmptyState>
        ) : (
          <div style={{ overflowX: 'auto' }}>
            <table className="table-soft">
              <thead>
                <tr>
                  <th>Product</th>
                  <th>Aisle</th>
                  <th className="text-end">Price</th>
                  <th className="text-end">Stock</th>
                  <th className="text-end">Threshold</th>
                  <th>State</th>
                  <th>Rating</th>
                  <th>Supplier</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((p) => (
                  <tr key={p._id} className={p.is_low_stock ? 'row-flag flag-warn' : ''}>
                    <td>
                      <div className="td-strong">{p.name}</div>
                      <div className="td-muted">{p.sku}</div>
                    </td>
                    <td><CategoryChip category={p.category} /></td>
                    <td className="text-end num td-strong">{inr(p.price)}</td>
                    <td className="text-end num td-strong">{p.stock}</td>
                    <td className="text-end num td-muted">{p.threshold}</td>
                    <td><StockChip stock={p.stock} threshold={p.threshold} /></td>
                    <td>
                      {p.rating_count > 0 ? (
                        <span className="d-inline-flex align-items-center gap-2">
                          <Stars value={p.rating_avg} />
                          <span className="td-muted">({p.rating_count})</span>
                        </span>
                      ) : <span className="td-muted">—</span>}
                    </td>
                    <td className="td-muted">{p.supplier_id?.name || '—'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>

      {isRole('Manager') && (
        <div className="td-muted mt-3">
          <i className="bi bi-info-circle me-1" />
          Stock is never edited here. It moves only through the stock service, so every change
          leaves a ledger row behind.
        </div>
      )}
    </Layout>
  );
}
