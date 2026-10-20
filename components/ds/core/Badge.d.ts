import React from 'react';

export type BadgeTone = 'success' | 'warning' | 'danger' | 'info' | 'neutral';
export type BadgeVariant = 'soft' | 'solid' | 'outline';

/**
 * Compact status / category label. Tone carries meaning (success, warning,
 * danger, info, neutral); variant sets weight (soft tint, solid fill, outline).
 * Use the `dot` form for live workflow statuses in tables.
 *
 * @startingPoint section="Core" subtitle="Status tags & badges" viewport="700x540"
 */
export interface BadgeProps extends React.HTMLAttributes<HTMLSpanElement> {
  /** Semantic tone. @default 'neutral' */
  tone?: BadgeTone;
  /** Visual weight. @default 'soft' */
  variant?: BadgeVariant;
  /** Size. @default 'md' */
  size?: 'sm' | 'md';
  /** Fully rounded pill shape. */
  pill?: boolean;
  /** Show a leading status dot. */
  dot?: boolean;
  /** Optional leading icon node. */
  icon?: React.ReactNode;
  children?: React.ReactNode;
}

export function Badge(props: BadgeProps): JSX.Element;
