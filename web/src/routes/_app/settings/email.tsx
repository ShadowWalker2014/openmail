import { createFileRoute } from "@tanstack/react-router";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { apiFetch } from "@/lib/api";
import { useWorkspaceStore } from "@/store/workspace";
import { useWorkspaces } from "@/hooks/use-workspaces";
import { useRef } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Mail } from "lucide-react";
import { toast } from "sonner";
import { SectionCard, SectionHeader } from "@/components/settings/shared";

export const Route = createFileRoute("/_app/settings/email")({
  component: EmailSettingsPage,
});

function EmailSettingsPage() {
  const { activeWorkspaceId } = useWorkspaceStore();
  const { activeWorkspace } = useWorkspaces();
  const qc = useQueryClient();

  if (!activeWorkspaceId) return null;

  const resendKeyRef = useRef<HTMLInputElement>(null);
  const fromEmailRef = useRef<HTMLInputElement>(null);
  const fromNameRef = useRef<HTMLInputElement>(null);

  const updateMutation = useMutation({
    mutationFn: (body: object) =>
      apiFetch(`/api/session/workspaces/${activeWorkspaceId}`, {
        method: "PATCH",
        body: JSON.stringify(body),
      }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["workspaces"] });
      toast.success("Settings saved");
    },
    onError: (e: Error) => toast.error(e.message),
  });

  return (
    <SectionCard>
      <SectionHeader icon={Mail} title="Email Sending" description="Resend API key and sender identity" />
      <div className="px-5 py-4">
        <form
          key={activeWorkspaceId ?? "none"}
          onSubmit={(e) => {
            e.preventDefault();
            if (!activeWorkspaceId) return;
            updateMutation.mutate({
              resendApiKey: resendKeyRef.current!.value || undefined,
              resendFromEmail: fromEmailRef.current!.value || null,
              resendFromName: fromNameRef.current!.value || null,
            });
          }}
          className="space-y-3.5"
        >
          <div className="space-y-1.5">
            <Label>Resend API Key</Label>
            <Input ref={resendKeyRef} type="password" placeholder="re_••••••••••••••••" />
            <p className="text-[11px] text-muted-foreground">
              Enter a new key to update. Leave blank to use the platform default.
            </p>
          </div>
          <div className="grid grid-cols-2 gap-2.5">
            <div className="space-y-1.5">
              <div className="flex items-center justify-between">
                <Label>From Email</Label>
                {activeWorkspace?.resendFromEmail && (
                  <span className="text-[11px] text-emerald-400 font-medium">✓ Configured</span>
                )}
              </div>
              <Input
                ref={fromEmailRef}
                type="email"
                placeholder="hello@yourapp.com"
                defaultValue={activeWorkspace?.resendFromEmail ?? ""}
              />
            </div>
            <div className="space-y-1.5">
              <Label>From Name</Label>
              <Input
                ref={fromNameRef}
                placeholder="Your App"
                defaultValue={activeWorkspace?.resendFromName ?? ""}
              />
            </div>
          </div>
          <Button type="submit" size="sm" disabled={updateMutation.isPending}>
            {updateMutation.isPending ? "Saving…" : "Save Settings"}
          </Button>
        </form>
      </div>
    </SectionCard>
  );
}
