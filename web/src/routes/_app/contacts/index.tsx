import { createFileRoute } from "@tanstack/react-router";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { sessionFetch } from "@/lib/api";
import { useWorkspaceStore } from "@/store/workspace";
import { useState, useRef } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
  DialogFooter,
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
import { Plus, Search, Trash2, Users } from "lucide-react";
import { toast } from "sonner";
import { format } from "date-fns";

export const Route = createFileRoute("/_app/contacts/")({
  component: ContactsPage,
});

interface Contact {
  id: string;
  email: string;
  firstName: string | null;
  lastName: string | null;
  unsubscribed: boolean;
  createdAt: string;
  attributes: Record<string, unknown>;
}

function ContactsPage() {
  const { activeWorkspaceId } = useWorkspaceStore();
  const qc = useQueryClient();
  const [search, setSearch] = useState("");
  const [open, setOpen] = useState(false);
  const [deleteContact, setDeleteContact] = useState<Contact | null>(null);
  const emailRef = useRef<HTMLInputElement>(null);
  const firstNameRef = useRef<HTMLInputElement>(null);
  const lastNameRef = useRef<HTMLInputElement>(null);

  const { data, isLoading } = useQuery<{ data: Contact[]; total: number }>({
    queryKey: ["contacts", activeWorkspaceId, search],
    queryFn: () =>
      sessionFetch(
        activeWorkspaceId!,
        `/contacts?search=${encodeURIComponent(search)}`
      ),
    enabled: !!activeWorkspaceId,
  });

  const createMutation = useMutation({
    mutationFn: (body: { email: string; firstName?: string; lastName?: string }) =>
      sessionFetch(activeWorkspaceId!, "/contacts", {
        method: "POST",
        body: JSON.stringify(body),
      }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["contacts", activeWorkspaceId] });
      setOpen(false);
      toast.success("Contact added");
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
    <div className="mx-auto max-w-5xl px-8 py-8">
      {/* Header */}
      <div className="mb-7 flex items-center justify-between">
        <div>
          <h1 className="text-lg font-semibold tracking-tight">Contacts</h1>
          <p className="mt-0.5 text-sm text-muted-foreground tabular-nums">
            {data?.total ?? 0} total
          </p>
        </div>
        <Dialog open={open} onOpenChange={setOpen}>
          <DialogTrigger asChild>
            <Button size="sm">
              <Plus className="h-4 w-4" />
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
              className="space-y-4"
            >
              <div className="space-y-1.5">
                <Label>Email *</Label>
                <Input ref={emailRef} type="email" required placeholder="name@company.com" />
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div className="space-y-1.5">
                  <Label>First Name</Label>
                  <Input ref={firstNameRef} placeholder="Jane" />
                </div>
                <div className="space-y-1.5">
                  <Label>Last Name</Label>
                  <Input ref={lastNameRef} placeholder="Smith" />
                </div>
              </div>
              <DialogFooter>
                <Button type="submit" disabled={createMutation.isPending}>
                  {createMutation.isPending ? "Adding…" : "Add Contact"}
                </Button>
              </DialogFooter>
            </form>
          </DialogContent>
        </Dialog>
      </div>

      {/* Search */}
      <div className="relative mb-4">
        <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
        <Input
          placeholder="Search by email…"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          className="pl-9"
        />
      </div>

      {/* Table */}
      <div className="overflow-hidden rounded-lg border bg-background">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b bg-muted/40">
              <th className="px-4 py-2.5 text-left text-xs font-medium text-muted-foreground">
                Email
              </th>
              <th className="px-4 py-2.5 text-left text-xs font-medium text-muted-foreground">
                Name
              </th>
              <th className="px-4 py-2.5 text-left text-xs font-medium text-muted-foreground">
                Status
              </th>
              <th className="px-4 py-2.5 text-left text-xs font-medium text-muted-foreground">
                Added
              </th>
              <th className="w-10 px-2" />
            </tr>
          </thead>
          <tbody>
            {isLoading &&
              Array.from({ length: 5 }).map((_, i) => (
                <tr key={i} className="border-b last:border-0">
                  <td className="px-4 py-3">
                    <div className="h-3.5 w-40 rounded shimmer" />
                  </td>
                  <td className="px-4 py-3">
                    <div className="h-3.5 w-24 rounded shimmer" />
                  </td>
                  <td className="px-4 py-3">
                    <div className="h-5 w-20 rounded-full shimmer" />
                  </td>
                  <td className="px-4 py-3">
                    <div className="h-3.5 w-16 rounded shimmer" />
                  </td>
                  <td className="px-2 py-3" />
                </tr>
              ))}

            {!isLoading &&
              data?.data.map((contact) => (
                <tr
                  key={contact.id}
                  className="group border-b last:border-0 transition-colors duration-150 hover:bg-accent/30"
                >
                  <td className="px-4 py-3 font-medium">{contact.email}</td>
                  <td className="px-4 py-3 text-muted-foreground">
                    {[contact.firstName, contact.lastName]
                      .filter(Boolean)
                      .join(" ") || "—"}
                  </td>
                  <td className="px-4 py-3">
                    {contact.unsubscribed ? (
                      <Badge variant="destructive">Unsubscribed</Badge>
                    ) : (
                      <Badge variant="success">Subscribed</Badge>
                    )}
                  </td>
                  <td className="tabular-nums px-4 py-3 text-muted-foreground">
                    {format(new Date(contact.createdAt), "MMM d, yyyy")}
                  </td>
                  <td className="px-2 py-3">
                    <button
                      onClick={() => setDeleteContact(contact)}
                      className="rounded p-1 text-muted-foreground/40 opacity-0 transition-all duration-150 hover:bg-destructive/10 hover:text-destructive group-hover:opacity-100 focus-visible:opacity-100 focus-visible:ring-2 focus-visible:ring-ring cursor-pointer"
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
                    <div className="mb-3 flex h-10 w-10 items-center justify-center rounded-lg border">
                      <Users className="h-5 w-5 text-muted-foreground" />
                    </div>
                    <p className="text-sm font-medium">No contacts yet</p>
                    <p className="mt-1 text-xs text-muted-foreground">
                      Add contacts manually or via the REST API
                    </p>
                  </div>
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>

      {/* Delete confirmation */}
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
              will be permanently deleted. This action cannot be undone.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={() => deleteContact && deleteMutation.mutate(deleteContact.id)}
            >
              Delete
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
