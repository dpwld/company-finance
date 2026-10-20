'use client';
import React from 'react';

/* Finance Button — primary action component.
   Self-contained: styling via design-system CSS custom properties. */

const CSS = `
.sx-btn {
  --_h: var(--control-md);
  --_px: 16px;
  --_fs: var(--text-md);
  --_gap: 6px;
  font-family: var(--font-sans);
  font-weight: var(--weight-semibold);
  font-size: var(--_fs);
  line-height: 1;
  height: var(--_h);
  padding: 0 var(--_px);
  display: inline-flex;
  align-items: center;
  justify-content: center;
  gap: var(--_gap);
  border-radius: var(--radius-md);
  border: 1px solid transparent;
  cursor: pointer;
  white-space: nowrap;
  user-select: none;
  letter-spacing: var(--tracking-snug);
  transition: background var(--dur-fast) var(--ease-out),
              border-color var(--dur-fast) var(--ease-out),
              color var(--dur-fast) var(--ease-out),
              box-shadow var(--dur-fast) var(--ease-out),
              transform var(--dur-fast) var(--ease-out);
}
.sx-btn:active:not(:disabled) { transform: scale(0.98); }
@media (prefers-reduced-motion: reduce) { .sx-btn:active:not(:disabled) { transform: none; } }
.sx-btn:focus-visible { outline: none; box-shadow: var(--ring-focus); }
.sx-btn[disabled] { opacity: 0.45; cursor: not-allowed; pointer-events: none; }
.sx-btn svg { width: 1em; height: 1em; flex-shrink: 0; }
.sx-btn--sm { --_h: var(--control-sm); --_px: 12px; --_fs: var(--text-sm); --_gap: 5px; }
.sx-btn--lg { --_h: var(--control-lg); --_px: 22px; --_fs: var(--text-lg); --_gap: 8px; }
.sx-btn--block { width: 100%; }
.sx-btn--icon { padding: 0; width: var(--_h); }

/* primary */
.sx-btn--primary { background: var(--color-primary); color: var(--on-primary); }
.sx-btn--primary:hover { background: var(--color-primary-hover); }
.sx-btn--primary:active { background: var(--color-primary-active); }

/* secondary (outline) */
.sx-btn--secondary { background: var(--surface-card); color: var(--text-strong); border-color: var(--border-default); }
.sx-btn--secondary:hover { background: var(--surface-hover); border-color: var(--border-strong); }
.sx-btn--secondary:active { background: var(--surface-active); }

/* soft */
.sx-btn--soft { background: var(--color-primary-soft); color: var(--color-primary-soft-text); }
.sx-btn--soft:hover { background: var(--color-primary-soft-hover); }

/* ghost */
.sx-btn--ghost { background: transparent; color: var(--text-default); }
.sx-btn--ghost:hover { background: var(--surface-hover); }
.sx-btn--ghost:active { background: var(--surface-active); }

/* danger */
.sx-btn--danger { background: var(--red-500); color: #ffffff; }
.sx-btn--danger:hover { background: var(--red-600); }
.sx-btn--danger:active { background: var(--red-700); }

.sx-btn__spin {
  width: 1em; height: 1em; border-radius: 50%;
  border: 2px solid currentColor; border-right-color: transparent;
  animation: sx-btn-spin 0.6s linear infinite;
}
@keyframes sx-btn-spin { to { transform: rotate(360deg); } }
`;

let _injected = false;
function inject() {
  if (_injected || typeof document === 'undefined') return;
  _injected = true;
  const s = document.createElement('style');
  s.setAttribute('data-sx', 'button');
  s.textContent = CSS;
  document.head.appendChild(s);
}

export function Button({
  variant = 'primary',
  size = 'md',
  iconOnly = false,
  block = false,
  loading = false,
  leftIcon = null,
  rightIcon = null,
  disabled = false,
  className = '',
  children,
  ...rest
}) {
  inject();
  const cls = [
    'sx-btn',
    `sx-btn--${variant}`,
    size !== 'md' ? `sx-btn--${size}` : '',
    iconOnly ? 'sx-btn--icon' : '',
    block ? 'sx-btn--block' : '',
    className,
  ].filter(Boolean).join(' ');

  // 아이콘만 있는 버튼은 마우스를 올려도 무엇인지 알 수 없었다 — aria-label을 툴팁으로 (2026-10-15 UX QA).
  const title = rest.title ?? (iconOnly ? rest['aria-label'] : undefined);

  return (
    <button className={cls} disabled={disabled || loading} {...rest} title={title}>
      {loading && <span className="sx-btn__spin" aria-hidden="true" />}
      {!loading && leftIcon}
      {!iconOnly && children}
      {iconOnly && !loading && !leftIcon ? children : null}
      {!loading && rightIcon}
    </button>
  );
}
