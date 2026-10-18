import { useState } from 'react';
import { useAuth } from '../context/AuthContext';
import { ROLE_META } from '../config/navigation';

const DEMO_ACCOUNTS = [
  { role: 'Owner', name: 'Rajesh Kumar', email: 'owner@sia.local', password: 'Owner@123' },
  { role: 'Manager', name: 'Priya Menon', email: 'manager@sia.local', password: 'Manager@123' },
  { role: 'Staff', name: 'Arun Pillai', email: 'staff1@sia.local', password: 'Staff@123' },
];

const initials = (n = '') => n.split(' ').slice(0, 2).map((w) => w[0]).join('').toUpperCase();

export default function Login() {
  const { login } = useAuth();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState(null);
  const [busy, setBusy] = useState(false);

  const submit = async (e, creds) => {
    e?.preventDefault();
    setError(null);
    setBusy(true);
    try {
      await login(creds?.email ?? email, creds?.password ?? password);
    } catch (err) {
      setError(err.message);
      setBusy(false);
    }
  };

  return (
    <div className="login-page">
      <div className="login-art">
        <div className="brand-mark" style={{ background: 'rgba(255,255,255,0.2)', boxShadow: 'none' }}>SIA</div>

        <div className="login-art-inner">
          <h2>One shelf, one record, one place.</h2>
          <p>
            A centralised inventory system for a small supermarket &mdash; stock, suppliers and
            thresholds in one place, with restocking that starts itself.
          </p>

          <ul className="login-points">
            <li>
              <i className="bi bi-arrow-repeat" />
              <span>Restock requests raise themselves the moment stock crosses a threshold.</span>
            </li>
            <li>
              <i className="bi bi-receipt" />
              <span>Sales recorded at the till against an optional phone number &mdash; never required.</span>
            </li>
            <li>
              <i className="bi bi-qr-code" />
              <span>Customers leave feedback by scanning a QR. No account, no password.</span>
            </li>
            <li>
              <i className="bi bi-shield-check" />
              <span>Every stock movement and every bill records who was responsible.</span>
            </li>
          </ul>
        </div>

        <div style={{ position: 'relative', zIndex: 2, fontSize: 'var(--text-xs)', color: 'rgba(255,255,255,0.65)' }}>
          Mini Project III &middot; Asigha K G &amp; Nirupa K V
        </div>
      </div>

      <div className="login-form-side">
        <div className="login-box">
          <h2 style={{ fontSize: 'var(--text-2xl)' }}>Sign in</h2>
          <p style={{ color: 'var(--ink-400)', marginTop: 6, marginBottom: 'var(--sp-5)' }}>
            Accounts are created by the Owner and the Manager. Nobody self-registers.
          </p>

          {error && (
            <div
              className="mb-3"
              style={{
                background: 'var(--coral-soft)', color: 'var(--coral-deep)',
                padding: 'var(--sp-3) var(--sp-4)', borderRadius: 'var(--radius-sm)',
                fontSize: 'var(--text-sm)', fontWeight: 'var(--weight-medium)',
              }}
            >
              <i className="bi bi-exclamation-circle-fill me-2" />
              {error}
            </div>
          )}

          <form onSubmit={submit}>
            <div className="mb-3">
              <label className="form-label" htmlFor="login-email">Email</label>
              <input
                id="login-email"
                className="form-control"
                type="email"
                value={email}
                autoComplete="username"
                onChange={(e) => setEmail(e.target.value)}
                placeholder="you@sia.local"
                required
              />
            </div>

            <div className="mb-4">
              <label className="form-label" htmlFor="login-password">Password</label>
              <input
                id="login-password"
                className="form-control"
                type="password"
                value={password}
                autoComplete="current-password"
                onChange={(e) => setPassword(e.target.value)}
                placeholder="••••••••"
                required
              />
            </div>

            <button type="submit" className="btn btn-primary w-100" disabled={busy}>
              {busy ? 'Signing in…' : 'Sign in'}
            </button>
          </form>

          <div className="divider-text">Demo accounts</div>

          <div className="demo-logins">
            {DEMO_ACCOUNTS.map((a) => (
              <div
                key={a.email}
                className="demo-login-row"
                onClick={(e) => submit(e, a)}
                role="button"
                tabIndex={0}
                onKeyDown={(e) => e.key === 'Enter' && submit(e, a)}
              >
                <div className="user-avatar" style={{ background: ROLE_META[a.role].color }}>
                  {initials(a.name)}
                </div>
                <div style={{ minWidth: 0 }}>
                  <strong style={{ color: 'var(--ink-900)', display: 'block' }}>{a.role}</strong>
                  <span style={{ color: 'var(--ink-400)', fontSize: 'var(--text-xs)' }}>
                    {ROLE_META[a.role].blurb}
                  </span>
                </div>
                <i className="bi bi-arrow-right ms-auto" style={{ color: 'var(--ink-300)' }} />
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}
