import { useState, useEffect } from 'react';
import { NavLink, useLocation, Link } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';
import { navForRole, SECTION_ORDER, ROLE_META } from '../config/navigation';
import { api } from '../api/client';
import NotificationBell from './NotificationBell';

const initials = (name = '') =>
  name.split(' ').filter(Boolean).slice(0, 2).map((w) => w[0]).join('').toUpperCase();

export default function Layout({ children, title, subtitle, actions }) {
  const { user, logout } = useAuth();
  const location = useLocation();
  const [open, setOpen] = useState(false);
  const [badges, setBadges] = useState({ approvals: 0, issues: 0, tasks: 0 });

  useEffect(() => { setOpen(false); }, [location.pathname]);

  useEffect(() => {
    let cancelled = false;
    const load = async () => {
      try {
        // approvals: reorders and stock counts waiting on the Manager;
        // issues: flagged and not yet acknowledged; tasks: open ones given to me.
        const counts = await api.get('/dashboard/badges');
        if (!cancelled) setBadges(counts);
      } catch { /* the badge is not worth an error state */ }
    };
    load();
    const t = setInterval(load, 20000);
    return () => { cancelled = true; clearInterval(t); };
  }, [location.pathname]);

  const items = navForRole(user.role);
  const sections = SECTION_ORDER
    .map((name) => ({ name, items: items.filter((i) => i.section === name) }))
    .filter((s) => s.items.length);

  const roleColor = ROLE_META[user.role]?.color;

  return (
    <div className="app-shell">
      <aside className={`sidebar ${open ? 'open' : ''}`}>
        <div className="sidebar-brand">
          <div className="brand-mark">SIA</div>
          <div className="brand-text">
            <strong>Smart Inventory</strong>
            <span>Assistant</span>
          </div>
        </div>

        <nav className="sidebar-nav">
          {sections.map((section) => (
            <div key={section.name}>
              <div className="nav-section-label">{section.name}</div>
              {section.items.map((item) => (
                <NavLink
                  key={item.path}
                  to={item.path}
                  end={item.path === '/'}
                  className={({ isActive }) => `nav-item ${isActive ? 'active' : ''}`}
                  style={{
                    '--accent': `var(--${item.accent})`,
                    '--accent-soft': `var(--${item.accent}-soft)`,
                    '--accent-deep': `var(--${item.accent}-deep, var(--${item.accent}))`,
                  }}
                >
                  <i className={`bi ${item.icon}`} />
                  <span>{item.label}</span>
                  {item.badge && badges[item.badge] > 0 && (
                    <span className="nav-badge">{badges[item.badge]}</span>
                  )}
                </NavLink>
              ))}
            </div>
          ))}
        </nav>

        <div className="sidebar-footer">
          <div className="user-chip" style={{ '--role-color': roleColor }}>
            <div className="user-avatar">{initials(user.name)}</div>
            <div className="user-chip-text">
              <strong>{user.name}</strong>
              <span>{user.role}</span>
            </div>
            <button className="icon-btn ms-auto" onClick={logout} title="Sign out" style={{ width: 32, height: 32 }}>
              <i className="bi bi-box-arrow-right" />
            </button>
          </div>
        </div>
      </aside>

      <div className="main-col">
        <header className="topbar">
          <button className="icon-btn d-lg-none" onClick={() => setOpen((v) => !v)}>
            <i className="bi bi-list" />
          </button>
          <div>
            <h1>{title}</h1>
            {subtitle && <div className="topbar-sub">{subtitle}</div>}
          </div>
          <div className="ms-auto d-flex align-items-center gap-2">
            {actions}
            <NotificationBell />
          </div>
        </header>

        <main className="page">{children}</main>
      </div>
    </div>
  );
}
