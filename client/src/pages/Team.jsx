import { useEffect, useState } from 'react';
import Layout from '../components/Layout';
import { Card, Loading, ErrorNote, Chip } from '../components/ui';
import { api, longDate } from '../api/client';
import { useAuth } from '../context/AuthContext';
import { ROLE_META } from '../config/navigation';

const initials = (n = '') => n.split(' ').slice(0, 2).map((w) => w[0]).join('').toUpperCase();

export default function Team() {
  const { user, isRole } = useAuth();
  const [users, setUsers] = useState(null);
  const [error, setError] = useState(null);
  const [adding, setAdding] = useState(false);
  const [form, setForm] = useState({ name: '', email: '', password: '', phone: '', role: 'Staff' });
  const [busy, setBusy] = useState(false);
  const [formError, setFormError] = useState(null);

  const load = () => api.get('/auth/users').then((d) => setUsers(d.users)).catch(setError);
  useEffect(() => { load(); }, []);

  const create = async () => {
    setBusy(true); setFormError(null);
    try {
      await api.post('/auth/users', form);
      setForm({ name: '', email: '', password: '', phone: '', role: 'Staff' });
      setAdding(false);
      await load();
    } catch (err) { setFormError(err); } finally { setBusy(false); }
  };

  if (error) return <Layout title="Team"><ErrorNote error={error} /></Layout>;

  const canCreate = isRole('Owner', 'Manager');
  const creatable = user.role === 'Owner' ? ['Manager', 'Staff'] : ['Staff'];

  return (
    <Layout
      title="Team"
      subtitle="Accounts are created down a chain: Owner → Manager → Staff. Nobody self-registers."
      actions={canCreate && !adding && (
        <button className="btn btn-primary" onClick={() => setAdding(true)}>
          <i className="bi bi-person-plus me-2" />Add an account
        </button>
      )}
    >
      {adding && (
        <Card
          title="New account"
          subtitle={`As ${user.role}, you can create: ${creatable.join(' and ')}`}
          className="mb-4"
          actions={<button className="icon-btn" onClick={() => setAdding(false)}><i className="bi bi-x-lg" /></button>}
        >
          {formError && (
            <div className="mb-3" style={{ background: 'var(--coral-soft)', color: 'var(--coral-deep)', padding: 'var(--sp-3)', borderRadius: 'var(--radius-sm)', fontSize: 'var(--text-sm)' }}>
              {formError.message}
            </div>
          )}
          <div className="row g-3">
            <div className="col-12 col-md-4">
              <label className="form-label">Name</label>
              <input className="form-control" value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} />
            </div>
            <div className="col-12 col-md-4">
              <label className="form-label">Email</label>
              <input className="form-control" type="email" value={form.email} onChange={(e) => setForm({ ...form, email: e.target.value })} />
            </div>
            <div className="col-12 col-md-4">
              <label className="form-label">Password</label>
              <input className="form-control" type="text" value={form.password} onChange={(e) => setForm({ ...form, password: e.target.value })} />
            </div>
            <div className="col-12 col-md-4">
              <label className="form-label">Phone</label>
              <input className="form-control" maxLength={10} value={form.phone} onChange={(e) => setForm({ ...form, phone: e.target.value })} />
            </div>
            <div className="col-12 col-md-4">
              <label className="form-label">Role</label>
              <select className="form-select" value={form.role} onChange={(e) => setForm({ ...form, role: e.target.value })}>
                {creatable.map((r) => <option key={r} value={r}>{r}</option>)}
              </select>
            </div>
          </div>
          <button className="btn btn-primary mt-3" onClick={create} disabled={busy}>
            {busy ? 'Creating…' : 'Create account'}
          </button>
        </Card>
      )}

      {!users ? <Loading rows={5} /> : (
        <div className="row g-3">
          {users.map((u) => (
            <div className="col-12 col-md-6 col-xl-4" key={u._id}>
              <div className="card-soft h-100" style={{ padding: 'var(--sp-5)' }}>
                <div className="d-flex align-items-center gap-3">
                  <div className="user-avatar" style={{ background: ROLE_META[u.role]?.color, width: 46, height: 46, fontSize: 'var(--text-base)' }}>
                    {initials(u.name)}
                  </div>
                  <div style={{ minWidth: 0 }}>
                    <div className="td-strong">{u.name}</div>
                    <div className="td-muted text-truncate">{u.email}</div>
                  </div>
                </div>

                <div className="d-flex gap-2 mt-3">
                  <span
                    className="chip"
                    style={{
                      background: `color-mix(in srgb, ${ROLE_META[u.role]?.color} 15%, white)`,
                      color: `color-mix(in srgb, ${ROLE_META[u.role]?.color} 75%, black)`,
                    }}
                  >
                    {u.role}
                  </span>
                  {u.active ? <Chip tone="ok">Active</Chip> : <Chip tone="neutral">Deactivated</Chip>}
                </div>

                <div className="td-muted mt-3" style={{ borderTop: 'var(--border-light)', paddingTop: 'var(--sp-3)' }}>
                  <div>
                    <i className="bi bi-diagram-2 me-2" />
                    {u.created_by
                      ? <>Created by {u.created_by.name} ({u.created_by.role})</>
                      : <>The founding account — created by the system</>}
                  </div>
                  {u.last_login && (
                    <div className="mt-1"><i className="bi bi-clock me-2" />Last signed in {longDate(u.last_login)}</div>
                  )}
                </div>

                <div className="td-muted mt-2" style={{ fontStyle: 'italic' }}>
                  {ROLE_META[u.role]?.blurb}
                </div>
              </div>
            </div>
          ))}
        </div>
      )}
    </Layout>
  );
}
