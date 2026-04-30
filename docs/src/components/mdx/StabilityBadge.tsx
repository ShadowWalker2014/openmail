/**
 * StabilityBadge — visual + accessible indicator for feature maturity.
 *
 * Three levels mapping to the repo-root ROADMAP.md:
 *   - "stable"   → ✅ Stable    (green pill)
 *   - "beta"     → 🟡 Beta      (orange pill)
 *   - "roadmap"  → 🔵 Roadmap   (gray/blue pill)
 *
 * Static render — no JS hydration needed. Uses Tailwind utility classes that
 * already exist in the docs site; introduces no new build dependencies (CN-02).
 *
 * Registered in `src/components/mdx/components.tsx` so MDX files can use
 * `<StabilityBadge level="stable" />` without an import.
 *
 * `linkToRoadmap` (default true) wraps the badge in an anchor pointing at the
 * matching section of the docs roadmap page. Set `false` if the badge sits
 * inside a heading that already has its own anchor link.
 */

import type { ReactElement } from "react";

type StabilityLevel = "stable" | "beta" | "roadmap";

interface StabilityBadgeProps {
  level: StabilityLevel;
  linkToRoadmap?: boolean;
}

const STYLES: Record<StabilityLevel, { label: string; className: string; anchor: string }> = {
  stable: {
    label: "Stable",
    className:
      "bg-emerald-500/15 text-emerald-300 border-emerald-500/30 hover:bg-emerald-500/20",
    anchor: "#-stable",
  },
  beta: {
    label: "Beta",
    className:
      "bg-amber-500/15 text-amber-300 border-amber-500/30 hover:bg-amber-500/20",
    anchor: "#-beta",
  },
  roadmap: {
    label: "Roadmap",
    className:
      "bg-sky-500/15 text-sky-300 border-sky-500/30 hover:bg-sky-500/20",
    anchor: "#-roadmap",
  },
};

export default function StabilityBadge({
  level,
  linkToRoadmap = true,
}: StabilityBadgeProps): ReactElement {
  const { label, className, anchor } = STYLES[level];
  const ariaLabel = `Stability: ${label}`;

  const pill = (
    <span
      role="status"
      aria-label={ariaLabel}
      className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full border text-xs font-medium uppercase tracking-wide align-middle ml-2 no-underline ${className}`}
    >
      {label}
    </span>
  );

  if (!linkToRoadmap) return pill;

  return (
    <a
      href={`/roadmap${anchor}`}
      className="no-underline"
      aria-label={`${ariaLabel} — see roadmap`}
    >
      {pill}
    </a>
  );
}
