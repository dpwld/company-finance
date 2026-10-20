'use client';
import React from 'react';

/* Finance Tabs — underline tab bar for view switching. */

const CSS = `
.sx-tabs { display: flex; align-items: center; gap: 2px; border-bottom: 1px solid var(--border-subtle); font-family: var(--font-sans); }
.sx-tabs--enclosed { gap: 4px; border-bottom: none; background: var(--surface-sunken); padding: 4px; border-radius: var(--radius-md); display: inline-flex; }
.sx-tab {
  position: relative;
  display: inline-flex; align-items: center; gap: 7px;
  height: 38px; padding: 0 12px;
  font-size: var(--text-md); font-weight: var(--weight-medium);
  color: var(--text-muted); cursor: pointer; user-select: none;
  border: none; background: none;
  transition: color var(--dur-fast) var(--ease-out), background-color var(--dur-base) var(--ease-out), box-shadow var(--dur-base) var(--ease-out);
  white-space: nowrap;
}
.sx-tab:hover { color: var(--text-default); }
.sx-tab:focus-visible { outline: none; box-shadow: var(--ring-focus); border-radius: var(--radius-sm); }
.sx-tab--active { color: var(--color-primary); font-weight: var(--weight-semibold); }
.sx-tab__underline { position: absolute; left: 8px; right: 8px; bottom: -1px; height: 2px; background: var(--color-primary); border-radius: 2px; animation: sx-tab-underline 220ms cubic-bezier(0.2, 0.8, 0.3, 1); }
@keyframes sx-tab-underline { from { transform: scaleX(0.3); opacity: 0; } to { transform: none; opacity: 1; } }
@media (prefers-reduced-motion: reduce) { .sx-tab__underline { animation: none; } }
.sx-tab__count { font-size: var(--text-xs); font-weight: var(--weight-semibold); font-variant-numeric: tabular-nums; background: var(--surface-active); color: var(--text-muted); border-radius: var(--radius-pill); padding: 1px 6px; }
.sx-tab--active .sx-tab__count { background: var(--blue-100); color: var(--blue-700); }
.sx-tab svg { width: 16px; height: 16px; }

/* enclosed (segmented) */
.sx-tabs--enclosed .sx-tab { height: 30px; border-radius: var(--radius-sm); color: var(--text-muted); }
.sx-tabs--enclosed .sx-tab:hover { color: var(--text-default); }
.sx-tab:focus-visible { outline: none; box-shadow: var(--ring-focus); border-radius: var(--radius-sm); }
.sx-tabs--enclosed .sx-tab--active { background: var(--surface-card); color: var(--text-strong); box-shadow: var(--shadow-xs); font-weight: var(--weight-semibold); }
.sx-tabs--enclosed .sx-tab__underline { display: none; }
`;

let _injected = false;
function inject() {
  if (_injected || typeof document === 'undefined') return;
  _injected = true;
  const s = document.createElement('style');
  s.setAttribute('data-sx', 'tabs');
  s.textContent = CSS;
  document.head.appendChild(s);
}

export function Tabs({ items = [], value, onChange, variant = 'underline', className = '', ...rest }) {
  inject();
  const active = value != null ? value : items[0]?.value;
  return (
    <div className={['sx-tabs', variant === 'enclosed' ? 'sx-tabs--enclosed' : '', className].filter(Boolean).join(' ')} role="tablist" {...rest}>
      {items.map((it) => {
        const isActive = it.value === active;
        return (
          <button
            key={it.value}
            role="tab"
            aria-selected={isActive}
            className={['sx-tab', isActive ? 'sx-tab--active' : ''].filter(Boolean).join(' ')}
            onClick={() => onChange && onChange(it.value)}
          >
            {it.icon}
            {it.label}
            {it.count != null && <span className="sx-tab__count">{it.count}</span>}
            {isActive && variant !== 'enclosed' && <span className="sx-tab__underline" />}
          </button>
        );
      })}
    </div>
  );
}
