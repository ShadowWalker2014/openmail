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
  Plus, Search, Trash2, Users, ChevronLeft, ChevronRight,
  AlertCircle, X, Mail,
} from "lucide-react";
import { toast } from "sonner";
import { format, isToday, isYesterday } from "date-fns";
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
  name: string;
  properties: Record<string, unknown>;
  occurredAt: string;
}

interface ContactSend {
  id: string;
  subject: string;
  status: string;
  sentAt: string | null;
  createdAt: string;
}

const PAGE_SIZE = 50;

// ── Helpers ───────────────────────────────────────────────────────────────────

function getInitials(contact: Contact): string {
  const f = contact.firstName?.[0] ?? "";
  const l = contact.lastName?.[0] ?? "";
  if (f || l) return (f + l).toUpperCase();
  return contact.email[0].toUpperCase();
}

const AVATAR_COLORS = [
  "bg-violet-500", "bg-blue-500", "bg-emerald-500",
  "bg-orange-500", "bg-pink-500", "bg-indigo-500", "bg-teal-500",
];

function getAvatarColor(email: string): string {
  return AVATAR_COLORS[email.charCodeAt(0) % AVATAR_COLORS.length];
}

function formatEventDate(dateStr: string): string {
  const d = new Date(dateStr);
  if (isToday(d)) return `Today at ${format(d, "h:mm a")}`;
  if (isYesterday(d)) return `Yesterday at ${format(d, "h:mm a")}`;
  return format(d, "MMM d, h:mm a");
}

function sendStatusVariant(status: string) {
  if (status === "sent") return "success" as const;
  if (status === "failed") return "destructive" as const;
  if (status === "bounced") return "warning" as const;
  return "secondary" as const;
}

// ── ContactDetailContent ──────────────────────────────────────────────────────

type ProfileTab = "overview" | "attributes" | "sent" | "activity";

function ContactDetailContent({
  contact,
  workspaceId,
  onClose,
}: {
  contact: Contact;
  workspaceId: string;
  onClose: () => void;
}) {
  const qc = useQueryClient();
  const [activeTab, setActiveTab] = useState<ProfileTab>("overview");
  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false);

  // Editable state (Attributes tab)
  const [firstName, setFirstName] = useState(contact.firstName ?? "");
  const [lastName, setLastName] = useState(contact.lastName ?? "");
  const [phone, setPhone] = useState(contact.phone ?? "");
  const [unsubscribed, setUnsubscribed] = useState(contact.unsubscribed);
  const [attrs, setAttrs] = useState(() =>
    Object.entries(contact.attributes ?? {}).map(([key, value]) => ({ id: crypto.randomUUID(), key, value: String(value) }))
  );

  const patchMutation = useMutation({
    mutationFn: () =>
      sessionFetch(workspaceId, `/contacts/${contact.id}`, {
        method: "PATCH",
        body: JSON.stringify({
          firstName: firstName || null,
          lastName: lastName || null,
          phone: phone || null,
          unsubscribed,
          attributes: Object.fromEntries(attrs.filter((a) => a.key.trim()).map((a) => [a.key.trim(), a.value])),
        }),
      }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["contacts", workspaceId] });
      qc.invalidateQueries({ queryKey: ["contact-detail", contact.id] });
      toast.success("Contact updated");
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const deleteMutation = useMutation({
    mutationFn: () => sessionFetch(workspaceId, `/contacts/${contact.id}`, { method: "DELETE" }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["contacts", workspaceId] });
      toast.success("Contact deleted");
      onClose();
    },
    onError: (e: Error) => toast.error(e.message),
  });

  // Data queries — always enabled so Overview tab can show previews without clicking tabs
  const { data: events = [], isLoading: eventsLoading } = useQuery<ContactEvent[]>({
    queryKey: ["contact-events", contact.id],
    queryFn: () => sessionFetch(workspaceId, `/contacts/${contact.id}/events`),
  });

  const { data: sends = [], isLoading: sendsLoading } = useQuery<ContactSend[]>({
    queryKey: ["contact-sends", contact.id],
    queryFn: () => sessionFetch(workspaceId, `/contacts/${contact.id}/sends`),
  });

  const tabs: { id: ProfileTab; label: string }[] = [
    { id: "overview",   label: "Overview" },
    { id: "attributes", label: "Attributes" },
    { id: "sent",       label: "Sent" },
    { id: "activity",   label: "Activity" },
  ];

  const displayName = [contact.firstName, contact.lastName].filter(Boolean).join(" ") || contact.email;
  const initials = getInitials(contact);
  const avatarColor = getAvatarColor(contact.email);

  return (
    <>
      <div className="flex flex-col h-full overflow-hidden">
        {/* ── Profile header ─────────────────────────────────────────── */}
        <div className="shrink-0 px-6 py-4 border-b border-border bg-card">
          <div className="flex items-start gap-4">
            {/* Avatar */}
            <div className={cn("h-12 w-12 rounded-full flex items-center justify-center text-white font-semibold text-lg shrink-0", avatarColor)}>
              {initials}
            </div>

            {/* Name + email */}
            <div className="flex-1 min-w-0">
              <h2 className="text-[16px] font-semibold tracking-tight truncate">{displayName}</h2>
              <p className="text-[12px] text-muted-foreground truncate">{contact.email}</p>
            </div>

            {/* Meta pills */}
            <div className="flex items-center gap-4 shrink-0">
              <div className="text-center">
                <p className="text-[10px] uppercase tracking-wide text-muted-foreground/60 mb-0.5">Status</p>
                {contact.unsubscribed ? (
                  <Badge variant="destructive" className="text-[11px]">Unsubscribed</Badge>
                ) : (
                  <Badge variant="success" className="text-[11px]">● Subscribed</Badge>
                )}
              </div>
              <div className="text-center">
                <p className="text-[10px] uppercase tracking-wide text-muted-foreground/60 mb-0.5">Signed Up</p>
                <p className="text-[12px] text-foreground/80 tabular-nums">
                  {format(new Date(contact.createdAt), "MMM d, yyyy")}
                </p>
              </div>
              <div className="text-center">
                <p className="text-[10px] uppercase tracking-wide text-muted-foreground/60 mb-0.5">Updated</p>
                <p className="text-[12px] text-foreground/80 tabular-nums">
                  {format(new Date(contact.updatedAt), "MMM d, yyyy")}
                </p>
              </div>

              {/* Delete */}
              <TooltipProvider>
                <Tooltip>
                  <TooltipTrigger asChild>
                    <button
                      type="button"
                      onClick={() => setShowDeleteConfirm(true)}
                      className="rounded-md p-1.5 text-muted-foreground/40 hover:text-destructive hover:bg-destructive/10 transition-colors cursor-pointer"
                    >
                      <Trash2 className="h-4 w-4" />
                    </button>
                  </TooltipTrigger>
                  <TooltipContent>Delete contact</TooltipContent>
                </Tooltip>
              </TooltipProvider>
            </div>
          </div>

          {/* Tab bar */}
          <div className="flex items-center gap-0 mt-4 border-b border-border -mb-4">
            {tabs.map((t) => (
              <button
                key={t.id}
                onClick={() => setActiveTab(t.id)}
                className={cn(
                  "px-4 py-2 text-[13px] font-medium border-b-2 -mb-px transition-colors cursor-pointer",
                  activeTab === t.id
                    ? "border-foreground text-foreground"
                    : "border-transparent text-muted-foreground hover:text-foreground"
                )}
              >
                {t.label}
              </button>
            ))}
          </div>
        </div>

        {/* ── Tab content ────────────────────────────────────────────── */}
        <div className="flex-1 overflow-y-auto">

          {/* ── OVERVIEW ── */}
          {activeTab === "overview" && (
            <div className="flex gap-0 h-full min-h-0">
              {/* Left column — Identifiers + Attributes */}
              <div className="w-[360px] shrink-0 border-r border-border overflow-y-auto px-5 py-5 space-y-6">
                {/* Identifiers */}
                <div>
                  <h3 className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground mb-3">Identifiers</h3>
                  <div className="space-y-2">
                    <div>
                      <p className="text-[11px] text-muted-foreground/70">id</p>
                      <p className="text-[12px] font-mono text-foreground/80 truncate">{contact.id}</p>
                    </div>
                    <div>
                      <p className="text-[11px] text-muted-foreground/70">email</p>
                      <p className="text-[12px] font-mono text-foreground/80 truncate">{contact.email}</p>
                    </div>
                    {contact.firstName && (
                      <div>
                        <p className="text-[11px] text-muted-foreground/70">first_name</p>
                        <p className="text-[12px] font-mono text-foreground/80">{contact.firstName}</p>
                      </div>
                    )}
                    {contact.lastName && (
                      <div>
                        <p className="text-[11px] text-muted-foreground/70">last_name</p>
                        <p className="text-[12px] font-mono text-foreground/80">{contact.lastName}</p>
                      </div>
                    )}
                    {contact.phone && (
                      <div>
                        <p className="text-[11px] text-muted-foreground/70">phone</p>
                        <p className="text-[12px] font-mono text-foreground/80">{contact.phone}</p>
                      </div>
                    )}
                  </div>
                </div>

                {/* Attributes */}
                {Object.keys(contact.attributes ?? {}).length > 0 && (
                  <div>
                    <h3 className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground mb-3">Attributes</h3>
                    <div className="space-y-2">
                      {Object.entries(contact.attributes ?? {}).map(([k, v]) => (
                        <div key={k}>
                          <p className="text-[11px] text-muted-foreground/70">{k}</p>
                          <p className="text-[12px] font-mono text-foreground/80 break-all">{String(v)}</p>
                        </div>
                      ))}
                    </div>
                  </div>
                )}

                {/* Edit shortcut */}
                <button
                  onClick={() => setActiveTab("attributes")}
                  className="text-[12px] text-muted-foreground hover:text-foreground transition-colors cursor-pointer flex items-center gap-1"
                >
                  <Plus className="h-3 w-3" />
                  Edit attributes
                </button>
              </div>

              {/* Right column — Activity + Deliveries */}
              <div className="flex-1 overflow-y-auto px-5 py-5 space-y-6">
                {/* Recent Activity */}
                <div>
                  <div className="flex items-center justify-between mb-3">
                    <h3 className="text-[13px] font-semibold">Recent Activity</h3>
                    {events.length > 5 && (
                      <button onClick={() => setActiveTab("activity")} className="text-[12px] text-muted-foreground hover:text-foreground cursor-pointer">
                        More →
                      </button>
                    )}
                  </div>
                  <div className="rounded-lg border border-border overflow-hidden">
                    <div className="grid grid-cols-[1fr_1.5fr_1fr] px-3 py-2 bg-muted/40 border-b border-border">
                      <span className="text-[10px] font-medium uppercase tracking-wide text-muted-foreground">Activity Type</span>
                      <span className="text-[10px] font-medium uppercase tracking-wide text-muted-foreground">Activity Name</span>
                      <span className="text-[10px] font-medium uppercase tracking-wide text-muted-foreground text-right">Timestamp</span>
                    </div>
                    {eventsLoading && Array.from({ length: 3 }).map((_, i) => (
                      <div key={i} className="grid grid-cols-[1fr_1.5fr_1fr] px-3 py-2 border-b border-border/50 last:border-0">
                        <div className="h-3 w-20 rounded shimmer" />
                        <div className="h-3 w-28 rounded shimmer" />
                        <div className="h-3 w-16 rounded shimmer ml-auto" />
                      </div>
                    ))}
                    {!eventsLoading && events.slice(0, 5).map((e) => (
                      <div key={e.id} className="grid grid-cols-[1fr_1.5fr_1fr] px-3 py-2 border-b border-border/50 last:border-0 hover:bg-accent/30">
                        <span className="text-[12px] text-muted-foreground">Event</span>
                        <span className="text-[12px] font-medium truncate">{e.name}</span>
                        <span className="text-[11px] text-muted-foreground text-right tabular-nums">{formatEventDate(e.occurredAt)}</span>
                      </div>
                    ))}
                    {!eventsLoading && events.length === 0 && (
                      <div className="px-3 py-6 text-center text-[12px] text-muted-foreground">
                        No activity yet
                      </div>
                    )}
                  </div>
                </div>

                {/* Most Recent Deliveries */}
                <div>
                  <div className="flex items-center justify-between mb-3">
                    <h3 className="text-[13px] font-semibold">Most Recent Deliveries</h3>
                    {sends.length > 5 && (
                      <button onClick={() => setActiveTab("sent")} className="text-[12px] text-muted-foreground hover:text-foreground cursor-pointer">
                        More →
                      </button>
                    )}
                  </div>
                  <div className="rounded-lg border border-border overflow-hidden">
                    <div className="grid grid-cols-[1fr_auto_auto] px-3 py-2 bg-muted/40 border-b border-border">
                      <span className="text-[10px] font-medium uppercase tracking-wide text-muted-foreground">Action</span>
                      <span className="text-[10px] font-medium uppercase tracking-wide text-muted-foreground px-3">Status</span>
                      <span className="text-[10px] font-medium uppercase tracking-wide text-muted-foreground">Timestamp</span>
                    </div>
                    {sendsLoading && Array.from({ length: 3 }).map((_, i) => (
                      <div key={i} className="grid grid-cols-[1fr_auto_auto] px-3 py-2 border-b border-border/50 last:border-0 items-center">
                        <div className="h-3 w-36 rounded shimmer" />
                        <div className="h-5 w-16 rounded-full shimmer mx-3" />
                        <div className="h-3 w-16 rounded shimmer" />
                      </div>
                    ))}
                    {!sendsLoading && sends.slice(0, 5).map((s) => (
                      <div key={s.id} className="grid grid-cols-[1fr_auto_auto] px-3 py-2 border-b border-border/50 last:border-0 items-center hover:bg-accent/30">
                        <div className="flex items-center gap-2 min-w-0">
                          <Mail className="h-3.5 w-3.5 text-muted-foreground/50 shrink-0" />
                          <span className="text-[12px] font-medium truncate">{s.subject}</span>
                        </div>
                        <div className="px-3">
                          <Badge variant={sendStatusVariant(s.status)} className="text-[10px]">
                            {s.status.charAt(0).toUpperCase() + s.status.slice(1)}
                          </Badge>
                        </div>
                        <span className="text-[11px] text-muted-foreground tabular-nums whitespace-nowrap">
                          {formatEventDate(s.sentAt ?? s.createdAt)}
                        </span>
                      </div>
                    ))}
                    {!sendsLoading && sends.length === 0 && (
                      <div className="px-3 py-6 text-center text-[12px] text-muted-foreground">
                        No emails sent yet
                      </div>
                    )}
                  </div>
                </div>
              </div>
            </div>
          )}

          {/* ── ATTRIBUTES (edit form) ── */}
          {activeTab === "attributes" && (
            <div className="max-w-lg px-6 py-6 space-y-5">
              <div className="grid grid-cols-2 gap-3">
                <div className="space-y-1.5">
                  <Label className="text-[12px]">First Name</Label>
                  <Input value={firstName} onChange={(e) => setFirstName(e.target.value)} placeholder="Jane" />
                </div>
                <div className="space-y-1.5">
                  <Label className="text-[12px]">Last Name</Label>
                  <Input value={lastName} onChange={(e) => setLastName(e.target.value)} placeholder="Smith" />
                </div>
              </div>
              <div className="space-y-1.5">
                <Label className="text-[12px]">Phone</Label>
                <Input value={phone} onChange={(e) => setPhone(e.target.value)} placeholder="+1 (555) 000-0000" />
              </div>
              <div className="space-y-1.5">
                <Label className="text-[12px]">Subscription Status</Label>
                <div className="flex items-center rounded-md border border-border overflow-hidden">
                  <button
                    type="button"
                    onClick={() => setUnsubscribed(false)}
                    className={cn("flex-1 px-3 py-1.5 text-[12px] font-medium transition-colors cursor-pointer", !unsubscribed ? "bg-foreground text-background" : "text-muted-foreground hover:text-foreground")}
                  >
                    Subscribed
                  </button>
                  <button
                    type="button"
                    onClick={() => setUnsubscribed(true)}
                    className={cn("flex-1 px-3 py-1.5 text-[12px] font-medium transition-colors cursor-pointer border-l border-border", unsubscribed ? "bg-destructive text-destructive-foreground" : "text-muted-foreground hover:text-foreground")}
                  >
                    Unsubscribed
                  </button>
                </div>
              </div>

              <div className="space-y-2">
                <p className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">Custom Attributes</p>
                {attrs.map((attr) => (
                  <div key={attr.id} className="flex items-center gap-1.5">
                    <Input className="w-1/3" placeholder="key" value={attr.key}
                      onChange={(e) => setAttrs(attrs.map(a => a.id === attr.id ? { ...a, key: e.target.value } : a))} />
                    <Input className="flex-1" placeholder="value" value={attr.value}
                      onChange={(e) => setAttrs(attrs.map(a => a.id === attr.id ? { ...a, value: e.target.value } : a))} />
                    <button type="button" onClick={() => setAttrs(attrs.filter(a => a.id !== attr.id))}
                      className="rounded p-1 text-muted-foreground/50 hover:text-destructive hover:bg-destructive/10 transition-colors cursor-pointer">
                      <X className="h-3.5 w-3.5" />
                    </button>
                  </div>
                ))}
                <button type="button" onClick={() => setAttrs([...attrs, { id: crypto.randomUUID(), key: "", value: "" }])}
                  className="flex items-center gap-1 text-[12px] text-muted-foreground hover:text-foreground transition-colors cursor-pointer">
                  <Plus className="h-3 w-3" />Add attribute
                </button>
              </div>

              <Button onClick={() => patchMutation.mutate()} disabled={patchMutation.isPending}>
                {patchMutation.isPending ? "Saving…" : "Save Changes"}
              </Button>
            </div>
          )}

          {/* ── SENT ── */}
          {activeTab === "sent" && (
            <div className="px-5 py-5">
              <div className="rounded-lg border border-border overflow-hidden">
                <table className="w-full text-[13px]">
                  <thead>
                    <tr className="border-b border-border bg-muted/50">
                      <th className="px-4 py-2.5 text-left text-[11px] font-medium text-muted-foreground/70 tracking-wide uppercase">Date</th>
                      <th className="px-4 py-2.5 text-left text-[11px] font-medium text-muted-foreground/70 tracking-wide uppercase">Subject</th>
                      <th className="px-4 py-2.5 text-left text-[11px] font-medium text-muted-foreground/70 tracking-wide uppercase w-28">Status</th>
                    </tr>
                  </thead>
                  <tbody>
                    {sendsLoading && Array.from({ length: 5 }).map((_, i) => (
                      <tr key={i} className="border-b border-border/50 last:border-0">
                        <td className="px-4 py-3"><div className="h-3 w-24 rounded shimmer" /></td>
                        <td className="px-4 py-3"><div className="h-3 w-56 rounded shimmer" /></td>
                        <td className="px-4 py-3"><div className="h-5 w-16 rounded-full shimmer" /></td>
                      </tr>
                    ))}
                    {!sendsLoading && sends.map((s) => (
                      <tr key={s.id} className="border-b border-border/50 last:border-0 hover:bg-accent/30">
                        <td className="px-4 py-3 text-[11px] text-muted-foreground tabular-nums whitespace-nowrap">
                          {formatEventDate(s.sentAt ?? s.createdAt)}
                        </td>
                        <td className="px-4 py-3 font-medium truncate max-w-[320px]">{s.subject}</td>
                        <td className="px-4 py-3">
                          <Badge variant={sendStatusVariant(s.status)} className="text-[10px]">
                            {s.status.charAt(0).toUpperCase() + s.status.slice(1)}
                          </Badge>
                        </td>
                      </tr>
                    ))}
                    {!sendsLoading && sends.length === 0 && (
                      <tr><td colSpan={3} className="px-4 py-12 text-center text-[13px] text-muted-foreground">No emails sent yet</td></tr>
                    )}
                  </tbody>
                </table>
              </div>
            </div>
          )}

          {/* ── ACTIVITY ── */}
          {activeTab === "activity" && (
            <div className="px-5 py-5">
              <div className="rounded-lg border border-border overflow-hidden">
                <table className="w-full text-[13px]">
                  <thead>
                    <tr className="border-b border-border bg-muted/50">
                      <th className="px-4 py-2.5 text-left text-[11px] font-medium text-muted-foreground/70 tracking-wide uppercase">Date</th>
                      <th className="px-4 py-2.5 text-left text-[11px] font-medium text-muted-foreground/70 tracking-wide uppercase">Event</th>
                      <th className="px-4 py-2.5 text-left text-[11px] font-medium text-muted-foreground/70 tracking-wide uppercase">Properties</th>
                    </tr>
                  </thead>
                  <tbody>
                    {eventsLoading && Array.from({ length: 5 }).map((_, i) => (
                      <tr key={i} className="border-b border-border/50 last:border-0">
                        <td className="px-4 py-3"><div className="h-3 w-24 rounded shimmer" /></td>
                        <td className="px-4 py-3"><div className="h-3 w-32 rounded shimmer" /></td>
                        <td className="px-4 py-3"><div className="h-3 w-48 rounded shimmer" /></td>
                      </tr>
                    ))}
                    {!eventsLoading && events.map((e) => {
                      const props = JSON.stringify(e.properties);
                      return (
                        <tr key={e.id} className="border-b border-border/50 last:border-0 hover:bg-accent/30">
                          <td className="px-4 py-3 text-[11px] text-muted-foreground tabular-nums whitespace-nowrap">
                            {formatEventDate(e.occurredAt)}
                          </td>
                          <td className="px-4 py-3 font-medium">{e.name}</td>
                          <td className="px-4 py-3 text-[11px] text-muted-foreground font-mono truncate max-w-[300px]">
                            {props === "{}" ? "—" : props.length > 80 ? props.slice(0, 80) + "…" : props}
                          </td>
                        </tr>
                      );
                    })}
                    {!eventsLoading && events.length === 0 && (
                      <tr><td colSpan={3} className="px-4 py-12 text-center text-[13px] text-muted-foreground">No activity yet</td></tr>
                    )}
                  </tbody>
                </table>
              </div>
            </div>
          )}
        </div>
      </div>

      {/* Delete confirm */}
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
            <AlertDialogAction disabled={deleteMutation.isPending} onClick={() => deleteMutation.mutate()}>
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
  const [detailContactId, setDetailContactId] = useState<string | null>(null);
  const emailRef = useRef<HTMLInputElement>(null);
  const firstNameRef = useRef<HTMLInputElement>(null);
  const lastNameRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    const t = setTimeout(() => { setDebouncedSearch(search); setPage(1); }, 300);
    return () => clearTimeout(t);
  }, [search]);

  const { data, isLoading, isError } = useQuery<{ data: Contact[]; total: number; pageSize: number }>({
    queryKey: ["contacts", activeWorkspaceId, debouncedSearch, page],
    queryFn: () =>
      sessionFetch(activeWorkspaceId!, `/contacts?search=${encodeURIComponent(debouncedSearch)}&page=${page}&pageSize=${PAGE_SIZE}`),
    enabled: !!activeWorkspaceId,
  });

  const { data: detailContact } = useQuery<Contact | null>({
    queryKey: ["contact-detail", detailContactId],
    queryFn: () =>
      detailContactId
        ? sessionFetch<Contact>(activeWorkspaceId!, `/contacts/${detailContactId}`)
        : Promise.resolve(null),
    enabled: !!detailContactId && !!activeWorkspaceId,
  });

  const totalPages = data ? Math.ceil(data.total / PAGE_SIZE) : 1;

  const createMutation = useMutation({
    mutationFn: (body: { email: string; firstName?: string; lastName?: string }) =>
      sessionFetch(activeWorkspaceId!, "/contacts", { method: "POST", body: JSON.stringify(body) }),
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
          <h1 className="text-[15px] font-semibold tracking-tight">Contacts</h1>
          <p className="mt-0.5 text-[12px] text-muted-foreground tabular-nums">
            {isError ? "Failed to load" : `${(data?.total ?? 0).toLocaleString()} people`}
          </p>
        </div>
        <Dialog open={open} onOpenChange={setOpen}>
          <DialogTrigger asChild>
            <Button size="sm"><Plus className="h-3.5 w-3.5" />Add Contact</Button>
          </DialogTrigger>
          <DialogContent>
            <DialogHeader><DialogTitle>Add Contact</DialogTitle></DialogHeader>
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
                <Input ref={emailRef} type="email" required placeholder="name@company.com" />
              </div>
              <div className="grid grid-cols-2 gap-2.5">
                <div className="space-y-1.5"><Label>First Name</Label><Input ref={firstNameRef} placeholder="Jane" /></div>
                <div className="space-y-1.5"><Label>Last Name</Label><Input ref={lastNameRef} placeholder="Smith" /></div>
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
        <Input placeholder="Find by email address…" value={search} onChange={(e) => setSearch(e.target.value)} className="pl-8" />
      </div>

      {isError && (
        <div className="flex items-center gap-2 rounded-lg border border-destructive/20 bg-destructive/8 px-3.5 py-2.5 text-[13px] text-destructive">
          <AlertCircle className="h-3.5 w-3.5 shrink-0" />
          Failed to load contacts.
        </div>
      )}

      {!isError && (
        <div className="overflow-hidden rounded-lg border border-border bg-card">
          <table className="w-full text-[13px]">
            <thead>
              <tr className="border-b border-border bg-muted/50">
                <th className="px-4 py-2.5 text-left text-[11px] font-medium text-muted-foreground/70 tracking-wide uppercase">Email</th>
                <th className="px-4 py-2.5 text-left text-[11px] font-medium text-muted-foreground/70 tracking-wide uppercase">Name</th>
                <th className="px-4 py-2.5 text-left text-[11px] font-medium text-muted-foreground/70 tracking-wide uppercase">Status</th>
                <th className="px-4 py-2.5 text-left text-[11px] font-medium text-muted-foreground/70 tracking-wide uppercase">Added</th>
                <th className="w-10 px-2" />
              </tr>
            </thead>
            <tbody>
              {isLoading && Array.from({ length: 5 }).map((_, i) => (
                <tr key={i} className="border-b border-border/50 last:border-0">
                  <td className="px-4 py-3"><div className="h-3 w-44 rounded shimmer" /></td>
                  <td className="px-4 py-3"><div className="h-3 w-24 rounded shimmer" /></td>
                  <td className="px-4 py-3"><div className="h-4 w-20 rounded shimmer" /></td>
                  <td className="px-4 py-3"><div className="h-3 w-16 rounded shimmer" /></td>
                  <td />
                </tr>
              ))}

              {!isLoading && data?.data.map((contact) => (
                <tr
                  key={contact.id}
                  onClick={() => setDetailContactId(contact.id)}
                  className="group border-b border-border/40 last:border-0 transition-colors hover:bg-accent/50 cursor-pointer"
                >
                  <td className="px-4 py-3 font-medium text-foreground/90">{contact.email}</td>
                  <td className="px-4 py-3 text-muted-foreground">
                    {[contact.firstName, contact.lastName].filter(Boolean).join(" ") || "—"}
                  </td>
                  <td className="px-4 py-3">
                    {contact.unsubscribed ? (
                      <Badge variant="destructive">Unsubscribed</Badge>
                    ) : (
                      <Badge variant="success">Subscribed</Badge>
                    )}
                  </td>
                  <td className="tabular-nums px-4 py-3 text-[12px] text-muted-foreground">
                    {format(new Date(contact.createdAt), "MMM d, yyyy")}
                  </td>
                  <td className="px-2 py-3">
                    <button
                      onClick={(e) => { e.stopPropagation(); setDeleteContact(contact); }}
                      className="rounded p-1 text-muted-foreground/30 opacity-0 transition-all hover:bg-destructive/10 hover:text-destructive group-hover:opacity-100 cursor-pointer"
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
                        {debouncedSearch ? `No results for "${debouncedSearch}"` : "Add contacts manually or via the REST API"}
                      </p>
                    </div>
                  </td>
                </tr>
              )}
            </tbody>
          </table>

          {data && data.total > PAGE_SIZE && (
            <div className="flex items-center justify-between border-t border-border px-4 py-2.5">
              <span className="tabular-nums text-[12px] text-muted-foreground">
                {(page - 1) * PAGE_SIZE + 1}–{Math.min(page * PAGE_SIZE, data.total)} of {data.total.toLocaleString()}
              </span>
              <div className="flex items-center gap-1">
                <button onClick={() => setPage((p) => Math.max(1, p - 1))} disabled={page === 1}
                  className="rounded p-1 text-muted-foreground transition-colors hover:bg-accent hover:text-foreground disabled:opacity-30 cursor-pointer disabled:cursor-not-allowed">
                  <ChevronLeft className="h-3.5 w-3.5" />
                </button>
                <span className="tabular-nums px-1 text-[12px] text-muted-foreground">{page} / {totalPages}</span>
                <button onClick={() => setPage((p) => Math.min(totalPages, p + 1))} disabled={page >= totalPages}
                  className="rounded p-1 text-muted-foreground transition-colors hover:bg-accent hover:text-foreground disabled:opacity-30 cursor-pointer disabled:cursor-not-allowed">
                  <ChevronRight className="h-3.5 w-3.5" />
                </button>
              </div>
            </div>
          )}
        </div>
      )}

      {/* Contact Detail Dialog */}
      <Dialog open={!!detailContactId} onOpenChange={(o) => !o && setDetailContactId(null)}>
        <DialogContent className="max-w-[96vw] w-[96vw] h-[92vh] max-h-[92vh] p-0 gap-0 flex flex-col overflow-hidden">
          <DialogHeader className="sr-only">
            <DialogTitle>{detailContact?.email}</DialogTitle>
          </DialogHeader>
          {detailContact && (
            <ContactDetailContent
              key={detailContact.id}
              contact={detailContact}
              workspaceId={activeWorkspaceId!}
              onClose={() => setDetailContactId(null)}
            />
          )}
        </DialogContent>
      </Dialog>

      {/* Delete confirm */}
      <AlertDialog open={!!deleteContact} onOpenChange={(o: boolean) => !o && setDeleteContact(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete contact?</AlertDialogTitle>
            <AlertDialogDescription>
              <strong className="text-foreground font-medium">{deleteContact?.email}</strong>{" "}
              will be permanently deleted along with all their event history.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction disabled={deleteMutation.isPending}
              onClick={() => deleteContact && deleteMutation.mutate(deleteContact.id)}>
              {deleteMutation.isPending ? "Deleting…" : "Delete"}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
