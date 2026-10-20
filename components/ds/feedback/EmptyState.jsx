'use client';
import React from 'react';

/* Finance EmptyState — zero-data / empty-result placeholder. */

const CSS = `
.sx-empty {
  display: flex; flex-direction: column; align-items: center; text-align: center;
  padding: 40px 24px; font-family: var(--font-sans);
}
.sx-empty__icon {
  width: 48px; height: 48px; margin-bottom: 16px;
  display: inline-flex; align-items: center; justify-content: center;
  border-radius: var(--radius-lg); background: var(--surface-sunken); color: var(--text-subtle);
  border: 1px solid var(--border-subtle);
}
.sx-empty__icon svg { width: 24px; height: 24px; }
.sx-empty__title { font-size: var(--text-lg); font-weight: var(--weight-semibold); color: var(--text-strong); margin-bottom: 4px; }
.sx-empty__desc { font-size: var(--text-sm); color: var(--text-muted); max-width: 340px; line-height: 1.5; }
.sx-empty__actions { display: flex; gap: 8px; margin-top: 18px; }
`;

let _injected = false;
function inject() {
  if (_injected || typeof document === 'undefined') return;
  _injected = true;
  const s = document.createElement('style');
  s.setAttribute('data-sx', 'empty');
  s.textContent = CSS;
  document.head.appendChild(s);
}

export function EmptyState({ icon = null, title, description = null, actions = null, className = '', ...rest }) {
  inject();
  return (
    <div className={['sx-empty', className].filter(Boolean).join(' ')} {...rest}>
      {icon && <span className="sx-empty__icon">{icon}</span>}
      {title && <div className="sx-empty__title">{title}</div>}
      {description && <div className="sx-empty__desc">{description}</div>}
      {actions && <div className="sx-empty__actions">{actions}</div>}
    </div>
  );
}
