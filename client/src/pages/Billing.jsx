import { useEffect, useMemo, useState, useCallback } from 'react';
import { useSearchParams } from 'react-router-dom';
import Layout from '../components/Layout';
import { Card, CategoryChip, EmptyState, StockChip } from '../components/ui';
import { api, inr } from '../api/client';

/**
 * The till.
 *
 * This is the same component the customer record screen opens - from there it
 * arrives with a customer already attached, here it opens empty. There is no
 * second billing screen.
 */
export default function Billing() {
  const [params] = useSearchParams();
  const [products, setProducts] = useState([]);
  const [search, setSearch] = useState('');
  const [cart, setCart] = useState([]);
  const [phone, setPhone] = useState(params.get('phone') || '');
  const [customer, setCustomer] = useState(null);
  const [lookupState, setLookupState] = useState('idle'); // idle | checking | known | new
  const [name, setName] = useState('');
  const [address, setAddress] = useState('');
  const [payment, setPayment] = useState('cash');
  const [busy, setBusy] = useState(false);
  const [receipt, setReceipt] = useState(null);
  const [error, setError] = useState(null);

  useEffect(() => {
    api.get('/products?limit=500').then((d) => setProducts(d.products)).catch(setError);
  }, []);

  /**
   * Phone lookup, as the number is typed.
   *
   * A miss is an ordinary outcome, not an error: it opens the inline form
   * rather than blocking anything. Nothing here is ever required - a blank
   * phone completes a walk-in sale perfectly normally.
   */
  useEffect(() => {
    const digits = phone.replace(/\D/g, '');
    if (digits.length !== 10) {
      setLookupState('idle');
      setCustomer(null);
      return undefined;
    }
    let cancelled = false;
    setLookupState('checking');
    const t = setTimeout(async () => {
      try {
        const { customer: found } = await api.get(`/customers/by-phone/${digits}`);
        if (cancelled) return;
        if (found) {
          setCustomer(found);
          setName(found.name || '');
          setAddress(found.address || '');
          setLookupState('known');
        } else {
          setCustomer(null);
          setLookupState('new');
        }
      } catch { if (!cancelled) setLookupState('new'); }
    }, 320);
    return () => { cancelled = true; clearTimeout(t); };
  }, [phone]);

  const visible = useMemo(() => {
    const term = search.trim().toLowerCase();
    const pool = products.filter((p) => p.stock > 0);
    if (!term) return pool.slice(0, 24);
    return pool.filter((p) =>
      p.name.toLowerCase().includes(term) || p.sku.toLowerCase().includes(term)
    ).slice(0, 24);
  }, [products, search]);

  const addToCart = useCallback((product) => {
    setCart((prev) => {
      const existing = prev.find((l) => l.product._id === product._id);
      if (existing) {
        if (existing.qty >= product.stock) return prev;
        return prev.map((l) => (l.product._id === product._id ? { ...l, qty: l.qty + 1 } : l));
      }
      return [...prev, { product, qty: 1 }];
    });
  }, []);

  const setQty = (id, delta) => {
    setCart((prev) => prev.flatMap((l) => {
      if (l.product._id !== id) return [l];
      const next = l.qty + delta;
      if (next <= 0) return [];
      if (next > l.product.stock) return [l];
      return [{ ...l, qty: next }];
    }));
  };

  const subtotal = cart.reduce((s, l) => s + l.product.price * l.qty, 0);

  const complete = async () => {
    setBusy(true);
    setError(null);
    try {
      const digits = phone.replace(/\D/g, '');
      const body = {
        items: cart.map((l) => ({ productId: l.product._id, qty: l.qty })),
        payment_method: payment,
        ...(digits.length === 10
          ? { customer: { phone: digits, name: name || undefined, address: address || undefined } }
          : {}),
      };
      const result = await api.post('/sales', body);
      setReceipt(result);
      setCart([]);
      setPhone('');
      setName('');
      setAddress('');
      setCustomer(null);
      setLookupState('idle');
      const fresh = await api.get('/products?limit=500');
      setProducts(fresh.products);
    } catch (err) {
      setError(err);
    } finally {
      setBusy(false);
    }
  };

  if (receipt) return <Receipt receipt={receipt} onDone={() => setReceipt(null)} />;

  return (
    <Layout title="Billing" subtitle="Ring up a sale. A phone number is optional, always.">
      {error && (
        <div
          className="mb-3"
          style={{
            background: 'var(--coral-soft)', color: 'var(--coral-deep)',
            padding: 'var(--sp-3) var(--sp-4)', borderRadius: 'var(--radius-sm)', fontSize: 'var(--text-sm)',
          }}
        >
          <i className="bi bi-exclamation-circle-fill me-2" />{error.message}
        </div>
      )}

      <div className="till-grid">
        <Card
          title="Products"
          subtitle="Search by name or SKU, then click to add"
          bodyClass=""
        >
          <div style={{ padding: 'var(--sp-4) var(--sp-5)', borderBottom: 'var(--border-light)' }}>
            <div className="search-wrap">
              <i className="bi bi-search" />
              <input
                className="form-control"
                placeholder="Search 169 products…"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                autoFocus
              />
            </div>
          </div>

          <div style={{ padding: 'var(--sp-4) var(--sp-5)', maxHeight: 560, overflowY: 'auto' }}>
            {visible.length === 0 ? (
              <EmptyState icon="bi-search" title="Nothing matches">
                Try a different name, or check whether it is out of stock.
              </EmptyState>
            ) : (
              visible.map((p) => (
                <div key={p._id} className="product-pick" onClick={() => addToCart(p)}>
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div className="td-strong text-truncate">{p.name}</div>
                    <div className="d-flex align-items-center gap-2 mt-1">
                      <CategoryChip category={p.category} />
                      <span className="td-muted">{p.stock} in stock</span>
                    </div>
                  </div>
                  <div className="text-end">
                    <div className="td-strong num">{inr(p.price)}</div>
                    <StockChip stock={p.stock} threshold={p.threshold} />
                  </div>
                </div>
              ))
            )}
          </div>
        </Card>

        <div className="d-grid gap-4">
          <Card title="Customer" subtitle="Optional — never required to complete a sale" >
            <label className="form-label">Phone number</label>
            <div className="search-wrap">
              <i className="bi bi-telephone" />
              <input
                className="form-control"
                placeholder="10-digit mobile, or leave blank"
                value={phone}
                onChange={(e) => setPhone(e.target.value)}
                maxLength={10}
                inputMode="numeric"
              />
            </div>

            {lookupState === 'idle' && (
              <div className="td-muted mt-2">
                <i className="bi bi-person-dash me-1" />
                Leave blank for a walk-in. The sale completes normally.
              </div>
            )}

            {lookupState === 'checking' && (
              <div className="td-muted mt-2"><i className="bi bi-hourglass-split me-1" />Checking…</div>
            )}

            {lookupState === 'known' && customer && (
              <div
                className="mt-3"
                style={{ background: 'var(--sage-soft)', padding: 'var(--sp-3)', borderRadius: 'var(--radius-sm)' }}
              >
                <div style={{ fontSize: 'var(--text-sm)', fontWeight: 'var(--weight-bold)', color: 'var(--sage-deep)' }}>
                  <i className="bi bi-person-check-fill me-1" />
                  Returning customer · visit {customer.visits + 1}
                </div>
                <div className="mt-2">
                  <input
                    className="form-control form-control-sm mb-2"
                    value={name} onChange={(e) => setName(e.target.value)} placeholder="Name"
                  />
                  <input
                    className="form-control form-control-sm"
                    value={address} onChange={(e) => setAddress(e.target.value)} placeholder="Billing address"
                  />
                  <div className="td-muted mt-1">Corrections here are saved with the sale.</div>
                </div>
              </div>
            )}

            {lookupState === 'new' && (
              <div
                className="mt-3"
                style={{ background: 'var(--indigo-soft)', padding: 'var(--sp-3)', borderRadius: 'var(--radius-sm)' }}
              >
                <div style={{ fontSize: 'var(--text-sm)', fontWeight: 'var(--weight-bold)', color: 'var(--indigo-deep)' }}>
                  <i className="bi bi-person-plus-fill me-1" />New number
                </div>
                <div className="td-muted mb-2">
                  The record is created as part of completing this sale.
                </div>
                <input
                  className="form-control form-control-sm mb-2"
                  value={name} onChange={(e) => setName(e.target.value)} placeholder="Name (optional)"
                />
                <input
                  className="form-control form-control-sm"
                  value={address} onChange={(e) => setAddress(e.target.value)} placeholder="Address (optional)"
                />
              </div>
            )}
          </Card>

          <Card title="Cart" subtitle={`${cart.length} line${cart.length === 1 ? '' : 's'}`}>
            {cart.length === 0 ? (
              <EmptyState icon="bi-basket" title="Nothing added yet">
                Click a product on the left to start.
              </EmptyState>
            ) : (
              <>
                {cart.map((l) => (
                  <div key={l.product._id} className="cart-line">
                    <div style={{ minWidth: 0 }}>
                      <div className="td-strong text-truncate" style={{ fontSize: 'var(--text-sm)' }}>
                        {l.product.name}
                      </div>
                      <div className="td-muted num">{inr(l.product.price)} each</div>
                    </div>
                    <div className="qty-stepper">
                      <button onClick={() => setQty(l.product._id, -1)}><i className="bi bi-dash" /></button>
                      <span>{l.qty}</span>
                      <button onClick={() => setQty(l.product._id, 1)}><i className="bi bi-plus" /></button>
                    </div>
                    <div className="td-strong num" style={{ minWidth: 74, textAlign: 'right' }}>
                      {inr(l.product.price * l.qty)}
                    </div>
                  </div>
                ))}

                <div className="mt-4">
                  <label className="form-label">Payment</label>
                  <div className="d-flex gap-2">
                    {['cash', 'upi', 'card'].map((m) => (
                      <button
                        key={m}
                        className={`btn ${payment === m ? 'btn-primary' : 'btn-ghost'} flex-fill`}
                        onClick={() => setPayment(m)}
                        style={{ textTransform: 'capitalize' }}
                      >
                        {m}
                      </button>
                    ))}
                  </div>
                </div>

                <div className="total-row grand mt-3">
                  <span>Total</span>
                  <span className="num">{inr(subtotal)}</span>
                </div>

                <button
                  className="btn btn-accent w-100 mt-3"
                  onClick={complete}
                  disabled={busy}
                  style={{ padding: '0.7rem !important', fontSize: 'var(--text-md)' }}
                >
                  {busy ? 'Completing…' : `Complete sale · ${inr(subtotal)}`}
                </button>
              </>
            )}
          </Card>
        </div>
      </div>
    </Layout>
  );
}

/** Shown after a sale. This is where the auto-restock result surfaces. */
function Receipt({ receipt, onDone }) {
  const { sale, customer, restock_raised: restocked } = receipt;
  const [qr, setQr] = useState(null);

  useEffect(() => {
    api.get(`/feedback/qr?type=bill&id=${sale._id}`).then(setQr).catch(() => {});
  }, [sale._id]);

  return (
    <Layout title="Sale complete" subtitle={sale.bill_no}>
      <div className="page-narrow">
        {restocked.length > 0 && (
          <div className="restock-flash mb-4">
            <div style={{ fontWeight: 'var(--weight-bold)', color: 'var(--amber-deep)', fontSize: 'var(--text-md)' }}>
              <i className="bi bi-arrow-repeat me-2" />
              {restocked.length === 1 ? 'A restock request was raised automatically' : `${restocked.length} restock requests were raised automatically`}
            </div>
            <div style={{ fontSize: 'var(--text-sm)', color: 'var(--ink-700)', marginTop: 6 }}>
              This sale took stock across a threshold. Nobody pressed anything — the server raised it
              on the way out, and the Manager has already been notified.
            </div>
            <div className="mt-3 d-grid gap-2">
              {restocked.map((r) => (
                <div
                  key={r.sku}
                  className="d-flex align-items-center gap-3"
                  style={{ background: 'rgba(255,255,255,0.7)', padding: 'var(--sp-3)', borderRadius: 'var(--radius-sm)' }}
                >
                  <i className="bi bi-box-seam" style={{ color: 'var(--amber-deep)', fontSize: '1.2rem' }} />
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div className="td-strong">{r.product}</div>
                    <div className="td-muted">
                      Stock fell to {r.stock_now}, threshold is {r.threshold}
                    </div>
                  </div>
                  <span className="chip chip-warn">{r.qty_requested} units requested</span>
                </div>
              ))}
            </div>
          </div>
        )}

        <div className="row g-4">
          <div className="col-12 col-lg-7">
            <Card title="Receipt" subtitle={customer ? `${customer.name || 'Customer'} · ${customer.phone}` : 'Walk-in — no phone given'}>
              <table className="table-soft">
                <thead>
                  <tr>
                    <th>Item</th>
                    <th className="text-end">Qty</th>
                    <th className="text-end">Price</th>
                    <th className="text-end">Total</th>
                  </tr>
                </thead>
                <tbody>
                  {sale.items.map((i) => (
                    <tr key={i.sku}>
                      <td className="td-strong">{i.name}</td>
                      <td className="text-end num">{i.qty}</td>
                      <td className="text-end num">{inr(i.unit_price)}</td>
                      <td className="text-end num td-strong">{inr(i.line_total)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
              <div className="total-row grand">
                <span>Total paid · {sale.payment_method}</span>
                <span className="num">{inr(sale.total)}</span>
              </div>
            </Card>
          </div>

          <div className="col-12 col-lg-5 d-grid gap-4">
            <Card title="Feedback QR" subtitle="Printed on the receipt">
              {qr ? (
                <div className="qr-frame">
                  <img src={qr.dataUrl} alt="Feedback QR code" />
                  <div className="td-muted text-center">
                    Opens the items they just bought, pre-filled.<br />No login, no account.
                  </div>
                </div>
              ) : <div className="skeleton" style={{ height: 210 }} />}
            </Card>

            <button className="btn btn-primary w-100" onClick={onDone}>
              <i className="bi bi-plus-lg me-2" />Start the next sale
            </button>
          </div>
        </div>
      </div>
    </Layout>
  );
}
