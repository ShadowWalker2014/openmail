import { createFileRoute } from "@tanstack/react-router";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { sessionFetch } from "@/lib/api";
import { useWorkspaceStore } from "@/store/workspace";
import { useState, useRef, useEffect } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
  DialogTrigger,
} from "@/components/ui/dialog";
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
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import {
  Plus,
  Search,
  Trash2,
  Users,
  ChevronLeft,
  ChevronRight,
  AlertCircle,
  X,
} from "lucide-react";
import { toast } from "sonner";
import { format } from "date-fns";
import { cn } from "@/lib/utils";

export const Route = createFileRoute("/_app/contacts/")({ component: ContactsPage });

interface Contact {
  id: string;
  email: string;
  firstName: string | null;
  lastName: string | null;
  phone: string | null;
  attributes: Record<string, unknown>;
  unsubscribed: boolean;
  createdAt: string;
  updatedAt: string;
}

interface ContactEvent {
  id: string;
  eventName: string;
  properties: Record<string, unknown>;
  createdAt: string;
}

interface ContactSend {
  id: string;
  subject: string;
  status: string;
  createdAt: string;
}

const PAGE_SIZE = 50;

// ── ContactDetailContent ──────────────────────────────────────────────────────

interface ContactDetailContentProps {
  contact: Contact;
  workspaceId: string;
  onClose: () => void;
}

function ContactDetailContent({ contact, workspaceId, onClose }: ContactDetailContentProps) {
  const qc = useQueryClient();
  const [firstName, setFirstName] = useState(contact.firstName ?? "");
  const [lastName, setLastName] = useState(contact.lastName ?? "");
  const [phone, setPhone] = useState(contact.phone ?? "");
  const [unsubscribed, setUnsubscribed] = useState(contact.unsubscribed);
  const [attrs, setAttrs] = useState<{ key: string; value: string }[]>(() =>
    Object.entries(contact.attributes ?? {}).map(([key, value]) => ({
      key,
      value: String(value),
    }))
  );
  const [activeTab, setActiveTab] = useState<"events" | "emails">("events");
  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false);

  const patchMutation = useMutation({
    mutationFn: () =>
      sessionFetch(workspaceId, `/contacts/${contact.id}`, {
        method: "PATCH",
        body: JSON.stringify({
          firstName: firstName || null,
          lastName: lastName || null,
          phone: phone || null,
          unsubscribed,
          attributes: Object.fromEntries(
            attrs.filter((a) => a.key.trim()).map((a) => [a.key.trim(), a.value])
          ),
        }),
      }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["contacts", workspaceId] });
      toast.success("Contact updated");
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const deleteMutation = useMutation({
    mutationFn: () =>
      sessionFetch(workspaceId, `/contacts/${contact.id}`, { method: "DELETE" }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["contacts", workspaceId] });
      toast.success("Contact deleted");
      onClose();
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const { data: events, isLoading: eventsLoading } = useQuery<ContactEvent[]>({
    queryKey: ["contact-events", contact.id],
    queryFn: () => sessionFetch(workspaceId, `/contacts/${contact.id}/events`),
    enabled: activeTab === "events",
  });

  const { data: sends, isLoading: sendsLoading } = useQuery<ContactSend[]>({
    queryKey: ["contact-sends", contact.id],
    queryFn: () => sessionFetch(workspaceId, `/contacts/${contact.id}/sends`),
    enabled: activeTab === "emails",
  });

  function sendStatusVariant(status: string) {
    switch (status) {
      case "sent":
        return "success" as const;
      case "failed":
        return "destructive" as const;
      case "bounced":
        return "warning" as const;
      default:
        return "secondary" as const;
    }
  }

  return (
    <>
      {/* Top bar */}
      <DialogHeader className="flex flex-row items-center gap-3 px-5 py-3.5 border-b border-border/50 shrink-0">
        <DialogTitle className="truncate flex-1 min-w-0">{contact.email}</DialogTitle>
        {unsubscribed ? (
          <Badge variant="destructive">Unsubscribed</Badge>
        ) : (
          <Badge variant="success">Subscribed</Badge>
        )}
      </DialogHeader>

      {/* Body */}
      <div className="flex flex-1 min-h-0">
        {/* Left panel */}
        <div className="w-[400px] shrink-0 border-r border-border/50 overflow-y-auto flex flex-col">
          <div className="flex-1 p-5 space-y-5">
            {/* Email (read-only) */}
            <div className="space-y-1.5">
              <p className="text-[12px] font-medium text-muted-foreground">Email</p>
              <p className="text-[13px] text-foreground truncate">{contact.email}</p>
            </div>

            {/* First + Last Name */}
            <div className="grid grid-cols-2 gap-2.5">
              <div className="space-y-1.5">
                <Label className="text-[12px] font-medium text-muted-foreground">
                  First Name
                </Label>
                <Input
                  value={firstName}
                  onChange={(e) => setFirstName(e.target.value)}
                  placeholder="Jane"
                />
              </div>
              <div className="space-y-1.5">
                <Label className="text-[12px] font-medium text-muted-foreground">
                  Last Name
                </Label>
                <Input
                  value={lastName}
                  onChange={(e) => setLastName(e.target.value)}
                  placeholder="Smith"
                />
              </div>
            </div>

            {/* Phone */}
            <div className="space-y-1.5">
              <Label className="text-[12px] font-medium text-muted-foreground">Phone</Label>
              <Input
                value={phone}
                onChange={(e) => setPhone(e.target.value)}
                placeholder="+1 (555) 000-0000"
              />
            </div>

            {/* Subscription Status */}
            <div className="space-y-1.5">
              <Label className="text-[12px] font-medium text-muted-foreground">
                Subscription Status
              </Label>
              <div className="flex items-center rounded-md border border-border overflow-hidden">
                <button
                  type="button"
                  onClick={() => setUnsubscribed(false)}
                  className={cn(
                    "flex-1 px-3 py-1.5 text-[12px] font-medium transition-colors cursor-pointer",
                    !unsubscribed
                      ? "bg-foreground text-background"
                      : "text-muted-foreground hover:text-foreground"
                  )}
                >
                  Subscribed
                </button>
                <button
                  type="button"
                  onClick={() => setUnsubscribed(true)}
                  className={cn(
                    "flex-1 px-3 py-1.5 text-[12px] font-medium transition-colors cursor-pointer border-l border-border",
                    unsubscribed
                      ? "bg-destructive text-destructive-foreground"
                      : "text-muted-foreground hover:text-foreground"
                  )}
                >
                  Unsubscribed
                </button>
              </div>
            </div>

            {/* Custom Attributes */}
            <div className="space-y-2">
              <p className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
                Custom Attributes
              </p>
              {attrs.map((attr, i) => (
                <div key={i} className="flex items-center gap-1.5">
                  <Input
                    className="w-1/3"
                    placeholder="key"
                    value={attr.key}
                    onChange={(e) => {
                      const next = [...attrs];
                      next[i] = { ...next[i], key: e.target.value };
                      setAttrs(next);
                    }}
                  />
                  <Input
                    className="flex-1"
                    placeholder="value"
                    value={attr.value}
                    onChange={(e) => {
                      const next = [...attrs];
                      next[i] = { ...next[i], value: e.target.value };
                      setAttrs(next);
                    }}
                  />
                  <button
                    type="button"
                    onClick={() => setAttrs(attrs.filter((_, j) => j !== i))}
                    className="rounded p-1 text-muted-foreground/50 hover:text-destructive hover:bg-destructive/10 transition-colors cursor-pointer"
                  >
                    <X className="h-3.5 w-3.5" />
                  </button>
                </div>
              ))}
              <button
                type="button"
                onClick={() => setAttrs([...attrs, { key: "", value: "" }])}
                className="flex items-center gap-1 text-[12px] text-muted-foreground hover:text-foreground transition-colors cursor-pointer"
              >
                <Plus className="h-3 w-3" />
                Add attribute
              </button>
            </div>
          </div>

          {/* Left panel footer */}
          <div className="sticky bottom-0 bg-popover border-t border-border/50 px-5 py-3 flex items-center justify-between gap-2 shrink-0">
            <Button
              size="sm"
              onClick={() => patchMutation.mutate()}
              disabled={patchMutation.isPending}
            >
              {patchMutation.isPending ? "Saving…" : "Save Changes"}
            </Button>
            <TooltipProvider>
              <Tooltip>
                <TooltipTrigger asChild>
                  <button
                    type="button"
                    onClick={() => setShowDeleteConfirm(true)}
                    className="rounded p-1.5 text-muted-foreground/40 hover:text-destructive hover:bg-destructive/10 transition-colors cursor-pointer"
                  >
                    <Trash2 className="h-4 w-4" />
                  </button>
                </TooltipTrigger>
                <TooltipContent>Delete contact</TooltipContent>
              </Tooltip>
            </TooltipProvider>
          </div>
        </div>

        {/* Right panel */}
        <div className="flex-1 flex flex-col min-w-0">
          {/* Tab bar */}
          <div className="flex items-center gap-1 px-4 py-2.5 border-b border-border/50 shrink-0">
            <button
              type="button"
              onClick={() => setActiveTab("events")}
              className={
                activeTab === "events"
                  ? "bg-foreground text-background rounded px-3 py-1.5 text-[12px] font-medium cursor-pointer"
                  : "text-muted-foreground hover:text-foreground px-3 py-1.5 text-[12px] cursor-pointer"
              }
            >
              Events
            </button>
            <button
              type="button"
              onClick={() => setActiveTab("emails")}
              className={
                activeTab === "emails"
                  ? "bg-foreground text-background rounded px-3 py-1.5 text-[12px] font-medium cursor-pointer"
                  : "text-muted-foreground hover:text-foreground px-3 py-1.5 text-[12px] cursor-pointer"
              }
            >
              Emails
            </button>
          </div>

          {/* Tab content */}
          <div className="flex-1 overflow-y-auto">
            {activeTab === "events" && (
              <>
                {eventsLoading &&
                  Array.from({ length: 3 }).map((_, i) => (
                    <div
                      key={i}
                      className="px-4 py-2.5 border-b border-border/50 last:border-0 flex items-center justify-between"
                    >
                      <div className="space-y-1.5">
                        <div className="h-3 w-32 rounded shimmer" />
                        <div className="h-2.5 w-48 rounded shimmer" />
                      </div>
                      <div className="h-2.5 w-16 rounded shimmer" />
                    </div>
                  ))}
                {!eventsLoading && !events?.length && (
                  <div className="flex items-center justify-center h-32 text-[13px] text-muted-foreground">
                    No events tracked yet
                  </div>
                )}
                {!eventsLoading &&
                  events?.map((event) => {
                    const props = JSON.stringify(event.properties);
                    return (
                      <div
                        key={event.id}
                        className="px-4 py-2.5 border-b border-border/50 last:border-0 flex items-start justify-between gap-4"
                      >
                        <div className="min-w-0">
                          <p className="text-[13px] font-medium text-foreground">
                            {event.eventName}
                          </p>
                          {props !== "{}" && (
                            <p className="text-[11px] text-muted-foreground truncate max-w-xs">
                              {props.length > 80 ? props.slice(0, 80) + "…" : props}
                            </p>
                          )}
                        </div>
                        <span className="text-[11px] text-muted-foreground tabular-nums shrink-0">
                          {format(new Date(event.createdAt), "MMM d, h:mm a")}
                        </span>
                      </div>
                    );
                  })}
              </>
            )}

            {activeTab === "emails" && (
              <>
                {sendsLoading &&
                  Array.from({ length: 3 }).map((_, i) => (
                    <div
                      key={i}
                      className="px-4 py-2.5 border-b border-border/50 last:border-0 flex items-center justify-between"
                    >
                      <div className="space-y-1.5">
                        <div className="h-3 w-40 rounded shimmer" />
                        <div className="h-4 w-16 rounded shimmer" />
                      </div>
                      <div className="h-2.5 w-12 rounded shimmer" />
                    </div>
                  ))}
                {!sendsLoading && !sends?.length && (
                  <div className="flex items-center justify-center h-32 text-[13px] text-muted-foreground">
                    No emails sent yet
                  </div>
                )}
                {!sendsLoading &&
                  sends?.map((send) => (
                    <div
                      key={send.id}
                      className="px-4 py-2.5 border-b border-border/50 last:border-0 flex items-center justify-between gap-4"
                    >
                      <div className="min-w-0">
                        <p className="text-[13px] font-medium text-foreground truncate">
                          {send.subject}
                        </p>
                        <Badge variant={sendStatusVariant(send.status)} className="mt-0.5">
                          {send.status}
                        </Badge>
                      </div>
                      <span className="text-[11px] text-muted-foreground tabular-nums shrink-0">
                        {format(new Date(send.createdAt), "MMM d")}
                      </span>
                    </div>
                  ))}
              </>
            )}
          </div>
        </div>
      </div>

      {/* Delete confirm (from detail dialog) */}
      <AlertDialog open={showDeleteConfirm} onOpenChange={setShowDeleteConfirm}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete contact?</AlertDialogTitle>
            <AlertDialogDescription>
              <strong className="text-foreground font-medium">{contact.email}</strong>{" "}
              will be permanently deleted along with all their event history.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              disabled={deleteMutation.isPending}
              onClick={() => deleteMutation.mutate()}
            >
              {deleteMutation.isPending ? "Deleting…" : "Delete"}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}

// ── ContactsPage ──────────────────────────────────────────────────────────────

function ContactsPage() {
  const { activeWorkspaceId } = useWorkspaceStore();
  const qc = useQueryClient();
  const [search, setSearch] = useState("");
  const [debouncedSearch, setDebouncedSearch] = useState("");
  const [page, setPage] = useState(1);
  const [open, setOpen] = useState(false);
  const [deleteContact, setDeleteContact] = useState<Contact | null>(null);
  const [detailContact, setDetailContact] = useState<Contact | null>(null);
  const emailRef = useRef<HTMLInputElement>(null);
  const firstNameRef = useRef<HTMLInputElement>(null);
  const lastNameRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    const t = setTimeout(() => {
      setDebouncedSearch(search);
      setPage(1);
    }, 300);
    return () => clearTimeout(t);
  }, [search]);

  const { data, isLoading, isError } = useQuery<{
    data: Contact[];
    total: number;
    pageSize: number;
  }>({
    queryKey: ["contacts", activeWorkspaceId, debouncedSearch, page],
    queryFn: () =>
      sessionFetch(
        activeWorkspaceId!,
        `/contacts?search=${encodeURIComponent(debouncedSearch)}&page=${page}&pageSize=${PAGE_SIZE}`
      ),
    enabled: !!activeWorkspaceId,
  });

  const totalPages = data ? Math.ceil(data.total / PAGE_SIZE) : 1;

  const createMutation = useMutation({
    mutationFn: (body: { email: string; firstName?: string; lastName?: string }) =>
      sessionFetch(activeWorkspaceId!, "/contacts", {
        method: "POST",
        body: JSON.stringify(body),
      }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["contacts", activeWorkspaceId] });
      setOpen(false);
      if (emailRef.current) emailRef.current.value = "";
      if (firstNameRef.current) firstNameRef.current.value = "";
      if (lastNameRef.current) lastNameRef.current.value = "";
      toast.success("Contact saved");
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const deleteMutation = useMutation({
    mutationFn: (id: string) =>
      sessionFetch(activeWorkspaceId!, `/contacts/${id}`, { method: "DELETE" }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["contacts", activeWorkspaceId] });
      setDeleteContact(null);
      toast.success("Contact deleted");
    },
    onError: (e: Error) => toast.error(e.message),
  });

  return (
    <div className="px-8 py-7 w-full">
      {/* Header */}
      <div className="mb-5 flex items-center justify-between">
        <div>
          <h1 className="text-[15px] font-semibold tracking-tight text-foreground">
            Contacts
          </h1>
          <p className="mt-0.5 text-[12px] text-muted-foreground tabular-nums">
            {isError ? "Failed to load" : `${(data?.total ?? 0).toLocaleString()} total`}
          </p>
        </div>
        <Dialog open={open} onOpenChange={setOpen}>
          <DialogTrigger asChild>
            <Button size="sm">
              <Plus className="h-3.5 w-3.5" />
              Add Contact
            </Button>
          </DialogTrigger>
          <DialogContent>
            <DialogHeader>
              <DialogTitle>Add Contact</DialogTitle>
            </DialogHeader>
            <form
              onSubmit={(e) => {
                e.preventDefault();
                createMutation.mutate({
                  email: emailRef.current!.value,
                  firstName: firstNameRef.current!.value || undefined,
                  lastName: lastNameRef.current!.value || undefined,
                });
              }}
              className="space-y-3.5"
            >
              <div className="space-y-1.5">
                <Label>Email *</Label>
                <Input
                  ref={emailRef}
                  type="email"
                  required
                  placeholder="name@company.com"
                />
              </div>
              <div className="grid grid-cols-2 gap-2.5">
                <div className="space-y-1.5">
                  <Label>First Name</Label>
                  <Input ref={firstNameRef} placeholder="Jane" />
                </div>
                <div className="space-y-1.5">
                  <Label>Last Name</Label>
                  <Input ref={lastNameRef} placeholder="Smith" />
                </div>
              </div>
              <DialogFooter className="sticky bottom-0 bg-popover pt-2">
                <Button type="submit" disabled={createMutation.isPending}>
                  {createMutation.isPending ? "Saving…" : "Add Contact"}
                </Button>
              </DialogFooter>
            </form>
          </DialogContent>
        </Dialog>
      </div>

      {/* Search */}
      <div className="relative mb-3.5">
        <Search className="absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground/50" />
        <Input
          placeholder="Search by email…"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          className="pl-8"
        />
      </div>

      {/* Error */}
      {isError && (
        <div className="flex items-center gap-2 rounded-lg border border-destructive/20 bg-destructive/8 px-3.5 py-2.5 text-[13px] text-destructive">
          <AlertCircle className="h-3.5 w-3.5 shrink-0" />
          Failed to load contacts. Check your connection and try refreshing.
        </div>
      )}

      {/* Table */}
      {!isError && (
        <div className="overflow-hidden rounded-lg border border-border bg-card">
          <table className="w-full text-[13px]">
            <thead>
              <tr className="border-b border-border bg-muted/50">
                <th className="px-4 py-2 text-left text-[11px] font-medium text-muted-foreground/70 tracking-wide uppercase">
                  Email
                </th>
                <th className="px-4 py-2 text-left text-[11px] font-medium text-muted-foreground/70 tracking-wide uppercase">
                  Name
                </th>
                <th className="px-4 py-2 text-left text-[11px] font-medium text-muted-foreground/70 tracking-wide uppercase">
                  Status
                </th>
                <th className="px-4 py-2 text-left text-[11px] font-medium text-muted-foreground/70 tracking-wide uppercase">
                  Added
                </th>
                <th className="w-10 px-2" />
              </tr>
            </thead>
            <tbody>
              {isLoading &&
                Array.from({ length: 5 }).map((_, i) => (
                  <tr key={i} className="border-b border-border/50 last:border-0">
                    <td className="px-4 py-2.5">
                      <div className="h-3 w-40 rounded shimmer" />
                    </td>
                    <td className="px-4 py-2.5">
                      <div className="h-3 w-24 rounded shimmer" />
                    </td>
                    <td className="px-4 py-2.5">
                      <div className="h-4 w-20 rounded shimmer" />
                    </td>
                    <td className="px-4 py-2.5">
                      <div className="h-3 w-16 rounded shimmer" />
                    </td>
                    <td className="px-2 py-2.5" />
                  </tr>
                ))}

              {!isLoading &&
                data?.data.map((contact) => (
                  <tr
                    key={contact.id}
                    onClick={() => setDetailContact(contact)}
                    className="group border-b border-border/40 last:border-0 transition-colors duration-100 hover:bg-accent/50 cursor-pointer"
                  >
                    <td className="px-4 py-2.5 text-foreground/90 font-medium">
                      {contact.email}
                    </td>
                    <td className="px-4 py-2.5 text-muted-foreground">
                      {[contact.firstName, contact.lastName].filter(Boolean).join(" ") || "—"}
                    </td>
                    <td className="px-4 py-2.5">
                      {contact.unsubscribed ? (
                        <Badge variant="destructive">Unsubscribed</Badge>
                      ) : (
                        <Badge variant="success">Subscribed</Badge>
                      )}
                    </td>
                    <td className="tabular-nums px-4 py-2.5 text-[12px] text-muted-foreground">
                      {format(new Date(contact.createdAt), "MMM d, yyyy")}
                    </td>
                    <td className="px-2 py-2.5">
                      <button
                        onClick={(e) => {
                          e.stopPropagation();
                          setDeleteContact(contact);
                        }}
                        className="rounded p-1 text-muted-foreground/30 opacity-0 transition-all duration-100 hover:bg-destructive/10 hover:text-destructive group-hover:opacity-100 cursor-pointer"
                      >
                        <Trash2 className="h-3.5 w-3.5" />
                      </button>
                    </td>
                  </tr>
                ))}

              {!isLoading && !data?.data.length && (
                <tr>
                  <td colSpan={5} className="py-16 text-center">
                    <div className="flex flex-col items-center">
                      <div className="mb-3 flex h-9 w-9 items-center justify-center rounded-lg border border-border">
                        <Users className="h-4 w-4 text-muted-foreground/40" />
                      </div>
                      <p className="text-[13px] font-medium text-foreground/60">
                        {debouncedSearch ? "No contacts found" : "No contacts yet"}
                      </p>
                      <p className="mt-0.5 text-[12px] text-muted-foreground/50">
                        {debouncedSearch
                          ? `No results for "${debouncedSearch}"`
                          : "Add contacts manually or via the REST API"}
                      </p>
                    </div>
                  </td>
                </tr>
              )}
            </tbody>
          </table>

          {/* Pagination */}
          {data && data.total > PAGE_SIZE && (
            <div className="flex items-center justify-between border-t border-border px-4 py-2.5">
              <span className="tabular-nums text-[12px] text-muted-foreground">
                {(page - 1) * PAGE_SIZE + 1}–
                {Math.min(page * PAGE_SIZE, data.total)} of{" "}
                {data.total.toLocaleString()}
              </span>
              <div className="flex items-center gap-1">
                <button
                  onClick={() => setPage((p) => Math.max(1, p - 1))}
                  disabled={page === 1}
                  className="rounded p-1 text-muted-foreground transition-colors hover:bg-accent hover:text-foreground disabled:opacity-30 cursor-pointer disabled:cursor-not-allowed"
                >
                  <ChevronLeft className="h-3.5 w-3.5" />
                </button>
                <span className="tabular-nums px-1 text-[12px] text-muted-foreground">
                  {page} / {totalPages}
                </span>
                <button
                  onClick={() => setPage((p) => Math.min(totalPages, p + 1))}
                  disabled={page >= totalPages}
                  className="rounded p-1 text-muted-foreground transition-colors hover:bg-accent hover:text-foreground disabled:opacity-30 cursor-pointer disabled:cursor-not-allowed"
                >
                  <ChevronRight className="h-3.5 w-3.5" />
                </button>
              </div>
            </div>
          )}
        </div>
      )}

      {/* Contact Detail Dialog */}
      <Dialog open={!!detailContact} onOpenChange={(o) => !o && setDetailContact(null)}>
        <DialogContent className="max-w-[96vw] w-[96vw] h-[92vh] max-h-[92vh] p-0 gap-0 flex flex-col overflow-hidden">
          {detailContact && (
            <ContactDetailContent
              key={detailContact.id}
              contact={detailContact}
              workspaceId={activeWorkspaceId!}
              onClose={() => setDetailContact(null)}
            />
          )}
        </DialogContent>
      </Dialog>

      {/* Delete confirm (table row) */}
      <AlertDialog
        open={!!deleteContact}
        onOpenChange={(o: boolean) => !o && setDeleteContact(null)}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete contact?</AlertDialogTitle>
            <AlertDialogDescription>
              <strong className="text-foreground font-medium">
                {deleteContact?.email}
              </strong>{" "}
              will be permanently deleted along with all their event history.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              disabled={deleteMutation.isPending}
              onClick={() => deleteContact && deleteMutation.mutate(deleteContact.id)}
            >
              {deleteMutation.isPending ? "Deleting…" : "Delete"}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
