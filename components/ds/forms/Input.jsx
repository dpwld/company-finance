'use client';
import React from 'react';

/* Finance Input — single-line text field with optional affixes and icon. */

const CSS = `
.sx-field {
  display: inline-flex;
  align-items: center;
  width: 100%;
  height: var(--control-md);
  background: var(--surface-card);
  border: 1px solid var(--border-default);
  border-radius: var(--radius-md);
  font-family: var(--font-sans);
  font-size: var(--text-md);
  color: var(--text-strong);
  transition: border-color var(--dur-fast) var(--ease-out), box-shadow var(--dur-fast) var(--ease-out);
  overflow: hidden;
}
.sx-field:hover { border-color: var(--border-strong); }
.sx-field--focus { border-color: var(--color-primary); box-shadow: var(--ring-focus); }
.sx-field--sm { height: var(--control-sm); font-size: var(--text-sm); }
.sx-field--lg { height: var(--control-lg); }
.sx-field--error { border-color: var(--red-500); }
.sx-field--error.sx-field--focus { box-shadow: 0 0 0 3px var(--status-danger-bg); }
.sx-field--disabled { background: var(--surface-sunken); color: var(--text-subtle); cursor: not-allowed; }
.sx-field__input {
  flex: 1; min-width: 0;
  height: 100%;
  border: none; outline: none; background: transparent;
  font: inherit; color: inherit;
  padding: 0 12px;
}
.sx-field__input::placeholder { color: var(--text-subtle); }
.sx-field__input:disabled { cursor: not-allowed; }
.sx-field--mono .sx-field__input { font-family: var(--font-mono); font-variant-numeric: tabular-nums; }
.sx-field__affix {
  display: inline-flex; align-items: center; gap: 6px;
  padding: 0 12px; height: 100%;
  color: var(--text-muted); font-size: var(--text-sm);
  white-space: nowrap; flex-shrink: 0;
}
.sx-field__affix--start { padding-right: 0; }
.sx-field__affix--end { padding-left: 0; }
.sx-field__affix--divided.sx-field__affix--end { border-left: 1px solid var(--border-subtle); background: var(--surface-sunken); padding-left: 12px; }
.sx-field__icon { display:inline-flex; color: var(--text-muted); }
.sx-field__icon svg { width: 16px; height: 16px; }
`;

let _injected = false;
function inject() {
  if (_injected || typeof document === 'undefined') return;
  _injected = true;
  const s = document.createElement('style');
  s.setAttribute('data-sx', 'input');
  s.textContent = CSS;
  document.head.appendChild(s);
}

export function Input({
  size = 'md',
  error = false,
  disabled = false,
  mono = false,
  icon = null,
  prefix = null,
  suffix = null,
  suffixDivided = false,
  className = '',
  onFocus,
  onBlur,
  ...rest
}) {
  inject();
  const [focused, setFocused] = React.useState(false);
  const cls = [
    'sx-field',
    size !== 'md' ? `sx-field--${size}` : '',
    error ? 'sx-field--error' : '',
    disabled ? 'sx-field--disabled' : '',
    focused ? 'sx-field--focus' : '',
    mono ? 'sx-field--mono' : '',
    className,
  ].filter(Boolean).join(' ');
  return (
    <div className={cls}>
      {prefix && <span className="sx-field__affix sx-field__affix--start">{prefix}</span>}
      {icon && <span className="sx-field__icon" style={{ paddingLeft: 12 }}>{icon}</span>}
      <input
        className="sx-field__input"
        disabled={disabled}
        onFocus={(e) => { setFocused(true); onFocus && onFocus(e); }}
        onBlur={(e) => { setFocused(false); onBlur && onBlur(e); }}
        {...rest}
      />
      {suffix && (
        <span className={`sx-field__affix sx-field__affix--end${suffixDivided ? ' sx-field__affix--divided' : ''}`}>
          {suffix}
        </span>
      )}
    </div>
  );
}
