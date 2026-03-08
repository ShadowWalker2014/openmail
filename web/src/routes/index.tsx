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
  Cpu,
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

// ─── Tiny badge ──────────────────────────────────────────────────────────────
function Chip({
  children,
  className,
}: {
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1.5 rounded-full border border-white/10 bg-white/5 px-2.5 py-0.5 text-[11px] font-medium text-white/60",
        className
      )}
    >
      {children}
    </span>
  );
}

// ─── Feature card ────────────────────────────────────────────────────────────
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
      className={cn(
        "group relative rounded-xl border p-5 transition-all duration-200",
        accent
          ? "border-violet-500/25 bg-violet-500/5 hover:border-violet-500/40 hover:bg-violet-500/8"
          : "border-white/8 bg-white/[0.03] hover:border-white/14 hover:bg-white/[0.05]"
      )}
    >
      <div
        className={cn(
          "mb-3.5 inline-flex rounded-lg p-2",
          accent ? "bg-violet-500/15 text-violet-400" : "bg-white/8 text-white/50"
        )}
      >
        <Icon className="h-4 w-4" />
      </div>
      <h3 className="mb-1 text-sm font-medium text-white/90">{title}</h3>
      <p className="text-sm leading-relaxed text-white/45">{desc}</p>
    </div>
  );
}

// ─── Dashboard mockup ────────────────────────────────────────────────────────
function DashboardMockup() {
  return (
    <div className="relative mx-auto mt-16 max-w-4xl">
      {/* Glow under mockup */}
      <div className="absolute inset-x-0 -bottom-10 h-32 bg-gradient-to-t from-violet-600/10 to-transparent blur-xl" />

      <div className="relative overflow-hidden rounded-xl border border-white/10 bg-[#0e0e11] shadow-2xl shadow-black/50">
        {/* Window chrome */}
        <div className="flex h-9 items-center gap-1.5 border-b border-white/8 bg-white/[0.03] px-4">
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
          <div className="w-44 shrink-0 border-r border-white/8 bg-white/[0.02] p-3">
            <div className="mb-3 flex items-center gap-2 px-1">
              <div className="h-5 w-5 rounded bg-white/90" />
              <div className="h-3 w-16 rounded bg-white/60" />
            </div>
            <div className="mb-3 h-7 w-full rounded bg-white/5 border border-white/8" />
            {["Dashboard", "Contacts", "Broadcasts", "Campaigns", "Templates"].map((item, i) => (
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
            ))}
          </div>

          {/* Main content */}
          <div className="flex-1 p-5">
            <div className="mb-4">
              <div className="h-4 w-24 rounded bg-white/60 mb-1" />
              <div className="h-2.5 w-16 rounded bg-white/20" />
            </div>
            {/* Stat cards */}
            <div className="mb-4 grid grid-cols-5 gap-2.5">
              {[
                { v: "12,481", label: "Contacts" },
                { v: "48,203", label: "Sent" },
                { v: "42.1%", label: "Open Rate" },
                { v: "8.3%", label: "Clicks" },
                { v: "24", label: "Unsubs" },
              ].map(({ v, label }) => (
                <div
                  key={label}
                  className="rounded-lg border border-white/8 bg-white/[0.04] p-2.5"
                >
                  <div className="mb-1 text-[11px] text-white/35">{label}</div>
                  <div className="text-sm font-semibold text-white/80">{v}</div>
                </div>
              ))}
            </div>
            {/* Activity feed */}
            <div className="rounded-lg border border-white/8 bg-white/[0.04]">
              <div className="flex items-center justify-between border-b border-white/8 px-3 py-2">
                <div className="h-2.5 w-20 rounded bg-white/40" />
                <div className="flex items-center gap-1.5">
                  <div className="h-1.5 w-1.5 rounded-full bg-green-400 animate-pulse" />
                  <div className="h-2 w-12 rounded bg-green-400/40" />
                </div>
              </div>
              {["Email opened", "Link clicked", "Email opened", "Unsubscribed", "Email opened"].map((ev, i) => (
                <div key={i} className="flex items-center gap-2.5 border-b border-white/5 px-3 py-2 last:border-0">
                  <div className={cn(
                    "h-3 w-3 rounded-full shrink-0",
                    ev === "Unsubscribed" ? "bg-red-400/40" :
                    ev === "Link clicked" ? "bg-green-400/40" : "bg-blue-400/40"
                  )} />
                  <div className="h-2 w-20 rounded bg-white/20" />
                  <div className="ml-auto h-2 w-10 rounded bg-white/10" />
                </div>
              ))}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

// ─── Main ────────────────────────────────────────────────────────────────────
function LandingPage() {
  const { data: stars } = useGitHubStars();

  return (
    <div className="min-h-screen bg-[#08080a] text-white antialiased selection:bg-violet-500/25">
      {/* Ambient background glows */}
      <div aria-hidden className="pointer-events-none fixed inset-0 overflow-hidden">
        <div className="absolute left-1/2 top-0 h-[500px] w-[800px] -translate-x-1/2 -translate-y-1/4 rounded-full bg-violet-600/8 blur-[100px]" />
        <div className="absolute right-0 top-1/3 h-[300px] w-[400px] rounded-full bg-cyan-600/5 blur-[80px]" />
      </div>

      {/* ── Nav ────────────────────────────────────────────────────────────── */}
      <header className="sticky top-0 z-50 border-b border-white/[0.06] bg-[#08080a]/80 backdrop-blur-xl">
        <div className="mx-auto flex h-14 max-w-6xl items-center justify-between px-6">
          <div className="flex items-center gap-2.5">
            <div className="flex h-7 w-7 items-center justify-center rounded-lg bg-white">
              <Mail className="h-4 w-4 text-black" />
            </div>
            <span className="text-sm font-semibold tracking-tight">OpenMail</span>
          </div>

          <nav className="hidden items-center gap-1 md:flex">
            {[
              { label: "Features", href: "#features" },
              { label: "MCP", href: "#mcp" },
              { label: "Pricing", href: "#pricing" },
            ].map(({ label, href }) => (
              <a
                key={label}
                href={href}
                className="rounded-md px-3 py-1.5 text-sm text-white/50 transition-colors hover:text-white/90"
              >
                {label}
              </a>
            ))}
            <a
              href={GITHUB_REPO}
              target="_blank"
              rel="noreferrer"
              className="rounded-md px-3 py-1.5 text-sm text-white/50 transition-colors hover:text-white/90"
            >
              Docs
            </a>
          </nav>

          <div className="flex items-center gap-2">
            <a
              href={GITHUB_REPO}
              target="_blank"
              rel="noreferrer"
              className="hidden items-center gap-1.5 rounded-lg border border-white/10 bg-white/5 px-3 py-1.5 text-xs font-medium text-white/60 transition-all hover:bg-white/8 hover:text-white sm:flex"
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

      {/* ── Hero ─────────────────────────────────────────────────────────────── */}
      <section className="relative mx-auto max-w-6xl px-6 pt-20 pb-4 text-center">
        <div className="mb-6 inline-flex items-center gap-2 rounded-full border border-white/10 bg-white/[0.04] px-3 py-1">
          <span className="h-1.5 w-1.5 rounded-full bg-violet-400" />
          <span className="text-[11px] font-medium text-white/60">
            Open source · ELv2 License
          </span>
        </div>

        <h1 className="mx-auto max-w-3xl text-5xl font-bold leading-[1.08] tracking-tight md:text-6xl lg:text-[68px]">
          The open&#8209;source{" "}
          <span className="bg-gradient-to-br from-violet-300 via-violet-400 to-cyan-400 bg-clip-text text-transparent">
            Customer.io
          </span>{" "}
          alternative
        </h1>

        <p className="mx-auto mt-5 max-w-lg text-base leading-relaxed text-white/45 md:text-lg">
          Email lifecycle marketing with a full REST API, native{" "}
          <span className="text-white/70">MCP server</span> for AI agents, and
          zero per&#8209;seat pricing. Self&#8209;host in minutes.
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
            className="flex items-center gap-2 rounded-lg border border-white/10 bg-white/[0.04] px-5 py-2.5 text-sm font-semibold text-white/70 transition-all hover:bg-white/8 hover:text-white"
          >
            <Github className="h-4 w-4" />
            View on GitHub
          </a>
        </div>

        {/* Stack badges */}
        <div className="mt-8 flex flex-wrap items-center justify-center gap-1.5">
          {["Hono", "Drizzle ORM", "BullMQ", "ElectricSQL", "Resend", "Better Auth"].map((t) => (
            <Chip key={t}>{t}</Chip>
          ))}
        </div>

        {/* Dashboard mockup */}
        <DashboardMockup />
      </section>

      {/* ── Comparison ──────────────────────────────────────────────────────── */}
      <section id="features" className="mx-auto max-w-6xl px-6 pt-24 pb-20">
        <div className="mx-auto max-w-xl">
          <p className="mb-2 text-center text-xs font-medium uppercase tracking-widest text-white/25">
            Why OpenMail
          </p>
          <h2 className="mb-8 text-center text-2xl font-semibold tracking-tight">
            Everything Customer.io has. Nothing you don't need.
          </h2>

          <div className="overflow-hidden rounded-xl border border-white/8 bg-white/[0.02]">
            <div className="grid grid-cols-3 border-b border-white/8 bg-white/[0.03] px-5 py-2.5">
              <span className="text-xs font-medium text-white/35">Feature</span>
              <span className="text-center text-xs font-semibold text-white">OpenMail</span>
              <span className="text-center text-xs font-medium text-white/35">Customer.io</span>
            </div>
            {[
              { feature: "Self-hosted", us: true, them: false },
              { feature: "Full REST API", us: "Complete", them: "Limited" },
              { feature: "MCP server for AI agents", us: true, them: false },
              { feature: "Real-time sync", us: "ElectricSQL", them: false },
              { feature: "Per-seat pricing", us: "Never", them: "$1k–$10k+/mo" },
              { feature: "Data ownership", us: true, them: false },
              { feature: "Open source", us: true, them: false },
            ].map(({ feature, us, them }) => (
              <div
                key={feature}
                className="grid grid-cols-3 border-b border-white/5 px-5 py-3 last:border-0"
              >
                <span className="text-sm text-white/55">{feature}</span>
                <div className="flex justify-center">
                  {typeof us === "boolean" ? (
                    us ? (
                      <div className="flex h-5 w-5 items-center justify-center rounded-full bg-emerald-500/15">
                        <Check className="h-3 w-3 text-emerald-400" />
                      </div>
                    ) : (
                      <span className="text-white/20">—</span>
                    )
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

      {/* ── Feature grid ───────────────────────────────────────────────────── */}
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
            desc="One-off email blasts to any segment with scheduling, live send progress, and open/click tracking."
          />
          <FeatureCard
            icon={Zap}
            title="Campaigns"
            desc="Event-triggered automation sequences. Enroll contacts when they sign up, upgrade, or churn."
          />
          <FeatureCard
            icon={Users}
            title="Contacts & Segments"
            desc="Flexible attributes and rule-based dynamic segments. Filter by plan, activity, MRR — anything."
          />
          <FeatureCard
            icon={Code2}
            title="Full REST API"
            desc="Create campaigns, track events, manage contacts, send broadcasts — every feature available via API."
          />
          <FeatureCard
            icon={BarChart3}
            title="Live Analytics"
            desc="Real-time open rates, click rates, and unsubscribes powered by ElectricSQL. No polling, ever."
          />
          <FeatureCard
            icon={Globe}
            title="Click Tracking"
            desc="Automatic link rewriting, open pixel injection, and unsubscribe handling per CAN-SPAM requirements."
          />
          <FeatureCard
            icon={Bot}
            title="MCP Server — AI Agents"
            desc="17 tools exposed via Model Context Protocol. Claude, GPT, or any agent can run full campaigns."
            accent
          />
          <FeatureCard
            icon={Cpu}
            title="ElectricSQL Real-time"
            desc="Live send progress bars, instant activity feeds, and real-time dashboard updates via Postgres logical replication."
            accent
          />
          <FeatureCard
            icon={Lock}
            title="Multi-workspace & Auth"
            desc="Team workspaces with role-based access. Better Auth for email/password. Each workspace brings its own Resend key."
            accent
          />
        </div>
      </section>

      {/* ── MCP showcase ──────────────────────────────────────────────────── */}
      <section id="mcp" className="mx-auto max-w-6xl px-6 pb-20">
        <div className="overflow-hidden rounded-xl border border-violet-500/20 bg-gradient-to-br from-violet-500/[0.07] via-violet-500/[0.03] to-transparent p-8 md:p-12">
          <div className="grid gap-10 md:grid-cols-2 md:items-center">
            <div>
              <div className="mb-4 inline-flex items-center gap-2 rounded-full border border-violet-500/25 bg-violet-500/10 px-3 py-1 text-xs font-medium text-violet-400">
                <Bot className="h-3.5 w-3.5" />
                AI-Native
              </div>
              <h2 className="mb-3 text-2xl font-bold tracking-tight md:text-3xl">
                Let your AI agent run email campaigns
              </h2>
              <p className="mb-6 text-sm leading-relaxed text-white/50">
                OpenMail ships a native{" "}
                <a
                  href="https://modelcontextprotocol.io"
                  target="_blank"
                  rel="noreferrer"
                  className="text-violet-400 hover:text-violet-300 transition-colors"
                >
                  MCP (Model Context Protocol)
                </a>{" "}
                HTTP server. Connect Claude, GPT, or any agent to create
                campaigns, track events, and analyse performance — no code, no
                dashboard.
              </p>
              <div className="flex flex-wrap gap-1.5">
                {[
                  "list_contacts",
                  "create_broadcast",
                  "send_broadcast",
                  "track_event",
                  "get_analytics",
                  "create_segment",
                  "pause_campaign",
                ].map((tool) => (
                  <code
                    key={tool}
                    className="rounded border border-violet-500/20 bg-violet-500/8 px-2 py-0.5 text-xs font-mono text-violet-300/80"
                  >
                    {tool}
                  </code>
                ))}
                <span className="rounded border border-white/8 px-2 py-0.5 text-xs text-white/30">
                  +10 more
                </span>
              </div>
            </div>

            <div>
              <div className="flex items-center gap-1.5 mb-2 text-xs text-white/30">
                <Terminal className="h-3.5 w-3.5" />
                <span>claude.json / cursor MCP config</span>
              </div>
              <div className="overflow-x-auto rounded-xl border border-white/8 bg-[#0c0c0f] p-5 shadow-inner">
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
                  <span className="text-emerald-400">
                    "https://mcp.openmail.dev/mcp"
                  </span>
                  <span className="text-white/40">{","}</span>
                  {"\n      "}
                  <span className="text-white/50">"headers"</span>
                  <span className="text-white/40">{": {"}</span>
                  {"\n        "}
                  <span className="text-white/50">"Authorization"</span>
                  <span className="text-white/40">{": "}</span>
                  <span className="text-emerald-400">
                    "Bearer &lt;workspace-api-key&gt;"
                  </span>
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
            </div>
          </div>
        </div>
      </section>

      {/* ── Pricing ─────────────────────────────────────────────────────────── */}
      <section id="pricing" className="mx-auto max-w-6xl px-6 pb-20">
        <p className="mb-2 text-center text-xs font-medium uppercase tracking-widest text-white/25">
          Pricing
        </p>
        <h2 className="mb-10 text-center text-2xl font-semibold tracking-tight">
          Simple. Honest. Open.
        </h2>

        <div className="mx-auto grid max-w-2xl gap-4 md:grid-cols-2">
          {/* Self-hosted */}
          <div className="flex flex-col rounded-xl border border-white/8 bg-white/[0.03] p-7">
            <p className="mb-1 text-xs font-medium uppercase tracking-wider text-white/40">
              Self-hosted
            </p>
            <p className="mb-1 text-4xl font-bold tracking-tight">Free</p>
            <p className="mb-6 text-sm text-white/40">Forever. No credit card.</p>
            <ul className="mb-8 flex-1 space-y-2.5">
              {[
                "Full source code",
                "Unlimited contacts",
                "Unlimited sends",
                "All API & MCP features",
                "Your data, your infra",
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
              className="flex items-center justify-center gap-2 rounded-lg border border-white/10 py-2.5 text-sm font-medium text-white/60 transition-all hover:bg-white/5 hover:text-white cursor-pointer"
            >
              <Github className="h-4 w-4" />
              Clone on GitHub
            </a>
          </div>

          {/* Enterprise */}
          <div className="flex flex-col rounded-xl border border-violet-500/25 bg-gradient-to-br from-violet-500/8 to-violet-500/[0.03] p-7">
            <p className="mb-1 text-xs font-medium uppercase tracking-wider text-violet-400">
              Enterprise
            </p>
            <p className="mb-1 text-4xl font-bold tracking-tight">Custom</p>
            <p className="mb-6 text-sm text-white/40">Managed hosting + SLA.</p>
            <ul className="mb-8 flex-1 space-y-2.5">
              {[
                "Managed hosting + SLA",
                "Enterprise SSO (SAML, Okta)",
                "Priority support",
                "Dedicated onboarding",
                "Air-gapped / on-premise",
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
              Contact sales
              <ArrowRight className="h-4 w-4" />
            </a>
          </div>
        </div>
      </section>

      {/* ── CTA ─────────────────────────────────────────────────────────────── */}
      <section className="mx-auto max-w-6xl px-6 pb-28 text-center">
        <div className="relative overflow-hidden rounded-xl border border-white/8 bg-white/[0.03] px-8 py-16">
          <div
            aria-hidden
            className="pointer-events-none absolute inset-0 bg-gradient-to-b from-violet-600/5 to-transparent"
          />
          <h2 className="relative mb-3 text-2xl font-bold tracking-tight md:text-3xl">
            Ready to own your email stack?
          </h2>
          <p className="relative mx-auto mb-8 max-w-sm text-sm text-white/45">
            Deploy in minutes on Railway. No credit card, no lock-in, no
            per-seat fees.
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
              className="flex items-center gap-2 rounded-lg border border-white/10 px-6 py-2.5 text-sm font-semibold text-white/60 transition-all hover:bg-white/5 hover:text-white"
            >
              Talk to us
            </a>
          </div>
        </div>
      </section>

      {/* ── Footer ──────────────────────────────────────────────────────────── */}
      <footer className="border-t border-white/[0.06] px-6 py-8">
        <div className="mx-auto flex max-w-6xl items-center justify-between">
          <div className="flex items-center gap-2">
            <div className="flex h-6 w-6 items-center justify-center rounded-md bg-white">
              <Mail className="h-3.5 w-3.5 text-black" />
            </div>
            <span className="text-sm font-semibold">OpenMail</span>
            <span className="mx-2 text-white/15">·</span>
            <span className="text-xs text-white/30">ELv2 License</span>
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
            <a
              href="mailto:kai@1flow.ai"
              className="transition-colors hover:text-white/60"
            >
              kai@1flow.ai
            </a>
          </div>
        </div>
      </footer>
    </div>
  );
}
