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
import { Plus, Search, Trash2 } from "lucide-react";
import { toast } from "sonner";

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
  const emailRef = useRef<HTMLInputElement>(null);
  const firstNameRef = useRef<HTMLInputElement>(null);
  const lastNameRef = useRef<HTMLInputElement>(null);

  const { data } = useQuery<{ data: Contact[]; total: number }>({
    queryKey: ["contacts", activeWorkspaceId, search],
    queryFn: () =>
      sessionFetch(activeWorkspaceId!, `/contacts?search=${encodeURIComponent(search)}`),
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
      toast.success("Contact deleted");
    },
    onError: (e: Error) => toast.error(e.message),
  });

  return (
    <div className="p-8 max-w-5xl mx-auto">
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-xl font-semibold">Contacts</h1>
          <p className="text-sm text-muted-foreground mt-0.5">{data?.total ?? 0} total</p>
        </div>
        <Dialog open={open} onOpenChange={setOpen}>
          <DialogTrigger asChild>
            <Button size="sm">
              <Plus className="w-4 h-4" />
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
                <Input ref={emailRef} type="email" required />
              </div>
              <div className="space-y-1.5">
                <Label>First Name</Label>
                <Input ref={firstNameRef} />
              </div>
              <div className="space-y-1.5">
                <Label>Last Name</Label>
                <Input ref={lastNameRef} />
              </div>
              <DialogFooter>
                <Button type="submit" disabled={createMutation.isPending}>
                  {createMutation.isPending ? "Adding..." : "Add Contact"}
                </Button>
              </DialogFooter>
            </form>
          </DialogContent>
        </Dialog>
      </div>

      <div className="relative mb-4">
        <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
        <Input
          placeholder="Search by email..."
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          className="pl-9"
        />
      </div>

      <div className="bg-white rounded-xl border overflow-hidden">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b bg-gray-50">
              <th className="text-left px-4 py-3 font-medium text-muted-foreground">Email</th>
              <th className="text-left px-4 py-3 font-medium text-muted-foreground">Name</th>
              <th className="text-left px-4 py-3 font-medium text-muted-foreground">Status</th>
              <th className="text-left px-4 py-3 font-medium text-muted-foreground">Added</th>
              <th className="w-10" />
            </tr>
          </thead>
          <tbody>
            {data?.data.map((contact) => (
              <tr
                key={contact.id}
                className="border-b last:border-0 hover:bg-gray-50 transition-colors"
              >
                <td className="px-4 py-3 font-medium">{contact.email}</td>
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
                <td className="px-4 py-3 text-muted-foreground">
                  {new Date(contact.createdAt).toLocaleDateString()}
                </td>
                <td className="px-4 py-3">
                  <button
                    onClick={() => deleteMutation.mutate(contact.id)}
                    className="text-muted-foreground hover:text-destructive transition-colors cursor-pointer"
                  >
                    <Trash2 className="w-4 h-4" />
                  </button>
                </td>
              </tr>
            ))}
            {!data?.data.length && (
              <tr>
                <td colSpan={5} className="px-4 py-12 text-center text-muted-foreground">
                  No contacts yet
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
