import { createFileRoute } from "@tanstack/react-router";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { apiFetch, sessionFetch } from "@/lib/api";
import { useWorkspaceStore } from "@/store/workspace";
import { useWorkspaces } from "@/hooks/use-workspaces";
import { useState, useRef } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Building2, Camera, Loader2, X } from "lucide-react";
import { toast } from "sonner";
import { SectionCard, SectionHeader } from "@/components/settings/shared";
import { cn } from "@/lib/utils";

export const Route = createFileRoute("/_app/settings/general")({
  component: GeneralSettingsPage,
});

// ── Workspace Icon Upload ──────────────────────────────────────────────────────

function WorkspaceIconUpload({
  workspaceId,
  logoUrl,
  name,
}: {
  workspaceId: string;
  logoUrl: string | null;
  name: string;
}) {
  const qc = useQueryClient();
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [uploading, setUploading] = useState(false);
  const [hovered, setHovered] = useState(false);

  const initial = (name ?? "W")[0].toUpperCase();

  const updateLogoMutation = useMutation({
    mutationFn: (url: string | null) =>
      apiFetch(`/api/session/workspaces/${workspaceId}`, {
        method: "PATCH",
        body: JSON.stringify({ logoUrl: url }),
      }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["workspaces"] });
    },
    onError: (e: Error) => toast.error(e.message),
  });

  async function handleFileChange(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;

    // Validate
    if (!file.type.startsWith("image/")) {
      toast.error("Please select an image file");
      return;
    }
    if (file.size > 5 * 1024 * 1024) {
      toast.error("Image must be under 5 MB");
      return;
    }

    setUploading(true);
    // Reset input so same file can be re-selected
    e.target.value = "";

    const step1 = await sessionFetch<{ id: string; uploadUrl: string; proxyUrl: string }>(
      workspaceId,
      "/assets/upload-url",
      {
        method: "POST",
        body: JSON.stringify({
          fileName: file.name,
          mimeType: file.type,
          fileSize: file.size,
        }),
      }
    ).catch((err: Error) => {
      toast.error(err.message);
      setUploading(false);
      return null;
    });

    if (!step1) return;

    // PUT directly to S3 presigned URL
    const uploadRes = await fetch(step1.uploadUrl, {
      method: "PUT",
      body: file,
      headers: { "Content-Type": file.type },
    }).catch(() => null);

    if (!uploadRes?.ok) {
      toast.error("Upload failed — please try again");
      setUploading(false);
      return;
    }

    await updateLogoMutation.mutateAsync(step1.proxyUrl);
    toast.success("Workspace icon updated");
    setUploading(false);
  }

  async function handleRemove() {
    await updateLogoMutation.mutateAsync(null);
    toast.success("Workspace icon removed");
  }

  return (
    <div className="flex items-center gap-4">
      {/* Avatar trigger */}
      <button
        type="button"
        disabled={uploading}
        onClick={() => fileInputRef.current?.click()}
        onMouseEnter={() => setHovered(true)}
        onMouseLeave={() => setHovered(false)}
        className="relative flex h-14 w-14 shrink-0 items-center justify-center rounded-xl border border-border bg-muted/50 overflow-hidden transition-all duration-150 cursor-pointer hover:border-foreground/20 disabled:cursor-not-allowed disabled:opacity-60 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
      >
        {uploading ? (
          <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
        ) : logoUrl ? (
          <>
            <img
              src={logoUrl}
              alt={name}
              className="h-full w-full object-cover"
            />
            {hovered && (
              <div className="absolute inset-0 flex items-center justify-center bg-black/50 backdrop-blur-[1px]">
                <Camera className="h-4 w-4 text-white" />
              </div>
            )}
          </>
        ) : (
          <>
            <span
              className={cn(
                "text-lg font-bold uppercase text-violet-300 transition-opacity duration-100",
                hovered && "opacity-0"
              )}
            >
              {initial}
            </span>
            {hovered && (
              <div className="absolute inset-0 flex items-center justify-center">
                <Camera className="h-4 w-4 text-muted-foreground" />
              </div>
            )}
          </>
        )}
      </button>

      {/* Info + actions */}
      <div className="flex flex-col gap-1.5">
        <div className="flex items-center gap-2">
          <button
            type="button"
            disabled={uploading}
            onClick={() => fileInputRef.current?.click()}
            className="text-[13px] font-medium text-foreground/80 hover:text-foreground transition-colors cursor-pointer disabled:cursor-not-allowed disabled:opacity-50"
          >
            {uploading ? "Uploading…" : logoUrl ? "Change icon" : "Upload icon"}
          </button>
          {logoUrl && !uploading && (
            <>
              <span className="text-muted-foreground/30">·</span>
              <button
                type="button"
                onClick={handleRemove}
                disabled={updateLogoMutation.isPending}
                className="text-[13px] text-muted-foreground hover:text-destructive transition-colors cursor-pointer disabled:cursor-not-allowed"
              >
                Remove
              </button>
            </>
          )}
        </div>
        <p className="text-[11px] text-muted-foreground">
          JPG, PNG, GIF, WebP · max 5 MB · Shown in sidebar and switcher
        </p>
      </div>

      <input
        ref={fileInputRef}
        type="file"
        accept="image/jpeg,image/png,image/gif,image/webp"
        className="sr-only"
        onChange={handleFileChange}
      />
    </div>
  );
}

// ── Page ──────────────────────────────────────────────────────────────────────

function GeneralSettingsPage() {
  const { activeWorkspaceId } = useWorkspaceStore();
  const { activeWorkspace } = useWorkspaces();
  const qc = useQueryClient();

  const [workspaceName, setWorkspaceName] = useState("");
  const [editingName, setEditingName] = useState(false);

  const updateMutation = useMutation({
    mutationFn: (body: object) =>
      apiFetch(`/api/session/workspaces/${activeWorkspaceId}`, {
        method: "PATCH",
        body: JSON.stringify(body),
      }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["workspaces"] });
      toast.success("Settings saved");
      setEditingName(false);
    },
    onError: (e: Error) => toast.error(e.message),
  });

  if (!activeWorkspaceId) return null;

  return (
    <SectionCard>
      <SectionHeader icon={Building2} title="General" description="Workspace name and icon" />
      <div className="divide-y divide-border/60">
        {/* Workspace Icon */}
        <div className="px-5 py-4">
          <div className="mb-3">
            <Label className="text-[12px]">Workspace Icon</Label>
          </div>
          <WorkspaceIconUpload
            workspaceId={activeWorkspaceId}
            logoUrl={activeWorkspace?.logoUrl ?? null}
            name={activeWorkspace?.name ?? "W"}
          />
        </div>

        {/* Workspace Name */}
        <div className="px-5 py-4">
          <div className="space-y-1.5">
            <Label>Workspace Name</Label>
            <div className="flex gap-2">
              <Input
                value={editingName ? workspaceName : (activeWorkspace?.name ?? "")}
                onChange={(e) => { setEditingName(true); setWorkspaceName(e.target.value); }}
                onFocus={() => { if (!editingName) { setWorkspaceName(activeWorkspace?.name ?? ""); setEditingName(true); } }}
                placeholder="My Workspace"
                className="flex-1"
              />
              <Button
                size="sm"
                disabled={!editingName || !workspaceName.trim() || updateMutation.isPending}
                onClick={() => { if (workspaceName.trim()) updateMutation.mutate({ name: workspaceName.trim() }); }}
              >
                {updateMutation.isPending ? "Saving…" : "Save"}
              </Button>
            </div>
          </div>
        </div>
      </div>
    </SectionCard>
  );
}
