'use client';
import React from 'react';

/* Finance Card — surface container with optional header/footer.
   Exports: Card, CardHeader, CardBody, CardFooter. */

const CSS = `
.sx-card {
  background: var(--surface-card);
  border: 1px solid var(--border-subtle);
  border-radius: var(--radius-lg);
  box-shadow: var(--shadow-sm);
  overflow: hidden;
  font-family: var(--font-sans);
}
.sx-card--flat { box-shadow: none; }
.sx-card--elevated { box-shadow: var(--shadow-md); border-color: transparent; }
.sx-card--interactive { cursor: pointer; transition: box-shadow var(--dur-base) var(--ease-out), border-color var(--dur-base) var(--ease-out), transform var(--dur-base) var(--ease-out); }
.sx-card--interactive:hover { box-shadow: var(--shadow-md); border-color: var(--border-default); }
.sx-card--interactive:active { transform: translateY(1px); }
.sx-card--interactive:focus-visible { outline: none; box-shadow: var(--ring-focus); }

.sx-card__header { display: flex; align-items: flex-start; gap: 12px; padding: 16px 18px; border-bottom: 1px solid var(--border-subtle); }
.sx-card__header--plain { border-bottom: none; padding-bottom: 0; }
.sx-card__htext { flex: 1; min-width: 0; display: flex; flex-direction: column; gap: 2px; }
.sx-card__title { font-size: var(--text-lg); font-weight: var(--weight-semibold); color: var(--text-strong); letter-spacing: var(--tracking-snug); line-height: 1.3; }
.sx-card__subtitle { font-size: var(--text-sm); color: var(--text-muted); line-height: 1.4; }
.sx-card__actions { display: inline-flex; align-items: center; gap: 8px; flex-shrink: 0; }
.sx-card__body { padding: 18px; }
.sx-card__footer { display: flex; align-items: center; gap: 10px; padding: 14px 18px; border-top: 1px solid var(--border-subtle); background: var(--surface-sunken); }
`;

let _injected = false;
function inject() {
  if (_injected || typeof document === 'undefined') return;
  _injected = true;
  const s = document.createElement('style');
  s.setAttribute('data-sx', 'card');
  s.textContent = CSS;
  document.head.appendChild(s);
}

export function Card({ variant = 'default', interactive = false, className = '', children, ...rest }) {
  inject();
  const cls = [
    'sx-card',
    variant !== 'default' ? `sx-card--${variant}` : '',
    interactive ? 'sx-card--interactive' : '',
    className,
  ].filter(Boolean).join(' ');
  // Interactive cards are real click targets — make them keyboard-reachable.
  const a11y = interactive && rest.onClick
    ? {
        role: 'button',
        tabIndex: 0,
        onKeyDown: (e) => {
          if ((e.key === 'Enter' || e.key === ' ') && e.target === e.currentTarget) {
            e.preventDefault();
            rest.onClick(e);
          }
          if (rest.onKeyDown) rest.onKeyDown(e);
        },
      }
    : {};
  return <div className={cls} {...rest} {...a11y}>{children}</div>;
}

export function CardHeader({ title, subtitle, actions = null, plain = false, className = '', children, ...rest }) {
  inject();
  return (
    <div className={['sx-card__header', plain ? 'sx-card__header--plain' : '', className].filter(Boolean).join(' ')} {...rest}>
      {(title || subtitle) && (
        <div className="sx-card__htext">
          {title && <div className="sx-card__title">{title}</div>}
          {subtitle && <div className="sx-card__subtitle">{subtitle}</div>}
        </div>
      )}
      {children}
      {actions && <div className="sx-card__actions">{actions}</div>}
    </div>
  );
}

export function CardBody({ className = '', children, ...rest }) {
  inject();
  return <div className={['sx-card__body', className].filter(Boolean).join(' ')} {...rest}>{children}</div>;
}

export function CardFooter({ className = '', children, ...rest }) {
  inject();
  return <div className={['sx-card__footer', className].filter(Boolean).join(' ')} {...rest}>{children}</div>;
}
