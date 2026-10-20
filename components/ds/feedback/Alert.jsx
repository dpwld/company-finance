'use client';
import React from 'react';

/* Finance Alert — inline contextual banner. */

const CSS = `
.sx-alert {
  display: flex; align-items: flex-start; gap: 11px;
  padding: 13px 15px;
  border-radius: var(--radius-md);
  border: 1px solid transparent;
  font-family: var(--font-sans);
  background: var(--surface-card);
}
.sx-alert__icon { flex-shrink: 0; margin-top: 1px; display: inline-flex; }
.sx-alert__icon svg { width: 18px; height: 18px; }
.sx-alert__body { flex: 1; min-width: 0; display: flex; flex-direction: column; gap: 3px; }
.sx-alert__title { font-size: var(--text-md); font-weight: var(--weight-semibold); color: var(--text-strong); line-height: 1.4; }
.sx-alert__desc { font-size: var(--text-sm); color: var(--text-default); line-height: 1.5; }
.sx-alert__actions { display: flex; gap: 8px; margin-top: 8px; }
.sx-alert__close { flex-shrink: 0; width: 24px; height: 24px; display: inline-flex; align-items: center; justify-content: center; border-radius: var(--radius-sm); color: var(--text-muted); cursor: pointer; background: none; border: none; transition: background var(--dur-fast), color var(--dur-fast); }
.sx-alert__close:hover { background: var(--surface-hover); color: var(--text-strong); }
.sx-alert__close svg { width: 15px; height: 15px; }

.sx-alert--info    { background: var(--status-info-bg);    border-color: var(--blue-200); }
.sx-alert--info    .sx-alert__icon { color: var(--status-info-dot); }
.sx-alert--success { background: var(--status-success-bg); border-color: var(--green-100); }
.sx-alert--success .sx-alert__icon { color: var(--green-600); }
.sx-alert--warning { background: var(--status-warning-bg); border-color: var(--amber-100); }
.sx-alert--warning .sx-alert__icon { color: var(--amber-600); }
.sx-alert--danger  { background: var(--status-danger-bg);  border-color: var(--red-100); }
.sx-alert--danger  .sx-alert__icon { color: var(--red-500); }
.sx-alert--neutral { background: var(--surface-sunken); border-color: var(--border-subtle); }
.sx-alert--neutral .sx-alert__icon { color: var(--text-muted); }
`;

let _injected = false;
function inject() {
  if (_injected || typeof document === 'undefined') return;
  _injected = true;
  const s = document.createElement('style');
  s.setAttribute('data-sx', 'alert');
  s.textContent = CSS;
  document.head.appendChild(s);
}

const ICONS = {
  info: <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><circle cx="12" cy="12" r="10"/><path d="M12 16v-4M12 8h.01"/></svg>,
  success: <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><circle cx="12" cy="12" r="10"/><path d="m9 12 2 2 4-4"/></svg>,
  warning: <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M10.29 3.86 1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z"/><path d="M12 9v4M12 17h.01"/></svg>,
  danger: <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><circle cx="12" cy="12" r="10"/><path d="m15 9-6 6M9 9l6 6"/></svg>,
  neutral: <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><circle cx="12" cy="12" r="10"/><path d="M12 16v-4M12 8h.01"/></svg>,
};

export function Alert({ tone = 'info', title = null, icon, onClose = null, actions = null, className = '', children, ...rest }) {
  inject();
  return (
    <div className={['sx-alert', `sx-alert--${tone}`, className].filter(Boolean).join(' ')} role="alert" {...rest}>
      <span className="sx-alert__icon">{icon !== undefined ? icon : ICONS[tone]}</span>
      <div className="sx-alert__body">
        {title && <div className="sx-alert__title">{title}</div>}
        {children && <div className="sx-alert__desc">{children}</div>}
        {actions && <div className="sx-alert__actions">{actions}</div>}
      </div>
      {onClose && (
        <button className="sx-alert__close" onClick={onClose} aria-label="Dismiss">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"><path d="M18 6 6 18M6 6l12 12"/></svg>
        </button>
      )}
    </div>
  );
}
