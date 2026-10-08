import { useEffect, useState } from 'react';
import { useParams, useSearchParams } from 'react-router-dom';
import { api } from '../api/client';

/**
 * The customer-facing feedback page.
 *
 * Reached by scanning a QR on a shelf label, at the counter, or on a receipt.
 * There is NO authentication here and no prompt to create an account: a shopper
 * holding a phone in a shop does not have a login and never will. Asking them
 * to make one would simply end the interaction.
 *
 * The only thing ever optional-but-useful is a phone number, and the page works
 * completely without it.
 */
export default function PublicFeedback() {
  const { productId } = useParams();
  const [params] = useSearchParams();
  const saleId = params.get('sale');

  const [ctx, setCtx] = useState(null);
  const [chosen, setChosen] = useState(productId || '');
  const [rating, setRating] = useState(0);
  const [hover, setHover] = useState(0);
  const [comment, setComment] = useState('');
  const [phone, setPhone] = useState('');
  const [sent, setSent] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);

  useEffect(() => {
    const q = new URLSearchParams();
    if (productId) q.set('product', productId);
    if (saleId) q.set('sale', saleId);
    api.publicGet(`/feedback/public/context?${q}`)
      .then((d) => {
        setCtx(d);
        if (d.product) setChosen(d.product._id);
        else if (d.sale_items?.length === 1) setChosen(d.sale_items[0].product_id);
      })
      .catch(setError);
  }, [productId, saleId]);

  const submit = async () => {
    setBusy(true); setError(null);
    try {
      await api.publicPost('/feedback/public', {
        productId: chosen || undefined,
        rating,
        comment: comment || undefined,
        phone: phone.replace(/\D/g, '').length === 10 ? phone.replace(/\D/g, '') : undefined,
        saleId: saleId || undefined,
        source: saleId ? 'bill_qr' : productId ? 'product_qr' : 'shop_qr',
      });
      setSent(true);
    } catch (err) {
      setError(err);
    } finally {
      setBusy(false);
    }
  };

  if (sent) {
    return (
      <div className="feedback-page">
        <div className="feedback-card card-soft" style={{ padding: 'var(--sp-7)', textAlign: 'center' }}>
          <div
            style={{
              width: 64, height: 64, borderRadius: '50%', margin: '0 auto var(--sp-4)',
              background: 'var(--sage-soft)', color: 'var(--sage-deep)',
              display: 'grid', placeItems: 'center', fontSize: '1.9rem',
            }}
          >
            <i className="bi bi-check-lg" />
          </div>
          <h2 style={{ fontSize: 'var(--text-xl)' }}>Thank you</h2>
          <p style={{ color: 'var(--ink-500)', marginTop: 8, marginBottom: 0 }}>
            Your feedback has reached the shop.
          </p>
        </div>
      </div>
    );
  }

  const options = ctx?.sale_items?.length ? ctx.sale_items : ctx?.products || [];

  return (
    <div className="feedback-page">
      <div className="feedback-card">
        <div className="text-center mb-4">
          <div className="brand-mark" style={{ margin: '0 auto var(--sp-3)', width: 44, height: 44 }}>SIA</div>
          <h2 style={{ fontSize: 'var(--text-xl)' }}>How did we do?</h2>
          <p style={{ color: 'var(--ink-500)', margin: '6px 0 0', fontSize: 'var(--text-sm)' }}>
            No account needed. It takes a few seconds.
          </p>
        </div>

        <div className="card-soft" style={{ padding: 'var(--sp-5)' }}>
          {error && (
            <div
              className="mb-3"
              style={{
                background: 'var(--coral-soft)', color: 'var(--coral-deep)',
                padding: 'var(--sp-3)', borderRadius: 'var(--radius-sm)', fontSize: 'var(--text-sm)',
              }}
            >
              {error.message}
            </div>
          )}

          {ctx?.product ? (
            <div
              className="mb-4"
              style={{ background: 'var(--indigo-soft)', padding: 'var(--sp-3) var(--sp-4)', borderRadius: 'var(--radius)' }}
            >
              <div style={{ fontSize: 'var(--text-xs)', color: 'var(--indigo-deep)', fontWeight: 'var(--weight-bold)', textTransform: 'uppercase', letterSpacing: '0.06em' }}>
                You scanned
              </div>
              <div style={{ fontWeight: 'var(--weight-bold)', color: 'var(--ink-900)' }}>{ctx.product.name}</div>
            </div>
          ) : options.length > 0 ? (
            <div className="mb-4">
              <label className="form-label">
                {ctx?.sale_items?.length ? 'Which item?' : 'Which product?'}
              </label>
              <select className="form-select" value={chosen} onChange={(e) => setChosen(e.target.value)}>
                <option value="">The shop overall</option>
                {options.map((p) => (
                  <option key={p.product_id || p._id} value={p.product_id || p._id}>{p.name}</option>
                ))}
              </select>
            </div>
          ) : null}

          <div className="mb-4">
            <label className="form-label text-center d-block">Your rating</label>
            <div className="star-row" onMouseLeave={() => setHover(0)}>
              {[1, 2, 3, 4, 5].map((n) => (
                <button
                  key={n}
                  className={`star-btn ${n <= (hover || rating) ? 'on' : ''}`}
                  onMouseEnter={() => setHover(n)}
                  onClick={() => setRating(n)}
                  aria-label={`${n} star${n === 1 ? '' : 's'}`}
                >
                  <i className={`bi ${n <= (hover || rating) ? 'bi-star-fill' : 'bi-star'}`} />
                </button>
              ))}
            </div>
          </div>

          <div className="mb-3">
            <label className="form-label">Anything to add? (optional)</label>
            <textarea
              className="form-control"
              rows={3}
              value={comment}
              onChange={(e) => setComment(e.target.value)}
              placeholder="Tell the shop what you thought…"
            />
          </div>

          <div className="mb-4">
            <label className="form-label">Phone number (optional)</label>
            <input
              className="form-control"
              value={phone}
              onChange={(e) => setPhone(e.target.value)}
              placeholder="Only if you would like it linked to your visits"
              maxLength={10}
              inputMode="numeric"
            />
          </div>

          <button className="btn btn-primary w-100" disabled={!rating || busy} onClick={submit}>
            {busy ? 'Sending…' : 'Send feedback'}
          </button>

          <p style={{ fontSize: 'var(--text-xs)', color: 'var(--ink-400)', textAlign: 'center', margin: 'var(--sp-4) 0 0' }}>
            We never ask you to create an account.
          </p>
        </div>
      </div>
    </div>
  );
}
