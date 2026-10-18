import { useEffect, useState } from 'react';
import Layout from '../components/Layout';
import { Card, Loading, ErrorNote, EmptyState } from '../components/ui';
import { api, longDate } from '../api/client';
import { ROLE_META } from '../config/navigation';

const initials = (name = '') =>
  name.split(' ').filter(Boolean).slice(0, 2).map((w) => w[0]).join('').toUpperCase();

export default function Discussion() {
  const [posts, setPosts] = useState(null);
  const [hasMore, setHasMore] = useState(false);
  const [error, setError] = useState(null);
  const [loadingMore, setLoadingMore] = useState(false);

  const load = () => api.get('/discussion?limit=20')
    .then((d) => { setPosts(d.posts); setHasMore(d.has_more); setError(null); })
    .catch(setError);
  useEffect(() => { load(); }, []);

  const more = async () => {
    setLoadingMore(true);
    try {
      const last = posts[posts.length - 1];
      const d = await api.get(`/discussion?limit=20&before=${encodeURIComponent(last.createdAt)}`);
      setPosts((p) => [...p, ...d.posts]);
      setHasMore(d.has_more);
    } catch (err) { setError(err); } finally { setLoadingMore(false); }
  };

  return (
    <Layout title="Discussion" subtitle="The team noticeboard. Handovers, heads-ups and questions; customers never see it.">
      <div className="page-narrow" style={{ maxWidth: 860 }}>
        <Composer onPosted={load} />

        {error && <div className="mb-3"><ErrorNote error={error} /></div>}
        {!posts ? <Card><Loading rows={4} /></Card> : posts.length === 0 ? (
          <Card><EmptyState icon="bi-chat-left-text" title="No posts yet">Start the conversation above.</EmptyState></Card>
        ) : (
          <div className="d-grid gap-3">
            {posts.map((p) => <Thread key={p._id} post={p} onReplied={load} />)}
            {hasMore && (
              <button className="btn btn-ghost" disabled={loadingMore} onClick={more}>
                {loadingMore ? 'Loading…' : 'Show older posts'}
              </button>
            )}
          </div>
        )}
      </div>
    </Layout>
  );
}

function Avatar({ author, size = 40 }) {
  return (
    <div
      className="user-avatar"
      style={{ background: ROLE_META[author?.role]?.color, width: size, height: size, fontSize: size > 36 ? 'var(--text-sm)' : 'var(--text-xs)' }}
      title={author?.role}
    >
      {initials(author?.name || '?')}
    </div>
  );
}

function Post({ note, small }) {
  return (
    <div className="post">
      <Avatar author={note.author_id} size={small ? 34 : 42} />
      <div className="post-body">
        <div className="post-head">
          <strong>{note.author_id?.name || 'Former staff member'}</strong>
          <span className="td-muted">{note.author_id?.role} · {longDate(note.createdAt)}</span>
        </div>
        <p className="post-text">{note.body}</p>
      </div>
    </div>
  );
}

function Thread({ post, onReplied }) {
  const [replying, setReplying] = useState(false);
  return (
    <Card>
      <Post note={post} />
      {(post.replies.length > 0 || replying) && (
        <div className="replies">
          {post.replies.map((r) => <Post key={r._id} note={r} small />)}
          {replying && (
            <div className={post.replies.length ? 'mt-3' : ''}>
              <Composer parentId={post._id} compact onPosted={() => { setReplying(false); onReplied(); }} onCancel={() => setReplying(false)} />
            </div>
          )}
        </div>
      )}
      {!replying && (
        <button className="btn btn-ghost btn-sm mt-3" onClick={() => setReplying(true)}>
          <i className="bi bi-reply me-1" />Reply{post.replies.length ? ` (${post.replies.length})` : ''}
        </button>
      )}
    </Card>
  );
}

function Composer({ parentId, compact, onPosted, onCancel }) {
  const [body, setBody] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);

  const submit = async (e) => {
    e.preventDefault();
    setBusy(true); setError(null);
    try {
      await api.post('/discussion', { body, parentId });
      setBody('');
      onPosted();
    } catch (err) { setError(err); } finally { setBusy(false); }
  };

  const form = (
    <form onSubmit={submit}>
      {error && <div className="mb-2"><ErrorNote error={error} /></div>}
      <textarea
        className="form-control" rows={compact ? 2 : 3} maxLength={1000} autoFocus={compact}
        aria-label={parentId ? 'Write a reply' : 'Write a post'}
        placeholder={parentId ? 'Write a reply…' : 'Share something with the team: a handover note, a heads-up, a question…'}
        value={body} onChange={(e) => setBody(e.target.value)}
      />
      <div className="d-flex align-items-center gap-2 mt-2">
        <button className="btn btn-primary" type="submit" disabled={busy || !body.trim()}>
          {busy ? 'Posting…' : parentId ? 'Reply' : 'Post'}
        </button>
        {onCancel && <button type="button" className="btn btn-ghost" onClick={onCancel}>Cancel</button>}
        <span className="td-muted ms-auto">{body.length}/1000</span>
      </div>
    </form>
  );

  return compact ? form : <Card className="mb-4" title="New post">{form}</Card>;
}
