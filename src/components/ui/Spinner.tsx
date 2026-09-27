import type { SVGAttributes } from 'react';

export interface SpinnerProps extends SVGAttributes<SVGSVGElement> {
  size?: number;
}

export function Spinner({ size = 20, className = '', ...rest }: SpinnerProps) {
  return (
    <svg
      role="status"
      aria-label="Carregando"
      viewBox="0 0 24 24"
      width={size}
      height={size}
      className={`inline-block animate-spin ${className}`}
      {...rest}
    >
      <circle cx="12" cy="12" r="10" fill="none" stroke="currentColor" strokeWidth="3" strokeOpacity="0.25" />
      <path d="M12 2a10 10 0 0 1 10 10" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" />
    </svg>
  );
}
