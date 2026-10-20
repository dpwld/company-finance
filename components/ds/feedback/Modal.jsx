'use client';
import React from 'react';
import { leaveGhost } from './leaveGhost';

/* Finance Modal — centered dialog with backdrop. Controlled via `open`. */

const CSS = `
.sx-modal__backdrop {
  position: fixed; inset: 0; z-index: 1000;
  background: rgba(24,24,27,0.45);
  backdrop-filter: blur(1.5px);
  display: flex; align-items: center; justify-content: center;
  padding: 24px;
  animation: sx-modal-fade var(--dur-base) var(--ease-out);
}
@keyframes sx-modal-fade { from { opacity: 0; } to { opacity: 1; } }
.sx-modal {
  background: var(--surface-card);
  border-radius: var(--radius-lg);
  box-shadow: var(--shadow-xl);
  width: 100%; max-height: calc(100vh - 48px);
  display: flex; flex-direction: column;
  font-family: var(--font-sans);
  animation: sx-modal-pop var(--dur-base) var(--ease-out);
}
@keyframes sx-modal-pop { from { opacity: 0; transform: translateY(8px) scale(0.98); } to { opacity: 1; transform: none; } }
.sx-modal__backdrop.is-leaving { animation: sx-modal-fade-out 160ms ease-in forwards; }
.sx-modal__backdrop.is-leaving .sx-modal { animation: sx-modal-leave 160ms ease-in forwards; }
@keyframes sx-modal-fade-out { to { opacity: 0; } }
@keyframes sx-modal-leave { to { opacity: 0; transform: translateY(6px) scale(0.98); } }
.sx-modal--sm { max-width: 400px; }
.sx-modal--md { max-width: 540px; }
.sx-modal--lg { max-width: 720px; }
.sx-modal--xl { max-width: 960px; }
.sx-modal__header { display: flex; align-items: flex-start; gap: 12px; padding: 18px 20px; border-bottom: 1px solid var(--border-subtle); }
.sx-modal__htext { flex: 1; min-width: 0; display: flex; flex-direction: column; gap: 2px; }
.sx-modal__title { font-size: var(--text-xl); font-weight: var(--weight-semibold); color: var(--text-strong); letter-spacing: var(--tracking-snug); }
.sx-modal__subtitle { font-size: var(--text-sm); color: var(--text-muted); }
.sx-modal__close { flex-shrink: 0; width: 30px; height: 30px; display: inline-flex; align-items: center; justify-content: center; border-radius: var(--radius-md); color: var(--text-muted); cursor: pointer; background: none; border: none; transition: background var(--dur-fast), color var(--dur-fast); }
.sx-modal__close:hover { background: var(--surface-hover); color: var(--text-strong); }
.sx-modal__close svg { width: 18px; height: 18px; }
.sx-modal__body { padding: 20px; overflow-y: auto; flex: 1; color: var(--text-default); font-size: var(--text-md); line-height: 1.55; }
.sx-modal__footer { display: flex; align-items: center; justify-content: flex-end; gap: 10px; padding: 16px 20px; border-top: 1px solid var(--border-subtle); background: var(--surface-sunken); border-radius: 0 0 var(--radius-lg) var(--radius-lg); }
`;

let _injected = false;
const openDialogs = [];
const FOCUSABLE = 'a[href], button, input, select, textarea, [tabindex], [contenteditable="true"], iframe, summary, audio[controls], video[controls]';
const EDITABLE = 'input:not([type="hidden"]), select, textarea, [contenteditable="true"]';

function focusableWithin(root) {
  return [...root.querySelectorAll(FOCUSABLE)].filter((element) =>
    element.tabIndex >= 0 && !element.matches(':disabled') &&
    !element.closest('[inert]') && element.getClientRects().length > 0 &&
    element.ownerDocument.defaultView.getComputedStyle(element).visibility !== 'hidden'
  );
}

function initialFocus(dialog) {
  const controls = focusableWithin(dialog);
  return controls.find((element) => element.matches(EDITABLE)) ??
    controls.find((element) => element.classList.contains('sx-modal__close')) ?? dialog;
}

function activateModal(dialog, onClose, returnFocus) {
  const doc = dialog.ownerDocument;
  const entry = { dialog, returnFocus, lastFocus: null };
  // Child layout effects run first when nested dialogs mount together.
  const childIndex = openDialogs.findIndex((item) => dialog.contains(item.dialog));
  openDialogs.splice(childIndex < 0 ? openDialogs.length : childIndex, 0, entry);
  openDialogs.forEach((item, index) => { item.dialog.parentElement.style.zIndex = String(1000 + index); });
  const top = () => openDialogs.filter((item) => item.dialog.ownerDocument === doc).at(-1);
  const frameDocuments = new Map();

  function focus(element, backwards = false) {
    if (element.tagName === 'IFRAME') {
      try {
        const controls = element.contentDocument && focusableWithin(element.contentDocument);
        const target = backwards ? controls?.at(-1) : controls?.[0];
        if (target) { target.focus(); return; }
      } catch { /* Cross-origin previews keep their native iframe focus. */ }
    }
    element.focus({ preventScroll: true });
  }

  function onKey(event, frame = null) {
    if (top() !== entry || event.defaultPrevented || event.isComposing) return;
    if (event.key === 'Escape') {
      event.preventDefault();
      event.stopImmediatePropagation();
      if (!event.repeat) onClose();
      return;
    }
    if (event.key !== 'Tab') return;
    const controls = focusableWithin(dialog);
    const active = doc.activeElement;
    let target;
    if (frame) {
      const inner = focusableWithin(frame.contentDocument);
      const innerActive = frame.contentDocument.activeElement;
      // Let the browser traverse controls within a same-origin preview normally.
      if (inner.length && (event.shiftKey ? innerActive !== inner[0] : innerActive !== inner.at(-1)) && inner.includes(innerActive)) return;
      if (inner.length && !event.shiftKey && !inner.includes(innerActive)) return;
      const index = controls.indexOf(frame);
      target = controls[(index + (event.shiftKey ? -1 : 1) + controls.length) % controls.length];
    } else if (!controls.length || !controls.includes(active)) {
      target = event.shiftKey ? controls.at(-1) : controls[0];
    } else if (event.shiftKey && active === controls[0]) {
      target = controls.at(-1);
    } else if (!event.shiftKey && active === controls.at(-1)) {
      target = controls[0];
    } else return;
    event.preventDefault();
    focus(target ?? dialog, event.shiftKey);
  }

  function onFocus(event) {
    if (top() !== entry) return;
    if (dialog.contains(event.target)) entry.lastFocus = event.target;
    else focus(entry.lastFocus?.isConnected ? entry.lastFocus : initialFocus(dialog));
  }

  function connectFrame(frame) {
    if (frame.tagName !== 'IFRAME') return;
    const previous = frameDocuments.get(frame);
    previous?.doc.removeEventListener('keydown', previous.listener);
    try {
      const frameDoc = frame.contentDocument;
      if (!frameDoc) return;
      const listener = (event) => onKey(event, frame);
      frameDoc.addEventListener('keydown', listener);
      frameDocuments.set(frame, { doc: frameDoc, listener });
    } catch { /* Cross-origin previews do not expose their keyboard events. */ }
  }
  const onLoad = (event) => connectFrame(event.target);
  dialog.querySelectorAll('iframe').forEach(connectFrame);
  dialog.addEventListener('load', onLoad, true);
  doc.addEventListener('keydown', onKey);
  doc.addEventListener('focusin', onFocus);
  if (top() === entry) {
    const active = doc.activeElement;
    focus(dialog.contains(active) && active.matches(EDITABLE) ? active : initialFocus(dialog));
  }

  return () => {
    const wasTop = top() === entry;
    openDialogs.splice(openDialogs.indexOf(entry), 1);
    doc.removeEventListener('keydown', onKey);
    doc.removeEventListener('focusin', onFocus);
    dialog.removeEventListener('load', onLoad, true);
    frameDocuments.forEach(({ doc: frameDoc, listener }) => frameDoc.removeEventListener('keydown', listener));
    // If an entire nested flow closes, preserve the original page opener.
    openDialogs.forEach((item) => {
      if (dialog.contains(item.returnFocus)) item.returnFocus = entry.returnFocus;
    });
    if (!wasTop) return;
    const next = top();
    if (entry.returnFocus?.isConnected && (!next || next.dialog.contains(entry.returnFocus))) focus(entry.returnFocus);
    else if (next) focus(initialFocus(next.dialog));
  };
}

function inject() {
  if (_injected || typeof document === 'undefined') return;
  _injected = true;
  const s = document.createElement('style');
  s.setAttribute('data-sx', 'modal');
  s.textContent = CSS;
  document.head.appendChild(s);
}

export function Modal({ open = false, onClose = null, title = null, subtitle = null, size = 'md', footer = null, closeOnBackdrop = true, className = '', children, onFocusCapture, ...rest }) {
  inject();
  const dialogRef = React.useRef(null);
  const returnFocusRef = React.useRef(null);
  const close = React.useEffectEvent(() => onClose?.());
  React.useLayoutEffect(() => {
    if (!open) return;
    const dialog = dialogRef.current;
    const backdrop = dialog.parentElement;
    const cleanup = activateModal(dialog, close, returnFocusRef.current ?? dialog.ownerDocument.activeElement);
    return () => { cleanup(); returnFocusRef.current = null; leaveGhost(backdrop, 'is-leaving', 160); };
  }, [open]);
  if (!open) return null;
  return (
    <div className="sx-modal__backdrop" onClick={closeOnBackdrop && onClose ? () => onClose() : undefined}>
      <div className={['sx-modal', `sx-modal--${size}`, className].filter(Boolean).join(' ')} role="dialog" aria-modal="true" aria-label={typeof title === 'string' ? title : undefined} onClick={(e) => e.stopPropagation()} tabIndex={-1} {...rest} ref={dialogRef}
        onFocusCapture={(event) => {
          // React autoFocus runs before our layout effect: retain its relatedTarget.
          if (!openDialogs.some((item) => item.dialog === event.currentTarget) && event.relatedTarget && !event.currentTarget.contains(event.relatedTarget)) returnFocusRef.current = event.relatedTarget;
          onFocusCapture?.(event);
        }}>
        {(title || onClose) && (
          <div className="sx-modal__header">
            <div className="sx-modal__htext">
              {title && <div className="sx-modal__title">{title}</div>}
              {subtitle && <div className="sx-modal__subtitle">{subtitle}</div>}
            </div>
            {onClose && (
              <button type="button" className="sx-modal__close" onClick={onClose} aria-label="Close">
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"><path d="M18 6 6 18M6 6l12 12"/></svg>
              </button>
            )}
          </div>
        )}
        <div className="sx-modal__body sx-scroll">{children}</div>
        {footer && <div className="sx-modal__footer">{footer}</div>}
      </div>
    </div>
  );
}
