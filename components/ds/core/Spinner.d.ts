import React from 'react';

/** Indeterminate loading spinner. Sizes sm/md/lg; `onPrimary` for use on filled buttons/dark surfaces. */
export interface SpinnerProps extends React.HTMLAttributes<HTMLSpanElement> {
  size?: 'sm' | 'md' | 'lg';
  onPrimary?: boolean;
}
export function Spinner(props: SpinnerProps): JSX.Element;
