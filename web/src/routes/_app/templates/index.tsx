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
  DialogFooter,
} from "@/components/ui/dialog";
import { Plus, FileText, Trash2, Edit2 } from "lucide-react";
import { toast } from "sonner";
import { format } from "date-fns";
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
  const nameRef = useRef<HTMLInputElement>(null);
  const subjectRef = useRef<HTMLInputElement>(null);
  const previewRef = useRef<HTMLInputElement>(null);
  const htmlRef = useRef<HTMLTextAreaElement>(null);

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
      // Reset form refs so re-opening shows a blank form
      if (nameRef.current) nameRef.current.value = "";
      if (subjectRef.current) subjectRef.current.value = "";
      if (previewRef.current) previewRef.current.value = "";
      if (htmlRef.current) htmlRef.current.value = "";
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
      htmlContent: htmlRef.current!.value,
    };
    if (editTemplate) {
      updateMutation.mutate({ id: editTemplate.id, ...body });
    } else {
      createMutation.mutate(body);
    }
  }

  const dialogOpen = open || !!editTemplate;

  return (
    <div className="mx-auto max-w-5xl px-8 py-7">
      {/* Header */}
      <div className="mb-7 flex items-center justify-between">
        <div>
          <h1 className="text-[15px] font-semibold tracking-tight">Templates</h1>
          <p className="mt-0.5 text-[12px] text-muted-foreground">
            Reusable email templates
          </p>
        </div>
        <Button size="sm" onClick={() => setOpen(true)}>
          <Plus className="h-4 w-4" />
          New Template
        </Button>
      </div>

      {/* Dialog */}
      <Dialog
        open={dialogOpen}
        onOpenChange={(o) => {
          if (!o) {
            setOpen(false);
            setEditTemplate(null);
          }
        }}
      >
        {/* key forces full remount when switching between templates so defaultValue re-populates */}
        <DialogContent key={editTemplate?.id ?? "new"} className="max-w-xl">
          <DialogHeader>
            <DialogTitle>
              {editTemplate ? "Edit Template" : "New Template"}
            </DialogTitle>
          </DialogHeader>
          <form onSubmit={handleSubmit} className="space-y-4">
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
            <div className="space-y-1.5">
              <Label>HTML Content *</Label>
              <textarea
                ref={htmlRef}
                required
                defaultValue={editTemplate?.htmlContent}
                placeholder="<html>...</html>"
                className="w-full min-h-[120px] resize-y rounded-md border border-input bg-transparent px-3 py-2 font-mono text-xs focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
              />
            </div>
            <DialogFooter className="sticky bottom-0 bg-background pt-2">
              <Button
                type="submit"
                disabled={createMutation.isPending || updateMutation.isPending}
              >
                {createMutation.isPending || updateMutation.isPending
                  ? "Saving…"
                  : "Save Template"}
              </Button>
            </DialogFooter>
          </form>
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
                    onClick={() => setEditTemplate(tmpl)}
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
            <Button size="sm" className="mt-4" onClick={() => setOpen(true)}>
              <Plus className="h-4 w-4" />
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
