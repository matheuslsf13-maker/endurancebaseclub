export interface LogoProps {
  size?: number;
  className?: string;
}

export function Logo({ size = 32, className = '' }: LogoProps) {
  return (
    <img
      src="/logo.png"
      alt="EnduranceBaseClub"
      width={size}
      height={size}
      className={`shrink-0 rounded-full ${className}`}
    />
  );
}
