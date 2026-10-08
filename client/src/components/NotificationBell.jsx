import { useEffect, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { api, longDate } from '../api/client';

const TONE = {
  restock_request: ['bi-arrow-repeat', 'var(--amber)'],
  restock_approved: ['bi-check2-circle', 'var(--sky)'],
  stock_received: ['bi-box-seam', 'var(--sage)'],
  adjustment_request: ['bi-sliders', 'var(--plum)'],
  bad_review: ['bi-star', 'var(--coral)'],
  low_stock: ['bi-exclamation-triangle', 'var(--amber)'],
  issue_raised: ['bi-flag', 'var(--coral)'],
};

export default function NotificationBell() {
  const [open, setOpen] = useState(false);
  const [items, setItems] = useState([]);
  const [unread, setUnread] = useState(0);
  const ref = useRef(null);

  const load = async () => {
    try {
      const data = await api.get('/notifications?limit=20');
      setItems(data.notifications);
      setUnread(data.unread);
    } catch { /* the bell is not worth an error state */ }
  };

  useEffect(() => {
    load();
    // Notifications are written by their triggers on the server, so the bell
    // polls rather than being told what to show.
    const t = setInterval(load, 15000);
    return () => clearInterval(t);
  }, []);

  useEffect(() => {
    const onClick = (e) => { if (ref.current && !ref.current.contains(e.target)) setOpen(false); };
    document.addEventListener('mousedown', onClick);
    return () => document.removeEventListener('mousedown', onClick);
  }, []);

  const markAll = async () => {
    await api.post('/notifications/read-all');
    load();
  };

  return (
    <div style={{ position: 'relative' }} ref={ref}>
      <button className="icon-btn" onClick={() => setOpen((v) => !v)} title="Notifications">
        <i className="bi bi-bell-fill" />
        {unread > 0 && <span className="dot-badge">{unread > 9 ? '9+' : unread}</span>}
      </button>

      {open && (
        <div
          className="card-soft"
          style={{
            position: 'absolute', right: 0, top: 46, width: 380, zIndex: 60,
            boxShadow: 'var(--shadow-lg)', maxHeight: 460, display: 'flex', flexDirection: 'column',
          }}
        >
          <div className="card-head" style={{ padding: 'var(--sp-4)' }}>
            <div>
              <h3 style={{ fontSize: 'var(--text-base)' }}>Notifications</h3>
              <p>{unread} unread</p>
            </div>
            {unread > 0 && (
              <button className="btn btn-soft btn-sm" onClick={markAll}>Mark all read</button>
            )}
          </div>

          <div style={{ overflowY: 'auto' }}>
            {items.length === 0 && (
              <div className="empty-state" style={{ padding: 'var(--sp-6)' }}>
                <i className="bi bi-bell-slash" />
                <h4>Nothing yet</h4>
                <p>Alerts appear here when the system raises them.</p>
              </div>
            )}

            {items.map((n) => {
              const [icon, color] = TONE[n.type] || ['bi-info-circle', 'var(--ink-400)'];
              return (
                <Link
                  key={n._id}
                  to={n.link || '/'}
                  onClick={() => setOpen(false)}
                  style={{
                    display: 'flex', gap: 'var(--sp-3)', padding: 'var(--sp-4)',
                    borderBottom: 'var(--border-light)', color: 'inherit',
                    background: n.read ? 'transparent' : 'var(--ink-50)',
                  }}
                >
                  <span style={{
                    flex: '0 0 auto', width: 32, height: 32, borderRadius: 9,
                    display: 'grid', placeItems: 'center',
                    background: `color-mix(in srgb, ${color} 16%, white)`, color,
                  }}
                  >
                    <i className={`bi ${icon}`} />
                  </span>
                  <span style={{ minWidth: 0 }}>
                    <strong style={{ display: 'block', fontSize: 'var(--text-sm)', color: 'var(--ink-900)' }}>
                      {n.title}
                    </strong>
                    <span style={{ fontSize: 'var(--text-sm)', color: 'var(--ink-500)', display: 'block' }}>
                      {n.body}
                    </span>
                    <span style={{ fontSize: 'var(--text-xs)', color: 'var(--ink-300)' }}>
                      {longDate(n.createdAt)}
                    </span>
                  </span>
                </Link>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
}
