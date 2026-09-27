import type { HTMLAttributes, ReactNode } from 'react';

export interface CardProps extends HTMLAttributes<HTMLDivElement> {
  children: ReactNode;
}

export function Card({ className = '', children, ...rest }: CardProps) {
  return (
    <div className={`rounded-xl border border-border bg-surface p-4 sm:p-6 ${className}`} {...rest}>
      {children}
    </div>
  );
}
