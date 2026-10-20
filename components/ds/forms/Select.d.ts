import React from 'react';

export interface SelectOption { value: string; label: string; }

/**
 * Dropdown select styled to match Input. Pass `options` (string[] or
 * {value,label}[]) or native <option> children. Supports placeholder, error,
 * and disabled states.
 */
export interface SelectProps extends Omit<React.SelectHTMLAttributes<HTMLSelectElement>, 'size'> {
  size?: 'sm' | 'md' | 'lg';
  error?: boolean;
  placeholder?: string | null;
  options?: Array<string | SelectOption> | null;
}
export function Select(props: SelectProps): JSX.Element;
