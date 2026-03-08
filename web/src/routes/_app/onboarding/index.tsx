import { createFileRoute, useRouter } from "@tanstack/react-router";
import { useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { apiFetch } from "@/lib/api";
import { useQueryClient } from "@tanstack/react-query";
import { useWorkspaceStore } from "@/store/workspace";
import { toast } from "sonner";
import { Mail } from "lucide-react";

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
    const workspace = await apiFetch<{
      id: string;
      name: string;
      slug: string;
    }>("/api/session/workspaces", {
      method: "POST",
      body: JSON.stringify({
        name: nameRef.current!.value,
        slug: slugRef.current!.value,
      }),
    }).catch((err: Error) => {
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
    <div className="flex min-h-screen items-center justify-center bg-[hsl(var(--app-bg))] px-4">
      <div className="w-full max-w-md">
        <div className="mb-8 text-center">
          <div className="mx-auto mb-4 flex h-10 w-10 items-center justify-center rounded-xl border bg-background shadow-sm">
            <Mail className="h-5 w-5" />
          </div>
          <h1 className="text-xl font-semibold tracking-tight">
            Create your workspace
          </h1>
          <p className="mt-1.5 text-sm text-muted-foreground">
            A workspace contains your contacts, campaigns, and email settings.
          </p>
        </div>

        <div className="rounded-xl border bg-background p-6 shadow-sm">
          <form onSubmit={handleSubmit} className="space-y-4">
            <div className="space-y-1.5">
              <Label htmlFor="name">Workspace Name *</Label>
              <Input
                id="name"
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
              <Label htmlFor="slug">Slug *</Label>
              <Input
                id="slug"
                ref={slugRef}
                placeholder="acme-corp"
                pattern="[a-z0-9-]+"
                required
              />
              <p className="text-xs text-muted-foreground">
                Lowercase letters, numbers, and hyphens only
              </p>
            </div>
            <Button type="submit" className="w-full" disabled={loading}>
              {loading ? "Creating…" : "Create Workspace"}
            </Button>
          </form>
        </div>
      </div>
    </div>
  );
}
