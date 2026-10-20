'use client';
import React from 'react';

/* Finance Badge / StatusTag — compact status & category labels.
   Tones map to semantic status tokens. */

const CSS = `
.sx-badge {
  display: inline-flex;
  align-items: center;
  gap: 5px;
  font-family: var(--font-sans);
  font-weight: var(--weight-semibold);
  font-size: var(--text-xs);
  line-height: 1;
  letter-spacing: var(--tracking-snug);
  height: 22px;
  padding: 0 8px;
  border-radius: var(--radius-sm);
  border: 1px solid transparent;
  white-space: nowrap;
}
.sx-badge--sm { height: 18px; font-size: var(--text-2xs); padding: 0 6px; gap: 4px; }
.sx-badge--pill { border-radius: var(--radius-pill); padding: 0 10px; }
.sx-badge__dot { width: 6px; height: 6px; border-radius: 50%; flex-shrink: 0; }
.sx-badge svg { width: 13px; height: 13px; }

/* soft (default) */
.sx-badge--soft.sx-tone-success { background: var(--status-success-bg); color: var(--status-success-text); }
.sx-badge--soft.sx-tone-warning { background: var(--status-warning-bg); color: var(--status-warning-text); }
.sx-badge--soft.sx-tone-danger  { background: var(--status-danger-bg);  color: var(--status-danger-text); }
.sx-badge--soft.sx-tone-info    { background: var(--status-info-bg);    color: var(--status-info-text); }
.sx-badge--soft.sx-tone-neutral { background: var(--status-neutral-bg); color: var(--status-neutral-text); }

/* solid */
.sx-badge--solid.sx-tone-success { background: var(--green-600); color:#ffffff; }
.sx-badge--solid.sx-tone-warning { background: var(--amber-500); color:#ffffff; }
.sx-badge--solid.sx-tone-danger  { background: var(--red-500);   color:#ffffff; }
.sx-badge--solid.sx-tone-info    { background: var(--blue-500);  color:#ffffff; }
.sx-badge--solid.sx-tone-neutral { background: var(--gray-600);  color:#ffffff; }

/* outline */
.sx-badge--outline { background: var(--surface-card); }
.sx-badge--outline.sx-tone-success { border-color: var(--green-600); color: var(--status-success-text); }
.sx-badge--outline.sx-tone-warning { border-color: var(--amber-500); color: var(--status-warning-text); }
.sx-badge--outline.sx-tone-danger  { border-color: var(--red-500);   color: var(--status-danger-text); }
.sx-badge--outline.sx-tone-info    { border-color: var(--blue-400);  color: var(--status-info-text); }
.sx-badge--outline.sx-tone-neutral { border-color: var(--border-strong); color: var(--status-neutral-text); }

.sx-tone-success .sx-badge__dot { background: var(--status-success-dot); }
.sx-tone-warning .sx-badge__dot { background: var(--status-warning-dot); }
.sx-tone-danger  .sx-badge__dot { background: var(--status-danger-dot); }
.sx-tone-info    .sx-badge__dot { background: var(--status-info-dot); }
.sx-tone-neutral .sx-badge__dot { background: var(--status-neutral-dot); }
`;

let _injected = false;
function inject() {
  if (_injected || typeof document === 'undefined') return;
  _injected = true;
  const s = document.createElement('style');
  s.setAttribute('data-sx', 'badge');
  s.textContent = CSS;
  document.head.appendChild(s);
}

export function Badge({
  tone = 'neutral',
  variant = 'soft',
  size = 'md',
  pill = false,
  dot = false,
  icon = null,
  className = '',
  children,
  ...rest
}) {
  inject();
  const cls = [
    'sx-badge',
    `sx-badge--${variant}`,
    `sx-tone-${tone}`,
    size === 'sm' ? 'sx-badge--sm' : '',
    pill ? 'sx-badge--pill' : '',
    className,
  ].filter(Boolean).join(' ');
  return (
    <span className={cls} {...rest}>
      {dot && <span className="sx-badge__dot" aria-hidden="true" />}
      {icon}
      {children}
    </span>
  );
}
