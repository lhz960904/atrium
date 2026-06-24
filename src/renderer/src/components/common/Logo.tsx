import { useId } from 'react';

/*
 * Atrium brand mark. The A-monogram is inherited verbatim from code-artisan
 * (same author's tool family) with the legs widened for a sturdier stance —
 * pink beam #FFC6C6 and cyan spark #C3FAF5 are kept to preserve that lineage.
 * `mono` collapses it to a single currentColor tile (A knocked out via mask)
 * for tight, theme-following placements like the titlebar.
 */

interface LogoProps {
  className?: string;
  variant?: 'color' | 'mono';
}

const A_PATH = 'M23 74 L42 22 H54 L73 74 H63 L58 60 H38 L33 74 Z M41.4 51 H54.6 L48 32.5 Z';

export function Logo({ className, variant = 'color' }: LogoProps): React.JSX.Element {
  const id = useId();

  if (variant === 'mono') {
    const maskId = `atrium-mono-${id}`;
    return (
      <svg width="24" height="24" viewBox="0 0 96 96" fill="none" className={className} aria-hidden>
        <defs>
          <mask id={maskId}>
            <rect width="96" height="96" rx="22" fill="#fff" />
            <path d={A_PATH} fill="#000" />
          </mask>
        </defs>
        <rect width="96" height="96" rx="22" fill="currentColor" mask={`url(#${maskId})`} />
        <rect
          x="34"
          y="50"
          width="28"
          height="4.5"
          rx="2.25"
          transform="rotate(-22 48 52)"
          className="fill-accent"
        />
      </svg>
    );
  }

  const bgId = `atrium-bg-${id}`;
  const shineId = `atrium-shine-${id}`;
  return (
    <svg width="24" height="24" viewBox="0 0 96 96" fill="none" className={className} aria-hidden>
      <defs>
        <linearGradient id={bgId} x1="0" y1="0" x2="96" y2="96" gradientUnits="userSpaceOnUse">
          <stop offset="0%" stopColor="#8487FF" />
          <stop offset="100%" stopColor="#5457E8" />
        </linearGradient>
        <linearGradient id={shineId} x1="0" y1="0" x2="0" y2="96" gradientUnits="userSpaceOnUse">
          <stop offset="0%" stopColor="#FFFFFF" stopOpacity="0.18" />
          <stop offset="60%" stopColor="#FFFFFF" stopOpacity="0" />
        </linearGradient>
      </defs>
      <rect width="96" height="96" rx="22" fill={`url(#${bgId})`} />
      <rect width="96" height="96" rx="22" fill={`url(#${shineId})`} />
      <path d={A_PATH} fill="#FFFFFF" />
      <rect
        x="34"
        y="50"
        width="28"
        height="4.5"
        rx="2.25"
        transform="rotate(-22 48 52)"
        fill="#FFC6C6"
      />
      <circle cx="74" cy="22" r="3" fill="#C3FAF5" />
    </svg>
  );
}
