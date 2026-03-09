import { createFileRoute, useRouter, Link } from "@tanstack/react-router";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { apiFetch } from "@/lib/api";
import { useSession } from "@/lib/auth-client";
import { useWorkspaceStore } from "@/store/workspace";
import { Button } from "@/components/ui/button";
import { Mail, ShieldCheck } from "lucide-react";
import { LogoIcon } from "@/components/logo-icon";
import { toast } from "sonner";

export const Route = createFileRoute("/invite/$token")({
  component: InviteAcceptPage,
});

interface InviteInfo {
  id: string;
  email: string;
  role: "admin" | "member";
  expiresAt: string;
  workspaceId: string;
  workspaceName?: string;
}

function RoleBadge({ role }: { role: "admin" | "member" }) {
  const styles = {
    admin: "bg-violet-500/15 text-violet-400",
    member: "bg-muted text-muted-foreground",
  };
  return (
    <span
      className={`inline-flex items-center rounded px-1.5 py-0.5 text-[11px] font-medium ${styles[role]}`}
    >
      {role}
    </span>
  );
}

function InviteAcceptPage() {
  const { token } = Route.useParams();
  const router = useRouter();
  const qc = useQueryClient();
  const { data: session, isPending: sessionLoading } = useSession();
  const { setActiveWorkspaceId } = useWorkspaceStore();

  const {
    data: invite,
    isLoading: inviteLoading,
    error: inviteError,
  } = useQuery<InviteInfo>({
    queryKey: ["invite-info", token],
    queryFn: () => apiFetch<InviteInfo>(`/api/invites/info/${token}`),
    retry: false,
  });

  const acceptMutation = useMutation({
    mutationFn: () =>
      apiFetch(`/api/session/invites/accept/${token}`, { method: "POST" }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["workspaces"] });
      if (invite?.workspaceId) {
        setActiveWorkspaceId(invite.workspaceId);
      }
      toast.success("You've joined the workspace!");
      router.navigate({ to: "/dashboard" });
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const isLoading = sessionLoading || inviteLoading;

  return (
    <div
      className="min-h-screen flex items-center justify-center px-4"
      style={{ background: "hsl(var(--background))" }}
    >
      {/* Subtle ambient glow */}
      <div
        aria-hidden
        className="pointer-events-none fixed inset-0 overflow-hidden"
      >
        <div className="absolute left-1/2 top-0 h-[400px] w-[600px] -translate-x-1/2 -translate-y-1/3 rounded-full bg-violet-600/6 blur-[90px]" />
      </div>

      <div className="relative w-full max-w-[360px]">
        {/* Logo */}
        <div className="mb-6 flex justify-center">
          <LogoIcon size={32} className="rounded-[7px]" />
        </div>

        {isLoading && (
          <div className="rounded-lg border border-border bg-card p-6 text-center">
            <div className="mx-auto mb-3 h-4 w-32 rounded shimmer" />
            <div className="mx-auto h-3 w-48 rounded shimmer" />
          </div>
        )}

        {!isLoading && inviteError && (
          <div className="rounded-lg border border-border bg-card p-6 text-center">
            <div className="mb-2 flex justify-center">
              <div className="flex h-10 w-10 items-center justify-center rounded-full bg-destructive/10">
                <ShieldCheck className="h-5 w-5 text-destructive/70" />
              </div>
            </div>
            <h1 className="text-[14px] font-semibold text-foreground">
              Invitation invalid
            </h1>
            <p className="mt-1.5 text-[12px] text-muted-foreground">
              This invitation link has expired or is no longer valid.
            </p>
            <div className="mt-4">
              <Link to="/dashboard">
                <Button size="sm" variant="outline" className="w-full">
                  Go to dashboard
                </Button>
              </Link>
            </div>
          </div>
        )}

        {!isLoading && invite && !session && (
          <div className="rounded-lg border border-border bg-card p-6">
            <h1 className="text-[14px] font-semibold text-foreground text-center">
              Sign in to accept invite
            </h1>
            <p className="mt-2 text-[12px] text-muted-foreground text-center leading-relaxed">
              This invite was sent to{" "}
              <span className="text-foreground/80 font-medium">{invite.email}</span>.
              Please sign in or create an account to accept it.
            </p>
            <div className="mt-4">
              <Link
                to="/login"
                onClick={() => sessionStorage.setItem("invite_token", token)}
              >
                <Button size="sm" className="w-full">
                  Sign in to continue
                </Button>
              </Link>
            </div>
          </div>
        )}

        {!isLoading && invite && session && (
          <div className="rounded-lg border border-border bg-card p-6">
            <div className="mb-4 flex justify-center">
              <div className="flex h-10 w-10 items-center justify-center rounded-full bg-violet-500/10 border border-violet-500/20">
                <Mail className="h-5 w-5 text-violet-400" />
              </div>
            </div>
            <h1 className="text-[14px] font-semibold text-foreground text-center">
              You&apos;ve been invited
            </h1>
            <p className="mt-1.5 text-[12px] text-muted-foreground text-center">
              Join{" "}
              <span className="text-foreground/80 font-medium">
                {invite.workspaceName ?? invite.workspaceId}
              </span>{" "}
              on OpenMail
            </p>

            <div className="mt-4 rounded-md border border-border/60 bg-muted/30 px-3.5 py-2.5 flex items-center justify-between">
              <div>
                <p className="text-[11px] text-muted-foreground">Role</p>
              </div>
              <RoleBadge role={invite.role} />
            </div>

            <div className="mt-4 flex gap-2">
              <Button
                variant="outline"
                size="sm"
                className="flex-1"
                onClick={() => router.navigate({ to: "/dashboard" })}
              >
                Decline
              </Button>
              <Button
                size="sm"
                className="flex-1"
                disabled={acceptMutation.isPending}
                onClick={() => acceptMutation.mutate()}
              >
                {acceptMutation.isPending ? "Accepting…" : "Accept invite"}
              </Button>
            </div>

            <p className="mt-3 text-center text-[11px] text-muted-foreground">
              Signed in as{" "}
              <span className="text-foreground/70">{session.user.email}</span>
            </p>
          </div>
        )}
      </div>
    </div>
  );
}
