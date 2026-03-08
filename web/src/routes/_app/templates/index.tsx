import { createFileRoute } from "@tanstack/react-router";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { sessionFetch } from "@/lib/api";
import { useWorkspaceStore } from "@/store/workspace";
import { useState, useRef } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Plus, FileText, Trash2, Edit2, Monitor, Smartphone } from "lucide-react";
import { toast } from "sonner";
import { format } from "date-fns";
import { cn } from "@/lib/utils";
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

export const Route = createFileRoute("/_app/templates/")({
  component: TemplatesPage,
});

interface Template {
  id: string;
  name: string;
  subject: string;
  previewText: string | null;
  htmlContent: string;
  updatedAt: string;
}

function TemplatesPage() {
  const { activeWorkspaceId } = useWorkspaceStore();
  const qc = useQueryClient();
  const [open, setOpen] = useState(false);
  const [editTemplate, setEditTemplate] = useState<Template | null>(null);
  const [deleteTemplate, setDeleteTemplate] = useState<Template | null>(null);
  const [htmlContent, setHtmlContent] = useState("");
  const [previewMobile, setPreviewMobile] = useState(false);
  const nameRef = useRef<HTMLInputElement>(null);
  const subjectRef = useRef<HTMLInputElement>(null);
  const previewRef = useRef<HTMLInputElement>(null);

  const { data: templates = [], isLoading } = useQuery<Template[]>({
    queryKey: ["templates", activeWorkspaceId],
    queryFn: () => sessionFetch(activeWorkspaceId!, "/templates"),
    enabled: !!activeWorkspaceId,
  });

  const createMutation = useMutation({
    mutationFn: (body: object) =>
      sessionFetch(activeWorkspaceId!, "/templates", {
        method: "POST",
        body: JSON.stringify(body),
      }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["templates", activeWorkspaceId] });
      setOpen(false);
      setHtmlContent("");
      if (nameRef.current) nameRef.current.value = "";
      if (subjectRef.current) subjectRef.current.value = "";
      if (previewRef.current) previewRef.current.value = "";
      toast.success("Template created");
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const updateMutation = useMutation({
    mutationFn: ({
      id,
      ...body
    }: { id: string } & Record<string, unknown>) =>
      sessionFetch(activeWorkspaceId!, `/templates/${id}`, {
        method: "PATCH",
        body: JSON.stringify(body),
      }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["templates", activeWorkspaceId] });
      setEditTemplate(null);
      setHtmlContent("");
      toast.success("Template saved");
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const deleteMutation = useMutation({
    mutationFn: (id: string) =>
      sessionFetch(activeWorkspaceId!, `/templates/${id}`, {
        method: "DELETE",
      }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["templates", activeWorkspaceId] });
      setDeleteTemplate(null);
      toast.success("Template deleted");
    },
    onError: (e: Error) => toast.error(e.message),
  });

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    const body = {
      name: nameRef.current!.value,
      subject: subjectRef.current!.value,
      previewText: previewRef.current!.value || undefined,
      htmlContent,
    };
    if (editTemplate) {
      updateMutation.mutate({ id: editTemplate.id, ...body });
    } else {
      createMutation.mutate(body);
    }
  }

  function openEdit(tmpl: Template) {
    setHtmlContent(tmpl.htmlContent);
    setEditTemplate(tmpl);
  }

  function openNew() {
    setHtmlContent("");
    setOpen(true);
  }

  const dialogOpen = open || !!editTemplate;

  return (
    <div className="px-8 py-7 w-full">
      {/* Header */}
      <div className="mb-5 flex items-center justify-between">
        <div>
          <h1 className="text-[15px] font-semibold tracking-tight">Templates</h1>
          <p className="mt-0.5 text-[12px] text-muted-foreground">
            Reusable email templates
          </p>
        </div>
        <Button size="sm" onClick={openNew}>
          <Plus className="h-3.5 w-3.5" />
          New Template
        </Button>
      </div>

      {/* Editor dialog — full-screen two-column: editor left, live preview right */}
      <Dialog
        open={dialogOpen}
        onOpenChange={(o) => {
          if (!o) {
            setOpen(false);
            setEditTemplate(null);
            setHtmlContent("");
          }
        }}
      >
        <DialogContent
          key={editTemplate?.id ?? "new"}
          className="max-w-[96vw] w-[96vw] h-[92vh] p-0 gap-0 flex flex-col overflow-hidden"
        >
          {/* Top bar */}
          <DialogHeader className="shrink-0 flex flex-row items-center justify-between px-5 py-3 border-b border-border">
            <DialogTitle className="text-[14px] font-semibold">
              {editTemplate ? "Edit Template" : "New Template"}
            </DialogTitle>
            <div className="flex items-center gap-2 mr-8">
              {/* Viewport toggle */}
              <div className="flex items-center rounded-md border border-border p-0.5 gap-0.5">
                <button
                  type="button"
                  onClick={() => setPreviewMobile(false)}
                  className={cn(
                    "rounded px-2 py-1 transition-colors cursor-pointer",
                    !previewMobile ? "bg-foreground text-background" : "text-muted-foreground hover:text-foreground"
                  )}
                >
                  <Monitor className="h-3.5 w-3.5" />
                </button>
                <button
                  type="button"
                  onClick={() => setPreviewMobile(true)}
                  className={cn(
                    "rounded px-2 py-1 transition-colors cursor-pointer",
                    previewMobile ? "bg-foreground text-background" : "text-muted-foreground hover:text-foreground"
                  )}
                >
                  <Smartphone className="h-3.5 w-3.5" />
                </button>
              </div>
            </div>
          </DialogHeader>

          {/* Body: editor | preview */}
          <div className="flex flex-1 min-h-0">
            {/* Left — form */}
            <form
              onSubmit={handleSubmit}
              className="flex flex-col w-[400px] shrink-0 border-r border-border overflow-y-auto"
            >
              <div className="flex-1 space-y-4 p-5">
                <div className="space-y-1.5">
                  <Label>Name *</Label>
                  <Input
                    ref={nameRef}
                    defaultValue={editTemplate?.name}
                    required
                    placeholder="Welcome email"
                  />
                </div>
                <div className="space-y-1.5">
                  <Label>Subject *</Label>
                  <Input
                    ref={subjectRef}
                    defaultValue={editTemplate?.subject}
                    required
                    placeholder="Welcome to {{company}}!"
                  />
                </div>
                <div className="space-y-1.5">
                  <Label>Preview Text</Label>
                  <Input
                    ref={previewRef}
                    defaultValue={editTemplate?.previewText ?? ""}
                    placeholder="Short preview shown in inbox"
                  />
                </div>
                <div className="space-y-1.5 flex flex-col flex-1">
                  <Label>HTML Content *</Label>
                  <textarea
                    required
                    value={htmlContent}
                    onChange={(e) => setHtmlContent(e.target.value)}
                    placeholder="<html>...</html>"
                    className="flex-1 w-full min-h-[340px] resize-none rounded-md border border-input bg-input px-3 py-2 font-mono text-xs focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
                  />
                </div>
              </div>
              <div className="shrink-0 px-5 py-3 border-t border-border bg-card">
                <Button
                  type="submit"
                  className="w-full"
                  disabled={createMutation.isPending || updateMutation.isPending}
                >
                  {createMutation.isPending || updateMutation.isPending
                    ? "Saving…"
                    : "Save Template"}
                </Button>
              </div>
            </form>

            {/* Right — live preview */}
            <div className="flex-1 flex flex-col min-w-0 bg-muted/30">
              <div className="shrink-0 flex items-center justify-between px-4 py-2 border-b border-border">
                <span className="text-[11px] font-medium text-muted-foreground uppercase tracking-wide">Preview</span>
                {htmlContent && (
                  <span className="text-[10px] text-muted-foreground">Live</span>
                )}
              </div>
              <div className="flex-1 flex items-start justify-center overflow-auto p-6">
                {htmlContent ? (
                  <div
                    className={cn(
                      "h-full transition-all duration-200",
                      previewMobile ? "w-[375px]" : "w-full max-w-[680px]"
                    )}
                  >
                    <iframe
                      srcDoc={htmlContent}
                      sandbox="allow-same-origin"
                      className="w-full h-full min-h-[600px] rounded-lg border border-border bg-white shadow-sm"
                      title="Email preview"
                    />
                  </div>
                ) : (
                  <div className="flex flex-col items-center justify-center h-full text-center gap-2 opacity-40">
                    <Monitor className="h-8 w-8 text-muted-foreground" />
                    <p className="text-[12px] text-muted-foreground">Start typing HTML to see a live preview</p>
                  </div>
                )}
              </div>
            </div>
          </div>
        </DialogContent>
      </Dialog>

      {/* Grid */}
      <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
        {isLoading &&
          Array.from({ length: 4 }).map((_, i) => (
            <div key={i} className="rounded-lg border border-border bg-card p-4">
              <div className="mb-2 h-4 w-32 rounded shimmer" />
              <div className="h-3.5 w-48 rounded shimmer" />
              <div className="mt-4 h-3 w-20 rounded shimmer" />
            </div>
          ))}

        {!isLoading &&
          templates.map((tmpl) => (
            <div
              key={tmpl.id}
              className="group rounded-lg border border-border bg-card p-4 transition-colors duration-150 hover:bg-accent/50"
            >
              <div className="flex items-start justify-between gap-2">
                <div className="min-w-0 flex-1">
                  <p className="truncate font-medium text-sm">{tmpl.name}</p>
                  <p className="mt-0.5 truncate text-[12px] text-muted-foreground">
                    {tmpl.subject}
                  </p>
                </div>
                <div className="flex shrink-0 gap-0.5 opacity-0 transition-opacity group-hover:opacity-100">
                  <button
                    onClick={() => openEdit(tmpl)}
                    className="rounded p-1.5 text-muted-foreground transition-colors hover:bg-accent hover:text-foreground cursor-pointer"
                  >
                    <Edit2 className="h-3.5 w-3.5" />
                  </button>
                  <button
                    onClick={() => setDeleteTemplate(tmpl)}
                    className="rounded p-1.5 text-muted-foreground transition-colors hover:bg-destructive/10 hover:text-destructive cursor-pointer"
                  >
                    <Trash2 className="h-3.5 w-3.5" />
                  </button>
                </div>
              </div>
              <p className="mt-3 text-xs text-muted-foreground tabular-nums">
                {tmpl.updatedAt
                  ? `Updated ${format(new Date(tmpl.updatedAt), "MMM d, yyyy")}`
                  : ""}
              </p>
            </div>
          ))}

        {!isLoading && templates.length === 0 && (
          <div className="col-span-2 flex flex-col items-center justify-center py-20 text-center">
            <div className="mb-4 flex h-9 w-9 items-center justify-center rounded-lg border border-border">
              <FileText className="h-5 w-5 text-muted-foreground" />
            </div>
            <p className="text-[13px] font-medium">No templates yet</p>
            <p className="mt-1 text-[12px] text-muted-foreground">
              Create a reusable HTML email template
            </p>
            <Button size="sm" className="mt-4" onClick={openNew}>
              <Plus className="h-3.5 w-3.5" />
              New Template
            </Button>
          </div>
        )}
      </div>

      {/* Delete confirmation */}
      <AlertDialog
        open={!!deleteTemplate}
        onOpenChange={(o) => !o && setDeleteTemplate(null)}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete template?</AlertDialogTitle>
            <AlertDialogDescription>
              <strong className="text-foreground font-medium">
                {deleteTemplate?.name}
              </strong>{" "}
              will be permanently deleted. Any broadcasts using this template will be unaffected.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              disabled={deleteMutation.isPending}
              onClick={() => deleteTemplate && deleteMutation.mutate(deleteTemplate.id)}
            >
              {deleteMutation.isPending ? "Deleting…" : "Delete"}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
