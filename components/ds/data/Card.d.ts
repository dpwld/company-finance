import React from 'react';

/**
 * Surface container. `Card` is the shell (default / flat / elevated, optional
 * interactive hover); compose with `CardHeader` (title, subtitle, actions),
 * `CardBody`, and `CardFooter`.
 */
export interface CardProps extends React.HTMLAttributes<HTMLDivElement> {
  variant?: 'default' | 'flat' | 'elevated';
  /** Adds hover/active affordance for clickable cards. */
  interactive?: boolean;
  children?: React.ReactNode;
}
export function Card(props: CardProps): JSX.Element;

export interface CardHeaderProps extends React.HTMLAttributes<HTMLDivElement> {
  title?: React.ReactNode;
  subtitle?: React.ReactNode;
  actions?: React.ReactNode;
  /** Remove the divider / bottom padding (header sits flush with body). */
  plain?: boolean;
}
export function CardHeader(props: CardHeaderProps): JSX.Element;
export function CardBody(props: React.HTMLAttributes<HTMLDivElement>): JSX.Element;
export function CardFooter(props: React.HTMLAttributes<HTMLDivElement>): JSX.Element;
