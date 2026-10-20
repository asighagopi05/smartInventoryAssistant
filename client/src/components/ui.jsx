/**
 * Small presentational primitives shared across screens.
 * Keeping them here stops each page reinventing a card header or a status chip
 * with slightly different spacing.
 */

const CATEGORY_CLASS = {
  Dairy: 'cat-Dairy', Bakery: 'cat-Bakery', Produce: 'cat-Produce', Meat: 'cat-Meat',
  Frozen: 'cat-Frozen', Beverages: 'cat-Beverages', Alcohol: 'cat-Alcohol',
  Snacks: 'cat-Snacks', Staples: 'cat-Staples', Household: 'cat-Household',
  'Personal Care': 'cat-PersonalCare', Electronics: 'cat-Electronics',
};

export function CategoryChip({ category }) {
  return (
    <span className={`chip chip-cat ${CATEGORY_CLASS[category] || 'cat-Electronics'}`}>
      {category}
    </span>
  );
}

export function Chip({ tone = 'neutral', icon, children }) {
  return (
    <span className={`chip chip-${tone}`}>
      {icon && <i className={`bi ${icon}`} />}
      {children}
    </span>
  );
}

/** Stock state, expressed consistently everywhere it appears. */
export function StockChip({ stock, threshold }) {
  if (stock <= 0) return <Chip tone="danger" icon="bi-x-octagon-fill">Out of stock</Chip>;
  if (stock <= threshold) return <Chip tone="warn" icon="bi-exclamation-triangle-fill">Low</Chip>;
  if (stock <= threshold * 1.5) return <Chip tone="info">Watch</Chip>;
  return <Chip tone="ok" icon="bi-check-circle-fill">Healthy</Chip>;
}

export function StatusChip({ status }) {
  const map = {
    pending: ['warn', 'bi-hourglass-split', 'Pending'],
    approved: ['info', 'bi-check2', 'Approved'],
    received: ['ok', 'bi-box-seam', 'Received'],
    rejected: ['danger', 'bi-x-circle', 'Rejected'],
    applied: ['ok', 'bi-check2-all', 'Applied'],
    open: ['warn', 'bi-exclamation-circle', 'Open'],
    acknowledged: ['info', 'bi-eye', 'Acknowledged'],
    resolved: ['ok', 'bi-check-circle', 'Resolved'],
  };
  const [tone, icon, label] = map[status] || ['neutral', null, status];
  return <Chip tone={tone} icon={icon}>{label}</Chip>;
}

export function StatTile({ tone = 'indigo', icon, label, value, foot }) {
  return (
    <div className={`stat tile-${tone}`}>
      <div className="stat-icon"><i className={`bi ${icon}`} /></div>
      <div className="stat-label">{label}</div>
      <div className="stat-value">{value}</div>
      {foot && <div className="stat-foot">{foot}</div>}
    </div>
  );
}

export function Card({ title, subtitle, actions, children, bodyClass = 'card-body-p', className = '' }) {
  return (
    <section className={`card-soft ${className}`}>
      {(title || actions) && (
        <div className="card-head">
          <div>
            {title && <h3>{title}</h3>}
            {subtitle && <p>{subtitle}</p>}
          </div>
          {actions}
        </div>
      )}
      <div className={bodyClass}>{children}</div>
    </section>
  );
}

export function EmptyState({ icon = 'bi-inbox', title, children }) {
  return (
    <div className="empty-state">
      <i className={`bi ${icon}`} />
      <h4>{title}</h4>
      {children && <p>{children}</p>}
    </div>
  );
}

export function Loading({ rows = 5 }) {
  return (
    <div className="d-grid gap-2 p-2">
      {Array.from({ length: rows }).map((_, i) => (
        <div key={i} className="skeleton" style={{ height: 40, opacity: 1 - i * 0.12 }} />
      ))}
    </div>
  );
}

export function Stars({ value = 0, size = '1rem' }) {
  return (
    <span className="rating-inline" style={{ fontSize: size }}>
      {[1, 2, 3, 4, 5].map((n) => (
        <i key={n} className={`bi ${n <= Math.round(value) ? 'bi-star-fill' : 'bi-star'}`} />
      ))}
    </span>
  );
}

export function ErrorNote({ error }) {
  if (!error) return null;
  return (
    <div className="card-soft" style={{ borderLeft: '4px solid var(--coral)', padding: 'var(--sp-4)' }}>
      <strong style={{ color: 'var(--coral-deep)' }}>
        <i className="bi bi-exclamation-octagon-fill me-2" />Something went wrong
      </strong>
      <div style={{ fontSize: 'var(--text-sm)', color: 'var(--ink-500)', marginTop: 4 }}>
        {error.message || String(error)}
      </div>
    </div>
  );
}
