import { useEffect, useState } from 'react';
import Layout from '../components/Layout';
import { Card, Loading, ErrorNote } from '../components/ui';
import { api } from '../api/client';

/**
 * QR generation for printing.
 *
 * The codes encode whatever PUBLIC_BASE_URL is set to on the server. For a
 * phone to open them that must be the machine LAN address, not localhost -
 * no internet is required, but the phone and this machine do need to be on the
 * same network.
 */
export default function QRCodes() {
  const [shopQr, setShopQr] = useState(null);
  const [products, setProducts] = useState([]);
  const [selected, setSelected] = useState('');
  const [productQr, setProductQr] = useState(null);
  const [error, setError] = useState(null);

  useEffect(() => {
    api.get('/feedback/qr?type=shop').then(setShopQr).catch(setError);
    api.get('/products?limit=500').then((d) => {
      setProducts(d.products);
      if (d.products[0]) setSelected(d.products[0]._id);
    }).catch(setError);
  }, []);

  useEffect(() => {
    if (!selected) return;
    setProductQr(null);
    api.get(`/feedback/qr?type=product&id=${selected}`).then(setProductQr).catch(setError);
  }, [selected]);

  if (error) return <Layout title="QR codes"><ErrorNote error={error} /></Layout>;

  const localhostWarning = shopQr?.target?.includes('localhost');

  return (
    <Layout
      title="QR codes"
      subtitle="Printed and put on the shelf, the counter and the receipt"
    >
      {localhostWarning && (
        <div
          className="mb-4"
          style={{
            background: 'var(--amber-soft)', border: '1px solid color-mix(in srgb, var(--amber) 40%, white)',
            borderRadius: 'var(--radius)', padding: 'var(--sp-4)',
          }}
        >
          <strong style={{ color: 'var(--amber-deep)' }}>
            <i className="bi bi-phone me-2" />These codes point at localhost
          </strong>
          <div style={{ fontSize: 'var(--text-sm)', color: 'var(--ink-700)', marginTop: 6 }}>
            A phone cannot open <code>localhost</code> — that address means the phone itself. To scan
            these from a phone, set <code>PUBLIC_BASE_URL</code> in <code>server/.env</code> to this
            machine network address (for example <code>http://192.168.1.7:5173</code>) and restart
            the API. No internet is needed, only the same WiFi or a phone hotspot. To demonstrate
            without a phone, just open the link below in a new browser tab.
          </div>
        </div>
      )}

      <div className="row g-4">
        <div className="col-12 col-lg-6">
          <Card title="Shop code" subtitle="For the counter and the door">
            {shopQr ? (
              <>
                <div className="qr-frame">
                  <img src={shopQr.dataUrl} alt="Shop feedback QR code" />
                </div>
                <div className="mt-3">
                  <div className="td-muted">Opens</div>
                  <a href={shopQr.target} target="_blank" rel="noreferrer" className="num" style={{ fontSize: 'var(--text-sm)', wordBreak: 'break-all' }}>
                    {shopQr.target}
                  </a>
                </div>
                <div className="d-flex gap-2 mt-3">
                  <button className="btn btn-soft" onClick={() => window.print()}>
                    <i className="bi bi-printer me-2" />Print
                  </button>
                  <a className="btn btn-ghost" href={shopQr.target} target="_blank" rel="noreferrer">
                    <i className="bi bi-box-arrow-up-right me-2" />Open it here
                  </a>
                </div>
              </>
            ) : <Loading rows={4} />}
          </Card>
        </div>

        <div className="col-12 col-lg-6">
          <Card title="Shelf code" subtitle="One per product, for the shelf label">
            <label className="form-label">Product</label>
            <select className="form-select mb-3" value={selected} onChange={(e) => setSelected(e.target.value)}>
              {products.map((p) => <option key={p._id} value={p._id}>{p.name}</option>)}
            </select>

            {productQr ? (
              <>
                <div className="qr-frame">
                  <img src={productQr.dataUrl} alt="Product feedback QR code" />
                </div>
                <div className="mt-3">
                  <div className="td-muted">Opens with that product already selected</div>
                  <a href={productQr.target} target="_blank" rel="noreferrer" className="num" style={{ fontSize: 'var(--text-sm)', wordBreak: 'break-all' }}>
                    {productQr.target}
                  </a>
                </div>
              </>
            ) : <div className="skeleton" style={{ height: 220 }} />}
          </Card>
        </div>

        <div className="col-12">
          <Card title="The third code" subtitle="Printed on the receipt">
            <p style={{ color: 'var(--ink-500)', margin: 0 }}>
              The bill QR is generated at the moment a sale completes and appears on the receipt
              screen. It is the strongest of the three: it reaches the customer while they still
              have an opinion, and it already knows what they bought and which phone number was on
              the sale — so their feedback links to their history{' '}
              <strong>without asking them for anything at all</strong>.
            </p>
          </Card>
        </div>
      </div>
    </Layout>
  );
}
