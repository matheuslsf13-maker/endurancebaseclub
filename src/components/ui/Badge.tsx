import type { ReactNode } from 'react';

export type BadgeTone = 'neutral' | 'success' | 'warning' | 'danger' | 'info';

export interface BadgeProps {
  tone?: BadgeTone;
  children: ReactNode;
}

// C-Minor-11 / round 2 Badge-contrast grant: every tone but neutral uses the brand-derived
// "-text" tint (index.css) for the text colour — the plain swatch fails WCAG AA as text in at
// least one theme (success: light theme, ~3.5:1 on paper; warning/danger/info: as before).
const TONE_CLASSES: Record<BadgeTone, string> = {
  neutral: 'bg-surface-2 text-fg border-border',
  success: 'bg-success/15 text-success-text border-success/30',
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
