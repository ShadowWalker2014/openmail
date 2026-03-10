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
    <div className="group relative overflow-hidden rounded-xl border border-border/50 bg-card p-5 transition-all duration-200 hover:border-border hover:bg-card/80">
      <div className="absolute inset-x-0 top-0 h-px bg-gradient-to-r from-transparent via-violet-500/25 to-transparent opacity-0 transition-opacity duration-300 group-hover:opacity-100" />
      <div className="mb-4 inline-flex rounded-lg bg-violet-500/10 p-2 text-violet-400">
        <Icon className="h-[15px] w-[15px]" />
      </div>
      <h3 className="mb-1.5 text-[13px] font-semibold leading-snug text-foreground" style={{ letterSpacing: "-0.018em" }}>
        {title}
      </h3>
      <p className="text-[12px] leading-relaxed text-muted-foreground">{desc}</p>
    </div>
  );
}

function DashboardMockup() {
  return (
    <div className="relative mx-auto mt-16 max-w-4xl">
      {/* Bottom glow */}
      <div className="absolute inset-x-0 -bottom-10 h-32 bg-gradient-to-t from-violet-600/10 to-transparent blur-xl pointer-events-none" />
      {/* Outer glow ring */}
      <div className="absolute -inset-px rounded-[13px] bg-gradient-to-b from-violet-500/10 to-transparent pointer-events-none" />
      <div className="relative overflow-hidden rounded-xl border border-border/60 bg-card shadow-2xl shadow-black/60">
        {/* Window chrome */}
        <div className="flex h-9 items-center gap-1.5 border-b border-border/50 bg-background/60 px-4">
          <div className="h-2.5 w-2.5 rounded-full bg-red-500/50" />
          <div className="h-2.5 w-2.5 rounded-full bg-yellow-500/50" />
          <div className="h-2.5 w-2.5 rounded-full bg-green-500/50" />
          <div className="ml-4 flex-1">
            <div className="mx-auto flex h-5 w-48 items-center justify-center rounded bg-muted/50 text-[10px] text-muted-foreground/50">
              app.openmail.win
            </div>
          </div>
        </div>
        {/* App layout */}
        <div className="flex" style={{ height: 340 }}>
          {/* Sidebar */}
          <div className="w-44 shrink-0 border-r border-border/40 bg-sidebar p-3">
            <div className="mb-3 flex items-center gap-2 px-1">
              <LogoIcon size={20} className="rounded-[4px]" />
              <div className="h-2.5 w-16 rounded bg-foreground/50" />
            </div>
            <div className="mb-3 h-7 w-full rounded border border-border/40 bg-muted/30" />
            {["Dashboard", "Contacts", "Broadcasts", "Campaigns", "Templates"].map(
              (item, i) => (
                <div
                  key={item}
                  className={cn(
                    "mb-0.5 flex h-7 items-center gap-2 rounded px-2",
                    i === 0 ? "bg-muted/60" : ""
                  )}
                >
                  <div className={cn("h-3.5 w-3.5 rounded-sm", i === 0 ? "bg-foreground/60" : "bg-foreground/15")} />
                  <div className={cn("h-2.5 rounded", i === 0 ? "w-16 bg-foreground/50" : "w-14 bg-foreground/15")} />
                </div>
              )
            )}
          </div>
          {/* Main content */}
          <div className="flex-1 p-5 bg-background">
            <div className="mb-4">
              <div className="h-4 w-24 rounded bg-foreground/50 mb-1" />
              <div className="h-2.5 w-16 rounded bg-foreground/15" />
            </div>
            {/* Stats row */}
            <div className="mb-4 grid grid-cols-5 gap-2.5">
              {[
                { v: "12,481", label: "Contacts" },
                { v: "48,203", label: "Sent" },
                { v: "42.1%", label: "Open Rate" },
                { v: "8.3%",  label: "Clicks" },
                { v: "24",    label: "Unsubs" },
              ].map(({ v, label }) => (
                <div key={label} className="rounded-lg border border-border/40 bg-card p-2.5">
                  <div className="mb-1 text-[11px] text-muted-foreground/60">{label}</div>
                  <div className="text-sm font-semibold text-foreground/80 tabular-nums">{v}</div>
                </div>
              ))}
            </div>
            {/* Activity feed */}
            <div className="rounded-lg border border-border/40 bg-card">
              <div className="flex items-center justify-between border-b border-border/40 px-3 py-2">
                <div className="h-2.5 w-20 rounded bg-foreground/30" />
                <div className="flex items-center gap-1.5">
                  <div className="h-1.5 w-1.5 rounded-full bg-emerald-400 animate-pulse" />
                  <div className="h-2 w-12 rounded bg-emerald-400/35" />
                </div>
              </div>
              {["Email opened", "Link clicked", "Email opened", "Unsubscribed", "Email opened"].map((ev, i) => (
                <div key={i} className="flex items-center gap-2.5 border-b border-border/30 px-3 py-2 last:border-0">
                  <div className={cn(
                    "h-3 w-3 rounded-full shrink-0",
                    ev === "Unsubscribed" ? "bg-destructive/40" :
                    ev === "Link clicked"  ? "bg-emerald-400/40" : "bg-violet-400/40"
                  )} />
                  <div className="h-2 w-20 rounded bg-foreground/15" />
                  <div className="ml-auto h-2 w-10 rounded bg-foreground/8" />
                </div>
              ))}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

function LandingPage() {
  const { data: stars } = useGitHubStars();

  return (
    <div className="min-h-screen antialiased" style={{ background: "#0a0a0f", color: "#eaeaed", colorScheme: "dark" }}>

      {/* ── Ambient background glows ── */}
      <div aria-hidden className="pointer-events-none fixed inset-0 overflow-hidden">
        <div className="absolute left-1/2 top-0 h-[500px] w-[800px] -translate-x-1/2 -translate-y-1/4 rounded-full bg-violet-600/[0.07] blur-[120px]" />
        <div className="absolute right-0 top-1/3 h-[300px] w-[400px] rounded-full bg-cyan-600/[0.04] blur-[100px]" />
        <div className="absolute left-0 bottom-1/3 h-[200px] w-[300px] rounded-full bg-violet-600/[0.04] blur-[80px]" />
      </div>

      {/* ── Nav ── */}
      <header className="sticky top-0 z-50 border-b border-white/[0.06] backdrop-blur-xl" style={{ background: "rgba(10,10,15,0.85)" }}>
        <div className="mx-auto flex h-12 max-w-6xl items-center justify-between px-6">

          {/* Logo */}
          <div className="flex items-center gap-2.5">
            <LogoIcon size={28} className="rounded-lg" />
            <span className="text-[13px] font-semibold text-white" style={{ letterSpacing: "-0.02em" }}>
              OpenMail
            </span>
          </div>

          {/* Nav links */}
          <nav className="hidden items-center gap-0.5 md:flex">
            {[
              { label: "Features", href: "#features" },
              { label: "AI Agents", href: "#ai" },
              { label: "Pricing",  href: "#pricing" },
              { label: "Docs",     href: "/docs" },
            ].map(({ label, href }) => (
              <a
                key={label}
                href={href}
                target={href.startsWith("http") ? "_blank" : undefined}
                rel={href.startsWith("http") ? "noreferrer" : undefined}
                className="rounded-md px-3 py-1.5 text-[13px] text-white/45 transition-colors duration-150 hover:text-white/85"
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
              className="hidden items-center gap-1.5 rounded-lg border border-white/[0.09] bg-white/[0.04] px-3 py-1.5 text-xs font-medium text-white/55 transition-colors duration-150 hover:bg-white/[0.08] hover:text-white/80 sm:flex tabular-nums"
            >
              <Star className="h-3 w-3" />
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
      <section className="relative mx-auto max-w-6xl px-6 pt-24 pb-4 text-center">
        {/* Dot grid */}
        <div
          aria-hidden
          className="pointer-events-none absolute inset-0 opacity-[0.022]"
          style={{
            backgroundImage: "radial-gradient(circle, rgba(255,255,255,0.85) 1px, transparent 1px)",
            backgroundSize: "28px 28px",
          }}
        />

        {/* Badge */}
        <div className="relative mb-8 inline-flex items-center gap-2 rounded-full border border-violet-500/25 bg-violet-500/[0.08] px-3.5 py-1.5">
          <span className="h-1.5 w-1.5 rounded-full bg-violet-400" style={{ animation: "live-pulse 2s ease-in-out infinite" }} />
          <span className="text-[11.5px] font-medium text-violet-300/85">
            Open source · Free to self-host
          </span>
        </div>

        {/* Headline */}
        <h1
          className="relative mx-auto max-w-3xl text-5xl font-bold md:text-6xl lg:text-[72px]"
          style={{ letterSpacing: "-0.035em", lineHeight: "1.06" }}
        >
          The open&#8209;source{" "}
          <span
            style={{
              background: "linear-gradient(135deg, #c4b5fd 0%, #a78bfa 45%, #67e8f9 100%)",
              WebkitBackgroundClip: "text",
              WebkitTextFillColor: "transparent",
              backgroundClip: "text",
            }}
          >
            Customer.io
          </span>{" "}
          alternative
        </h1>

        <p className="relative mx-auto mt-7 max-w-[400px] text-[15px] leading-[1.7] text-white/45">
          Lifecycle email marketing built for product teams. Automate onboarding,
          retention, and re-engagement — without the enterprise price tag.
        </p>

        {/* CTAs */}
        <div className="relative mt-9 flex flex-col items-center justify-center gap-2.5 sm:flex-row">
          <Link
            to="/login"
            className="flex items-center gap-2 rounded-xl bg-white px-6 py-2.5 text-[13px] font-semibold text-black shadow-[0_0_20px_rgba(255,255,255,0.14)] transition-all duration-150 hover:opacity-90 hover:shadow-[0_0_28px_rgba(255,255,255,0.20)] cursor-pointer"
          >
            Get started free
            <ArrowRight className="h-4 w-4" />
          </Link>
          <a
            href={GITHUB_REPO}
            target="_blank"
            rel="noreferrer"
            className="flex items-center gap-2 rounded-xl border border-white/[0.1] bg-white/[0.04] px-6 py-2.5 text-[13px] font-semibold text-white/60 transition-all duration-150 hover:bg-white/[0.08] hover:text-white/85"
          >
            <Github className="h-4 w-4" />
            View on GitHub
          </a>
        </div>

        {/* Dashboard mockup */}
        <div className="hidden sm:block">
          <DashboardMockup />
        </div>
      </section>

      {/* ── Comparison ── */}
      <section id="features" className="mx-auto max-w-6xl px-6 pt-28 pb-20">
        <div className="mx-auto max-w-xl">
          <p className="mb-2 text-center text-[11px] font-medium uppercase tracking-[0.16em] text-white/25">
            Why OpenMail
          </p>
          <h2
            className="mb-10 text-center text-[22px] font-semibold text-white/90"
            style={{ letterSpacing: "-0.025em" }}
          >
            Everything Customer.io has. At a fraction of the cost.
          </h2>

          <div className="overflow-hidden rounded-xl border border-white/[0.08] bg-card">
            <div className="grid grid-cols-3 border-b border-white/[0.07] bg-white/[0.025] px-5 py-2.5">
              <span className="text-[11px] font-medium uppercase tracking-wider text-white/30">Feature</span>
              <span className="text-center text-[11px] font-semibold uppercase tracking-wider text-white/80">OpenMail</span>
              <span className="text-center text-[11px] font-medium uppercase tracking-wider text-white/25">Customer.io</span>
            </div>
            {[
              { feature: "Self-hosted option",    us: true,     them: false           },
              { feature: "Full API access",        us: true,     them: "Limited"       },
              { feature: "AI agent integration",   us: true,     them: false           },
              { feature: "Real-time dashboards",   us: true,     them: false           },
              { feature: "Per-seat pricing",       us: "Never",  them: "$1k–$10k+/mo" },
              { feature: "You own your data",      us: true,     them: false           },
              { feature: "Open source",            us: true,     them: false           },
            ].map(({ feature, us, them }) => (
              <div
                key={feature}
                className="grid grid-cols-3 border-b border-white/[0.05] px-5 py-3 last:border-0 transition-colors duration-150 hover:bg-white/[0.02]"
              >
                <span className="text-[12.5px] text-white/50">{feature}</span>
                <div className="flex justify-center">
                  {typeof us === "boolean" ? (
                    <div className="flex h-5 w-5 items-center justify-center rounded-full bg-emerald-500/15">
                      <Check className="h-3 w-3 text-emerald-400" />
                    </div>
                  ) : (
                    <span className="text-xs font-semibold text-emerald-400">{us}</span>
                  )}
                </div>
                <div className="flex justify-center">
                  {typeof them === "boolean" ? (
                    them ? (
                      <Check className="h-4 w-4 text-white/25" />
                    ) : (
                      <span className="text-white/15">—</span>
                    )
                  ) : (
                    <span className="text-[11.5px] text-white/30">{them}</span>
                  )}
                </div>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* ── Feature grid ── */}
      <section className="relative mx-auto max-w-6xl px-6 pb-24">
        <div aria-hidden className="pointer-events-none absolute left-1/2 top-0 h-64 w-96 -translate-x-1/2 rounded-full bg-violet-600/[0.05] blur-[80px]" />
        <p className="mb-2 text-center text-[11px] font-medium uppercase tracking-[0.16em] text-white/25">
          Platform
        </p>
        <h2
          className="mb-10 text-center text-[22px] font-semibold text-white/90"
          style={{ letterSpacing: "-0.025em" }}
        >
          Everything you need to run email at scale
        </h2>
        <div className="grid gap-2.5 sm:grid-cols-2 lg:grid-cols-3">
          <FeatureCard icon={Mail}     title="Broadcasts"           desc="Send one-off email campaigns to any audience segment. Schedule ahead or send instantly — with live delivery progress as it happens." />
          <FeatureCard icon={Zap}      title="Automation Campaigns" desc="Trigger email sequences automatically when users sign up, upgrade, go quiet, or hit any custom event. Set it once, let it run." />
          <FeatureCard icon={Users}    title="Contacts & Segments"  desc="Build dynamic segments from any user attribute or behavior. Filter by plan, activity, revenue, or anything you track." />
          <FeatureCard icon={Code2}    title="Full REST API"         desc="Every feature is available via API. Build custom integrations, automate workflows, and manage your entire email stack programmatically." />
          <FeatureCard icon={BarChart3} title="Live Analytics"      desc="Watch opens, clicks, and unsubscribes update in real time as your campaigns send. No manual refreshing, no stale data." />
          <FeatureCard icon={Globe}    title="Tracking & Compliance" desc="Automatic open tracking, click tracking, and one-click unsubscribe handling built in. CAN-SPAM and GDPR ready out of the box." />
          <FeatureCard icon={Bot}      title="AI Agent Ready"        desc="Connect Claude, GPT, or any AI agent to create campaigns, enroll contacts, and send broadcasts — all through natural language." />
          <FeatureCard icon={Activity} title="Real-Time Everything"  desc="Live send progress bars, instant activity feeds, and dashboards that update as events happen. No page refreshes needed." />
          <FeatureCard icon={Lock}     title="Teams & Workspaces"    desc="Invite your team, set roles, and manage multiple projects in separate workspaces. Everyone sees what they need, nothing they don't." />
        </div>
      </section>

      {/* ── AI section ── */}
      <section id="ai" className="mx-auto max-w-6xl px-6 pb-20">
        <div className="overflow-hidden rounded-xl border border-violet-500/[0.18] bg-gradient-to-br from-violet-500/[0.09] via-violet-500/[0.04] to-transparent p-8 md:p-12">
          <div className="grid gap-10 md:grid-cols-2 md:items-center">

            <div>
              <div className="mb-5 inline-flex items-center gap-2 rounded-full border border-violet-500/25 bg-violet-500/10 px-3 py-1 text-xs font-medium text-violet-400">
                <Sparkles className="h-3.5 w-3.5" />
                AI-Native
              </div>
              <h2
                className="mb-4 text-[22px] font-bold md:text-[26px]"
                style={{ letterSpacing: "-0.028em", lineHeight: "1.2" }}
              >
                Let your AI agents run email
              </h2>
              <p className="mb-6 text-sm leading-relaxed text-white/50">
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
                    <span className="mt-0.5 shrink-0 text-[13px] text-violet-400/60">›</span>
                    <span className="text-[13px] italic text-white/40">{q}</span>
                  </div>
                ))}
              </div>
            </div>

            <div>
              <div className="mb-2 flex items-center gap-1.5 text-xs text-white/30">
                <Terminal className="h-3.5 w-3.5" />
                <span>Connect in 30 seconds</span>
              </div>
              <div className="overflow-x-auto rounded-xl border border-white/[0.08] bg-card p-5 shadow-inner">
                <pre className="text-xs leading-relaxed">
                  <span className="text-cyan-400">{"{"}</span>
                  {"\n  "}
                  <span className="text-violet-300">"mcpServers"</span>
                  <span className="text-white/40">{": {"}</span>
                  {"\n    "}
                  <span className="text-violet-300">"openmail"</span>
                  <span className="text-white/40">{": {"}</span>
                  {"\n      "}
                  <span className="text-white/50">"url"</span>
                  <span className="text-white/40">{": "}</span>
                  <span className="text-emerald-400">"https://mcp.openmail.win/mcp"</span>
                  <span className="text-white/40">{","}</span>
                  {"\n      "}
                  <span className="text-white/50">"headers"</span>
                  <span className="text-white/40">{": {"}</span>
                  {"\n        "}
                  <span className="text-white/50">"Authorization"</span>
                  <span className="text-white/40">{": "}</span>
                  <span className="text-emerald-400">"Bearer &lt;your-api-key&gt;"</span>
                  {"\n      "}
                  <span className="text-white/40">{"}"}</span>
                  {"\n    "}
                  <span className="text-white/40">{"}"}</span>
                  {"\n  "}
                  <span className="text-white/40">{"}"}</span>
                  {"\n"}
                  <span className="text-cyan-400">{"}"}</span>
                </pre>
              </div>
              <p className="mt-3 text-xs text-white/30">
                Works with Claude Desktop, Cursor, and any MCP-compatible agent.
              </p>
            </div>

          </div>
        </div>
      </section>

      {/* ── Pricing ── */}
      <section id="pricing" className="mx-auto max-w-6xl px-6 pb-20">
        <p className="mb-2 text-center text-[11px] font-medium uppercase tracking-[0.16em] text-white/25">
          Pricing
        </p>
        <h2
          className="mb-3 text-center text-[22px] font-semibold text-white/90"
          style={{ letterSpacing: "-0.025em" }}
        >
          Simple. Honest. No surprises.
        </h2>
        <p className="mb-10 text-center text-[12.5px] text-white/35">
          No per-seat fees. No contact limits on self-hosted. No lock-in.
        </p>

        <div className="mx-auto grid max-w-2xl gap-3 md:grid-cols-2">
          {/* Self-hosted */}
          <div className="flex flex-col rounded-xl border border-white/[0.08] bg-card p-7">
            <p className="mb-1.5 text-[11px] font-medium uppercase tracking-[0.14em] text-white/35">
              Self-hosted
            </p>
            <p className="mb-1 text-[38px] font-bold leading-none" style={{ letterSpacing: "-0.04em" }}>Free</p>
            <p className="mb-6 text-[12.5px] text-white/35">Forever. No credit card required.</p>
            <ul className="mb-8 flex-1 space-y-2.5">
              {[
                "Unlimited contacts",
                "Unlimited email sends",
                "Full API & AI agent access",
                "Your infrastructure, your data",
                "Community support",
              ].map((f) => (
                <li key={f} className="flex items-center gap-2.5 text-[12.5px] text-white/55">
                  <Check className="h-3.5 w-3.5 shrink-0 text-emerald-400" />
                  {f}
                </li>
              ))}
            </ul>
            <a
              href={GITHUB_REPO}
              target="_blank"
              rel="noreferrer"
              className="flex items-center justify-center gap-2 rounded-xl border border-white/[0.09] py-2.5 text-[13px] font-semibold text-white/55 transition-all duration-150 hover:bg-white/[0.05] hover:text-white/80 cursor-pointer"
            >
              <Github className="h-4 w-4" />
              Clone on GitHub
            </a>
          </div>

          {/* Enterprise */}
          <div className="flex flex-col rounded-xl border border-violet-500/[0.22] bg-gradient-to-br from-violet-500/[0.08] to-violet-500/[0.03] p-7">
            <p className="mb-1.5 text-[11px] font-medium uppercase tracking-[0.14em] text-violet-400/80">
              Enterprise
            </p>
            <p className="mb-1 text-[38px] font-bold leading-none" style={{ letterSpacing: "-0.04em" }}>Custom</p>
            <p className="mb-6 text-[12.5px] text-white/35">Fully managed, with an SLA.</p>
            <ul className="mb-8 flex-1 space-y-2.5">
              {[
                "Managed cloud hosting",
                "99.9% uptime SLA",
                "SSO (SAML, Okta)",
                "Dedicated onboarding",
                "Priority support",
              ].map((f) => (
                <li key={f} className="flex items-center gap-2.5 text-[12.5px] text-white/55">
                  <Check className="h-3.5 w-3.5 shrink-0 text-violet-400" />
                  {f}
                </li>
              ))}
            </ul>
            <a
              href="mailto:kai@1flow.ai"
              className="flex items-center justify-center gap-2 rounded-xl bg-violet-600 py-2.5 text-[13px] font-semibold text-white shadow-[0_0_20px_rgba(139,92,246,0.28)] transition-all duration-150 hover:opacity-90 hover:shadow-[0_0_28px_rgba(139,92,246,0.38)] cursor-pointer"
            >
              Talk to sales
              <ArrowRight className="h-4 w-4" />
            </a>
          </div>
        </div>
      </section>

      {/* ── CTA ── */}
      <section className="mx-auto max-w-6xl px-6 pb-28 text-center">
        <div className="relative overflow-hidden rounded-xl border border-white/[0.08] bg-card px-8 py-16">
          <div aria-hidden className="pointer-events-none absolute inset-x-0 top-0 h-px bg-gradient-to-r from-transparent via-violet-500/30 to-transparent" />
          <div aria-hidden className="pointer-events-none absolute inset-0 bg-gradient-to-b from-violet-600/[0.055] to-transparent" />
          <h2
            className="relative mb-3 text-[24px] font-bold md:text-[28px]"
            style={{ letterSpacing: "-0.03em" }}
          >
            Own your email stack.
          </h2>
          <p className="relative mx-auto mb-8 max-w-sm text-[13px] leading-relaxed text-white/40">
            Get started in minutes. No credit card, no vendor lock-in,
            no per-seat fees — ever.
          </p>
          <div className="relative flex flex-col items-center justify-center gap-2.5 sm:flex-row">
            <Link
              to="/login"
              className="flex items-center gap-2 rounded-xl bg-white px-6 py-2.5 text-[13px] font-semibold text-black shadow-[0_0_20px_rgba(255,255,255,0.14)] transition-all duration-150 hover:opacity-90 hover:shadow-[0_0_28px_rgba(255,255,255,0.20)] cursor-pointer"
            >
              Start for free
              <ArrowRight className="h-4 w-4" />
            </Link>
            <a
              href="mailto:kai@1flow.ai"
              className="flex items-center gap-2 rounded-xl border border-white/[0.09] px-6 py-2.5 text-[13px] font-semibold text-white/50 transition-all duration-150 hover:bg-white/[0.05] hover:text-white/80"
            >
              Talk to us
            </a>
          </div>
        </div>
      </section>

      {/* ── Footer ── */}
      <footer className="border-t border-white/[0.06] px-6 py-8">
        <div className="mx-auto flex max-w-6xl items-center justify-between">
          <div className="flex items-center gap-2">
            <LogoIcon size={24} className="rounded-md" />
            <span className="text-[13px] font-semibold text-white/80">OpenMail</span>
          </div>
          <div className="flex items-center gap-5 text-xs text-white/30">
            <a
              href={GITHUB_REPO}
              target="_blank"
              rel="noreferrer"
              className="flex items-center gap-1.5 transition-colors duration-150 hover:text-white/60"
            >
              <Github className="h-3.5 w-3.5" />
              GitHub
            </a>
            <a href="mailto:kai@1flow.ai" className="transition-colors duration-150 hover:text-white/60">
              kai@1flow.ai
            </a>
            <span className="text-white/20">ELv2 License</span>
          </div>
        </div>
      </footer>

    </div>
  );
}
