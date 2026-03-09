/**
 * OpenMail SVG logo icon — infinitely scalable, crisp at all sizes.
 * Design DNA: dark navy bg, open envelope, indigo flap, white body with M-fold, letter peeking out.
 * Use this everywhere instead of PNG/ICO files.
 */
import { useId } from "react";

export function LogoIcon({
  size = 20,
  className,
}: {
  size?: number;
  className?: string;
}) {
  // Each instance gets unique IDs so multiple logos on the same page don't share defs
  const uid = useId().replace(/[^a-zA-Z0-9]/g, "");
  const id = `om${uid}`;
  return (
    <svg
      viewBox="0 0 100 100"
      width={size}
      height={size}
      className={className}
      xmlns="http://www.w3.org/2000/svg"
      aria-label="OpenMail"
    >
      <defs>
        {/* Background: deep navy radial */}
        <radialGradient id={`${id}-bg`} cx="50%" cy="30%" r="70%">
          <stop offset="0%"   stopColor="#18183A" />
          <stop offset="100%" stopColor="#080812" />
        </radialGradient>

        {/* Indigo ambient glow (blurred behind flap) */}
        <radialGradient id={`${id}-aura`} cx="50%" cy="50%" r="50%">
          <stop offset="0%"   stopColor="#6366F1" stopOpacity="0.65" />
          <stop offset="100%" stopColor="#4F46E5" stopOpacity="0" />
        </radialGradient>

        {/* Open flap: lighter indigo at peak, deeper at base */}
        <linearGradient id={`${id}-flap`} x1="50%" y1="0%" x2="50%" y2="100%">
          <stop offset="0%"   stopColor="#A5B4FC" />
          <stop offset="100%" stopColor="#3730A3" />
        </linearGradient>

        {/* Envelope body: pure white → light indigo-gray */}
        <linearGradient id={`${id}-body`} x1="25%" y1="0%" x2="75%" y2="100%">
          <stop offset="0%"   stopColor="#FFFFFF" />
          <stop offset="100%" stopColor="#D8DCF0" />
        </linearGradient>

        {/* Letter/paper: white → very light indigo */}
        <linearGradient id={`${id}-letter`} x1="0%" y1="0%" x2="0%" y2="100%">
          <stop offset="0%"   stopColor="#FFFFFF" />
          <stop offset="100%" stopColor="#EAEBF8" />
        </linearGradient>

        {/* Blur for ambient glow */}
        <filter id={`${id}-glow`} x="-80%" y="-80%" width="260%" height="260%">
          <feGaussianBlur in="SourceGraphic" stdDeviation="10" />
        </filter>

        {/* Subtle drop shadow for letter */}
        <filter id={`${id}-shadow`} x="-20%" y="-20%" width="140%" height="140%">
          <feDropShadow dx="0" dy="1.5" stdDeviation="2.5" floodColor="#000" floodOpacity="0.22" />
        </filter>
      </defs>

      {/* ── Background ── */}
      <rect width="100" height="100" rx="22" fill={`url(#${id}-bg)`} />

      {/* ── Ambient indigo glow (blurred ellipse behind the envelope) ── */}
      <ellipse
        cx="50" cy="44" rx="26" ry="17"
        fill={`url(#${id}-aura)`}
        filter={`url(#${id}-glow)`}
      />

      {/* ── Open flap — triangle pointing upward ── */}
      <path d="M17 54 L50 30 L83 54 Z" fill={`url(#${id}-flap)`} />
      {/* Flap highlight — thin white edge along the two slanted sides */}
      <path
        d="M17 54 L50 30 L83 54"
        fill="none"
        stroke="rgba(255,255,255,0.32)"
        strokeWidth="0.8"
        strokeLinejoin="round"
      />

      {/* ── Letter / paper peeking out ── */}
      <rect
        x="28" y="38" width="44" height="26"
        rx="1.5"
        fill={`url(#${id}-letter)`}
        filter={`url(#${id}-shadow)`}
      />
      {/* Folded corner (top-right of letter) */}
      <path d="M66 38 L72 38 L72 44 Z" fill="#C4C7E0" opacity="0.85" />

      {/* ── Envelope body ── */}
      <rect x="17" y="54" width="66" height="33" rx="2" fill={`url(#${id}-body)`} />

      {/* M-fold crease lines */}
      <line x1="17" y1="54" x2="50" y2="71" stroke="#BEC2DC" strokeWidth="1.1" />
      <line x1="83" y1="54" x2="50" y2="71" stroke="#BEC2DC" strokeWidth="1.1" />
      <line x1="17" y1="87" x2="50" y2="75" stroke="#BEC2DC" strokeWidth="0.8" opacity="0.75" />
      <line x1="83" y1="87" x2="50" y2="75" stroke="#BEC2DC" strokeWidth="0.8" opacity="0.75" />

      {/* Subtle body border for depth */}
      <rect
        x="17" y="54" width="66" height="33" rx="2"
        fill="none"
        stroke="rgba(255,255,255,0.16)"
        strokeWidth="0.6"
      />
    </svg>
  );
}
