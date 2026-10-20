import React from 'react';

/**
 * Single-line text input with optional leading icon, prefix/suffix affixes,
 * error state, and a `mono` mode for part numbers / spec values. Wrap with
 * FormField for label, hint and error message.
 *
 * @startingPoint section="Forms" subtitle="Text inputs & affixes" viewport="700x560"
 */
export interface InputProps extends Omit<React.InputHTMLAttributes<HTMLInputElement>, 'prefix' | 'size'> {
  size?: 'sm' | 'md' | 'lg';
  error?: boolean;
  /** Tabular monospace — use for IDs, part numbers, dimensions. */
  mono?: boolean;
  /** Leading icon node. */
  icon?: React.ReactNode;
  /** Leading affix (e.g. "$", "Qty"). */
  prefix?: React.ReactNode;
  /** Trailing affix (e.g. "mm", "kPa"). */
  suffix?: React.ReactNode;
  /** Render the suffix on a divided, shaded panel. */
  suffixDivided?: boolean;
}
export function Input(props: InputProps): JSX.Element;
