import { createFileRoute, useRouter } from "@tanstack/react-router";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { sessionFetch } from "@/lib/api";
import { useWorkspaceStore } from "@/store/workspace";
import { authClient, useSession } from "@/lib/auth-client";
import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
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
import { User, LogOut } from "lucide-react";
import { toast } from "sonner";
import { SectionCard, SectionHeader, type Member } from "@/components/settings/shared";

export const Route = createFileRoute("/_app/settings/account")({
  component: AccountSettingsPage,
});

function AccountSettingsPage() {
  const router = useRouter();
  const { activeWorkspaceId, setActiveWorkspaceId } = useWorkspaceStore();
  const { data: session } = useSession();
  const qc = useQueryClient();

  const [accountName, setAccountName] = useState(session?.user?.name ?? "");
  const [currentPassword, setCurrentPassword] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [showLeave, setShowLeave] = useState(false);

  const { data: members = [] } = useQuery<Member[]>({
    queryKey: ["members", activeWorkspaceId],
    queryFn: () => sessionFetch(activeWorkspaceId!, "/members"),
    enabled: !!activeWorkspaceId,
  });

  const currentMember = members.find((m) => m.userId === session?.user?.id);
  const currentUserRole = currentMember?.role;

  const updateAccountNameMutation = useMutation({
    mutationFn: (name: string) => authClient.updateUser({ name }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["session"] });
      toast.success("Name updated");
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const changePasswordMutation = useMutation({
    mutationFn: ({ currentPassword: cp, newPassword: np }: { currentPassword: string; newPassword: string }) =>
      authClient.changePassword({ currentPassword: cp, newPassword: np, revokeOtherSessions: false }),
    onSuccess: () => {
      setCurrentPassword("");
      setNewPassword("");
      toast.success("Password changed");
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const leaveWorkspaceMutation = useMutation({
    mutationFn: () =>
      sessionFetch(activeWorkspaceId!, `/members/${currentMember!.id}`, { method: "DELETE" }),
    onSuccess: () => {
      setActiveWorkspaceId(null);
      qc.invalidateQueries({ queryKey: ["workspaces"] });
      router.navigate({ to: "/dashboard" });
      toast.success("Left workspace");
    },
    onError: (e: Error) => toast.error(e.message),
  });

  return (
    <>
      <SectionCard>
        <SectionHeader icon={User} title="Account" description="Manage your personal account settings" />
        <div className="px-5 py-4 space-y-5">
          {/* Profile */}
          <div className="space-y-3">
            <p className="text-[12px] font-medium text-foreground/70">Profile</p>
            <div className="space-y-1.5">
              <Label>Display Name</Label>
              <Input
                value={accountName}
                onChange={(e) => setAccountName(e.target.value)}
                placeholder="Your name"
              />
            </div>
            <Button
              size="sm"
              disabled={!accountName.trim() || updateAccountNameMutation.isPending}
              onClick={() => { if (accountName.trim()) updateAccountNameMutation.mutate(accountName.trim()); }}
            >
              {updateAccountNameMutation.isPending ? "Saving…" : "Save Name"}
            </Button>
          </div>

          {/* Change password */}
          <div className="space-y-3 border-t border-border/60 pt-4">
            <p className="text-[12px] font-medium text-foreground/70">Change Password</p>
            <div className="grid grid-cols-2 gap-2.5">
              <div className="space-y-1.5">
                <Label>Current Password</Label>
                <Input
                  type="password"
                  placeholder="••••••••"
                  value={currentPassword}
                  onChange={(e) => setCurrentPassword(e.target.value)}
                />
              </div>
              <div className="space-y-1.5">
                <Label>New Password</Label>
                <Input
                  type="password"
                  placeholder="••••••••"
                  value={newPassword}
                  onChange={(e) => setNewPassword(e.target.value)}
                  minLength={8}
                />
              </div>
            </div>
            <Button
              size="sm"
              disabled={!currentPassword || !newPassword || changePasswordMutation.isPending}
              onClick={() => {
                if (currentPassword && newPassword)
                  changePasswordMutation.mutate({ currentPassword, newPassword });
              }}
            >
              {changePasswordMutation.isPending ? "Updating…" : "Change Password"}
            </Button>
          </div>

          {/* Leave workspace */}
          {currentUserRole && currentUserRole !== "owner" && (
            <div className="border-t border-border/60 pt-4">
              <p className="text-[12px] font-medium text-foreground/70 mb-1">Danger Zone</p>
              <p className="text-[11px] text-muted-foreground mb-3">
                Permanently leave this workspace. You'll lose access to all workspace data.
              </p>
              <Button size="sm" variant="destructive" onClick={() => setShowLeave(true)}>
                <LogOut className="h-3.5 w-3.5" />
                Leave Workspace
              </Button>
            </div>
          )}
        </div>
      </SectionCard>

      <AlertDialog open={showLeave} onOpenChange={setShowLeave}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Leave workspace?</AlertDialogTitle>
            <AlertDialogDescription>
              You will permanently lose access to this workspace. You can only rejoin if an owner invites you again.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              disabled={leaveWorkspaceMutation.isPending}
              onClick={() => leaveWorkspaceMutation.mutate()}
            >
              {leaveWorkspaceMutation.isPending ? "Leaving…" : "Leave workspace"}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}
