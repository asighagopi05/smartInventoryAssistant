import { useEffect, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { api, longDate } from '../api/client';
import { toneFor, NOTIFICATIONS_CHANGED } from './notificationMeta';

export default function NotificationBell() {
  const [open, setOpen] = useState(false);
  const [items, setItems] = useState([]);
  const [unread, setUnread] = useState(0);
  const ref = useRef(null);

  const load = async () => {
    try {
      const data = await api.get('/notifications?limit=12');
      setItems(data.notifications);
      setUnread(data.unread);
    } catch { /* the bell is not worth an error state */ }
  };

  useEffect(() => {
    load();
    // Notifications are written by their triggers on the server, so the bell
    // polls rather than being told what to show.
    const t = setInterval(load, 15000);
    window.addEventListener(NOTIFICATIONS_CHANGED, load);
    return () => { clearInterval(t); window.removeEventListener(NOTIFICATIONS_CHANGED, load); };
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

  const openOne = (n) => {
    setOpen(false);
    if (!n.read) api.post(`/notifications/${n._id}/read`).then(load).catch(() => {});
  };

  return (
    <div style={{ position: 'relative' }} ref={ref}>
      <button className="icon-btn" onClick={() => setOpen((v) => !v)} title="Notifications" aria-label={`Notifications, ${unread} unread`}>
        <i className="bi bi-bell-fill" />
        {unread > 0 && <span className="dot-badge">{unread > 99 ? '99+' : unread}</span>}
      </button>

      {open && (
        <div className="card-soft bell-panel">
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
              const [icon, color] = toneFor(n.type);
              return (
                <Link
                  key={n._id}
                  to={n.link || '/notifications'}
                  onClick={() => openOne(n)}
                  className="bell-item"
                  style={{ background: n.read ? 'transparent' : 'var(--indigo-soft)' }}
                >
                  <span className="note-icon" style={{ '--tone': color }}><i className={`bi ${icon}`} /></span>
                  <span style={{ minWidth: 0 }}>
                    <strong style={{ display: 'block', fontSize: 'var(--text-sm)', color: 'var(--ink-900)' }}>
                      {n.title}
                    </strong>
                    <span style={{ fontSize: 'var(--text-sm)', color: 'var(--ink-500)', display: 'block' }}>
                      {n.body}
                    </span>
                    <span style={{ fontSize: 'var(--text-xs)', color: 'var(--ink-400)' }}>
                      {longDate(n.createdAt)}
                    </span>
                  </span>
                </Link>
              );
            })}
          </div>

          <Link to="/notifications" className="bell-all" onClick={() => setOpen(false)}>
            See all notifications <i className="bi bi-arrow-right ms-1" />
          </Link>
        </div>
      )}
    </div>
  );
}
