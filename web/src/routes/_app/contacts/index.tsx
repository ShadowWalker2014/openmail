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
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter, DialogTrigger,
} from "@/components/ui/dialog";
import {
  AlertDialog, AlertDialogContent, AlertDialogHeader, AlertDialogTitle,
  AlertDialogDescription, AlertDialogFooter, AlertDialogAction, AlertDialogCancel,
} from "@/components/ui/alert-dialog";
import { Plus, Search, Trash2, Users, ChevronLeft, ChevronRight, AlertCircle } from "lucide-react";
import { toast } from "sonner";
import { format } from "date-fns";

export const Route = createFileRoute("/_app/contacts/")({ component: ContactsPage });

interface Contact {
  id: string;
  email: string;
  firstName: string | null;
  lastName: string | null;
  unsubscribed: boolean;
  createdAt: string;
  attributes: Record<string, unknown>;
}

const PAGE_SIZE = 50;

function ContactsPage() {
  const { activeWorkspaceId } = useWorkspaceStore();
  const qc = useQueryClient();
  const [search, setSearch] = useState("");
  const [debouncedSearch, setDebouncedSearch] = useState("");
  const [page, setPage] = useState(1);
  const [open, setOpen] = useState(false);
  const [deleteContact, setDeleteContact] = useState<Contact | null>(null);
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
    <div className="mx-auto max-w-5xl px-8 py-7">
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
                <Button
                  type="submit"
                  disabled={createMutation.isPending}
                >
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
              <tr
                className="border-b border-border"
                style={{ background: "hsl(240 4% 10%)" }}
              >
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
                    className="group border-b border-border/40 last:border-0 transition-colors duration-100 hover:bg-accent/50"
                  >
                    <td className="px-4 py-2.5 text-foreground/90 font-medium">
                      {contact.email}
                    </td>
                    <td className="px-4 py-2.5 text-muted-foreground">
                      {[contact.firstName, contact.lastName]
                        .filter(Boolean)
                        .join(" ") || "—"}
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
                        onClick={() => setDeleteContact(contact)}
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

      {/* Delete confirm */}
      <AlertDialog
        open={!!deleteContact}
        onOpenChange={(o) => !o && setDeleteContact(null)}
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
              onClick={() =>
                deleteContact && deleteMutation.mutate(deleteContact.id)
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
