import React from 'react';

export type ButtonVariant = 'primary' | 'secondary' | 'soft' | 'ghost' | 'danger';
export type ButtonSize = 'sm' | 'md' | 'lg';

/**
 * Finance primary action button. Five variants, three sizes, icon-only and
 * loading states. Use `primary` for the single most important action per view;
 * `secondary` for neutral actions; `danger` for destructive ones.
 *
 * @startingPoint section="Core" subtitle="Buttons — 5 variants, 3 sizes" viewport="700x540"
 */
export interface ButtonProps extends React.ButtonHTMLAttributes<HTMLButtonElement> {
  /** Visual style. @default 'primary' */
  variant?: ButtonVariant;
  /** Size. @default 'md' */
  size?: ButtonSize;
  /** Render as a square icon button (children should be a single icon). */
  iconOnly?: boolean;
  /** Stretch to full container width. */
  block?: boolean;
  /** Show a spinner and disable interaction. */
  loading?: boolean;
  /** Icon node rendered before the label. */
  leftIcon?: React.ReactNode;
  /** Icon node rendered after the label. */
  rightIcon?: React.ReactNode;
  children?: React.ReactNode;
}

export function Button(props: ButtonProps): JSX.Element;
