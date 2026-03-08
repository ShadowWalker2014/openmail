import { useEffect, useState, useCallback } from "react";
import { useRouter } from "@tanstack/react-router";
import {
  LayoutDashboard, Users, Mail, Zap, FileText, Settings, Filter,
  Plus, LogOut, Search,
} from "lucide-react";
import {
  Command, CommandEmpty, CommandGroup, CommandInput,
  CommandItem, CommandList, CommandSeparator, CommandShortcut,
} from "@/components/ui/command";
import { cn } from "@/lib/utils";
import { signOut } from "@/lib/auth-client";
import { useQueryClient } from "@tanstack/react-query";
import { useWorkspaceStore } from "@/store/workspace";

interface CommandGroup {
  heading: string;
  items: CommandItemDef[];
}

interface CommandItemDef {
  id: string;
  label: string;
  icon: React.ElementType;
  shortcut?: string;
  action: () => void;
  keywords?: string[];
}

export function useCommandPalette() {
  const [open, setOpen] = useState(false);

  useEffect(() => {
    function handler(e: KeyboardEvent) {
      if ((e.metaKey || e.ctrlKey) && e.key === "k") {
        e.preventDefault();
        setOpen((o) => !o);
      }
    }
    document.addEventListener("keydown", handler);
    return () => document.removeEventListener("keydown", handler);
  }, []);

  return { open, setOpen };
}

interface CommandPaletteProps {
  open: boolean;
  onClose: () => void;
}

export function CommandPalette({ open, onClose }: CommandPaletteProps) {
  const router = useRouter();
  const queryClient = useQueryClient();
  const { setActiveWorkspaceId } = useWorkspaceStore();

  const navigate = useCallback(
    (to: string) => {
      router.navigate({ to });
      onClose();
    },
    [router, onClose]
  );

  const NAV_ITEMS: CommandItemDef[] = [
    { id: "nav-dashboard",  label: "Go to Dashboard",  icon: LayoutDashboard, shortcut: "G D", action: () => navigate("/dashboard"),  keywords: ["home", "overview", "stats"] },
    { id: "nav-contacts",   label: "Go to Contacts",   icon: Users,            shortcut: "G C", action: () => navigate("/contacts"),   keywords: ["people", "subscribers"] },
    { id: "nav-segments",   label: "Go to Segments",   icon: Filter,           shortcut: "G S", action: () => navigate("/segments"),   keywords: ["groups", "filters"] },
    { id: "nav-broadcasts", label: "Go to Broadcasts", icon: Mail,             shortcut: "G B", action: () => navigate("/broadcasts"), keywords: ["emails", "campaigns", "sends"] },
    { id: "nav-campaigns",  label: "Go to Campaigns",  icon: Zap,              shortcut: "G A", action: () => navigate("/campaigns"),  keywords: ["automation", "sequences"] },
    { id: "nav-templates",  label: "Go to Templates",  icon: FileText,         shortcut: "G T", action: () => navigate("/templates"),  keywords: ["html", "email templates"] },
    { id: "nav-settings",   label: "Go to Settings",   icon: Settings,         shortcut: "G ,", action: () => navigate("/settings"),   keywords: ["api keys", "resend", "config"] },
  ];

  const ACTION_ITEMS: CommandItemDef[] = [
    { id: "new-contact",   label: "New Contact",   icon: Users,    shortcut: "C", action: () => { navigate("/contacts");   }, keywords: ["add contact", "create contact"] },
    { id: "new-segment",   label: "New Segment",   icon: Filter,   shortcut: "S", action: () => { navigate("/segments");   }, keywords: ["create segment", "add segment"] },
    { id: "new-broadcast", label: "New Broadcast", icon: Mail,     shortcut: "B", action: () => { navigate("/broadcasts"); }, keywords: ["send email", "create broadcast"] },
    { id: "new-campaign",  label: "New Campaign",  icon: Zap,      shortcut: "A", action: () => { navigate("/campaigns");  }, keywords: ["new campaign", "automation"] },
    { id: "new-template",  label: "New Template",  icon: FileText, shortcut: "T", action: () => { navigate("/templates"); }, keywords: ["create template"] },
  ];

  const ACCOUNT_ITEMS: CommandItemDef[] = [
    {
      id: "sign-out",
      label: "Sign out",
      icon: LogOut,
      action: () => {
        onClose();
        signOut().then(() => {
          queryClient.clear();
          setActiveWorkspaceId(null);
          router.navigate({ to: "/login" });
        });
      },
      keywords: ["logout", "sign out"],
    },
  ];

  if (!open) return null;

  return (
    <>
      {/* Backdrop */}
      <div
        className="fixed inset-0 z-50 bg-black/60 backdrop-blur-[2px]"
        onClick={onClose}
        style={{ animation: "fadeIn 120ms ease-out" }}
      />

      {/* Palette */}
      <div
        className="fixed left-1/2 top-[20%] z-50 w-full max-w-[520px] -translate-x-1/2"
        style={{ animation: "paletteIn 150ms cubic-bezier(0.34, 1.56, 0.64, 1)" }}
      >
        <div className="overflow-hidden rounded-xl border border-border/80 bg-popover shadow-2xl shadow-black/50">
          <Command
            onKeyDown={(e) => {
              if (e.key === "Escape") onClose();
            }}
          >
            <CommandInput placeholder="Search commands, navigate…" autoFocus />
            <CommandList className="p-1">
              <CommandEmpty>
                <Search className="mx-auto mb-2 h-5 w-5 text-muted-foreground/30" />
                No results found
              </CommandEmpty>

              <CommandGroup heading="Navigate">
                {NAV_ITEMS.map((item) => (
                  <CommandItem
                    key={item.id}
                    value={`${item.label} ${item.keywords?.join(" ")}`}
                    onSelect={item.action}
                  >
                    <item.icon className="h-3.5 w-3.5 shrink-0 text-muted-foreground/60" />
                    <span className="flex-1">{item.label}</span>
                    {item.shortcut && (
                      <CommandShortcut>{item.shortcut}</CommandShortcut>
                    )}
                  </CommandItem>
                ))}
              </CommandGroup>

              <CommandSeparator />

              <CommandGroup heading="Create">
                {ACTION_ITEMS.map((item) => (
                  <CommandItem
                    key={item.id}
                    value={`${item.label} ${item.keywords?.join(" ")}`}
                    onSelect={item.action}
                  >
                    <div className="flex h-5 w-5 items-center justify-center rounded bg-accent">
                      <Plus className="h-2.5 w-2.5 text-muted-foreground/80" />
                    </div>
                    <span className="flex-1">{item.label}</span>
                    {item.shortcut && (
                      <CommandShortcut>⌘ {item.shortcut}</CommandShortcut>
                    )}
                  </CommandItem>
                ))}
              </CommandGroup>

              <CommandSeparator />

              <CommandGroup heading="Account">
                {ACCOUNT_ITEMS.map((item) => (
                  <CommandItem
                    key={item.id}
                    value={`${item.label} ${item.keywords?.join(" ")}`}
                    onSelect={item.action}
                  >
                    <item.icon className="h-3.5 w-3.5 shrink-0 text-muted-foreground/60" />
                    <span className="flex-1">{item.label}</span>
                  </CommandItem>
                ))}
              </CommandGroup>
            </CommandList>

            {/* Footer hint */}
            <div className="border-t border-border/40 px-3.5 py-2.5 flex items-center gap-3">
              <div className="flex items-center gap-1 text-[10px] text-muted-foreground/50">
                <kbd className="rounded border border-border/60 bg-muted/50 px-1 py-0.5 font-mono text-[10px]">↑↓</kbd>
                <span>navigate</span>
              </div>
              <div className="flex items-center gap-1 text-[10px] text-muted-foreground/50">
                <kbd className="rounded border border-border/60 bg-muted/50 px-1 py-0.5 font-mono text-[10px]">↵</kbd>
                <span>select</span>
              </div>
              <div className="flex items-center gap-1 text-[10px] text-muted-foreground/50">
                <kbd className="rounded border border-border/60 bg-muted/50 px-1 py-0.5 font-mono text-[10px]">esc</kbd>
                <span>close</span>
              </div>
              <div className="ml-auto text-[10px] text-muted-foreground/40">
                ⌘K
              </div>
            </div>
          </Command>
        </div>
      </div>

      <style>{`
        @keyframes fadeIn {
          from { opacity: 0; }
          to { opacity: 1; }
        }
        @keyframes paletteIn {
          from { opacity: 0; transform: translateX(-50%) translateY(-8px) scale(0.96); }
          to { opacity: 1; transform: translateX(-50%) translateY(0) scale(1); }
        }
      `}</style>
    </>
  );
}
