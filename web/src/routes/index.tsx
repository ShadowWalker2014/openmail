import { createFileRoute, Link } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { cn } from "@/lib/utils";
import {
  Mail,
  Zap,
  Users,
  BarChart3,
  Code2,
  Bot,
  ArrowRight,
  Check,
  Github,
  Star,
  Globe,
  Lock,
  Activity,
  Terminal,
  Sparkles,
  Filter,
  FileText,
  Inbox,
  ImagePlay,
  LayoutDashboard,
} from "lucide-react";
import { LogoIcon } from "@/components/logo-icon";

export const Route = createFileRoute("/")({
  component: LandingPage,
});

const GITHUB_REPO = "https://github.com/ShadowWalker2014/openmail"; // pragma: allowlist secret
const GITHUB_API = "https://api.github.com/repos/ShadowWalker2014/openmail"; // pragma: allowlist secret

function useGitHubStars() {
  return useQuery({
    queryKey: ["github-stars"],
    queryFn: () =>
      fetch(GITHUB_API)
        .then((r) => r.json())
        .then((d) => d.stargazers_count as number),
    staleTime: 5 * 60_000,
    retry: false,
  });
}

// ── Sidebar nav pill ────────────────────────────────────────────────────────
function SidebarItem({
  icon: Icon,
  label,
  active,
}: {
  icon: React.ElementType;
  label: string;
  active?: boolean;
}) {
  return (
    <div
      className={cn(
        "flex h-[26px] items-center gap-2 rounded px-2 shrink-0",
        active ? "bg-white/[0.07]" : ""
      )}
    >
      <Icon
        className={cn(
          "h-[11px] w-[11px] shrink-0",
          active ? "text-white/55" : "text-white/15"
        )}
        strokeWidth={1.8}
      />
      <div
        className="h-[8px] rounded-sm"
        style={{
          width: label.length * 5,
          background: active ? "rgba(255,255,255,0.38)" : "rgba(255,255,255,0.1)",
        }}
      />
    </div>
  );
}

// ── Rich dashboard mockup ───────────────────────────────────────────────────
function DashboardMockup() {
  const stats = [
    { v: "12,481", label: "Contacts" },
    { v: "48,203", label: "Emails Sent" },
    { v: "42.1%", label: "Open Rate" },
    { v: "8.3%", label: "Click Rate" },
    { v: "24", label: "Unsubscribes" },
  ];

  const events = [
    { type: "open", user: "john@acme.com", time: "2m ago" },
    { type: "click", user: "sarah@stripe.com", time: "4m ago" },
    { type: "open", user: "mark@vercel.com", time: "7m ago" },
    { type: "unsubscribe", user: "test@example.com", time: "12m ago" },
    { type: "open", user: "amy@linear.app", time: "15m ago" },
    { type: "click", user: "ben@figma.com", time: "19m ago" },
  ];

  const broadcasts = [
    { name: "August Newsletter", sent: "48,203", openRate: "42.1%", status: "sent" },
    { name: "Re-engagement Q3", sent: "8,412", openRate: "31.4%", status: "sent" },
    { name: "Welcome Series", sent: "—", openRate: "—", status: "draft" },
  ];

  return (
    <div className="relative mx-auto mt-16 max-w-5xl px-4">
      {/* Bottom ambient glow */}
      <div
        aria-hidden
        className="pointer-events-none absolute inset-x-16 -bottom-16 h-40 blur-3xl"
        style={{ background: "radial-gradient(ellipse, rgba(124,90,248,0.18) 0%, transparent 70%)" }}
      />
      {/* Top border highlight */}
      <div
        aria-hidden
        className="pointer-events-none absolute inset-x-0 top-0 h-px"
        style={{ background: "linear-gradient(90deg, transparent, rgba(139,92,246,0.35), transparent)" }}
      />

      {/* Browser chrome */}
      <div
        className="relative overflow-hidden rounded-xl"
        style={{
          border: "1px solid rgba(255,255,255,0.08)",
          boxShadow: "0 32px 80px rgba(0,0,0,0.7), 0 0 0 1px rgba(255,255,255,0.04) inset",
          background: "#080812",
        }}
      >
        {/* Window titlebar */}
        <div
          className="flex h-9 items-center gap-1.5 px-4"
          style={{ borderBottom: "1px solid rgba(255,255,255,0.05)", background: "rgba(6,6,10,0.9)" }}
        >
          <div className="h-[10px] w-[10px] rounded-full" style={{ background: "rgba(239,68,68,0.65)" }} />
          <div className="h-[10px] w-[10px] rounded-full" style={{ background: "rgba(251,191,36,0.65)" }} />
          <div className="h-[10px] w-[10px] rounded-full" style={{ background: "rgba(34,197,94,0.65)" }} />
          <div className="ml-auto mr-auto flex h-[18px] w-40 items-center justify-center gap-1.5 rounded"
            style={{ background: "rgba(255,255,255,0.03)", border: "1px solid rgba(255,255,255,0.06)" }}>
            <div className="h-[7px] w-[7px] rounded-full" style={{ background: "rgba(255,255,255,0.2)" }} />
            <span className="text-[9.5px]" style={{ color: "rgba(255,255,255,0.28)", letterSpacing: "0.02em" }}>
              app.openmail.win
            </span>
          </div>
        </div>

        {/* App layout */}
        <div className="flex" style={{ height: 460 }}>

          {/* ── Sidebar ── */}
          <div
            className="w-[168px] shrink-0 flex flex-col p-2.5 gap-0.5"
            style={{ borderRight: "1px solid rgba(255,255,255,0.05)", background: "#06060a" }}
          >
            {/* Logo + workspace */}
            <div className="mb-2.5 flex items-center gap-2 px-1.5 py-0.5">
              <LogoIcon size={16} className="rounded shrink-0" />
              <div className="h-[9px] w-16 rounded-sm" style={{ background: "rgba(255,255,255,0.32)" }} />
            </div>

            {/* Search */}
            <div
              className="mb-2 flex h-[22px] items-center gap-1.5 rounded px-2"
              style={{ background: "rgba(255,255,255,0.03)", border: "1px solid rgba(255,255,255,0.06)" }}
            >
              <div className="h-[8px] w-[8px] rounded-sm" style={{ background: "rgba(255,255,255,0.12)" }} />
              <div className="h-[7px] w-12 rounded-sm" style={{ background: "rgba(255,255,255,0.08)" }} />
            </div>

            {/* Nav */}
            <SidebarItem icon={LayoutDashboard} label="Dashboard" active />
            <SidebarItem icon={Users} label="Contacts" />
            <SidebarItem icon={Filter} label="Segments" />
            <SidebarItem icon={Mail} label="Broadcasts" />
            <SidebarItem icon={Zap} label="Campaigns" />
            <SidebarItem icon={Inbox} label="Deliveries" />
            <SidebarItem icon={Activity} label="Events" />
            <SidebarItem icon={FileText} label="Templates" />
            <SidebarItem icon={ImagePlay} label="Assets" />

            {/* Spacer */}
            <div className="flex-1" />

            {/* Bottom: user avatar placeholder */}
            <div
              className="flex items-center gap-2 rounded px-2 py-1.5 mt-2"
              style={{ borderTop: "1px solid rgba(255,255,255,0.05)" }}
            >
              <div className="h-5 w-5 rounded-full shrink-0" style={{ background: "linear-gradient(135deg, rgba(139,92,246,0.6), rgba(96,165,250,0.4))" }} />
              <div className="h-[7px] w-14 rounded-sm" style={{ background: "rgba(255,255,255,0.18)" }} />
            </div>
          </div>

          {/* ── Main content ── */}
          <div className="flex-1 flex flex-col overflow-hidden" style={{ background: "#0a0a10" }}>
            {/* Top bar */}
            <div
              className="flex h-9 shrink-0 items-center justify-between px-5"
              style={{ borderBottom: "1px solid rgba(255,255,255,0.05)" }}
            >
              <div className="flex items-center gap-2">
                <div className="h-[9px] w-20 rounded" style={{ background: "rgba(255,255,255,0.4)" }} />
                <div className="h-[7px] w-28 rounded-sm" style={{ background: "rgba(255,255,255,0.1)" }} />
              </div>
              {/* Quick action chips */}
              <div className="flex items-center gap-1.5">
                {["New Broadcast", "Add Contact"].map((label) => (
                  <div
                    key={label}
                    className="flex h-[20px] items-center gap-1 rounded px-2"
                    style={{ border: "1px solid rgba(255,255,255,0.08)", background: "rgba(255,255,255,0.03)" }}
                  >
                    <div className="h-[6px] w-[6px] rounded-sm" style={{ background: "rgba(255,255,255,0.18)" }} />
                    <div className="h-[6px] rounded-sm" style={{ width: label.length * 3.6, background: "rgba(255,255,255,0.15)" }} />
                  </div>
                ))}
              </div>
            </div>

            <div className="flex-1 flex gap-0 overflow-hidden">
              {/* Left panel: stats + quick actions + activity */}
              <div className="flex-1 p-4 flex flex-col gap-3 min-w-0 overflow-hidden">

                {/* Stat cards */}
                <div className="grid grid-cols-5 gap-1.5">
                  {stats.map(({ v, label }) => (
                    <div
                      key={label}
                      className="rounded-lg p-2.5"
                      style={{ background: "rgba(255,255,255,0.025)", border: "1px solid rgba(255,255,255,0.06)" }}
                    >
                      <div
                        className="mb-1.5 text-[8px] font-medium uppercase tracking-wider truncate"
                        style={{ color: "rgba(255,255,255,0.3)" }}
                      >
                        {label}
                      </div>
                      <div
                        className="text-[13px] font-semibold tabular-nums"
                        style={{ color: "rgba(255,255,255,0.75)", letterSpacing: "-0.02em" }}
                      >
                        {v}
                      </div>
                    </div>
                  ))}
                </div>

                {/* Quick action chips */}
                <div className="flex items-center gap-1.5 flex-wrap">
                  {[
                    { icon: Mail, label: "New Broadcast" },
                    { icon: Users, label: "Add Contact" },
                    { icon: Filter, label: "New Segment" },
                    { icon: Zap, label: "Campaign" },
                  ].map(({ icon: Icon, label }) => (
                    <div
                      key={label}
                      className="flex h-[22px] items-center gap-1.5 rounded px-2"
                      style={{ border: "1px solid rgba(255,255,255,0.07)", background: "rgba(255,255,255,0.03)" }}
                    >
                      <Icon className="h-[8px] w-[8px]" style={{ color: "rgba(255,255,255,0.2)" }} strokeWidth={2} />
                      <div
                        className="h-[7px] rounded-sm"
                        style={{ width: label.length * 3.8, background: "rgba(255,255,255,0.16)" }}
                      />
                    </div>
                  ))}
                </div>

                {/* Activity feed */}
                <div
                  className="flex-1 rounded-lg overflow-hidden flex flex-col"
                  style={{ border: "1px solid rgba(255,255,255,0.06)", background: "rgba(255,255,255,0.015)" }}
                >
                  {/* Feed header */}
                  <div
                    className="flex items-center justify-between px-3 py-2 shrink-0"
                    style={{ borderBottom: "1px solid rgba(255,255,255,0.05)" }}
                  >
                    <div className="flex items-center gap-2">
                      <Activity className="h-[9px] w-[9px]" style={{ color: "rgba(255,255,255,0.22)" }} />
                      <div className="h-[7px] w-10 rounded-sm" style={{ background: "rgba(255,255,255,0.22)" }} />
                    </div>
                    <div className="flex items-center gap-1.5">
                      <span
                        className="relative flex h-[6px] w-[6px]"
                      >
                        <span
                          className="absolute inline-flex h-full w-full rounded-full bg-emerald-500 opacity-60"
                          style={{ animation: "live-pulse 2s ease-in-out infinite" }}
                        />
                        <span className="relative inline-flex h-[6px] w-[6px] rounded-full bg-emerald-400" />
                      </span>
                      <div className="h-[6px] w-6 rounded-sm" style={{ background: "rgba(74,222,128,0.28)" }} />
                    </div>
                  </div>

                  {/* Event rows */}
                  {events.map(({ type, user, time }, i) => (
                    <div
                      key={i}
                      className="flex items-center gap-2.5 px-3"
                      style={{
                        paddingTop: 7,
                        paddingBottom: 7,
                        borderBottom: i < events.length - 1 ? "1px solid rgba(255,255,255,0.04)" : undefined,
                      }}
                    >
                      {/* Event type dot */}
                      <div
                        className="h-[7px] w-[7px] rounded-full shrink-0"
                        style={{
                          background:
                            type === "unsubscribe"
                              ? "rgba(239,68,68,0.6)"
                              : type === "click"
                              ? "rgba(74,222,128,0.6)"
                              : "rgba(96,165,250,0.6)",
                        }}
                      />
                      {/* Event label */}
                      <div
                        className="h-[7px] shrink-0 rounded-sm"
                        style={{
                          width: type === "unsubscribe" ? 60 : type === "click" ? 54 : 62,
                          background: "rgba(255,255,255,0.2)",
                        }}
                      />
                      {/* User */}
                      <div
                        className="flex-1 h-[6px] rounded-sm"
                        style={{ background: "rgba(255,255,255,0.09)", maxWidth: 90 }}
                      />
                      {/* Time */}
                      <div
                        className="ml-auto h-[6px] shrink-0 rounded-sm"
                        style={{ width: 28, background: "rgba(255,255,255,0.1)" }}
                      />
                    </div>
                  ))}
                </div>
              </div>

              {/* Right panel: recent broadcasts */}
              <div
                className="w-[220px] shrink-0 p-3 flex flex-col gap-2"
                style={{ borderLeft: "1px solid rgba(255,255,255,0.05)" }}
              >
                {/* Panel header */}
                <div className="flex items-center justify-between mb-1">
                  <div className="flex items-center gap-1.5">
                    <Mail className="h-[9px] w-[9px]" style={{ color: "rgba(255,255,255,0.22)" }} />
                    <div className="h-[7px] w-16 rounded-sm" style={{ background: "rgba(255,255,255,0.22)" }} />
                  </div>
                  <div className="h-[7px] w-8 rounded-sm" style={{ background: "rgba(255,255,255,0.1)" }} />
                </div>

                {/* Broadcast rows */}
                {broadcasts.map(({ name, sent, openRate, status }, i) => (
                  <div
                    key={i}
                    className="rounded-lg p-2.5"
                    style={{ border: "1px solid rgba(255,255,255,0.06)", background: "rgba(255,255,255,0.02)" }}
                  >
                    {/* Name */}
                    <div className="flex items-center justify-between mb-1.5">
                      <div
                        className="h-[7px] rounded-sm"
                        style={{ width: name.length * 3.6, background: "rgba(255,255,255,0.28)", maxWidth: 130 }}
                      />
                      {/* Status badge */}
                      <div
                        className="h-[14px] rounded-full px-1.5 flex items-center"
                        style={{
                          background: status === "sent" ? "rgba(74,222,128,0.12)" : "rgba(255,255,255,0.06)",
                          border: `1px solid ${status === "sent" ? "rgba(74,222,128,0.2)" : "rgba(255,255,255,0.08)"}`,
                        }}
                      >
                        <div
                          className="h-[5px] rounded-sm"
                          style={{
                            width: 18,
                            background: status === "sent" ? "rgba(74,222,128,0.5)" : "rgba(255,255,255,0.18)",
                          }}
                        />
                      </div>
                    </div>
                    {/* Metrics row */}
                    <div className="flex items-center gap-3">
                      <div>
                        <div className="h-[5px] w-5 rounded-sm mb-0.5" style={{ background: "rgba(255,255,255,0.1)" }} />
                        <div
                          className="h-[8px] rounded-sm tabular-nums"
                          style={{ width: sent.length * 5.5, background: "rgba(255,255,255,0.22)" }}
                        />
                      </div>
                      <div>
                        <div className="h-[5px] w-8 rounded-sm mb-0.5" style={{ background: "rgba(255,255,255,0.1)" }} />
                        <div
                          className="h-[8px] rounded-sm"
                          style={{ width: openRate.length * 5.5, background: status === "sent" ? "rgba(96,165,250,0.35)" : "rgba(255,255,255,0.1)" }}
                        />
                      </div>
                    </div>
                    {/* Send progress bar (for sent broadcasts) */}
                    {status === "sent" && (
                      <div className="mt-2 h-[3px] w-full overflow-hidden rounded-full" style={{ background: "rgba(255,255,255,0.07)" }}>
                        <div
                          className="h-full rounded-full"
                          style={{
                            width: i === 0 ? "100%" : "73%",
                            background: "linear-gradient(90deg, rgba(139,92,246,0.5), rgba(96,165,250,0.5))",
                          }}
                        />
                      </div>
                    )}
                  </div>
                ))}

                {/* Segment count card */}
                <div
                  className="rounded-lg p-2.5 mt-1"
                  style={{ border: "1px solid rgba(255,255,255,0.06)", background: "rgba(255,255,255,0.02)" }}
                >
                  <div className="flex items-center gap-1.5 mb-2">
                    <Filter className="h-[8px] w-[8px]" style={{ color: "rgba(139,92,246,0.6)" }} />
                    <div className="h-[7px] w-12 rounded-sm" style={{ background: "rgba(255,255,255,0.2)" }} />
                  </div>
                  <div className="flex gap-2">
                    {[
                      { w: 28, c: "rgba(139,92,246,0.35)" },
                      { w: 20, c: "rgba(96,165,250,0.3)" },
                      { w: 24, c: "rgba(74,222,128,0.3)" },
                    ].map(({ w, c }, i) => (
                      <div key={i} className="flex-1 flex flex-col gap-0.5">
                        <div className="h-[7px] w-full rounded-sm" style={{ background: "rgba(255,255,255,0.12)" }} />
                        <div className="h-[10px] w-8 rounded-sm" style={{ background: c }} />
                      </div>
                    ))}
                  </div>
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

// ── Feature card ─────────────────────────────────────────────────────────────
function FeatureCard({
  icon: Icon,
  title,
  desc,
}: {
  icon: React.ElementType;
  title: string;
  desc: string;
}) {
  return (
    <div className="group relative overflow-hidden rounded-xl border border-white/[0.07] bg-white/[0.025] p-5 transition-all duration-200 hover:border-white/[0.12] hover:bg-white/[0.04]">
      <div className="absolute inset-x-0 top-0 h-px bg-gradient-to-r from-transparent via-violet-500/30 to-transparent opacity-0 transition-opacity duration-300 group-hover:opacity-100" />
      <div className="mb-4 inline-flex rounded-lg bg-violet-500/10 p-2 text-violet-400 ring-1 ring-violet-500/15">
        <Icon className="h-[14px] w-[14px]" strokeWidth={1.8} />
      </div>
      <h3
        className="mb-1.5 text-[13px] font-semibold leading-snug text-white/85"
        style={{ letterSpacing: "-0.018em" }}
      >
        {title}
      </h3>
      <p className="text-[12px] leading-relaxed text-white/38">{desc}</p>
    </div>
  );
}

// ── Main landing page ─────────────────────────────────────────────────────────
function LandingPage() {
  const { data: stars } = useGitHubStars();

  return (
    <div
      className="force-dark min-h-screen antialiased"
      style={{ background: "#07070d", color: "#eaeaed" }}
    >
      {/* ── Ambient background glows ── */}
      <div aria-hidden className="pointer-events-none fixed inset-0 overflow-hidden">
        <div
          className="absolute left-1/2 top-0 -translate-x-1/2 -translate-y-1/3"
          style={{
            width: 900,
            height: 600,
            background: "radial-gradient(ellipse, rgba(109,40,217,0.08) 0%, transparent 70%)",
            filter: "blur(40px)",
          }}
        />
        <div
          className="absolute right-0 top-1/2"
          style={{
            width: 500,
            height: 400,
            background: "radial-gradient(ellipse, rgba(6,182,212,0.04) 0%, transparent 70%)",
            filter: "blur(60px)",
          }}
        />
        <div
          className="absolute left-0 bottom-1/4"
          style={{
            width: 400,
            height: 300,
            background: "radial-gradient(ellipse, rgba(109,40,217,0.05) 0%, transparent 70%)",
            filter: "blur(60px)",
          }}
        />
      </div>

      {/* ── Dot grid overlay ── */}
      <div
        aria-hidden
        className="pointer-events-none fixed inset-0 opacity-[0.018]"
        style={{
          backgroundImage: "radial-gradient(circle, rgba(255,255,255,0.9) 1px, transparent 1px)",
          backgroundSize: "28px 28px",
        }}
      />

      {/* ── Nav ── */}
      <header
        className="sticky top-0 z-50"
        style={{
          borderBottom: "1px solid rgba(255,255,255,0.055)",
          backdropFilter: "blur(20px) saturate(180%)",
          WebkitBackdropFilter: "blur(20px) saturate(180%)",
          background: "rgba(7,7,13,0.82)",
        }}
      >
        <div className="mx-auto flex h-12 max-w-6xl items-center justify-between px-6">
          {/* Logo */}
          <div className="flex items-center gap-2.5">
            <LogoIcon size={28} className="rounded-lg shrink-0" />
            <span
              className="text-[13px] font-semibold text-white"
              style={{ letterSpacing: "-0.02em" }}
            >
              OpenMail
            </span>
          </div>

          {/* Nav links */}
          <nav className="hidden items-center gap-0.5 md:flex">
            {[
              { label: "Features", href: "#features" },
              { label: "AI Agents", href: "#ai" },
              { label: "Pricing", href: "#pricing" },
              { label: "Docs", href: "/docs" },
            ].map(({ label, href }) => (
              <a
                key={label}
                href={href}
                className="rounded-md px-3 py-1.5 text-[13px] text-white/40 transition-colors duration-150 hover:text-white/80"
              >
                {label}
              </a>
            ))}
          </nav>

          {/* Actions */}
          <div className="flex items-center gap-2">
            <a
              href={GITHUB_REPO}
              target="_blank"
              rel="noreferrer"
              className="hidden items-center gap-1.5 rounded-lg px-3 py-1.5 text-xs font-medium text-white/45 transition-all duration-150 hover:text-white/75 sm:flex tabular-nums cursor-pointer"
              style={{ border: "1px solid rgba(255,255,255,0.08)", background: "rgba(255,255,255,0.03)" }}
            >
              <Star className="h-3 w-3" strokeWidth={1.8} />
              {stars != null ? stars.toLocaleString() : "Star"}
            </a>
            <Link
              to="/login"
              className="rounded-lg bg-white px-4 py-1.5 text-[13px] font-semibold text-black transition-opacity duration-150 hover:opacity-85 cursor-pointer"
            >
              Sign in
            </Link>
          </div>
        </div>
      </header>

      {/* ── Hero ── */}
      <section className="relative mx-auto max-w-6xl px-6 pt-24 pb-6 text-center">
        {/* Badge */}
        <div
          className="relative mb-8 inline-flex items-center gap-2 rounded-full px-3.5 py-1.5"
          style={{ border: "1px solid rgba(139,92,246,0.22)", background: "rgba(139,92,246,0.07)" }}
        >
          <span
            className="h-1.5 w-1.5 rounded-full bg-violet-400"
            style={{ animation: "live-pulse 2s ease-in-out infinite" }}
          />
          <span className="text-[11.5px] font-medium text-violet-300/80">
            Open source · Free to self-host
          </span>
        </div>

        {/* Headline */}
        <h1
          className="relative mx-auto max-w-3xl text-5xl font-bold md:text-6xl lg:text-[70px]"
          style={{ letterSpacing: "-0.035em", lineHeight: "1.06" }}
        >
          The open&#8209;source{" "}
          <span
            style={{
              background: "linear-gradient(135deg, #c4b5fd 0%, #a78bfa 40%, #67e8f9 100%)",
              WebkitBackgroundClip: "text",
              WebkitTextFillColor: "transparent",
              backgroundClip: "text",
            }}
          >
            Customer.io
          </span>{" "}
          alternative
        </h1>

        <p
          className="relative mx-auto mt-7 max-w-[400px] text-[15px] leading-[1.7]"
          style={{ color: "rgba(255,255,255,0.42)" }}
        >
          Lifecycle email marketing built for product teams. Automate onboarding,
          retention, and re-engagement — without the enterprise price tag.
        </p>

        {/* CTAs */}
        <div className="relative mt-9 flex flex-col items-center justify-center gap-2.5 sm:flex-row">
          <Link
            to="/login"
            className="flex items-center gap-2 rounded-xl bg-white px-6 py-2.5 text-[13px] font-semibold text-black transition-all duration-150 hover:opacity-90 cursor-pointer"
            style={{ boxShadow: "0 0 24px rgba(255,255,255,0.13)" }}
          >
            Get started free
            <ArrowRight className="h-4 w-4" />
          </Link>
          <a
            href={GITHUB_REPO}
            target="_blank"
            rel="noreferrer"
            className="flex items-center gap-2 rounded-xl px-6 py-2.5 text-[13px] font-semibold transition-all duration-150 cursor-pointer"
            style={{
              border: "1px solid rgba(255,255,255,0.09)",
              background: "rgba(255,255,255,0.04)",
              color: "rgba(255,255,255,0.55)",
            }}
          >
            <Github className="h-4 w-4" />
            View on GitHub
          </a>
        </div>

        {/* Trust signals */}
        <div className="relative mt-8 flex items-center justify-center gap-6">
          {[
            { label: "ELv2 licensed" },
            { label: "No per-seat fees" },
            { label: "Self-hostable" },
          ].map(({ label }) => (
            <div key={label} className="flex items-center gap-1.5">
              <Check className="h-3 w-3 text-emerald-400/70" />
              <span className="text-[11.5px]" style={{ color: "rgba(255,255,255,0.35)" }}>
                {label}
              </span>
            </div>
          ))}
        </div>

        {/* Dashboard mockup */}
        <div className="hidden sm:block">
          <DashboardMockup />
        </div>
      </section>

      {/* ── Comparison ── */}
      <section id="features" className="mx-auto max-w-6xl px-6 pt-32 pb-24">
        <div className="mx-auto max-w-xl">
          <p
            className="mb-2 text-center text-[11px] font-semibold uppercase"
            style={{ letterSpacing: "0.16em", color: "rgba(255,255,255,0.22)" }}
          >
            Why OpenMail
          </p>
          <h2
            className="mb-12 text-center text-[22px] font-semibold"
            style={{ letterSpacing: "-0.025em", color: "rgba(255,255,255,0.88)" }}
          >
            Everything Customer.io has. At a fraction of the cost.
          </h2>

          <div
            className="overflow-hidden rounded-xl"
            style={{ border: "1px solid rgba(255,255,255,0.07)", background: "rgba(255,255,255,0.02)" }}
          >
            {/* Header row */}
            <div
              className="grid grid-cols-3 px-5 py-2.5"
              style={{ borderBottom: "1px solid rgba(255,255,255,0.06)", background: "rgba(255,255,255,0.02)" }}
            >
              <span
                className="text-[11px] font-semibold uppercase"
                style={{ letterSpacing: "0.12em", color: "rgba(255,255,255,0.28)" }}
              >
                Feature
              </span>
              <span
                className="text-center text-[11px] font-bold uppercase"
                style={{ letterSpacing: "0.12em", color: "rgba(255,255,255,0.8)" }}
              >
                OpenMail
              </span>
              <span
                className="text-center text-[11px] font-semibold uppercase"
                style={{ letterSpacing: "0.12em", color: "rgba(255,255,255,0.22)" }}
              >
                Customer.io
              </span>
            </div>

            {[
              { feature: "Self-hosted option", us: true, them: false },
              { feature: "Full API access", us: true, them: "Limited" },
              { feature: "AI agent integration", us: true, them: false },
              { feature: "Real-time dashboards", us: true, them: false },
              { feature: "Per-seat pricing", us: "Never", them: "$1k–$10k+/mo" },
              { feature: "You own your data", us: true, them: false },
              { feature: "Open source", us: true, them: false },
            ].map(({ feature, us, them }) => (
              <div
                key={feature}
                className="grid grid-cols-3 px-5 py-3 transition-colors duration-150"
                style={{ borderBottom: "1px solid rgba(255,255,255,0.04)" }}
              >
                <span className="text-[12.5px]" style={{ color: "rgba(255,255,255,0.48)" }}>
                  {feature}
                </span>
                <div className="flex justify-center">
                  {typeof us === "boolean" ? (
                    <div
                      className="flex h-5 w-5 items-center justify-center rounded-full"
                      style={{ background: "rgba(52,211,153,0.12)" }}
                    >
                      <Check className="h-3 w-3 text-emerald-400" />
                    </div>
                  ) : (
                    <span className="text-xs font-semibold text-emerald-400">{us}</span>
                  )}
                </div>
                <div className="flex justify-center">
                  {typeof them === "boolean" ? (
                    them ? (
                      <Check className="h-4 w-4" style={{ color: "rgba(255,255,255,0.22)" }} />
                    ) : (
                      <span style={{ color: "rgba(255,255,255,0.12)" }}>—</span>
                    )
                  ) : (
                    <span className="text-[11.5px]" style={{ color: "rgba(255,255,255,0.28)" }}>
                      {them}
                    </span>
                  )}
                </div>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* ── Feature grid ── */}
      <section className="relative mx-auto max-w-6xl px-6 pb-28">
        <div
          aria-hidden
          className="pointer-events-none absolute left-1/2 top-0 -translate-x-1/2"
          style={{
            width: 500,
            height: 300,
            background: "radial-gradient(ellipse, rgba(109,40,217,0.06) 0%, transparent 70%)",
            filter: "blur(40px)",
          }}
        />
        <p
          className="mb-2 text-center text-[11px] font-semibold uppercase"
          style={{ letterSpacing: "0.16em", color: "rgba(255,255,255,0.22)" }}
        >
          Platform
        </p>
        <h2
          className="mb-12 text-center text-[22px] font-semibold"
          style={{ letterSpacing: "-0.025em", color: "rgba(255,255,255,0.88)" }}
        >
          Everything you need to run email at scale
        </h2>
        <div className="grid gap-2.5 sm:grid-cols-2 lg:grid-cols-3">
          <FeatureCard
            icon={Mail}
            title="Broadcasts"
            desc="Send one-off email campaigns to any audience segment. Schedule ahead or send instantly — with live delivery progress as it happens."
          />
          <FeatureCard
            icon={Zap}
            title="Automation Campaigns"
            desc="Trigger email sequences automatically when users sign up, upgrade, go quiet, or hit any custom event. Set it once, let it run."
          />
          <FeatureCard
            icon={Users}
            title="Contacts & Segments"
            desc="Build dynamic segments from any user attribute or behavior. Filter by plan, activity, revenue, or anything you track."
          />
          <FeatureCard
            icon={Code2}
            title="Full REST API"
            desc="Every feature is available via API. Build custom integrations, automate workflows, and manage your entire email stack programmatically."
          />
          <FeatureCard
            icon={BarChart3}
            title="Live Analytics"
            desc="Watch opens, clicks, and unsubscribes update in real time as your campaigns send. No manual refreshing, no stale data."
          />
          <FeatureCard
            icon={Globe}
            title="Tracking & Compliance"
            desc="Automatic open tracking, click tracking, and one-click unsubscribe handling built in. CAN-SPAM and GDPR ready out of the box."
          />
          <FeatureCard
            icon={Bot}
            title="AI Agent Ready"
            desc="Connect Claude, GPT, or any AI agent to create campaigns, enroll contacts, and send broadcasts — all through natural language."
          />
          <FeatureCard
            icon={Activity}
            title="Real-Time Everything"
            desc="Live send progress bars, instant activity feeds, and dashboards that update as events happen. No page refreshes needed."
          />
          <FeatureCard
            icon={Lock}
            title="Teams & Workspaces"
            desc="Invite your team, set roles, and manage multiple projects in separate workspaces. Everyone sees what they need, nothing they don't."
          />
        </div>
      </section>

      {/* ── AI section ── */}
      <section id="ai" className="mx-auto max-w-6xl px-6 pb-24">
        <div
          className="overflow-hidden rounded-xl p-8 md:p-12"
          style={{ border: "1px solid rgba(139,92,246,0.16)", background: "linear-gradient(135deg, rgba(109,40,217,0.08) 0%, rgba(109,40,217,0.03) 60%, transparent 100%)" }}
        >
          <div className="grid gap-12 md:grid-cols-2 md:items-center">
            <div>
              <div
                className="mb-5 inline-flex items-center gap-2 rounded-full px-3 py-1 text-xs font-medium text-violet-400"
                style={{ border: "1px solid rgba(139,92,246,0.22)", background: "rgba(139,92,246,0.09)" }}
              >
                <Sparkles className="h-3.5 w-3.5" />
                AI-Native
              </div>
              <h2
                className="mb-4 text-[22px] font-bold md:text-[26px]"
                style={{ letterSpacing: "-0.028em", lineHeight: "1.2" }}
              >
                Let your AI agents run email
              </h2>
              <p className="mb-6 text-sm leading-relaxed" style={{ color: "rgba(255,255,255,0.48)" }}>
                OpenMail connects directly to Claude, GPT, Cursor, and any agent
                that supports the Model Context Protocol. Your AI can create
                campaigns, enroll contacts, send broadcasts, and pull
                analytics — all through a single conversation.
              </p>
              <div className="space-y-2.5">
                {[
                  "\"Create a re-engagement campaign for users inactive 30+ days\"",
                  "\"Send the August newsletter to all paid customers\"",
                  "\"What's the open rate on our onboarding sequence?\"",
                ].map((q) => (
                  <div key={q} className="flex items-start gap-2.5">
                    <span className="mt-0.5 shrink-0 text-[13px]" style={{ color: "rgba(167,139,250,0.5)" }}>
                      ›
                    </span>
                    <span className="text-[13px] italic" style={{ color: "rgba(255,255,255,0.38)" }}>
                      {q}
                    </span>
                  </div>
                ))}
              </div>
            </div>

            <div>
              <div className="mb-2 flex items-center gap-1.5" style={{ color: "rgba(255,255,255,0.28)" }}>
                <Terminal className="h-3.5 w-3.5" />
                <span className="text-xs">Connect in 30 seconds</span>
              </div>
              <div
                className="overflow-x-auto rounded-xl p-5"
                style={{ border: "1px solid rgba(255,255,255,0.07)", background: "rgba(255,255,255,0.02)" }}
              >
                <pre className="text-xs leading-relaxed">
                  <span style={{ color: "#67e8f9" }}>{"{"}</span>
                  {"\n  "}
                  <span style={{ color: "#c4b5fd" }}>"mcpServers"</span>
                  <span style={{ color: "rgba(255,255,255,0.35)" }}>{": {"}</span>
                  {"\n    "}
                  <span style={{ color: "#c4b5fd" }}>"openmail"</span>
                  <span style={{ color: "rgba(255,255,255,0.35)" }}>{": {"}</span>
                  {"\n      "}
                  <span style={{ color: "rgba(255,255,255,0.5)" }}>"url"</span>
                  <span style={{ color: "rgba(255,255,255,0.35)" }}>{": "}</span>
                  <span style={{ color: "#86efac" }}>"https://mcp.openmail.win/mcp"</span>
                  <span style={{ color: "rgba(255,255,255,0.35)" }}>{","}</span>
                  {"\n      "}
                  <span style={{ color: "rgba(255,255,255,0.5)" }}>"headers"</span>
                  <span style={{ color: "rgba(255,255,255,0.35)" }}>{": {"}</span>
                  {"\n        "}
                  <span style={{ color: "rgba(255,255,255,0.5)" }}>"Authorization"</span>
                  <span style={{ color: "rgba(255,255,255,0.35)" }}>{": "}</span>
                  <span style={{ color: "#86efac" }}>"Bearer &lt;your-api-key&gt;"</span>
                  {"\n      "}
                  <span style={{ color: "rgba(255,255,255,0.35)" }}>{"}"}</span>
                  {"\n    "}
                  <span style={{ color: "rgba(255,255,255,0.35)" }}>{"}"}</span>
                  {"\n  "}
                  <span style={{ color: "rgba(255,255,255,0.35)" }}>{"}"}</span>
                  {"\n"}
                  <span style={{ color: "#67e8f9" }}>{"}"}</span>
                </pre>
              </div>
              <p className="mt-3 text-xs" style={{ color: "rgba(255,255,255,0.28)" }}>
                Works with Claude Desktop, Cursor, and any MCP-compatible agent.
              </p>
            </div>
          </div>
        </div>
      </section>

      {/* ── Pricing ── */}
      <section id="pricing" className="mx-auto max-w-6xl px-6 pb-24">
        <p
          className="mb-2 text-center text-[11px] font-semibold uppercase"
          style={{ letterSpacing: "0.16em", color: "rgba(255,255,255,0.22)" }}
        >
          Pricing
        </p>
        <h2
          className="mb-3 text-center text-[22px] font-semibold"
          style={{ letterSpacing: "-0.025em", color: "rgba(255,255,255,0.88)" }}
        >
          Simple. Honest. No surprises.
        </h2>
        <p className="mb-12 text-center text-[12.5px]" style={{ color: "rgba(255,255,255,0.32)" }}>
          No per-seat fees. No contact limits on self-hosted. No lock-in.
        </p>

        <div className="mx-auto grid max-w-2xl gap-3 md:grid-cols-2">
          {/* Self-hosted */}
          <div
            className="flex flex-col rounded-xl p-7"
            style={{ border: "1px solid rgba(255,255,255,0.07)", background: "rgba(255,255,255,0.02)" }}
          >
            <p
              className="mb-2 text-[11px] font-semibold uppercase"
              style={{ letterSpacing: "0.14em", color: "rgba(255,255,255,0.32)" }}
            >
              Self-hosted
            </p>
            <p
              className="mb-1 text-[38px] font-bold leading-none"
              style={{ letterSpacing: "-0.04em" }}
            >
              Free
            </p>
            <p className="mb-7 text-[12.5px]" style={{ color: "rgba(255,255,255,0.32)" }}>
              Forever. No credit card required.
            </p>
            <ul className="mb-8 flex-1 space-y-2.5">
              {[
                "Unlimited contacts",
                "Unlimited email sends",
                "Full API & AI agent access",
                "Your infrastructure, your data",
                "Community support",
              ].map((f) => (
                <li key={f} className="flex items-center gap-2.5 text-[12.5px]" style={{ color: "rgba(255,255,255,0.52)" }}>
                  <Check className="h-3.5 w-3.5 shrink-0 text-emerald-400" />
                  {f}
                </li>
              ))}
            </ul>
            <a
              href={GITHUB_REPO}
              target="_blank"
              rel="noreferrer"
              className="flex items-center justify-center gap-2 rounded-xl py-2.5 text-[13px] font-semibold transition-all duration-150 cursor-pointer"
              style={{
                border: "1px solid rgba(255,255,255,0.08)",
                color: "rgba(255,255,255,0.5)",
              }}
            >
              <Github className="h-4 w-4" />
              Clone on GitHub
            </a>
          </div>

          {/* Enterprise */}
          <div
            className="flex flex-col rounded-xl p-7"
            style={{
              border: "1px solid rgba(139,92,246,0.2)",
              background: "linear-gradient(135deg, rgba(109,40,217,0.08) 0%, rgba(109,40,217,0.03) 60%, transparent 100%)",
            }}
          >
            <p
              className="mb-2 text-[11px] font-semibold uppercase text-violet-400/80"
              style={{ letterSpacing: "0.14em" }}
            >
              Enterprise
            </p>
            <p
              className="mb-1 text-[38px] font-bold leading-none"
              style={{ letterSpacing: "-0.04em" }}
            >
              Custom
            </p>
            <p className="mb-7 text-[12.5px]" style={{ color: "rgba(255,255,255,0.32)" }}>
              Fully managed, with an SLA.
            </p>
            <ul className="mb-8 flex-1 space-y-2.5">
              {[
                "Managed cloud hosting",
                "99.9% uptime SLA",
                "SSO (SAML, Okta)",
                "Dedicated onboarding",
                "Priority support",
              ].map((f) => (
                <li key={f} className="flex items-center gap-2.5 text-[12.5px]" style={{ color: "rgba(255,255,255,0.52)" }}>
                  <Check className="h-3.5 w-3.5 shrink-0 text-violet-400" />
                  {f}
                </li>
              ))}
            </ul>
            <a
              href="mailto:kai@1flow.ai"
              className="flex items-center justify-center gap-2 rounded-xl bg-violet-600 py-2.5 text-[13px] font-semibold text-white transition-all duration-150 hover:opacity-90 cursor-pointer"
              style={{ boxShadow: "0 0 24px rgba(139,92,246,0.26)" }}
            >
              Talk to sales
              <ArrowRight className="h-4 w-4" />
            </a>
          </div>
        </div>
      </section>

      {/* ── CTA ── */}
      <section className="mx-auto max-w-6xl px-6 pb-28 text-center">
        <div
          className="relative overflow-hidden rounded-xl px-8 py-16"
          style={{ border: "1px solid rgba(255,255,255,0.07)", background: "rgba(255,255,255,0.025)" }}
        >
          <div
            aria-hidden
            className="pointer-events-none absolute inset-x-0 top-0 h-px"
            style={{ background: "linear-gradient(90deg, transparent, rgba(139,92,246,0.4), transparent)" }}
          />
          <div
            aria-hidden
            className="pointer-events-none absolute inset-0"
            style={{ background: "radial-gradient(ellipse at top, rgba(109,40,217,0.07) 0%, transparent 60%)" }}
          />
          <h2
            className="relative mb-3 text-[24px] font-bold md:text-[28px]"
            style={{ letterSpacing: "-0.03em" }}
          >
            Own your email stack.
          </h2>
          <p
            className="relative mx-auto mb-8 max-w-sm text-[13px] leading-relaxed"
            style={{ color: "rgba(255,255,255,0.38)" }}
          >
            Get started in minutes. No credit card, no vendor lock-in, no per-seat fees — ever.
          </p>
          <div className="relative flex flex-col items-center justify-center gap-2.5 sm:flex-row">
            <Link
              to="/login"
              className="flex items-center gap-2 rounded-xl bg-white px-6 py-2.5 text-[13px] font-semibold text-black transition-all duration-150 hover:opacity-90 cursor-pointer"
              style={{ boxShadow: "0 0 24px rgba(255,255,255,0.12)" }}
            >
              Start for free
              <ArrowRight className="h-4 w-4" />
            </Link>
            <a
              href="mailto:kai@1flow.ai"
              className="flex items-center gap-2 rounded-xl px-6 py-2.5 text-[13px] font-semibold transition-all duration-150 cursor-pointer"
              style={{
                border: "1px solid rgba(255,255,255,0.08)",
                color: "rgba(255,255,255,0.48)",
              }}
            >
              Talk to us
            </a>
          </div>
        </div>
      </section>

      {/* ── Footer ── */}
      <footer style={{ borderTop: "1px solid rgba(255,255,255,0.055)" }} className="px-6 py-8">
        <div className="mx-auto flex max-w-6xl items-center justify-between flex-wrap gap-4">
          <div className="flex items-center gap-2">
            <LogoIcon size={22} className="rounded-md" />
            <span className="text-[13px] font-semibold" style={{ color: "rgba(255,255,255,0.75)" }}>
              OpenMail
            </span>
          </div>
          <div className="flex items-center gap-5 text-xs" style={{ color: "rgba(255,255,255,0.28)" }}>
            <a
              href={GITHUB_REPO}
              target="_blank"
              rel="noreferrer"
              className="flex items-center gap-1.5 transition-colors duration-150 hover:text-white/55 cursor-pointer"
            >
              <Github className="h-3.5 w-3.5" />
              GitHub
            </a>
            <a
              href="mailto:kai@1flow.ai"
              className="transition-colors duration-150 hover:text-white/55 cursor-pointer"
            >
              kai@1flow.ai
            </a>
            <span style={{ color: "rgba(255,255,255,0.18)" }}>ELv2 License</span>
          </div>
        </div>
      </footer>
    </div>
  );
}
