import { createFileRoute } from "@tanstack/react-router";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { sessionFetch } from "@/lib/api";
import { useWorkspaceStore } from "@/store/workspace";
import { useState, useRef, useCallback, useEffect } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  Plus,
  FileText,
  Trash2,
  Monitor,
  Smartphone,
  Search,
  Copy,
  Code2,
  Eye,
  Send,
} from "lucide-react";
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
import { EmailEditor } from "@/components/ui/email-editor";
import { useSession } from "@/lib/auth-client";

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

type EditorMode = "visual" | "html";

function wrapForPreview(html: string): string {
  if (!html) return "";
  // If it's a full HTML document, use as-is
  if (html.trimStart().startsWith("<!DOCTYPE") || html.trimStart().startsWith("<html")) {
    return html;
  }
  // Otherwise wrap in a basic email shell
  return `<!DOCTYPE html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><style>
    *{box-sizing:border-box;margin:0;padding:0}
    body{font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;font-size:15px;line-height:1.6;color:#111;background:#f5f5f5;padding:24px 16px}
    .wrapper{max-width:600px;margin:0 auto;background:#fff;border-radius:8px;padding:36px 40px;border:1px solid #e5e5e5}
    h1{font-size:24px;font-weight:700;margin-bottom:16px;line-height:1.3}
    h2{font-size:20px;font-weight:600;margin-bottom:12px;line-height:1.3}
    h3{font-size:17px;font-weight:600;margin-bottom:10px;line-height:1.3}
    p{margin-bottom:12px}
    ul{list-style:disc;padding-left:24px;margin-bottom:12px}
    ol{list-style:decimal;padding-left:24px;margin-bottom:12px}
    li{margin-bottom:4px}
    a{color:#0070f3;text-decoration:underline}
    blockquote{border-left:3px solid #e5e5e5;padding-left:16px;color:#666;margin-bottom:12px;font-style:italic}
    code{background:#f0f0f0;padding:2px 6px;border-radius:4px;font-family:monospace;font-size:13px}
    pre{background:#f0f0f0;padding:16px;border-radius:6px;overflow-x:auto;margin-bottom:12px}
    pre code{background:none;padding:0}
    img{max-width:100%;height:auto;border-radius:4px}
    strong,b{font-weight:600}
    em,i{font-style:italic}
    u{text-decoration:underline}
    s{text-decoration:line-through}
  </style></head><body><div class="wrapper">${html}</div></body></html>`;
}

function TemplateEditor({
  template,
  onClose,
}: {
  template: Template | null;
  onClose: () => void;
}) {
  const { activeWorkspaceId } = useWorkspaceStore();
  const qc = useQueryClient();
  const { data: session } = useSession();

  const [mode, setMode] = useState<EditorMode>("visual");
  const [previewMobile, setPreviewMobile] = useState(false);
  const [content, setContent] = useState(template?.htmlContent ?? "");
  const [rawHtml, setRawHtml] = useState(template?.htmlContent ?? "");

  // Test email state — fill from session once loaded
  const [testEmail, setTestEmail] = useState("");
  const [prependTest, setPrependTest] = useState(true);

  useEffect(() => {
    if (!testEmail && session?.user?.email) {
      setTestEmail(session.user.email);
    }
  }, [session?.user?.email]);

  const nameRef = useRef<HTMLInputElement>(null);
  const subjectRef = useRef<HTMLInputElement>(null);
  const previewRef = useRef<HTMLInputElement>(null);

  // Sync between modes
  const switchMode = useCallback((next: EditorMode) => {
    if (next === mode) return;
    if (mode === "visual") {
      // visual → code: expose the current HTML
      setRawHtml(content);
    } else {
      // code → visual: load raw HTML into the WYSIWYG editor
      setContent(rawHtml);
    }
    setMode(next);
  }, [mode, content, rawHtml]);

  // The canonical HTML is whatever is active
  const activeHtml = mode === "visual" ? content : rawHtml;

  const createMutation = useMutation({
    mutationFn: (body: object) =>
      sessionFetch(activeWorkspaceId!, "/templates", {
        method: "POST",
        body: JSON.stringify(body),
      }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["templates", activeWorkspaceId] });
      toast.success("Template created");
      onClose();
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const updateMutation = useMutation({
    mutationFn: (body: object) =>
      sessionFetch(activeWorkspaceId!, `/templates/${template!.id}`, {
        method: "PATCH",
        body: JSON.stringify(body),
      }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["templates", activeWorkspaceId] });
      toast.success("Template saved");
      onClose();
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const sendTestMutation = useMutation({
    mutationFn: () =>
      sessionFetch(activeWorkspaceId!, "/templates/send-test", {
        method: "POST",
        body: JSON.stringify({
          to: testEmail,
          subject: subjectRef.current?.value || "Test email",
          htmlContent: activeHtml,
          prependTest,
        }),
      }),
    onSuccess: () => toast.success(`Test email sent to ${testEmail}`),
    onError: (e: Error) => toast.error(e.message),
  });

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    const body = {
      name: nameRef.current!.value,
      subject: subjectRef.current!.value,
      previewText: previewRef.current!.value || undefined,
      htmlContent: activeHtml,
    };
    if (template) {
      updateMutation.mutate(body);
    } else {
      createMutation.mutate(body);
    }
  }

  const isPending = createMutation.isPending || updateMutation.isPending;

  return (
    <form
      onSubmit={handleSubmit}
      className="flex flex-col w-full h-full"
    >
      {/* Top bar */}
      <div className="shrink-0 flex items-center justify-between px-5 py-3 border-b border-border">
        <span className="text-[14px] font-semibold">
          {template ? "Edit Template" : "New Template"}
        </span>
        <div className="flex items-center gap-3">
          {/* Editor mode toggle */}
          <div className="flex items-center rounded-md border border-border p-0.5 gap-0.5">
            <button
              type="button"
              onClick={() => switchMode("visual")}
              className={cn(
                "flex items-center gap-1.5 rounded px-2.5 py-1 text-[12px] font-medium transition-colors cursor-pointer",
                mode === "visual"
                  ? "bg-foreground text-background"
                  : "text-muted-foreground hover:text-foreground"
              )}
            >
              <Eye className="h-3 w-3" />
              Visual
            </button>
            <button
              type="button"
              onClick={() => switchMode("html")}
              className={cn(
                "flex items-center gap-1.5 rounded px-2.5 py-1 text-[12px] font-medium transition-colors cursor-pointer",
                mode === "html"
                  ? "bg-foreground text-background"
                  : "text-muted-foreground hover:text-foreground"
              )}
            >
              <Code2 className="h-3 w-3" />
              HTML
            </button>
          </div>
          {/* Viewport toggle */}
          <div className="flex items-center rounded-md border border-border p-0.5 gap-0.5">
            <button
              type="button"
              onClick={() => setPreviewMobile(false)}
              className={cn(
                "rounded px-2 py-1 transition-colors cursor-pointer",
                !previewMobile
                  ? "bg-foreground text-background"
                  : "text-muted-foreground hover:text-foreground"
              )}
              title="Desktop preview"
            >
              <Monitor className="h-3.5 w-3.5" />
            </button>
            <button
              type="button"
              onClick={() => setPreviewMobile(true)}
              className={cn(
                "rounded px-2 py-1 transition-colors cursor-pointer",
                previewMobile
                  ? "bg-foreground text-background"
                  : "text-muted-foreground hover:text-foreground"
              )}
              title="Mobile preview"
            >
              <Smartphone className="h-3.5 w-3.5" />
            </button>
          </div>
          {/* Save button */}
          <Button type="submit" size="sm" disabled={isPending}>
            {isPending ? "Saving…" : "Save Template"}
          </Button>
        </div>
      </div>

      {/* Body: editor | preview */}
      <div className="flex flex-1 min-h-0">
        {/* Left — fields + editor */}
        <div className="flex flex-col w-[440px] shrink-0 border-r border-border overflow-y-auto">
          <div className="flex-1 space-y-4 p-5">
            <div className="space-y-1.5">
              <Label className="text-[12px]">Template Name *</Label>
              <Input
                ref={nameRef}
                defaultValue={template?.name}
                required
                placeholder="Welcome email"
                className="h-8 text-sm"
              />
            </div>
            <div className="space-y-1.5">
              <Label className="text-[12px]">Subject Line *</Label>
              <Input
                ref={subjectRef}
                defaultValue={template?.subject}
                required
                placeholder="Welcome to {{company}}!"
                className="h-8 text-sm"
              />
            </div>
            <div className="space-y-1.5">
              <Label className="text-[12px]">Preview Text</Label>
              <Input
                ref={previewRef}
                defaultValue={template?.previewText ?? ""}
                placeholder="Short preview shown in inbox…"
                className="h-8 text-sm"
              />
            </div>

            <div className="space-y-1.5">
              <Label className="text-[12px]">Email Body</Label>

              {mode === "visual" ? (
                <EmailEditor
                  value={content}
                  onChange={setContent}
                  placeholder="Start writing your email…"
                  className="min-h-[320px]"
                  workspaceId={activeWorkspaceId ?? undefined}
                />
              ) : (
                <textarea
                  value={rawHtml}
                  onChange={(e) => setRawHtml(e.target.value)}
                  placeholder={"<p>Hello {{firstName}},</p>\n<p>Your content here…</p>"}
                  spellCheck={false}
                  className="w-full min-h-[340px] resize-y rounded-md border border-input bg-input px-3 py-2 font-mono text-xs focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
                />
              )}

              <p className="text-[11px] text-muted-foreground">
                Use{" "}
                <code className="bg-muted px-1 py-0.5 rounded text-[10px]">
                  {"{{variable}}"}
                </code>{" "}
                for dynamic content substitution.
              </p>
            </div>

            {/* Send Test Email */}
            <div className="space-y-2.5 rounded-lg border border-border bg-muted/20 p-4">
              <p className="text-[12px] font-medium">Send Test Email</p>
              <div className="space-y-1.5">
                <Label className="text-[11px] text-muted-foreground">Send to</Label>
                <Input
                  type="email"
                  value={testEmail}
                  onChange={(e) => setTestEmail(e.target.value)}
                  placeholder="you@example.com"
                  className="h-8 text-sm"
                />
              </div>
              <label className="flex items-center gap-2 cursor-pointer select-none">
                <button
                  type="button"
                  role="switch"
                  aria-checked={prependTest}
                  onClick={() => setPrependTest((v) => !v)}
                  className={cn(
                    "relative inline-flex h-4.5 w-8 shrink-0 items-center rounded-full border-2 border-transparent transition-colors focus-visible:outline-none",
                    prependTest ? "bg-foreground" : "bg-input"
                  )}
                >
                  <span
                    className={cn(
                      "pointer-events-none block h-3 w-3 rounded-full bg-background shadow-sm transition-transform",
                      prependTest ? "translate-x-3.5" : "translate-x-0.5"
                    )}
                  />
                </button>
                <span className="text-[12px] text-muted-foreground">
                  Prepend <code className="bg-muted px-1 rounded text-[11px]">[TEST]</code> to subject
                </span>
              </label>
              <Button
                type="button"
                variant="outline"
                size="sm"
                className="w-full"
                disabled={!testEmail || sendTestMutation.isPending}
                onClick={() => sendTestMutation.mutate()}
              >
                <Send className="h-3.5 w-3.5" />
                {sendTestMutation.isPending ? "Sending…" : "Send Test Email"}
              </Button>
            </div>
          </div>
        </div>

        {/* Right — live preview */}
        <div className="flex-1 flex flex-col min-w-0 bg-muted/20">
          <div className="shrink-0 flex items-center justify-between px-4 py-2 border-b border-border">
            <span className="text-[11px] font-medium text-muted-foreground uppercase tracking-wide">
              Preview
            </span>
            <span className="text-[10px] text-muted-foreground">
              {activeHtml ? "Live" : "Empty"}
            </span>
          </div>
          <div className="flex-1 flex items-start justify-center overflow-auto p-6">
            {activeHtml ? (
              <div
                className={cn(
                  "h-full transition-all duration-200",
                  previewMobile ? "w-[375px]" : "w-full max-w-[680px]"
                )}
              >
                <iframe
                  srcDoc={wrapForPreview(activeHtml)}
                  sandbox="allow-same-origin"
                  className="w-full min-h-[600px] rounded-lg border border-border bg-white shadow-sm"
                  title="Email preview"
                />
              </div>
            ) : (
              <div className="flex flex-col items-center justify-center h-full text-center gap-2 opacity-40 mt-20">
                <Monitor className="h-8 w-8 text-muted-foreground" />
                <p className="text-[12px] text-muted-foreground">
                  Start writing to see a live preview
                </p>
              </div>
            )}
          </div>
        </div>
      </div>
    </form>
  );
}

function TemplatesPage() {
  const { activeWorkspaceId } = useWorkspaceStore();
  const qc = useQueryClient();
  const [editorOpen, setEditorOpen] = useState(false);
  const [editTemplate, setEditTemplate] = useState<Template | null>(null);
  const [deleteTemplate, setDeleteTemplate] = useState<Template | null>(null);
  const [searchQuery, setSearchQuery] = useState("");

  const { data: templates = [], isLoading, isError } = useQuery<Template[]>({
    queryKey: ["templates", activeWorkspaceId],
    queryFn: () => sessionFetch(activeWorkspaceId!, "/templates"),
    enabled: !!activeWorkspaceId,
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

  const createMutation = useMutation({
    mutationFn: (body: object) =>
      sessionFetch(activeWorkspaceId!, "/templates", {
        method: "POST",
        body: JSON.stringify(body),
      }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["templates", activeWorkspaceId] });
      toast.success("Template duplicated");
    },
    onError: (e: Error) => toast.error(e.message),
  });

  function openNew() {
    setEditTemplate(null);
    setEditorOpen(true);
  }

  function openEdit(tmpl: Template) {
    setEditTemplate(tmpl);
    setEditorOpen(true);
  }

  function closeEditor() {
    setEditorOpen(false);
    setEditTemplate(null);
  }

  function duplicateTemplate(tmpl: Template) {
    createMutation.mutate({
      name: `${tmpl.name} (copy)`,
      subject: tmpl.subject,
      previewText: tmpl.previewText || undefined,
      htmlContent: tmpl.htmlContent,
    });
  }

  const dialogOpen = editorOpen || !!editTemplate;

  const filteredTemplates = templates.filter(
    (t) =>
      !searchQuery ||
      t.name.toLowerCase().includes(searchQuery.toLowerCase()) ||
      t.subject.toLowerCase().includes(searchQuery.toLowerCase())
  );

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

      {/* Full-screen editor dialog */}
      <Dialog
        open={dialogOpen}
        onOpenChange={(o) => {
          if (!o) closeEditor();
        }}
      >
        <DialogContent
          key={editTemplate?.id ?? "new"}
          className="max-w-[96vw] w-[96vw] h-[92vh] p-0 gap-0 flex flex-col overflow-hidden"
        >
          <DialogHeader className="sr-only">
            <DialogTitle>
              {editTemplate ? "Edit Template" : "New Template"}
            </DialogTitle>
          </DialogHeader>
          <TemplateEditor
            template={editTemplate}
            onClose={closeEditor}
          />
        </DialogContent>
      </Dialog>

      {isError && (
        <div className="mb-4 flex items-center gap-2 rounded-lg border border-destructive/20 bg-destructive/8 px-3.5 py-2.5 text-[13px] text-destructive">
          Failed to load templates.
        </div>
      )}

      {/* Search */}
      {(templates.length > 0 || isLoading) && (
        <div className="relative mb-4 max-w-sm">
          <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-muted-foreground/50" />
          <Input
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            placeholder="Search templates…"
            className="pl-8 h-9"
          />
        </div>
      )}

      {/* Grid */}
      <div className="grid grid-cols-1 gap-3 md:grid-cols-2 lg:grid-cols-3">
        {isLoading &&
          Array.from({ length: 4 }).map((_, i) => (
            <div key={i} className="rounded-lg border border-border bg-card p-4">
              <div className="mb-2 h-4 w-32 rounded shimmer" />
              <div className="h-3.5 w-48 rounded shimmer" />
              <div className="mt-4 h-3 w-20 rounded shimmer" />
            </div>
          ))}

        {!isLoading &&
          filteredTemplates.map((tmpl) => (
            <div
              key={tmpl.id}
              className="group rounded-lg border border-border bg-card p-4 transition-colors duration-150 hover:bg-accent/50 cursor-pointer"
              onClick={() => openEdit(tmpl)}
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
                    onClick={(e) => {
                      e.stopPropagation();
                      duplicateTemplate(tmpl);
                    }}
                    className="rounded p-1.5 text-muted-foreground transition-colors hover:bg-accent hover:text-foreground cursor-pointer"
                    title="Duplicate template"
                  >
                    <Copy className="h-3.5 w-3.5" />
                  </button>
                  <button
                    onClick={(e) => {
                      e.stopPropagation();
                      setDeleteTemplate(tmpl);
                    }}
                    className="rounded p-1.5 text-muted-foreground transition-colors hover:bg-destructive/10 hover:text-destructive cursor-pointer"
                    title="Delete template"
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

        {!isLoading && templates.length > 0 && filteredTemplates.length === 0 && (
          <div className="col-span-full py-12 text-center text-[13px] text-muted-foreground">
            No templates match &ldquo;{searchQuery}&rdquo;
          </div>
        )}

        {!isLoading && templates.length === 0 && (
          <div className="col-span-full flex flex-col items-center justify-center py-20 text-center">
            <div className="mb-4 flex h-9 w-9 items-center justify-center rounded-lg border border-border">
              <FileText className="h-5 w-5 text-muted-foreground" />
            </div>
            <p className="text-[13px] font-medium">No templates yet</p>
            <p className="mt-1 text-[12px] text-muted-foreground">
              Create a reusable email template
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
              will be permanently deleted.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              disabled={deleteMutation.isPending}
              onClick={() =>
                deleteTemplate && deleteMutation.mutate(deleteTemplate.id)
              }
            >
              {deleteMutation.isPending ? "Deleting…" : "Delete"}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
