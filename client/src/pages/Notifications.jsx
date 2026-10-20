import { useCallback, useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import Layout from '../components/Layout';
import { Card, Loading, ErrorNote, EmptyState } from '../components/ui';
import { api, longDate } from '../api/client';
import { toneFor, announceNotificationsChanged } from '../components/notificationMeta';

const GROUPS = [['', 'Everything'], ['stock', 'Stock & restock'], ['floor', 'Issues, tasks & posts'], ['feedback', 'Customer feedback']];

/**
 * The full notification history - everything the bell has ever shown this
 * person, a page at a time, not just the latest dozen.
 */
export default function Notifications() {
  const [rows, setRows] = useState(null);
  const [unread, setUnread] = useState(0);
  const [next, setNext] = useState(null);
  const [onlyUnread, setOnlyUnread] = useState(false);
  const [group, setGroup] = useState('');
  const [error, setError] = useState(null);
  const [busy, setBusy] = useState(false);

  const query = useCallback(
    (after) => `/notifications?limit=30${onlyUnread ? '&unread=1' : ''}${group ? `&group=${group}` : ''}${after ? `&after=${encodeURIComponent(after)}` : ''}`,
    [onlyUnread, group]
  );

  const load = useCallback(() => api.get(query())
    .then((d) => { setRows(d.notifications); setUnread(d.unread); setNext(d.next); setError(null); })
    .catch(setError), [query]);
  useEffect(() => { load(); }, [load]);

  // Changing a filter shows the loading state until the new page arrives.
  const changeGroup = (v) => { setRows(null); setGroup(v); };
  const changeUnread = (v) => { setRows(null); setOnlyUnread(v); };

  const more = async () => {
    setBusy(true);
    try {
      const d = await api.get(query(next));
      setRows((r) => [...r, ...d.notifications]);
      setNext(d.next);
    } catch (err) { setError(err); } finally { setBusy(false); }
  };

  const markRead = async (n) => {
    if (n.read) return;
    try {
      await api.post(`/notifications/${n._id}/read`);
      setRows((r) => r.map((x) => (x._id === n._id ? { ...x, read: true } : x)));
      setUnread((u) => Math.max(0, u - 1));
      announceNotificationsChanged();
    } catch (err) { setError(err); }
  };

  const markAll = async () => {
    setBusy(true);
    try {
      await api.post('/notifications/read-all');
      await load();
      announceNotificationsChanged();
    } catch (err) { setError(err); } finally { setBusy(false); }
  };

  return (
    <Layout
      title="Notifications"
      subtitle="Everything the system has told you, newest first"
      actions={unread > 0 && (
        <button className="btn btn-soft" disabled={busy} onClick={markAll}>
          <i className="bi bi-check2-all me-2" />Mark all {unread} read
        </button>
      )}
    >
      <Card
        bodyClass=""
        title={`${unread} unread`}
        subtitle="Opening one takes you to the screen it is about and marks it read"
        actions={(
          <div className="d-flex flex-wrap align-items-center gap-2">
            {GROUPS.map(([v, label]) => (
              <button key={v || 'all'} className={`btn btn-sm ${group === v ? 'btn-primary' : 'btn-ghost'}`} onClick={() => changeGroup(v)}>
                {label}
              </button>
            ))}
            <label className="check-pill">
              <input type="checkbox" checked={onlyUnread} onChange={(e) => changeUnread(e.target.checked)} />
              Unread only
            </label>
          </div>
        )}
      >
        {error && <div className="p-3"><ErrorNote error={error} /></div>}
        {!rows ? <Loading rows={6} /> : rows.length === 0 ? (
          <EmptyState icon="bi-bell-slash" title={onlyUnread ? 'All caught up' : 'Nothing here yet'}>
            {onlyUnread ? 'You have read everything in this view.' : 'Notifications appear when something needs you: a restock, a flagged issue, a task.'}
          </EmptyState>
        ) : (
          <div>
            {rows.map((n) => {
              const [icon, color] = toneFor(n.type);
              return (
                <div key={n._id} className={`list-row ${n.read ? '' : 'unread'}`} style={{ '--bar': n.read ? 'transparent' : color }}>
                  <span className="note-icon" style={{ '--tone': color }}><i className={`bi ${icon}`} /></span>
                  <div className="list-row-main">
                    <div className="d-flex flex-wrap align-items-center gap-2">
                      <h4 className="list-row-title" style={{ fontSize: 'var(--text-base)' }}>{n.title}</h4>
                      {!n.read && <span className="chip chip-brand">New</span>}
                    </div>
                    {n.body && <p className="list-row-body" style={{ margin: '4px 0' }}>{n.body}</p>}
                    <div className="list-row-meta">
                      {longDate(n.createdAt)}
                      {n.for_role && <> · to every {n.for_role}</>}
                      {n.for_user_id && <> · to you</>}
                    </div>
                  </div>
                  <div className="list-row-actions">
                    {n.link && (
                      <Link to={n.link} className="btn btn-primary btn-sm" onClick={() => markRead(n)}>Open</Link>
                    )}
                    {!n.read && (
                      <button className="btn btn-ghost btn-sm" onClick={() => markRead(n)}>Mark read</button>
                    )}
                  </div>
                </div>
              );
            })}
            {next && (
              <div className="p-3 text-center">
                <button className="btn btn-ghost" disabled={busy} onClick={more}>{busy ? 'Loading…' : 'Show older'}</button>
              </div>
            )}
          </div>
        )}
      </Card>
    </Layout>
  );
}
