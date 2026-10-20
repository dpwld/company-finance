import React from 'react';

/**
 * Inline contextual banner. Tone sets color + default icon (info/success/
 * warning/danger/neutral). Optional title, description (children), action
 * buttons, and dismiss.
 */
export interface AlertProps extends React.HTMLAttributes<HTMLDivElement> {
  tone?: 'info' | 'success' | 'warning' | 'danger' | 'neutral';
  title?: React.ReactNode;
  /** Override the default tone icon; pass null to hide. */
  icon?: React.ReactNode;
  onClose?: (() => void) | null;
  actions?: React.ReactNode;
  children?: React.ReactNode;
}
export function Alert(props: AlertProps): JSX.Element;
