import React from 'react';

export interface TabItem {
  value: string;
  label: React.ReactNode;
  icon?: React.ReactNode;
  count?: number | string;
}

/**
 * Tab bar for switching views. `underline` (default, page-level) or `enclosed`
 * (segmented, inline) variants. Controlled via `value` + `onChange`.
 */
export interface TabsProps extends Omit<React.HTMLAttributes<HTMLDivElement>, 'onChange'> {
  items: TabItem[];
  value?: string;
  onChange?: (value: string) => void;
  variant?: 'underline' | 'enclosed';
}
export function Tabs(props: TabsProps): JSX.Element;
