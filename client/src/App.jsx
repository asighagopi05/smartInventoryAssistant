import { BrowserRouter, Routes, Route, Navigate, useLocation } from 'react-router-dom';
import { AuthProvider, useAuth } from './context/AuthContext';
import { routesForRole } from './config/navigation';
import Layout from './components/Layout';
import Login from './pages/Login';
import PublicFeedback from './pages/PublicFeedback';

function FullPageLoader() {
  return (
    <div style={{ minHeight: '100vh', display: 'grid', placeItems: 'center', background: 'var(--canvas)' }}>
      <div style={{ textAlign: 'center' }}>
        <div className="brand-mark" style={{ margin: '0 auto var(--sp-4)', width: 46, height: 46 }}>SIA</div>
        <div style={{ color: 'var(--ink-400)', fontSize: 'var(--text-sm)' }}>Loading…</div>
      </div>
    </div>
  );
}

/**
 * Routes are generated from the same config the sidebar reads, filtered by the
 * signed-in role. A screen a role cannot see is not merely hidden from the menu
 * - it has no route at all, so typing the URL does not reach it either.
 *
 * The server enforces all of this independently on every request. This only
 * stops the interface offering something that would be refused.
 */
function AppRoutes() {
  const { user, loading } = useAuth();
  const location = useLocation();

  if (loading) return <FullPageLoader />;

  if (!user) {
    return (
      <Routes>
        <Route path="/login" element={<Login />} />
        <Route path="*" element={<Navigate to="/login" replace state={{ from: location }} />} />
      </Routes>
    );
  }

  const allowed = routesForRole(user.role);

  return (
    <Routes>
      <Route path="/login" element={<Navigate to="/" replace />} />
      {allowed.map(({ path, component: Component }) => (
        <Route key={path} path={path} element={<Component />} />
      ))}
      <Route
        path="*"
        element={(
          <Layout title="Not found">
            <div className="card-soft" style={{ padding: 'var(--sp-8)', textAlign: 'center' }}>
              <i className="bi bi-signpost-2" style={{ fontSize: '2.5rem', color: 'var(--ink-300)' }} />
              <h3 style={{ marginTop: 'var(--sp-4)' }}>That screen is not available</h3>
              <p style={{ color: 'var(--ink-400)', margin: 0 }}>
                It may not exist, or your role may not have access to it.
              </p>
            </div>
          </Layout>
        )}
      />
    </Routes>
  );
}

export default function App() {
  return (
    <BrowserRouter>
      <Routes>
        {/* Public. No auth, no redirect to login, no account prompt.
            This is what a customer reaches by scanning a QR code. */}
        <Route path="/feedback" element={<PublicFeedback />} />
        <Route path="/feedback/:productId" element={<PublicFeedback />} />

        <Route
          path="*"
          element={(
            <AuthProvider>
              <AppRoutes />
            </AuthProvider>
          )}
        />
      </Routes>
    </BrowserRouter>
  );
}
