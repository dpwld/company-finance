'use client';
import React from 'react';

/* Finance Select — native-backed dropdown styled to match Input. */

const CSS = `
.sx-select {
  position: relative;
  display: inline-flex;
  align-items: center;
  width: 100%;
  height: var(--control-md);
  background: var(--surface-card);
  border: 1px solid var(--border-default);
  border-radius: var(--radius-md);
  transition: border-color var(--dur-fast) var(--ease-out), box-shadow var(--dur-fast) var(--ease-out);
}
.sx-select:hover { border-color: var(--border-strong); }
.sx-select--sm { height: var(--control-sm); }
.sx-select--lg { height: var(--control-lg); }
.sx-select--error { border-color: var(--red-500); }
.sx-select--disabled { background: var(--surface-sunken); }
.sx-select__el {
  appearance: none; -webkit-appearance: none;
  width: 100%; height: 100%;
  border: none; outline: none; background: transparent;
  font-family: var(--font-sans); font-size: var(--text-md);
  color: var(--text-strong);
  padding: 0 36px 0 12px;
  cursor: pointer; border-radius: inherit;
}
.sx-select--sm .sx-select__el { font-size: var(--text-sm); }
.sx-select__el:focus-visible { box-shadow: var(--ring-focus); border-radius: var(--radius-md); }
.sx-select__el:disabled { cursor: not-allowed; color: var(--text-subtle); }
.sx-select__el.is-placeholder { color: var(--text-subtle); }
.sx-select__chev {
  position: absolute; right: 10px; top: 50%; transform: translateY(-50%);
  pointer-events: none; color: var(--text-muted); display: inline-flex;
}
.sx-select__chev svg { width: 16px; height: 16px; }
`;

let _injected = false;
function inject() {
  if (_injected || typeof document === 'undefined') return;
  _injected = true;
  const s = document.createElement('style');
  s.setAttribute('data-sx', 'select');
  s.textContent = CSS;
  document.head.appendChild(s);
}

export function Select({
  size = 'md',
  error = false,
  disabled = false,
  placeholder = null,
  options = null,
  value,
  defaultValue,
  className = '',
  style,
  children,
  ...rest
}) {
  inject();
  const cls = [
    'sx-select',
    size !== 'md' ? `sx-select--${size}` : '',
    error ? 'sx-select--error' : '',
    disabled ? 'sx-select--disabled' : '',
    className,
  ].filter(Boolean).join(' ');
  const isPlaceholder = placeholder && (value === '' || value == null) &&
    (defaultValue === undefined || defaultValue === '');
  // Width/sizing styles belong on the WRAPPER — the native <select> fills it
  // 100%. Putting them on the <select> instead shrinks the actual click target
  // to the left of the box, so the chevron area stops opening the dropdown.
  return (
    <div className={cls} style={style}>
      <select
        className={`sx-select__el${isPlaceholder ? ' is-placeholder' : ''}`}
        disabled={disabled}
        value={value}
        defaultValue={defaultValue}
        {...rest}
      >
        {placeholder && <option value="" disabled>{placeholder}</option>}
        {options
          ? options.map((o) => {
              const opt = typeof o === 'string' ? { value: o, label: o } : o;
              return <option key={opt.value} value={opt.value}>{opt.label}</option>;
            })
          : children}
      </select>
      <span className="sx-select__chev" aria-hidden="true">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="m6 9 6 6 6-6"/></svg>
      </span>
    </div>
  );
}
