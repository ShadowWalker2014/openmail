import { useState } from "react";
import { Copy, Check, CheckCircle2, XCircle, Clock, AlertTriangle } from "lucide-react";

// ── Types ──────────────────────────────────────────────────────────────────────

export interface ApiKey {
  id: string;
  name: string;
  keyPrefix: string;
  lastUsedAt: string | null;
  createdAt: string;
}

export interface Member {
  id: string;
  userId: string;
  userName: string;
  userEmail: string;
  role: "owner" | "admin" | "member";
  createdAt: string;
}

export interface Invite {
  id: string;
  email: string;
  role: "admin" | "member";
  expiresAt: string;
  createdAt: string;
}

// ── Shared UI helpers ──────────────────────────────────────────────────────────

export function SectionCard({ children }: { children: React.ReactNode }) {
  return (
    <div className="rounded-lg border border-border bg-card overflow-hidden">
      {children}
    </div>
  );
}

export function SectionHeader({
  icon: Icon,
  title,
  description,
}: {
  icon: React.ElementType;
  title: string;
  description?: string;
}) {
  return (
    <div className="flex items-center gap-3 border-b border-border px-5 py-3.5">
      <div className="flex h-7 w-7 items-center justify-center rounded-md border border-border bg-muted/50">
        <Icon className="h-3.5 w-3.5 text-muted-foreground" />
      </div>
      <div>
        <h2 className="text-[13px] font-medium text-foreground">{title}</h2>
        {description && (
          <p className="text-[11px] text-muted-foreground mt-px">{description}</p>
        )}
      </div>
    </div>
  );
}

export function CopyButton({ value }: { value: string }) {
  const [copied, setCopied] = useState(false);
  function handleCopy() {
    navigator.clipboard.writeText(value);
    setCopied(true);
    setTimeout(() => setCopied(false), 1500);
  }
  return (
    <button
      onClick={handleCopy}
      className="shrink-0 rounded p-1.5 text-emerald-500/70 transition-colors hover:bg-emerald-500/10 hover:text-emerald-400 cursor-pointer"
      title={copied ? "Copied!" : "Copy"}
    >
      {copied ? <Check className="h-3.5 w-3.5" /> : <Copy className="h-3.5 w-3.5" />}
    </button>
  );
}

export function RoleBadge({ role }: { role: "owner" | "admin" | "member" }) {
  const styles = {
    owner: "bg-amber-500/15 text-amber-400",
    admin: "bg-violet-500/15 text-violet-400",
    member: "bg-muted text-muted-foreground",
  };
  return (
    <span className={`inline-flex items-center rounded px-1.5 py-0.5 text-[11px] font-medium ${styles[role]}`}>
      {role}
    </span>
  );
}

export function AvatarInitial({ name }: { name: string }) {
  const initial = name?.charAt(0)?.toUpperCase() ?? "?";
  return (
    <div className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-muted border border-border text-[11px] font-semibold text-foreground/80">
      {initial}
    </div>
  );
}

export function DomainStatusBadge({ status }: { status: string }) {
  const configs: Record<string, { label: string; icon: React.ElementType; cls: string }> = {
    verified: { label: "Verified", icon: CheckCircle2, cls: "bg-emerald-500/10 text-emerald-400 border-emerald-500/20" },
    pending: { label: "Verifying…", icon: Clock, cls: "bg-amber-500/10 text-amber-400 border-amber-500/20" },
    not_started: { label: "Not verified", icon: AlertTriangle, cls: "bg-muted/60 text-muted-foreground border-border" },
    failed: { label: "Failed", icon: XCircle, cls: "bg-destructive/10 text-destructive border-destructive/20" },
    temporary_failure: { label: "Temp failure", icon: XCircle, cls: "bg-destructive/10 text-destructive border-destructive/20" },
  };
  const cfg = configs[status] ?? configs.not_started;
  const Icon = cfg.icon;
  return (
    <span className={`inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-[10px] font-medium ${cfg.cls}`}>
      <Icon className="h-2.5 w-2.5" />
      {cfg.label}
    </span>
  );
}

export function RecordStatusDot({ status }: { status: string }) {
  if (status === "verified") return <span className="text-emerald-400" title="Verified">●</span>;
  if (status === "failed") return <span className="text-destructive" title="Failed">●</span>;
  return <span className="text-muted-foreground/40" title="Not verified">●</span>;
}
