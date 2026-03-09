import { createFileRoute } from "@tanstack/react-router";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { sessionFetch } from "@/lib/api";
import { useWorkspaceStore } from "@/store/workspace";
import { useWorkspaces } from "@/hooks/use-workspaces";
import type { DomainRecord } from "@/hooks/use-workspaces";
import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  AlertDialog,
  AlertDialogContent,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogAction,
  AlertDialogCancel,
} from "@/components/ui/alert-dialog";
import {
  Globe, Trash2, RefreshCw, ExternalLink,
  CheckCircle2, Clock, XCircle, AlertTriangle,
} from "lucide-react";
import { toast } from "sonner";
import {
  SectionCard, SectionHeader,
  CopyButton, DomainStatusBadge, RecordStatusDot,
} from "@/components/settings/shared";

export const Route = createFileRoute("/_app/settings/domain")({
  component: DomainSettingsPage,
});

interface DomainResponse {
  id: string;
  name: string;
  status: string;
  records: DomainRecord[];
}

function DomainSettingsPage() {
  const { activeWorkspaceId } = useWorkspaceStore();
  const { activeWorkspace } = useWorkspaces();
  const qc = useQueryClient();

  const [domainInput, setDomainInput] = useState("");
  const [showRecords, setShowRecords] = useState(false);
  const [confirmDisconnect, setConfirmDisconnect] = useState(false);

  if (!activeWorkspaceId) return null;

  const hasDomain = !!activeWorkspace?.resendDomainName;
  const status = activeWorkspace?.resendDomainStatus ?? "not_started";
  const records = (activeWorkspace?.resendDomainRecords ?? []) as DomainRecord[];

  const connectMutation = useMutation({
    mutationFn: (domainName: string) =>
      sessionFetch<DomainResponse>(activeWorkspaceId, "/domains/connect", {
        method: "POST",
        body: JSON.stringify({ domainName }),
      }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["workspaces"] });
      setDomainInput("");
      setShowRecords(true);
      toast.success("Domain connected — add the DNS records below to your DNS provider.");
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const verifyMutation = useMutation({
    mutationFn: () =>
      sessionFetch<{ status: string }>(activeWorkspaceId, "/domains/verify", { method: "POST" }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["workspaces"] });
      toast.success("Verification started — this may take a few minutes.");
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const refreshMutation = useMutation({
    mutationFn: () =>
      sessionFetch<DomainResponse>(activeWorkspaceId, "/domains/refresh", { method: "POST" }),
    onSuccess: (data) => {
      qc.invalidateQueries({ queryKey: ["workspaces"] });
      if (data.status === "verified") {
        toast.success("Domain verified! You can now send from this domain.");
      } else {
        toast.info(`Status: ${data.status}. DNS records may still be propagating.`);
      }
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const disconnectMutation = useMutation({
    mutationFn: () => sessionFetch(activeWorkspaceId, "/domains", { method: "DELETE" }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["workspaces"] });
      setConfirmDisconnect(false);
      setShowRecords(false);
      toast.success("Domain disconnected.");
    },
    onError: (e: Error) => {
      setConfirmDisconnect(false);
      toast.error(e.message);
    },
  });

  return (
    <>
      <SectionCard>
        <SectionHeader
          icon={Globe}
          title="Sending Domain"
          description="Connect and verify a custom domain for sending emails"
        />
        <div className="px-5 py-4 space-y-4">
          {!hasDomain ? (
            <div className="space-y-3">
              <p className="text-[12px] text-muted-foreground">
                Connect a custom sending domain (e.g.{" "}
                <code className="rounded bg-muted px-1 py-px font-mono text-[11px]">mail.yourapp.com</code>
                ) to send emails from your own domain via Resend.
              </p>
              {!activeWorkspace?.resendFromEmail && (
                <div className="flex items-start gap-2 rounded-md border border-amber-500/20 bg-amber-500/8 px-3 py-2.5">
                  <AlertTriangle className="h-3.5 w-3.5 shrink-0 text-amber-400 mt-px" />
                  <p className="text-[11px] text-amber-300">
                    Configure your Resend API key in the Email Sending section first.
                  </p>
                </div>
              )}
              <form
                onSubmit={(e) => {
                  e.preventDefault();
                  if (domainInput) connectMutation.mutate(domainInput);
                }}
                className="flex gap-2"
              >
                <Input
                  value={domainInput}
                  onChange={(e) => setDomainInput(e.target.value)}
                  placeholder="mail.yourapp.com"
                  className="flex-1"
                  pattern="^[a-zA-Z0-9]([a-zA-Z0-9\-]*[a-zA-Z0-9])?(\.[a-zA-Z0-9]([a-zA-Z0-9\-]*[a-zA-Z0-9])?)+$"
                />
                <Button type="submit" size="sm" disabled={!domainInput || connectMutation.isPending}>
                  {connectMutation.isPending ? "Connecting…" : "Connect Domain"}
                </Button>
              </form>
            </div>
          ) : (
            <div className="space-y-4">
              <div className="flex items-center justify-between gap-3">
                <div className="flex items-center gap-2.5 min-w-0">
                  <Globe className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
                  <span className="text-[13px] font-medium text-foreground truncate">
                    {activeWorkspace.resendDomainName}
                  </span>
                  <DomainStatusBadge status={status} />
                </div>
                <div className="flex items-center gap-1.5 shrink-0">
                  {(status === "not_started" || status === "failed" || status === "temporary_failure") && (
                    <Button size="sm" variant="outline" onClick={() => verifyMutation.mutate()} disabled={verifyMutation.isPending} className="h-7 text-[11px]">
                      {verifyMutation.isPending ? "Requesting…" : "Verify Now"}
                    </Button>
                  )}
                  {status === "pending" && (
                    <Button size="sm" variant="outline" onClick={() => refreshMutation.mutate()} disabled={refreshMutation.isPending} className="h-7 text-[11px] gap-1.5">
                      <RefreshCw className={`h-3 w-3 ${refreshMutation.isPending ? "animate-spin" : ""}`} />
                      Check Status
                    </Button>
                  )}
                  {status === "verified" && (
                    <Button size="sm" variant="outline" onClick={() => refreshMutation.mutate()} disabled={refreshMutation.isPending} className="h-7 text-[11px] gap-1.5">
                      <RefreshCw className={`h-3 w-3 ${refreshMutation.isPending ? "animate-spin" : ""}`} />
                      Refresh
                    </Button>
                  )}
                  <button
                    onClick={() => setConfirmDisconnect(true)}
                    className="rounded p-1.5 text-muted-foreground/40 transition-colors hover:bg-destructive/10 hover:text-destructive cursor-pointer"
                    title="Disconnect domain"
                  >
                    <Trash2 className="h-3.5 w-3.5" />
                  </button>
                </div>
              </div>

              {status === "verified" && (
                <div className="flex items-center gap-2 rounded-md border border-emerald-500/20 bg-emerald-500/8 px-3 py-2.5">
                  <CheckCircle2 className="h-3.5 w-3.5 shrink-0 text-emerald-400" />
                  <p className="text-[11px] text-emerald-300">
                    Your sending domain is active. Set your From Email to{" "}
                    <code className="font-mono">you@{activeWorkspace.resendDomainName}</code> to start sending.
                  </p>
                </div>
              )}
              {status === "pending" && (
                <div className="flex items-center gap-2 rounded-md border border-amber-500/20 bg-amber-500/8 px-3 py-2.5">
                  <Clock className="h-3.5 w-3.5 shrink-0 text-amber-400" />
                  <p className="text-[11px] text-amber-300">
                    Verification in progress. DNS propagation can take up to 72 hours. Click &quot;Check Status&quot; to refresh.
                  </p>
                </div>
              )}
              {(status === "failed" || status === "temporary_failure") && (
                <div className="flex items-center gap-2 rounded-md border border-destructive/20 bg-destructive/8 px-3 py-2.5">
                  <XCircle className="h-3.5 w-3.5 shrink-0 text-destructive" />
                  <p className="text-[11px] text-destructive">
                    Verification failed. Check your DNS records below are correct, then click &quot;Verify Now&quot; to retry.
                  </p>
                </div>
              )}

              {records.length > 0 && (
                <div className="space-y-2">
                  <div className="flex items-center justify-between">
                    <button
                      type="button"
                      onClick={() => setShowRecords((v) => !v)}
                      className="text-[11px] text-muted-foreground hover:text-foreground transition-colors cursor-pointer"
                    >
                      {showRecords ? "Hide" : "Show"} DNS records ({records.length})
                    </button>
                    {!showRecords && status !== "verified" && (
                      <span className="text-[11px] text-muted-foreground/60">Add these to your DNS provider</span>
                    )}
                  </div>

                  {(showRecords || status === "not_started" || status === "failed" || status === "temporary_failure") && (
                    <div className="rounded-md border border-border overflow-hidden">
                      <div className="grid grid-cols-[56px_1fr_2fr_auto] gap-3 border-b border-border bg-muted/40 px-3 py-2">
                        <span className="text-[10px] font-medium uppercase tracking-wide text-muted-foreground">Type</span>
                        <span className="text-[10px] font-medium uppercase tracking-wide text-muted-foreground">Name</span>
                        <span className="text-[10px] font-medium uppercase tracking-wide text-muted-foreground">Value</span>
                        <span className="text-[10px] font-medium uppercase tracking-wide text-muted-foreground">St.</span>
                      </div>
                      {records.map((rec, i) => (
                        <div
                          key={i}
                          className={`grid grid-cols-[56px_1fr_2fr_auto] gap-3 px-3 py-2.5 items-start ${i < records.length - 1 ? "border-b border-border/50" : ""}`}
                        >
                          <span className="font-mono text-[11px] text-muted-foreground font-medium">{rec.type}</span>
                          <div className="flex items-start gap-1 min-w-0">
                            <span className="font-mono text-[11px] text-foreground/80 truncate">{rec.name}</span>
                            <CopyButton value={rec.name} />
                          </div>
                          <div className="flex items-start gap-1 min-w-0">
                            <span className="font-mono text-[11px] text-foreground/70 break-all">
                              {rec.priority !== undefined ? `${rec.priority} ${rec.value}` : rec.value}
                            </span>
                            <CopyButton value={rec.priority !== undefined ? `${rec.priority} ${rec.value}` : rec.value} />
                          </div>
                          <div className="flex items-center pt-px">
                            <RecordStatusDot status={rec.status} />
                          </div>
                        </div>
                      ))}
                      <div className="border-t border-border bg-muted/20 px-3 py-2">
                        <p className="text-[10px] text-muted-foreground">
                          Add all records to your DNS provider, then click &quot;Verify Now&quot;. DNS propagation may take up to 48–72 hours.{" "}
                          <a
                            href="https://resend.com/docs/dashboard/domains/introduction"
                            target="_blank"
                            rel="noopener noreferrer"
                            className="inline-flex items-center gap-0.5 text-foreground/60 hover:text-foreground transition-colors"
                          >
                            Resend domain guide
                            <ExternalLink className="h-2.5 w-2.5" />
                          </a>
                        </p>
                      </div>
                    </div>
                  )}
                </div>
              )}
            </div>
          )}
        </div>
      </SectionCard>

      <AlertDialog open={confirmDisconnect} onOpenChange={setConfirmDisconnect}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Disconnect sending domain?</AlertDialogTitle>
            <AlertDialogDescription>
              <strong className="text-foreground font-medium">{activeWorkspace?.resendDomainName}</strong>{" "}
              will be removed from your Resend account and you will no longer be able to send emails from this domain until it is reconnected.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction disabled={disconnectMutation.isPending} onClick={() => disconnectMutation.mutate()}>
              {disconnectMutation.isPending ? "Disconnecting…" : "Disconnect"}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}
