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
} from "lucide-react";

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
  accent = false,
}: {
  icon: React.ElementType;
  title: string;
  desc: string;
  accent?: boolean;
}) {
  return (
    <div
      style={{
        borderColor: accent ? "rgba(139,92,246,0.25)" : "rgba(255,255,255,0.08)",
        backgroundColor: accent ? "rgba(139,92,246,0.05)" : "rgba(255,255,255,0.04)",
      }}
      className="group relative rounded-xl border p-5 transition-all duration-150"
      onMouseEnter={(e) => {
        (e.currentTarget as HTMLDivElement).style.borderColor = accent
          ? "rgba(139,92,246,0.45)"
          : "rgba(255,255,255,0.14)";
      }}
      onMouseLeave={(e) => {
        (e.currentTarget as HTMLDivElement).style.borderColor = accent
          ? "rgba(139,92,246,0.25)"
          : "rgba(255,255,255,0.08)";
      }}
    >
      <div
        style={{
          backgroundColor: accent ? "rgba(139,92,246,0.15)" : "rgba(255,255,255,0.08)",
        }}
        className={cn(
          "mb-3.5 inline-flex rounded-lg p-2",
          accent ? "text-violet-400" : "text-white/50"
        )}
      >
        <Icon className="h-4 w-4" />
      </div>
      <h3 className="mb-1 text-sm font-medium text-white/90">{title}</h3>
      <p className="text-sm leading-relaxed text-white/45">{desc}</p>
    </div>
  );
}

function DashboardMockup() {
  return (
    <div className="relative mx-auto mt-16 max-w-4xl">
      <div className="absolute inset-x-0 -bottom-10 h-32 bg-gradient-to-t from-violet-600/10 to-transparent blur-xl" />
        <div style={{ borderColor: "rgba(255,255,255,0.1)" }} className="relative overflow-hidden rounded-xl border bg-card shadow-2xl shadow-black/50">
        {/* Window chrome */}
        <div style={{ borderColor: "rgba(255,255,255,0.08)", backgroundColor: "rgba(255,255,255,0.05)" }} className="flex h-9 items-center gap-1.5 border-b px-4">
          <div className="h-2.5 w-2.5 rounded-full bg-red-500/60" />
          <div className="h-2.5 w-2.5 rounded-full bg-yellow-500/60" />
          <div className="h-2.5 w-2.5 rounded-full bg-green-500/60" />
          <div className="ml-4 flex-1">
            <div className="mx-auto flex h-5 w-48 items-center justify-center rounded bg-white/5 text-[10px] text-white/30">
              app.openmail.dev
            </div>
          </div>
        </div>
        {/* App layout */}
        <div className="flex" style={{ height: 340 }}>
          {/* Sidebar */}
          <div style={{ borderColor: "rgba(255,255,255,0.08)", backgroundColor: "rgba(255,255,255,0.05)" }} className="w-44 shrink-0 border-r p-3">
            <div className="mb-3 flex items-center gap-2 px-1">
              <div className="h-5 w-5 rounded bg-white/90" />
              <div className="h-3 w-16 rounded bg-white/60" />
            </div>
            <div style={{ borderColor: "rgba(255,255,255,0.08)", backgroundColor: "rgba(255,255,255,0.05)" }} className="mb-3 h-7 w-full rounded border" />
            {["Dashboard", "Contacts", "Broadcasts", "Campaigns", "Templates"].map(
              (item, i) => (
                <div
                  key={item}
                  className={cn(
                    "mb-0.5 flex h-7 items-center gap-2 rounded px-2",
                    i === 0 ? "bg-white/10" : ""
                  )}
                >
                  <div className={cn("h-3.5 w-3.5 rounded-sm", i === 0 ? "bg-white/70" : "bg-white/20")} />
                  <div className={cn("h-2.5 rounded", i === 0 ? "w-16 bg-white/60" : "w-14 bg-white/20")} />
                </div>
              )
            )}
          </div>
          {/* Main content */}
          <div className="flex-1 p-5">
            <div className="mb-4">
              <div className="h-4 w-24 rounded bg-white/60 mb-1" />
              <div className="h-2.5 w-16 rounded bg-white/20" />
            </div>
            <div className="mb-4 grid grid-cols-5 gap-2.5">
              {[
                { v: "12,481", label: "Contacts" },
                { v: "48,203", label: "Sent" },
                { v: "42.1%", label: "Open Rate" },
                { v: "8.3%", label: "Clicks" },
                { v: "24", label: "Unsubs" },
              ].map(({ v, label }) => (
                <div key={label} style={{ borderColor: "rgba(255,255,255,0.08)", backgroundColor: "rgba(255,255,255,0.05)" }} className="rounded-lg border p-2.5">
                  <div className="mb-1 text-[11px] text-white/35">{label}</div>
                  <div className="text-sm font-semibold text-white/80">{v}</div>
                </div>
              ))}
            </div>
            <div style={{ borderColor: "rgba(255,255,255,0.08)", backgroundColor: "rgba(255,255,255,0.05)" }} className="rounded-lg border">
              <div style={{ borderColor: "rgba(255,255,255,0.08)" }} className="flex items-center justify-between border-b px-3 py-2">
                <div className="h-2.5 w-20 rounded bg-white/40" />
                <div className="flex items-center gap-1.5">
                  <div className="h-1.5 w-1.5 rounded-full bg-green-400 animate-pulse" />
                  <div className="h-2 w-12 rounded bg-green-400/40" />
                </div>
              </div>
              {["Email opened", "Link clicked", "Email opened", "Unsubscribed", "Email opened"].map(
                (ev, i) => (
                  <div key={i} style={{ borderColor: "rgba(255,255,255,0.05)" }} className="flex items-center gap-2.5 border-b px-3 py-2 last:border-0">
                    <div className={cn(
                      "h-3 w-3 rounded-full shrink-0",
                      ev === "Unsubscribed" ? "bg-red-400/40" :
                      ev === "Link clicked" ? "bg-green-400/40" : "bg-blue-400/40"
                    )} />
                    <div className="h-2 w-20 rounded bg-white/20" />
                    <div className="ml-auto h-2 w-10 rounded bg-white/10" />
                  </div>
                )
              )}
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
    <div className="min-h-screen text-white antialiased selection:bg-violet-500/25" style={{ background: "hsl(var(--background))" }}>
      {/* Ambient glows */}
      <div aria-hidden className="pointer-events-none fixed inset-0 overflow-hidden">
        <div className="absolute left-1/2 top-0 h-[500px] w-[800px] -translate-x-1/2 -translate-y-1/4 rounded-full bg-violet-600/8 blur-[100px]" />
        <div className="absolute right-0 top-1/3 h-[300px] w-[400px] rounded-full bg-cyan-600/5 blur-[80px]" />
      </div>

      {/* ── Nav ── */}
      <header style={{ borderColor: "rgba(255,255,255,0.06)", background: "hsl(var(--background) / 0.85)" }} className="sticky top-0 z-50 border-b backdrop-blur-xl">
        <div className="mx-auto flex h-12 max-w-6xl items-center justify-between px-6">
          <div className="flex items-center gap-2.5">
            <div className="flex h-7 w-7 items-center justify-center rounded-lg bg-white">
              <Mail className="h-4 w-4 text-black" />
            </div>
            <span className="text-[13px] font-semibold tracking-tight">OpenMail</span>
          </div>

          <nav className="hidden items-center gap-1 md:flex">
            {[
              { label: "Features", href: "#features" },
              { label: "AI Agents", href: "#ai" },
              { label: "Pricing", href: "#pricing" },
              { label: "Docs", href: GITHUB_REPO },
            ].map(({ label, href }) => (
              <a
                key={label}
                href={href}
                target={href.startsWith("http") ? "_blank" : undefined}
                rel={href.startsWith("http") ? "noreferrer" : undefined}
                className="rounded-md px-3 py-1.5 text-[13px] text-white/50 transition-colors hover:text-white/90"
              >
                {label}
              </a>
            ))}
          </nav>

          <div className="flex items-center gap-2">
            <a
              href={GITHUB_REPO}
              target="_blank"
              rel="noreferrer"
              style={{ borderColor: "rgba(255,255,255,0.1)", backgroundColor: "rgba(255,255,255,0.05)" }}
            className="hidden items-center gap-1.5 rounded-lg border px-3 py-1.5 text-xs font-medium text-white/60 transition-colors hover:bg-white/10 hover:text-white sm:flex tabular-nums"
            >
              <Star className="h-3 w-3" />
              {stars != null ? stars.toLocaleString() : "Star"}
            </a>
            <Link
              to="/login"
              className="rounded-lg bg-white px-4 py-1.5 text-sm font-medium text-black transition-opacity hover:opacity-85 cursor-pointer"
            >
              Sign in
            </Link>
          </div>
        </div>
      </header>

      {/* ── Hero ── */}
      <section className="relative mx-auto max-w-6xl px-6 pt-20 pb-4 text-center">
        <div style={{ borderColor: "rgba(255,255,255,0.1)", backgroundColor: "rgba(255,255,255,0.05)" }} className="mb-6 inline-flex items-center gap-2 rounded-full border px-3 py-1">
          <span className="h-1.5 w-1.5 rounded-full bg-violet-400" />
          <span className="text-xs font-medium text-white/60">
            Open source · Free to self-host
          </span>
        </div>

        <h1 className="mx-auto max-w-3xl text-5xl font-bold leading-tight tracking-tight md:text-6xl lg:text-7xl">
          The open&#8209;source{" "}
          <span className="bg-gradient-to-br from-violet-300 via-violet-400 to-cyan-400 bg-clip-text text-transparent">
            Customer.io
          </span>{" "}
          alternative
        </h1>

        <p className="mx-auto mt-5 max-w-lg text-base leading-relaxed text-white/50 md:text-lg">
          Lifecycle email marketing built for product teams. Automate onboarding,
          retention, and re-engagement — without the enterprise price tag.
        </p>

        <div className="mt-8 flex flex-col items-center justify-center gap-2.5 sm:flex-row">
          <Link
            to="/login"
            className="flex items-center gap-2 rounded-lg bg-white px-5 py-2.5 text-sm font-semibold text-black transition-opacity hover:opacity-85 cursor-pointer"
          >
            Get started free
            <ArrowRight className="h-4 w-4" />
          </Link>
          <a
            href={GITHUB_REPO}
            target="_blank"
            rel="noreferrer"
            style={{ borderColor: "rgba(255,255,255,0.1)", backgroundColor: "rgba(255,255,255,0.05)" }}
            className="flex items-center gap-2 rounded-lg border px-5 py-2.5 text-sm font-semibold text-white/70 transition-colors hover:bg-white/10 hover:text-white"
          >
            <Github className="h-4 w-4" />
            View on GitHub
          </a>
        </div>

        {/* Dashboard mockup — hidden on mobile */}
        <div className="hidden sm:block">
          <DashboardMockup />
        </div>
      </section>

      {/* ── Comparison ── */}
      <section id="features" className="mx-auto max-w-6xl px-6 pt-24 pb-20">
        <div className="mx-auto max-w-xl">
          <p className="mb-2 text-center text-xs font-medium uppercase tracking-widest text-white/25">
            Why OpenMail
          </p>
          <h2 className="mb-8 text-center text-2xl font-semibold tracking-tight">
            Everything Customer.io has. At a fraction of the cost.
          </h2>

          <div
            style={{ borderColor: "rgba(255,255,255,0.08)", backgroundColor: "rgba(255,255,255,0.04)" }}
            className="overflow-hidden rounded-xl border"
          >
            <div
              style={{ borderColor: "rgba(255,255,255,0.08)", backgroundColor: "rgba(255,255,255,0.05)" }}
              className="grid grid-cols-3 border-b px-5 py-2.5"
            >
              <span className="text-xs font-medium text-white/35">Feature</span>
              <span className="text-center text-xs font-semibold text-white">OpenMail</span>
              <span className="text-center text-xs font-medium text-white/35">Customer.io</span>
            </div>
            {[
              { feature: "Self-hosted option",     us: true,        them: false              },
              { feature: "Full API access",         us: true,        them: "Limited"          },
              { feature: "AI agent integration",    us: true,        them: false              },
              { feature: "Real-time dashboards",    us: true,        them: false              },
              { feature: "Per-seat pricing",        us: "Never",     them: "$1k–$10k+/mo"    },
              { feature: "You own your data",       us: true,        them: false              },
              { feature: "Open source",             us: true,        them: false              },
            ].map(({ feature, us, them }) => (
              <div
                key={feature}
                style={{ borderColor: "rgba(255,255,255,0.05)" }}
                className="grid grid-cols-3 border-b px-5 py-3 last:border-0"
              >
                <span className="text-sm text-white/55">{feature}</span>
                <div className="flex justify-center">
                  {typeof us === "boolean" ? (
                    <div className="flex h-5 w-5 items-center justify-center rounded-full bg-emerald-500/15">
                      <Check className="h-3 w-3 text-emerald-400" />
                    </div>
                  ) : (
                    <span className="text-xs font-medium text-emerald-400">{us}</span>
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
                    <span className="text-xs text-white/35">{them}</span>
                  )}
                </div>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* ── Feature grid ── */}
      <section className="mx-auto max-w-6xl px-6 pb-20">
        <p className="mb-2 text-center text-xs font-medium uppercase tracking-widest text-white/25">
          Platform
        </p>
        <h2 className="mb-10 text-center text-2xl font-semibold tracking-tight">
          Everything you need to run email at scale
        </h2>
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
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
            desc="Connect Claude, GPT, or any AI agent to create campaigns, enroll contacts, and pull analytics — all through natural language."
            accent
          />
          <FeatureCard
            icon={Activity}
            title="Real-Time Everything"
            desc="Live send progress bars, instant activity feeds, and dashboards that update as events happen. No page refreshes needed."
            accent
          />
          <FeatureCard
            icon={Lock}
            title="Teams & Workspaces"
            desc="Invite your team, set roles, and manage multiple projects in separate workspaces. Everyone sees what they need, nothing they don't."
            accent
          />
        </div>
      </section>

      {/* ── AI section ── */}
      <section id="ai" className="mx-auto max-w-6xl px-6 pb-20">
        <div style={{ borderColor: "rgba(139,92,246,0.2)" }} className="overflow-hidden rounded-xl border bg-gradient-to-br from-violet-500/10 via-violet-500/5 to-transparent p-8 md:p-12">
          <div className="grid gap-10 md:grid-cols-2 md:items-center">
            <div>
              <div style={{ borderColor: "rgba(139,92,246,0.25)", backgroundColor: "rgba(139,92,246,0.1)" }} className="mb-4 inline-flex items-center gap-2 rounded-full border px-3 py-1 text-xs font-medium text-violet-400">
                <Bot className="h-3.5 w-3.5" />
                AI-Native
              </div>
              <h2 className="mb-3 text-2xl font-bold tracking-tight md:text-3xl">
                Let your AI agents run email
              </h2>
              <p className="mb-6 text-sm leading-relaxed text-white/50">
                OpenMail connects directly to Claude, GPT, Cursor, and any agent
                that supports the Model Context Protocol. Your AI can create
                campaigns, enroll contacts, send broadcasts, and pull
                analytics — all through a single conversation.
              </p>
              <div className="space-y-2 text-sm text-white/50">
                {[
                  "\"Create a re-engagement campaign for users inactive 30+ days\"",
                  "\"Send the August newsletter to all paid customers\"",
                  "\"What's the open rate on our onboarding sequence?\"",
                ].map((q) => (
                  <div key={q} className="flex items-start gap-2">
                    <span className="mt-0.5 shrink-0 text-violet-400/60">→</span>
                    <span className="italic text-white/40">{q}</span>
                  </div>
                ))}
              </div>
            </div>

            <div>
              <div className="flex items-center gap-1.5 mb-2 text-xs text-white/30">
                <Terminal className="h-3.5 w-3.5" />
                <span>Connect in 30 seconds</span>
              </div>
              <div style={{ borderColor: "rgba(255,255,255,0.08)" }} className="overflow-x-auto rounded-xl border bg-card p-5 shadow-inner">
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
                  <span className="text-emerald-400">"https://mcp.openmail.dev/mcp"</span>
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
        <p className="mb-2 text-center text-xs font-medium uppercase tracking-widest text-white/25">
          Pricing
        </p>
        <h2 className="mb-3 text-center text-2xl font-semibold tracking-tight">
          Simple. Honest. No surprises.
        </h2>
        <p className="mb-10 text-center text-sm text-white/40">
          No per-seat fees. No contact limits on self-hosted. No lock-in.
        </p>

        <div className="mx-auto grid max-w-2xl gap-4 md:grid-cols-2">
          {/* Self-hosted */}
          <div style={{ borderColor: "rgba(255,255,255,0.08)", backgroundColor: "rgba(255,255,255,0.04)" }} className="flex flex-col rounded-xl border p-7">
            <p className="mb-1 text-xs font-medium uppercase tracking-wider text-white/40">
              Self-hosted
            </p>
            <p className="mb-1 text-4xl font-bold tracking-tight">Free</p>
            <p className="mb-6 text-sm text-white/40">Forever. No credit card required.</p>
            <ul className="mb-8 flex-1 space-y-2.5">
              {[
                "Unlimited contacts",
                "Unlimited email sends",
                "Full API & AI agent access",
                "Your infrastructure, your data",
                "Community support",
              ].map((f) => (
                <li key={f} className="flex items-center gap-2.5 text-sm text-white/55">
                  <Check className="h-3.5 w-3.5 shrink-0 text-emerald-400" />
                  {f}
                </li>
              ))}
            </ul>
            <a
              href={GITHUB_REPO}
              target="_blank"
              rel="noreferrer"
              style={{ borderColor: "rgba(255,255,255,0.1)" }}
              className="flex items-center justify-center gap-2 rounded-lg border py-2.5 text-sm font-medium text-white/60 transition-colors hover:bg-white/5 hover:text-white cursor-pointer"
            >
              <Github className="h-4 w-4" />
              Clone on GitHub
            </a>
          </div>

          {/* Cloud / Enterprise */}
          <div style={{ borderColor: "rgba(139,92,246,0.25)" }} className="flex flex-col rounded-xl border bg-gradient-to-br from-violet-500/8 to-violet-500/5 p-7">
            <p className="mb-1 text-xs font-medium uppercase tracking-wider text-violet-400">
              Enterprise
            </p>
            <p className="mb-1 text-4xl font-bold tracking-tight">Custom</p>
            <p className="mb-6 text-sm text-white/40">Fully managed, with an SLA.</p>
            <ul className="mb-8 flex-1 space-y-2.5">
              {[
                "Managed cloud hosting",
                "99.9% uptime SLA",
                "SSO (SAML, Okta)",
                "Dedicated onboarding",
                "Priority support",
              ].map((f) => (
                <li key={f} className="flex items-center gap-2.5 text-sm text-white/55">
                  <Check className="h-3.5 w-3.5 shrink-0 text-violet-400" />
                  {f}
                </li>
              ))}
            </ul>
            <a
              href="mailto:kai@1flow.ai"
              className="flex items-center justify-center gap-2 rounded-lg bg-violet-600 py-2.5 text-sm font-semibold text-white transition-opacity hover:opacity-90 cursor-pointer"
            >
              Talk to sales
              <ArrowRight className="h-4 w-4" />
            </a>
          </div>
        </div>
      </section>

      {/* ── CTA ── */}
      <section className="mx-auto max-w-6xl px-6 pb-28 text-center">
        <div style={{ borderColor: "rgba(255,255,255,0.08)", backgroundColor: "rgba(255,255,255,0.04)" }} className="relative overflow-hidden rounded-xl border px-8 py-16">
          <div
            aria-hidden
            className="pointer-events-none absolute inset-0 bg-gradient-to-b from-violet-600/5 to-transparent"
          />
          <h2 className="relative mb-3 text-2xl font-bold tracking-tight md:text-3xl">
            Own your email stack.
          </h2>
          <p className="relative mx-auto mb-8 max-w-sm text-sm text-white/45">
            Get started in minutes. No credit card, no vendor lock-in,
            no per-seat fees — ever.
          </p>
          <div className="relative flex flex-col items-center justify-center gap-2.5 sm:flex-row">
            <Link
              to="/login"
              className="flex items-center gap-2 rounded-lg bg-white px-6 py-2.5 text-sm font-semibold text-black transition-opacity hover:opacity-85 cursor-pointer"
            >
              Start for free
              <ArrowRight className="h-4 w-4" />
            </Link>
            <a
              href="mailto:kai@1flow.ai"
              style={{ borderColor: "rgba(255,255,255,0.1)" }}
              className="flex items-center gap-2 rounded-lg border px-6 py-2.5 text-sm font-semibold text-white/60 transition-colors hover:bg-white/5 hover:text-white"
            >
              Talk to us
            </a>
          </div>
        </div>
      </section>

      {/* ── Footer ── */}
      <footer style={{ borderColor: "rgba(255,255,255,0.06)" }} className="border-t px-6 py-8">
        <div className="mx-auto flex max-w-6xl items-center justify-between">
          <div className="flex items-center gap-2">
            <div className="flex h-6 w-6 items-center justify-center rounded-md bg-white">
              <Mail className="h-3.5 w-3.5 text-black" />
            </div>
            <span className="text-sm font-semibold">OpenMail</span>
          </div>
          <div className="flex items-center gap-5 text-xs text-white/30">
            <a
              href={GITHUB_REPO}
              target="_blank"
              rel="noreferrer"
              className="flex items-center gap-1.5 transition-colors hover:text-white/60"
            >
              <Github className="h-3.5 w-3.5" />
              GitHub
            </a>
            <a href="mailto:kai@1flow.ai" className="transition-colors hover:text-white/60">
              kai@1flow.ai
            </a>
          </div>
        </div>
      </footer>
    </div>
  );
}
