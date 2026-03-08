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
import { Plus, FileText, Trash2, Edit } from "lucide-react";
import { toast } from "sonner";

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
  const nameRef = useRef<HTMLInputElement>(null);
  const subjectRef = useRef<HTMLInputElement>(null);
  const previewRef = useRef<HTMLInputElement>(null);
  const htmlRef = useRef<HTMLTextAreaElement>(null);

  const { data: templates = [] } = useQuery<Template[]>({
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
      toast.success("Template created");
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const updateMutation = useMutation({
    mutationFn: ({ id, ...body }: { id: string } & Record<string, unknown>) =>
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
      sessionFetch(activeWorkspaceId!, `/templates/${id}`, { method: "DELETE" }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["templates", activeWorkspaceId] });
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
    <div className="p-8 max-w-5xl mx-auto">
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-xl font-semibold">Templates</h1>
          <p className="text-sm text-muted-foreground mt-0.5">Reusable email templates</p>
        </div>
        <Button size="sm" onClick={() => setOpen(true)}>
          <Plus className="w-4 h-4" />
          New Template
        </Button>
      </div>

      <Dialog
        open={dialogOpen}
        onOpenChange={(o) => {
          if (!o) {
            setOpen(false);
            setEditTemplate(null);
          }
        }}
      >
        <DialogContent className="max-w-2xl">
          <DialogHeader>
            <DialogTitle>{editTemplate ? "Edit Template" : "New Template"}</DialogTitle>
          </DialogHeader>
          <form onSubmit={handleSubmit} className="space-y-4">
            <div className="space-y-1.5">
              <Label>Name *</Label>
              <Input ref={nameRef} defaultValue={editTemplate?.name} required />
            </div>
            <div className="space-y-1.5">
              <Label>Subject *</Label>
              <Input ref={subjectRef} defaultValue={editTemplate?.subject} required />
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
                className="w-full min-h-[240px] font-mono text-xs rounded-md border border-input bg-transparent px-3 py-2 focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring resize-y"
              />
            </div>
            <DialogFooter>
              <Button
                type="submit"
                disabled={createMutation.isPending || updateMutation.isPending}
              >
                {createMutation.isPending || updateMutation.isPending
                  ? "Saving..."
                  : "Save Template"}
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        {templates.map((tmpl) => (
          <div key={tmpl.id} className="bg-white rounded-xl border p-4">
            <div className="flex items-start justify-between">
              <div className="min-w-0 flex-1">
                <p className="font-medium truncate">{tmpl.name}</p>
                <p className="text-sm text-muted-foreground truncate mt-0.5">{tmpl.subject}</p>
              </div>
              <div className="flex gap-1 ml-2 shrink-0">
                <button
                  onClick={() => setEditTemplate(tmpl)}
                  className="p-1.5 hover:bg-accent rounded cursor-pointer"
                >
                  <Edit className="w-4 h-4" />
                </button>
                <button
                  onClick={() => deleteMutation.mutate(tmpl.id)}
                  className="p-1.5 hover:bg-accent rounded text-muted-foreground hover:text-destructive cursor-pointer"
                >
                  <Trash2 className="w-4 h-4" />
                </button>
              </div>
            </div>
            <p className="text-xs text-muted-foreground mt-3">
              Updated {new Date(tmpl.updatedAt).toLocaleDateString()}
            </p>
          </div>
        ))}
        {templates.length === 0 && (
          <div className="col-span-2 text-center py-20 text-muted-foreground">
            <FileText className="w-8 h-8 mx-auto mb-3 opacity-30" />
            <p className="font-medium">No templates yet</p>
          </div>
        )}
      </div>
    </div>
  );
}
