'use client';
import React from 'react';

/* Finance Spinner — indeterminate loading indicator. */

const CSS = `
.sx-spinner {
  display: inline-block;
  width: 20px; height: 20px;
  border-radius: 50%;
  border: 2.5px solid var(--gray-200);
  border-top-color: var(--color-primary);
  animation: sx-spinner-rot 0.65s linear infinite;
}
.sx-spinner--sm { width: 14px; height: 14px; border-width: 2px; }
.sx-spinner--lg { width: 28px; height: 28px; border-width: 3px; }
.sx-spinner--on-primary { border-color: rgba(255,255,255,0.35); border-top-color: #ffffff; }
@keyframes sx-spinner-rot { to { transform: rotate(360deg); } }
`;

let _injected = false;
function inject() {
  if (_injected || typeof document === 'undefined') return;
  _injected = true;
  const s = document.createElement('style');
  s.setAttribute('data-sx', 'spinner');
  s.textContent = CSS;
  document.head.appendChild(s);
}

export function Spinner({ size = 'md', onPrimary = false, className = '', ...rest }) {
  inject();
  const cls = [
    'sx-spinner',
    size !== 'md' ? `sx-spinner--${size}` : '',
    onPrimary ? 'sx-spinner--on-primary' : '',
    className,
  ].filter(Boolean).join(' ');
  return <span className={cls} role="status" aria-label="Loading" {...rest} />;
}
