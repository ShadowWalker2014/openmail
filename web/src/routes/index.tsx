import { createFileRoute, Link } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { apiFetch } from "@/lib/api";
import { cn } from "@/lib/utils";
import {
  Mail, Zap, Users, BarChart3, Code2, Bot, ArrowRight,
  Check, Github, Star, GitFork, Globe, Lock, Cpu
} from "lucide-react";

export const Route = createFileRoute("/")({
  component: LandingPage,
});

// ─── tiny reusable pieces ────────────────────────────────────────────────────

function Badge({ children, className }: { children: React.ReactNode; className?: string }) {
  return (
    <span className={cn(
      "inline-flex items-center gap-1.5 rounded-full border border-white/10 bg-white/5 px-3 py-1 text-xs font-medium text-white/70",
      className
    )}>
      {children}
    </span>
  );
}

function FeatureCard({
  icon: Icon, title, desc, accent = false
}: { icon: React.ElementType; title: string; desc: string; accent?: boolean }) {
  return (
    <div className={cn(
      "group relative rounded-2xl border p-6 transition-all duration-200",
      accent
        ? "border-violet-500/30 bg-violet-500/5 hover:border-violet-500/50 hover:bg-violet-500/10"
        : "border-white/8 bg-white/3 hover:border-white/15 hover:bg-white/6"
    )}>
      <div className={cn(
        "mb-4 inline-flex rounded-xl p-2.5",
        accent ? "bg-violet-500/15 text-violet-400" : "bg-white/8 text-white/60"
      )}>
        <Icon className="h-5 w-5" />
      </div>
      <h3 className="mb-1.5 text-sm font-semibold text-white">{title}</h3>
      <p className="text-sm leading-relaxed text-white/50">{desc}</p>
    </div>
  );
}

function CompareRow({ feature, us, them }: { feature: string; us: boolean | string; them: boolean | string }) {
  return (
    <tr className="border-b border-white/5 last:border-0">
      <td className="py-3 pr-8 text-sm text-white/60">{feature}</td>
      <td className="py-3 pr-8 text-center">
        {typeof us === "boolean" ? (
          us ? <Check className="mx-auto h-4 w-4 text-emerald-400" /> : <span className="text-white/20">—</span>
        ) : (
          <span className="text-xs font-medium text-emerald-400">{us}</span>
        )}
      </td>
      <td className="py-3 text-center">
        {typeof them === "boolean" ? (
          them ? <Check className="mx-auto h-4 w-4 text-white/30" /> : <span className="text-white/20">—</span>
        ) : (
          <span className="text-xs text-white/40">{them}</span>
        )}
      </td>
    </tr>
  );
}

// ─── GitHub stars (best-effort, no auth needed) ───────────────────────────
function useGitHubStars() {
  return useQuery({
    queryKey: ["github-stars"],
    queryFn: () =>
      fetch("https://api.github.com/repos/ShadowWalker2014/openmail")
        .then((r) => r.json())
        .then((d) => d.stargazers_count as number),
    staleTime: 5 * 60_000,
    retry: false,
  });
}

// ─── Main ─────────────────────────────────────────────────────────────────
function LandingPage() {
  const { data: stars } = useGitHubStars();

  return (
    <div className="min-h-screen bg-[#080809] text-white antialiased selection:bg-violet-500/30">
      {/* subtle radial glow behind hero */}
      <div
        aria-hidden
        className="pointer-events-none fixed inset-0 overflow-hidden"
      >
        <div className="absolute left-1/2 top-0 h-[600px] w-[900px] -translate-x-1/2 rounded-full bg-violet-600/10 blur-[120px]" />
      </div>

      {/* ── Nav ── */}
      <header className="sticky top-0 z-50 border-b border-white/6 bg-[#080809]/80 backdrop-blur-md">
        <div className="mx-auto flex h-14 max-w-6xl items-center justify-between px-6">
          <div className="flex items-center gap-2">
            <div className="flex h-7 w-7 items-center justify-center rounded-lg bg-white">
              <Mail className="h-4 w-4 text-black" />
            </div>
            <span className="text-sm font-semibold tracking-tight">OpenMail</span>
          </div>
          <nav className="hidden items-center gap-6 md:flex">
            {["Features", "Docs", "GitHub"].map((item) => (
              <a
                key={item}
                href={item === "GitHub" ? "https://github.com/ShadowWalker2014/openmail" : `#${item.toLowerCase()}`}
                target={item === "GitHub" ? "_blank" : undefined}
                rel={item === "GitHub" ? "noreferrer" : undefined}
                className="text-sm text-white/50 transition-colors hover:text-white"
              >
                {item}
              </a>
            ))}
          </nav>
          <div className="flex items-center gap-3">
            <a
              href="https://github.com/ShadowWalker2014/openmail"
              target="_blank"
              rel="noreferrer"
              className="hidden items-center gap-1.5 rounded-lg border border-white/10 bg-white/5 px-3 py-1.5 text-xs font-medium text-white/70 transition-all hover:bg-white/10 hover:text-white sm:flex"
            >
              <Star className="h-3 w-3" />
              {stars != null ? stars.toLocaleString() : "Star"}
            </a>
            <Link
              to="/login"
              className="rounded-lg bg-white px-4 py-1.5 text-sm font-medium text-black transition-opacity hover:opacity-90 cursor-pointer"
            >
              Sign in
            </Link>
          </div>
        </div>
      </header>

      {/* ── Hero ── */}
      <section className="relative mx-auto max-w-6xl px-6 pb-24 pt-24 text-center">
        <Badge className="mb-6">
          <Star className="h-3 w-3" />
          Open source · ELv2 License
        </Badge>

        <h1 className="mx-auto max-w-3xl text-5xl font-bold leading-[1.1] tracking-tight md:text-6xl lg:text-7xl">
          The open-source{" "}
          <span className="bg-gradient-to-r from-violet-400 to-cyan-400 bg-clip-text text-transparent">
            Customer.io
          </span>{" "}
          alternative
        </h1>

        <p className="mx-auto mt-6 max-w-xl text-lg leading-relaxed text-white/50">
          PLG customer lifecycle email marketing with a <strong className="text-white/80">full REST API</strong>,
          native <strong className="text-white/80">MCP server</strong> for AI agents, and zero per-seat pricing.
          Self-host in minutes.
        </p>

        <div className="mt-10 flex flex-col items-center justify-center gap-3 sm:flex-row">
          <Link
            to="/login"
            className="flex items-center gap-2 rounded-xl bg-white px-6 py-3 text-sm font-semibold text-black transition-opacity hover:opacity-90 cursor-pointer"
          >
            Get started free
            <ArrowRight className="h-4 w-4" />
          </Link>
          <a
            href="https://github.com/ShadowWalker2014/openmail"
            target="_blank"
            rel="noreferrer"
            className="flex items-center gap-2 rounded-xl border border-white/10 bg-white/5 px-6 py-3 text-sm font-semibold text-white/80 transition-all hover:bg-white/10 hover:text-white"
          >
            <Github className="h-4 w-4" />
            View on GitHub
          </a>
        </div>

        {/* stack badges */}
        <div className="mt-12 flex flex-wrap items-center justify-center gap-2">
          {["Hono", "Drizzle ORM", "BullMQ", "ElectricSQL", "Resend", "Better Auth"].map((t) => (
            <Badge key={t}>{t}</Badge>
          ))}
        </div>
      </section>

      {/* ── Comparison ── */}
      <section id="features" className="mx-auto max-w-6xl px-6 pb-24">
        <div className="mx-auto max-w-2xl">
          <h2 className="mb-2 text-center text-sm font-medium uppercase tracking-widest text-white/30">
            Why OpenMail
          </h2>
          <div className="overflow-hidden rounded-2xl border border-white/8">
            {/* header */}
            <div className="grid grid-cols-3 border-b border-white/8 bg-white/3 px-6 py-3">
              <span className="text-xs font-medium text-white/40">Feature</span>
              <span className="text-center text-xs font-semibold text-white">OpenMail</span>
              <span className="text-center text-xs font-medium text-white/40">Customer.io</span>
            </div>
            <table className="w-full px-6">
              <tbody className="divide-y divide-white/5">
                <tr className="border-b border-white/5">
                  <td className="px-6 py-3 text-sm text-white/60">Self-hosted</td>
                  <td className="py-3 pr-8 text-center"><Check className="mx-auto h-4 w-4 text-emerald-400" /></td>
                  <td className="py-3 text-center"><span className="text-white/20">—</span></td>
                </tr>
                <tr className="border-b border-white/5">
                  <td className="px-6 py-3 text-sm text-white/60">Full REST API</td>
                  <td className="py-3 pr-8 text-center"><span className="text-xs font-medium text-emerald-400">Everything</span></td>
                  <td className="py-3 text-center"><span className="text-xs text-white/40">Limited</span></td>
                </tr>
                <tr className="border-b border-white/5">
                  <td className="px-6 py-3 text-sm text-white/60 flex items-center gap-1.5"><Cpu className="h-3.5 w-3.5 text-violet-400" />MCP server for AI agents</td>
                  <td className="py-3 pr-8 text-center"><Check className="mx-auto h-4 w-4 text-emerald-400" /></td>
                  <td className="py-3 text-center"><span className="text-white/20">—</span></td>
                </tr>
                <tr className="border-b border-white/5">
                  <td className="px-6 py-3 text-sm text-white/60">Real-time sync</td>
                  <td className="py-3 pr-8 text-center"><span className="text-xs font-medium text-emerald-400">ElectricSQL</span></td>
                  <td className="py-3 text-center"><span className="text-white/20">—</span></td>
                </tr>
                <tr className="border-b border-white/5">
                  <td className="px-6 py-3 text-sm text-white/60">Per-seat pricing</td>
                  <td className="py-3 pr-8 text-center"><span className="text-xs font-medium text-emerald-400">Never</span></td>
                  <td className="py-3 text-center"><span className="text-xs text-white/40">$1k–$10k+/mo</span></td>
                </tr>
                <tr>
                  <td className="px-6 py-3 text-sm text-white/60">Data ownership</td>
                  <td className="py-3 pr-8 text-center"><Check className="mx-auto h-4 w-4 text-emerald-400" /></td>
                  <td className="py-3 text-center"><span className="text-white/20">—</span></td>
                </tr>
              </tbody>
            </table>
          </div>
        </div>
      </section>

      {/* ── Feature grid ── */}
      <section className="mx-auto max-w-6xl px-6 pb-24">
        <h2 className="mb-2 text-center text-sm font-medium uppercase tracking-widest text-white/30">
          Platform
        </h2>
        <p className="mb-10 text-center text-2xl font-semibold tracking-tight">
          Everything you need to run email at scale
        </p>
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          <FeatureCard icon={Mail} title="Broadcasts" desc="One-off email blasts to any segment with scheduling, live send progress, and open/click tracking." />
          <FeatureCard icon={Zap} title="Campaigns" desc="Event-triggered automation sequences. Enroll contacts automatically when they sign up, upgrade, or churn." />
          <FeatureCard icon={Users} title="Contacts & Segments" desc="Flexible attributes and rule-based dynamic segments. Filter by plan, activity, MRR — anything." />
          <FeatureCard icon={Code2} title="Full REST API" desc="Create campaigns, track events, manage contacts, send broadcasts — every feature available via API." />
          <FeatureCard icon={BarChart3} title="Live Analytics" desc="Real-time open rates, click rates, and unsubscribes powered by ElectricSQL. No polling, ever." />
          <FeatureCard icon={Globe} title="Click Tracking" desc="Automatic link rewriting, open pixel injection, and unsubscribe handling per CAN-SPAM requirements." />
          <FeatureCard
            icon={Bot}
            title="MCP Server — AI Agents"
            desc="17 tools exposed via the Model Context Protocol HTTP server. Claude, GPT, or any agent can run full campaigns."
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

      {/* ── MCP showcase ── */}
      <section className="mx-auto max-w-6xl px-6 pb-24">
        <div className="overflow-hidden rounded-2xl border border-violet-500/20 bg-gradient-to-br from-violet-500/8 to-transparent p-8 md:p-12">
          <div className="mb-3 inline-flex items-center gap-2 rounded-full border border-violet-500/30 bg-violet-500/10 px-3 py-1 text-xs font-medium text-violet-400">
            <Bot className="h-3.5 w-3.5" />
            AI-Native
          </div>
          <h2 className="mb-4 max-w-xl text-3xl font-bold tracking-tight md:text-4xl">
            Let your AI agent run email campaigns
          </h2>
          <p className="mb-8 max-w-lg text-white/50">
            OpenMail ships a native{" "}
            <a href="https://modelcontextprotocol.io" target="_blank" rel="noreferrer" className="text-violet-400 hover:underline">
              MCP (Model Context Protocol)
            </a>{" "}
            HTTP server. Connect Claude, GPT, or any agent to create campaigns, track events, and analyse performance — no code, no dashboard.
          </p>
          <div className="overflow-x-auto rounded-xl border border-white/8 bg-[#0d0d10] p-5">
            <pre className="text-xs leading-relaxed text-white/70">
              <span className="text-white/30">{"// claude.json / cursor MCP config\n"}</span>
              <span className="text-cyan-400">{"{"}</span>
              {"\n  "}
              <span className="text-violet-300">"mcpServers"</span>
              {": {\n    "}
              <span className="text-violet-300">"openmail"</span>
              {": {\n      "}
              <span className="text-white/60">"url"</span>
              {": "}
              <span className="text-emerald-400">"https://mcp-production-7ca0.up.railway.app/mcp"</span>
              {",\n      "}
              <span className="text-white/60">"headers"</span>
              {": {\n        "}
              <span className="text-white/60">"Authorization"</span>
              {": "}
              <span className="text-emerald-400">"Bearer &lt;workspace-api-key&gt;"</span>
              {"\n      }\n    }\n  }\n"}
              <span className="text-cyan-400">{"}"}</span>
            </pre>
          </div>
          <div className="mt-6 flex flex-wrap gap-2">
            {["list_contacts","create_broadcast","send_broadcast","track_event","get_analytics","create_segment","pause_campaign"].map((tool) => (
              <code key={tool} className="rounded-md border border-violet-500/20 bg-violet-500/8 px-2.5 py-1 text-xs text-violet-300">
                {tool}
              </code>
            ))}
            <span className="rounded-md border border-white/10 px-2.5 py-1 text-xs text-white/30">+10 more</span>
          </div>
        </div>
      </section>

      {/* ── Pricing ── */}
      <section className="mx-auto max-w-6xl px-6 pb-24">
        <h2 className="mb-2 text-center text-sm font-medium uppercase tracking-widest text-white/30">Pricing</h2>
        <p className="mb-10 text-center text-2xl font-semibold tracking-tight">Simple. Honest. Open.</p>
        <div className="grid gap-4 md:grid-cols-2 max-w-2xl mx-auto">
          {/* Free / OSS */}
          <div className="rounded-2xl border border-white/8 bg-white/3 p-7">
            <p className="mb-1 text-sm font-medium text-white/50">Self-hosted</p>
            <p className="mb-4 text-4xl font-bold">Free</p>
            <ul className="mb-6 space-y-2.5 text-sm text-white/60">
              {["Full source code","Unlimited contacts","Unlimited sends","All API & MCP features","Your data, your infra"].map((f) => (
                <li key={f} className="flex items-center gap-2">
                  <Check className="h-3.5 w-3.5 shrink-0 text-emerald-400" />
                  {f}
                </li>
              ))}
            </ul>
            <a
              href="https://github.com/ShadowWalker2014/openmail"
              target="_blank"
              rel="noreferrer"
              className="flex items-center justify-center gap-2 rounded-xl border border-white/10 py-2.5 text-sm font-medium text-white/70 transition-all hover:bg-white/5 hover:text-white cursor-pointer"
            >
              <Github className="h-4 w-4" />
              Clone on GitHub
            </a>
          </div>
          {/* Enterprise */}
          <div className="rounded-2xl border border-violet-500/30 bg-violet-500/5 p-7">
            <p className="mb-1 text-sm font-medium text-violet-400">Enterprise</p>
            <p className="mb-4 text-4xl font-bold">Custom</p>
            <ul className="mb-6 space-y-2.5 text-sm text-white/60">
              {["Managed hosting + SLA","Enterprise SSO (SAML, Okta)","Priority support","Dedicated onboarding","Air-gapped / on-premise"].map((f) => (
                <li key={f} className="flex items-center gap-2">
                  <Check className="h-3.5 w-3.5 shrink-0 text-violet-400" />
                  {f}
                </li>
              ))}
            </ul>
            <a
              href="mailto:kai@1flow.ai"
              className="flex items-center justify-center gap-2 rounded-xl bg-violet-600 py-2.5 text-sm font-semibold text-white transition-opacity hover:opacity-90 cursor-pointer"
            >
              Contact sales
              <ArrowRight className="h-4 w-4" />
            </a>
          </div>
        </div>
      </section>

      {/* ── CTA ── */}
      <section className="mx-auto max-w-6xl px-6 pb-32 text-center">
        <div className="rounded-2xl border border-white/8 bg-white/3 px-8 py-16">
          <h2 className="mb-3 text-3xl font-bold tracking-tight md:text-4xl">
            Ready to own your email stack?
          </h2>
          <p className="mx-auto mb-8 max-w-md text-white/50">
            Deploy in minutes on Railway. No credit card, no lock-in, no per-seat fees.
          </p>
          <div className="flex flex-col items-center justify-center gap-3 sm:flex-row">
            <Link
              to="/login"
              className="flex items-center gap-2 rounded-xl bg-white px-7 py-3 text-sm font-semibold text-black transition-opacity hover:opacity-90 cursor-pointer"
            >
              Start for free
              <ArrowRight className="h-4 w-4" />
            </Link>
            <a
              href="mailto:kai@1flow.ai"
              className="flex items-center gap-2 rounded-xl border border-white/10 px-7 py-3 text-sm font-semibold text-white/70 transition-all hover:bg-white/5 hover:text-white"
            >
              Talk to us
            </a>
          </div>
        </div>
      </section>

      {/* ── Footer ── */}
      <footer className="border-t border-white/6 px-6 py-8">
        <div className="mx-auto flex max-w-6xl items-center justify-between">
          <div className="flex items-center gap-2">
            <div className="flex h-6 w-6 items-center justify-center rounded-md bg-white">
              <Mail className="h-3.5 w-3.5 text-black" />
            </div>
            <span className="text-sm font-semibold">OpenMail</span>
            <span className="text-sm text-white/30">· ELv2 License</span>
          </div>
          <div className="flex items-center gap-4 text-sm text-white/30">
            <a href="https://github.com/ShadowWalker2014/openmail" target="_blank" rel="noreferrer" className="flex items-center gap-1.5 hover:text-white/60 transition-colors">
              <Github className="h-4 w-4" />
              GitHub
            </a>
            <a href="mailto:kai@1flow.ai" className="hover:text-white/60 transition-colors">
              kai@1flow.ai
            </a>
          </div>
        </div>
      </footer>
    </div>
  );
}
