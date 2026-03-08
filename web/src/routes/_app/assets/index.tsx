import { createFileRoute } from "@tanstack/react-router";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { sessionFetch } from "@/lib/api";
import { useWorkspaceStore } from "@/store/workspace";
import { useState, useRef, useCallback } from "react";
import { Button } from "@/components/ui/button";
import {
  AlertDialog, AlertDialogContent, AlertDialogHeader, AlertDialogTitle,
  AlertDialogDescription, AlertDialogFooter, AlertDialogAction, AlertDialogCancel,
} from "@/components/ui/alert-dialog";
import {
  Upload, Copy, Check, Trash2, Image, FileVideo, FileText, ImageOff,
  Plus, AlertCircle,
} from "lucide-react";
import { toast } from "sonner";
import { format } from "date-fns";
import { cn } from "@/lib/utils";

export const Route = createFileRoute("/_app/assets/")({ component: AssetsPage });

interface Asset {
  id: string;
  name: string;
  fileName: string;
  mimeType: string;
  fileSize: number;
  s3Key: string;
  width: number | null;
  height: number | null;
  createdAt: string;
}

const API_URL = import.meta.env.VITE_API_URL ?? "http://localhost:3001";

function assetProxyUrl(workspaceId: string, assetId: string) {
  return `${API_URL}/api/public/assets/${workspaceId}/${assetId}`;
}

function formatBytes(bytes: number) {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

function mimeIcon(mimeType: string) {
  if (mimeType.startsWith("image/")) return Image;
  if (mimeType.startsWith("video/")) return FileVideo;
  return FileText;
}

// ── Copy URL button ───────────────────────────────────────────────────────────
function CopyUrlButton({ url }: { url: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <button
      onClick={(e) => {
        e.stopPropagation();
        navigator.clipboard.writeText(url);
        setCopied(true);
        setTimeout(() => setCopied(false), 1500);
      }}
      title={copied ? "Copied!" : "Copy URL"}
      className="flex items-center gap-1 rounded px-1.5 py-1 text-[11px] text-muted-foreground transition-colors hover:bg-accent hover:text-foreground cursor-pointer"
    >
      {copied ? <Check className="h-3 w-3 text-emerald-500" /> : <Copy className="h-3 w-3" />}
      {copied ? "Copied" : "Copy URL"}
    </button>
  );
}

// ── Asset card ────────────────────────────────────────────────────────────────
function AssetCard({
  asset,
  workspaceId,
  onDelete,
}: {
  asset: Asset;
  workspaceId: string;
  onDelete: (a: Asset) => void;
}) {
  const url = assetProxyUrl(workspaceId, asset.id);
  const isImage = asset.mimeType.startsWith("image/");
  const Icon = mimeIcon(asset.mimeType);

  return (
    <div className="group relative flex flex-col overflow-hidden rounded-lg border border-border bg-card transition-colors hover:border-border/80 hover:bg-card/80">
      {/* Thumbnail */}
      <div className="relative flex h-36 items-center justify-center bg-muted/30 overflow-hidden">
        {isImage ? (
          <img
            src={url}
            alt={asset.name}
            className="h-full w-full object-cover"
            onError={(e) => {
              (e.target as HTMLImageElement).style.display = "none";
              (e.target as HTMLImageElement).nextElementSibling?.classList.remove("hidden");
            }}
          />
        ) : null}
        <div className={cn("flex flex-col items-center gap-1.5 text-muted-foreground/40", isImage && "hidden")}>
          <Icon className="h-8 w-8" />
          <span className="text-[10px] uppercase tracking-wide font-medium">
            {asset.mimeType.split("/")[1]}
          </span>
        </div>
        {/* Hover overlay */}
        <div className="absolute inset-0 flex items-center justify-center gap-1.5 bg-background/80 opacity-0 transition-opacity duration-150 group-hover:opacity-100">
          <CopyUrlButton url={url} />
          <button
            onClick={(e) => { e.stopPropagation(); onDelete(asset); }}
            className="flex items-center gap-1 rounded px-1.5 py-1 text-[11px] text-muted-foreground transition-colors hover:bg-destructive/10 hover:text-destructive cursor-pointer"
          >
            <Trash2 className="h-3 w-3" />
            Delete
          </button>
        </div>
      </div>

      {/* Meta */}
      <div className="px-3 py-2.5">
        <p className="truncate text-[12px] font-medium text-foreground/90">{asset.name}</p>
        <p className="mt-px text-[10px] text-muted-foreground/50 tabular-nums">
          {formatBytes(asset.fileSize)}
          {asset.width && asset.height ? ` · ${asset.width}×${asset.height}` : ""}
          {" · "}
          {format(new Date(asset.createdAt), "MMM d")}
        </p>
      </div>
    </div>
  );
}

// ── Upload dropzone ───────────────────────────────────────────────────────────
function UploadZone({
  workspaceId,
  onUploaded,
}: {
  workspaceId: string;
  onUploaded: () => void;
}) {
  const [dragging, setDragging] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [progress, setProgress] = useState<string>("");
  const inputRef = useRef<HTMLInputElement>(null);

  const upload = useCallback(async (files: FileList | null) => {
    if (!files?.length) return;
    setUploading(true);
    let successCount = 0;

    for (const file of Array.from(files)) {
      setProgress(`Uploading ${file.name}…`);
      // 1. Get presigned URL from API
      const { uploadUrl } = await sessionFetch<{ id: string; uploadUrl: string }>(
        workspaceId,
        "/assets/upload-url",
        {
          method: "POST",
          body: JSON.stringify({
            fileName: file.name,
            mimeType: file.type || "application/octet-stream",
            fileSize: file.size,
          }),
        }
      );

      // 2. Upload directly to S3
      const s3Res = await fetch(uploadUrl, {
        method: "PUT",
        body: file,
        headers: { "Content-Type": file.type || "application/octet-stream" },
      });
      if (!s3Res.ok) throw new Error(`Upload failed: ${s3Res.status}`);
      successCount++;
    }

    setUploading(false);
    setProgress("");
    if (successCount > 0) {
      toast.success(`${successCount} file${successCount > 1 ? "s" : ""} uploaded`);
      onUploaded();
    }
  }, [workspaceId, onUploaded]);

  const handleDrop = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    setDragging(false);
    upload(e.dataTransfer.files).catch((err: Error) => { toast.error(err.message); setUploading(false); });
  }, [upload]);

  return (
    <div
      onDragOver={(e) => { e.preventDefault(); setDragging(true); }}
      onDragLeave={() => setDragging(false)}
      onDrop={handleDrop}
      onClick={() => !uploading && inputRef.current?.click()}
      className={cn(
        "flex flex-col items-center justify-center gap-3 rounded-xl border-2 border-dashed px-8 py-12 text-center transition-colors cursor-pointer",
        dragging
          ? "border-violet-500/50 bg-violet-500/5"
          : "border-border/50 hover:border-border hover:bg-muted/20"
      )}
    >
      <input
        ref={inputRef}
        type="file"
        multiple
        accept="image/*,video/mp4,video/webm,application/pdf"
        className="hidden"
        onChange={(e) => upload(e.target.files).catch((err: Error) => { toast.error(err.message); setUploading(false); })}
      />
      {uploading ? (
        <>
          <div className="h-8 w-8 rounded-full border-2 border-violet-500/30 border-t-violet-500 animate-spin" />
          <p className="text-[13px] text-muted-foreground">{progress}</p>
        </>
      ) : (
        <>
          <div className="flex h-10 w-10 items-center justify-center rounded-full border border-border bg-muted/50">
            <Upload className="h-4 w-4 text-muted-foreground/60" />
          </div>
          <div>
            <p className="text-[13px] font-medium text-foreground/80">Drop files or click to upload</p>
            <p className="mt-0.5 text-[11px] text-muted-foreground/50">
              Images, video, PDF · Max 25 MB each
            </p>
          </div>
        </>
      )}
    </div>
  );
}

// ── Main page ─────────────────────────────────────────────────────────────────
function AssetsPage() {
  const { activeWorkspaceId } = useWorkspaceStore();
  const qc = useQueryClient();
  const [showUpload, setShowUpload] = useState(false);
  const [deleteAsset, setDeleteAsset] = useState<Asset | null>(null);

  const { data: assetList = [], isLoading, isError } = useQuery<Asset[]>({
    queryKey: ["assets", activeWorkspaceId],
    queryFn: () => sessionFetch(activeWorkspaceId!, "/assets"),
    enabled: !!activeWorkspaceId,
  });

  const deleteMutation = useMutation({
    mutationFn: (id: string) => sessionFetch(activeWorkspaceId!, `/assets/${id}`, { method: "DELETE" }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["assets", activeWorkspaceId] });
      setDeleteAsset(null);
      toast.success("Asset deleted");
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const refetch = () => qc.invalidateQueries({ queryKey: ["assets", activeWorkspaceId] });

  return (
    <div className="px-8 py-7 w-full">
      {/* Header */}
      <div className="mb-6 flex items-start justify-between gap-4">
        <div>
          <h1 className="text-[15px] font-semibold tracking-tight text-foreground">Assets</h1>
          <p className="mt-0.5 text-[12px] text-muted-foreground">
            {assetList.length > 0
              ? `${assetList.length} file${assetList.length !== 1 ? "s" : ""}`
              : "Images, videos, and files for your email campaigns"}
          </p>
        </div>
        <Button size="sm" onClick={() => setShowUpload((v) => !v)}>
          <Plus className="h-3.5 w-3.5" />
          Upload
        </Button>
      </div>

      {/* Upload zone */}
      {showUpload && activeWorkspaceId && (
        <div className="mb-6">
          <UploadZone
            workspaceId={activeWorkspaceId}
            onUploaded={() => { refetch(); setShowUpload(false); }}
          />
        </div>
      )}

      {/* Error */}
      {isError && (
        <div className="mb-5 flex items-center gap-2 rounded-lg border border-destructive/20 bg-destructive/8 px-3 py-2 text-[12px] text-destructive">
          <AlertCircle className="h-3.5 w-3.5 shrink-0" />
          Failed to load assets. Check your storage configuration.
        </div>
      )}

      {/* Loading */}
      {isLoading && (
        <div className="grid gap-3 sm:grid-cols-2 md:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5">
          {Array.from({ length: 8 }).map((_, i) => (
            <div key={i} className="rounded-lg border border-border bg-card overflow-hidden">
              <div className="h-36 shimmer" />
              <div className="px-3 py-2.5 space-y-1.5">
                <div className="h-3 w-3/4 rounded shimmer" />
                <div className="h-2 w-1/2 rounded shimmer opacity-60" />
              </div>
            </div>
          ))}
        </div>
      )}

      {/* Empty state */}
      {!isLoading && assetList.length === 0 && (
        <div className="flex flex-col items-center justify-center px-6 py-20 text-center">
          <div className="mb-4 flex h-10 w-10 items-center justify-center rounded-full border border-border/60 bg-muted/30">
            <ImageOff className="h-4 w-4 text-muted-foreground/30" />
          </div>
          <p className="text-[13px] font-medium text-foreground/60">No assets yet</p>
          <p className="mt-1 max-w-[260px] text-[12px] leading-relaxed text-muted-foreground/40">
            Upload images and files to use in your email campaigns. Copy the URL to embed them anywhere.
          </p>
          <button
            onClick={() => setShowUpload(true)}
            className="mt-4 flex items-center gap-1.5 rounded-md border border-border/50 bg-muted/20 px-3 py-1.5 text-[12px] text-muted-foreground/60 transition-colors hover:border-border hover:bg-muted/40 hover:text-foreground/70 cursor-pointer"
          >
            <Upload className="h-3.5 w-3.5" />
            Upload your first file
          </button>
        </div>
      )}

      {/* Asset grid */}
      {!isLoading && assetList.length > 0 && (
        <div className="grid gap-3 sm:grid-cols-2 md:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5">
          {assetList.map((asset) => (
            <AssetCard
              key={asset.id}
              asset={asset}
              workspaceId={activeWorkspaceId!}
              onDelete={setDeleteAsset}
            />
          ))}
        </div>
      )}

      {/* Delete confirm */}
      <AlertDialog open={!!deleteAsset} onOpenChange={(o) => !o && setDeleteAsset(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete asset?</AlertDialogTitle>
            <AlertDialogDescription>
              <strong className="text-foreground font-medium">{deleteAsset?.name}</strong> will be
              permanently deleted from storage. Any emails using this asset will show a broken image.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              disabled={deleteMutation.isPending}
              onClick={() => deleteAsset && deleteMutation.mutate(deleteAsset.id)}
            >
              {deleteMutation.isPending ? "Deleting…" : "Delete"}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
