import React from 'react';

/** Zero-data / empty-result placeholder with icon, title, description, and optional actions. */
export interface EmptyStateProps extends React.HTMLAttributes<HTMLDivElement> {
  icon?: React.ReactNode;
  title: React.ReactNode;
  description?: React.ReactNode;
  actions?: React.ReactNode;
}
export function EmptyState(props: EmptyStateProps): JSX.Element;
