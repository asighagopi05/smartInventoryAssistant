/** Icon and colour for each notification type, shared by the bell and the notification centre. */
export const NOTIFICATION_TONE = {
  restock_request: ['bi-arrow-repeat', 'var(--amber)'],
  restock_approved: ['bi-check2-circle', 'var(--sky)'],
  stock_received: ['bi-box-seam', 'var(--sage)'],
  adjustment_request: ['bi-sliders', 'var(--plum)'],
  adjustment_decided: ['bi-clipboard-check', 'var(--plum)'],
  bad_review: ['bi-star', 'var(--coral)'],
  low_stock: ['bi-exclamation-triangle', 'var(--amber)'],
  issue_raised: ['bi-flag', 'var(--coral)'],
  issue_updated: ['bi-flag-fill', 'var(--sage)'],
  task_assigned: ['bi-check2-square', 'var(--teal)'],
  task_done: ['bi-check2-all', 'var(--sage)'],
  discussion_reply: ['bi-chat-left-text', 'var(--sky)'],
};

export const toneFor = (type) => NOTIFICATION_TONE[type] || ['bi-info-circle', 'var(--ink-400)'];

/** Read state changed somewhere other than the bell: tell the bell to recount. */
export const NOTIFICATIONS_CHANGED = 'sia:notifications-changed';
export const announceNotificationsChanged = () => window.dispatchEvent(new Event(NOTIFICATIONS_CHANGED));
