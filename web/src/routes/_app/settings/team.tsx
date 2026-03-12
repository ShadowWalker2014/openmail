import { createFileRoute } from "@tanstack/react-router";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { sessionFetch } from "@/lib/api";
import { useWorkspaceStore } from "@/store/workspace";
import { useSession } from "@/lib/auth-client";
import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
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
import { Users, Plus, X } from "lucide-react";
import { toast } from "sonner";
import { format } from "date-fns";
import {
  SectionCard, SectionHeader,
  RoleBadge, AvatarInitial,
  type Member, type Invite,
} from "@/components/settings/shared";

export const Route = createFileRoute("/_app/settings/team")({
  component: TeamSettingsPage,
});

function TeamSettingsPage() {
  const { activeWorkspaceId } = useWorkspaceStore();
  const { data: session } = useSession();
  const qc = useQueryClient();

  const [inviteEmail, setInviteEmail] = useState("");
  const [inviteRole, setInviteRole] = useState<"admin" | "member">("member");
  const [removeMember, setRemoveMember] = useState<Member | null>(null);
  const [cancellingId, setCancellingId] = useState<string | null>(null);

  const { data: members = [], isLoading: membersLoading } = useQuery<Member[]>({
    queryKey: ["members", activeWorkspaceId],
    queryFn: () => sessionFetch(activeWorkspaceId!, "/members"),
    enabled: !!activeWorkspaceId,
  });

  const { data: invites = [], isLoading: invitesLoading } = useQuery<Invite[]>({
    queryKey: ["invites", activeWorkspaceId],
    queryFn: () => sessionFetch(activeWorkspaceId!, "/invites"),
    enabled: !!activeWorkspaceId,
  });

  const currentMember = members.find((m) => m.userId === session?.user?.id);
  const canManageMembers = currentMember?.role === "owner" || currentMember?.role === "admin";

  const removeMemberMutation = useMutation({
    mutationFn: (memberId: string) =>
      sessionFetch(activeWorkspaceId!, `/members/${memberId}`, { method: "DELETE" }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["members", activeWorkspaceId] });
      setRemoveMember(null);
      toast.success("Member removed");
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const sendInviteMutation = useMutation({
    mutationFn: ({ email, role }: { email: string; role: string }) =>
      sessionFetch(activeWorkspaceId!, "/invites", {
        method: "POST",
        body: JSON.stringify({ email, role }),
      }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["invites", activeWorkspaceId] });
      setInviteEmail("");
      setInviteRole("member");
      toast.success("Invite sent");
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const cancelInviteMutation = useMutation({
    mutationFn: (inviteId: string) => {
      setCancellingId(inviteId);
      return sessionFetch(activeWorkspaceId!, `/invites/${inviteId}`, { method: "DELETE" });
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["invites", activeWorkspaceId] });
      toast.success("Invite cancelled");
    },
    onError: (e: Error) => toast.error(e.message),
    onSettled: () => setCancellingId(null),
  });

  return (
    <>
      <SectionCard>
        <SectionHeader icon={Users} title="Team Members" description="Manage who has access to this workspace" />
        <div className="px-5 py-4 space-y-5">
          {/* Members list */}
          <div>
            {membersLoading && (
              <div className="space-y-px">
                {Array.from({ length: 3 }).map((_, i) => (
                  <div key={i} className="flex items-center gap-3 py-2.5 border-b border-border/40 last:border-0">
                    <div className="h-7 w-7 rounded-full shimmer" />
                    <div className="flex-1 space-y-1.5">
                      <div className="h-3 w-28 rounded shimmer" />
                      <div className="h-2.5 w-40 rounded shimmer" />
                    </div>
                    <div className="h-5 w-14 rounded shimmer" />
                  </div>
                ))}
              </div>
            )}
            {!membersLoading && members.map((member, i) => {
              const canRemove = canManageMembers && member.role !== "owner" && member.userId !== session?.user?.id;
              return (
                <div
                  key={member.id}
                  className={`group flex items-center gap-3 py-2.5 ${i < members.length - 1 ? "border-b border-border/40" : ""}`}
                >
                  <AvatarInitial name={member.userName} />
                  <div className="min-w-0 flex-1">
                    <p className="text-[13px] font-medium text-foreground/90 truncate">
                      {member.userName}
                      {member.userId === session?.user?.id && (
                        <span className="ml-1.5 text-[11px] text-muted-foreground font-normal">(you)</span>
                      )}
                    </p>
                    <p className="text-[11px] text-muted-foreground truncate">{member.userEmail}</p>
                  </div>
                  <RoleBadge role={member.role} />
                  {canRemove && (
                    <button
                      onClick={() => setRemoveMember(member)}
                      className="shrink-0 rounded p-1.5 text-muted-foreground/30 opacity-0 transition-all duration-100 hover:bg-destructive/10 hover:text-destructive group-hover:opacity-100 cursor-pointer"
                    >
                      <X className="h-3.5 w-3.5" />
                    </button>
                  )}
                </div>
              );
            })}
          </div>

          {/* Pending invites */}
          <div>
            <p className="mb-2 text-[12px] font-medium text-foreground/70">Pending Invites</p>
            {invitesLoading && (
              <div className="space-y-px">
                {Array.from({ length: 2 }).map((_, i) => (
                  <div key={i} className="flex items-center gap-3 py-2 border-b border-border/40 last:border-0">
                    <div className="h-2.5 w-40 rounded shimmer" />
                    <div className="h-5 w-12 rounded shimmer ml-auto" />
                  </div>
                ))}
              </div>
            )}
            {!invitesLoading && invites.length === 0 && (
              <p className="text-[12px] text-muted-foreground">No pending invites</p>
            )}
            {!invitesLoading && invites.map((invite, i) => (
              <div
                key={invite.id}
                className={`group flex items-center gap-3 py-2 ${i < invites.length - 1 ? "border-b border-border/40" : ""}`}
              >
                <div className="min-w-0 flex-1">
                  <p className="text-[13px] text-foreground/80 truncate">{invite.email}</p>
                  <p className="text-[11px] text-muted-foreground">Expires {format(new Date(invite.expiresAt), "MMM d, yyyy")}</p>
                </div>
                <RoleBadge role={invite.role} />
                {canManageMembers && (
                  <button
                    onClick={() => cancelInviteMutation.mutate(invite.id)}
                    disabled={cancellingId === invite.id}
                    className="shrink-0 rounded p-1.5 text-muted-foreground/30 opacity-0 transition-all duration-100 hover:bg-destructive/10 hover:text-destructive group-hover:opacity-100 cursor-pointer disabled:cursor-not-allowed"
                  >
                    <X className="h-3.5 w-3.5" />
                  </button>
                )}
              </div>
            ))}
          </div>

          {/* Invite form */}
          {canManageMembers && (
            <form
              onSubmit={(e) => {
                e.preventDefault();
                if (inviteEmail) sendInviteMutation.mutate({ email: inviteEmail, role: inviteRole });
              }}
              className="flex gap-2"
            >
              <Input
                type="email"
                value={inviteEmail}
                onChange={(e) => setInviteEmail(e.target.value)}
                placeholder="colleague@company.com"
                className="flex-1"
              />
              <Select value={inviteRole} onValueChange={(v) => setInviteRole(v as "admin" | "member")}>
                <SelectTrigger className="w-28">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="member">Member</SelectItem>
                  <SelectItem value="admin">Admin</SelectItem>
                </SelectContent>
              </Select>
              <Button type="submit" size="sm" disabled={!inviteEmail || sendInviteMutation.isPending}>
                <Plus className="h-3.5 w-3.5" />
                {sendInviteMutation.isPending ? "Sending…" : "Send Invite"}
              </Button>
            </form>
          )}
        </div>
      </SectionCard>

      <AlertDialog open={!!removeMember} onOpenChange={(o) => !o && setRemoveMember(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Remove member?</AlertDialogTitle>
            <AlertDialogDescription>
              <strong className="text-foreground font-medium">{removeMember?.userName}</strong>{" "}
              ({removeMember?.userEmail}) will lose access to this workspace immediately.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              disabled={removeMemberMutation.isPending}
              onClick={() => removeMember && removeMemberMutation.mutate(removeMember.id)}
            >
              {removeMemberMutation.isPending ? "Removing…" : "Remove member"}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}
