import { createFileRoute, useRouter } from "@tanstack/react-router";
import { useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { apiFetch } from "@/lib/api";
import { useQueryClient } from "@tanstack/react-query";
import { useWorkspaceStore } from "@/store/workspace";
import { toast } from "sonner";

export const Route = createFileRoute("/_app/onboarding/")({
  component: OnboardingPage,
});

function OnboardingPage() {
  const router = useRouter();
  const qc = useQueryClient();
  const { setActiveWorkspaceId } = useWorkspaceStore();
  const nameRef = useRef<HTMLInputElement>(null);
  const slugRef = useRef<HTMLInputElement>(null);
  const [loading, setLoading] = useState(false);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setLoading(true);
    const workspace = await apiFetch<{ id: string; name: string; slug: string }>(
      "/api/session/workspaces",
      {
        method: "POST",
        body: JSON.stringify({
          name: nameRef.current!.value,
          slug: slugRef.current!.value,
        }),
      }
    ).catch((err: Error) => {
      toast.error(err.message);
      setLoading(false);
      return null;
    });
    if (!workspace) return;
    setActiveWorkspaceId(workspace.id);
    await qc.invalidateQueries({ queryKey: ["workspaces"] });
    router.navigate({ to: "/dashboard" });
  }

  return (
    <div className="flex-1 flex items-center justify-center p-8">
      <div className="w-full max-w-md">
        <h1 className="text-2xl font-semibold mb-2">Create your workspace</h1>
        <p className="text-muted-foreground mb-8">
          A workspace contains your contacts, campaigns, and email settings.
        </p>
        <form onSubmit={handleSubmit} className="space-y-4">
          <div className="space-y-1.5">
            <Label>Workspace Name *</Label>
            <Input
              ref={nameRef}
              placeholder="Acme Corp"
              required
              onChange={(e) => {
                if (slugRef.current) {
                  slugRef.current.value = e.target.value
                    .toLowerCase()
                    .replace(/[^a-z0-9]+/g, "-")
                    .replace(/^-+|-+$/g, "");
                }
              }}
            />
          </div>
          <div className="space-y-1.5">
            <Label>Slug *</Label>
            <Input ref={slugRef} placeholder="acme-corp" pattern="[a-z0-9-]+" required />
            <p className="text-xs text-muted-foreground">
              Lowercase letters, numbers, and hyphens only
            </p>
          </div>
          <Button type="submit" className="w-full" disabled={loading}>
            {loading ? "Creating..." : "Create Workspace"}
          </Button>
        </form>
      </div>
    </div>
  );
}
