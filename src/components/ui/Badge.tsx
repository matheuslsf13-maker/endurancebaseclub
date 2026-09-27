import type { ReactNode } from 'react';

export type BadgeTone = 'neutral' | 'success' | 'warning' | 'danger' | 'info';

export interface BadgeProps {
  tone?: BadgeTone;
  children: ReactNode;
}

// C-Minor-11: warning/danger/info use the brand-derived "-text" tint (index.css) for the text
// colour — the plain swatch fails WCAG AA as text in one theme or the other. success already
// passes and keeps its original swatch.
const TONE_CLASSES: Record<BadgeTone, string> = {
  neutral: 'bg-surface-2 text-fg border-border',
  success: 'bg-success/15 text-success border-success/30',
  warning: 'bg-warning/15 text-warning-text border-warning/30',
  danger: 'bg-danger/15 text-danger-text border-danger/30',
  info: 'bg-info/15 text-info-text border-info/30',
};

export function Badge({ tone = 'neutral', children }: BadgeProps) {
  return (
    <span
      className={`inline-flex items-center gap-1 rounded-full border px-2.5 py-0.5 text-xs font-medium tabular ${TONE_CLASSES[tone]}`}
    >
      {children}
    </span>
  );
}
