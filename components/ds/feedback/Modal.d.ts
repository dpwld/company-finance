import React from 'react';

/**
 * Centered dialog with backdrop. Controlled via `open`; `onClose` fires on the
 * close button, backdrop click (unless disabled), and Escape. Title/subtitle
 * header and a footer slot for actions.
 */
export interface ModalProps extends React.HTMLAttributes<HTMLDivElement> {
  open: boolean;
  onClose?: (() => void) | null;
  title?: React.ReactNode;
  subtitle?: React.ReactNode;
  size?: 'sm' | 'md' | 'lg' | 'xl';
  /** Footer node, typically action buttons. */
  footer?: React.ReactNode;
  closeOnBackdrop?: boolean;
  children?: React.ReactNode;
}
export function Modal(props: ModalProps): JSX.Element | null;
