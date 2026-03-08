import { Link, useLocation, useRouter } from "@tanstack/react-router";
import { toast } from "sonner";
import {
  LayoutDashboard, Users, Mail, Zap, FileText, Settings,
  Check, LogOut, Filter, Search, PanelLeftOpen, ChevronDown, Plus,
  Sun, Moon, Monitor, ImagePlay,
} from "lucide-react";
import type { ComponentType } from "react";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { cn } from "@/lib/utils";
import { useWorkspaceStore } from "@/store/workspace";
import { useWorkspaces } from "@/hooks/use-workspaces";
import { useSession, signOut } from "@/lib/auth-client";
import { useQueryClient, useMutation } from "@tanstack/react-query";
import { useState, useRef } from "react";
import * as Popover from "@radix-ui/react-popover";
import { apiFetch } from "@/lib/api";
import { useTheme, type Theme } from "@/hooks/use-theme";
import {
  Sidebar,
  SidebarContent,
  SidebarFooter,
  SidebarGroup,
  SidebarHeader,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
  SidebarRail,
  SidebarSeparator,
  useSidebar,
} from "@/components/ui/sidebar";

const NAV_ITEMS = [
  { to: "/dashboard",  icon: LayoutDashboard, label: "Dashboard" },
  { to: "/contacts",   icon: Users,            label: "Contacts" },
  { to: "/segments",   icon: Filter,           label: "Segments" },
  { to: "/broadcasts", icon: Mail,             label: "Broadcasts" },
  { to: "/campaigns",  icon: Zap,              label: "Campaigns" },
  { to: "/templates",  icon: FileText,         label: "Templates" },
  { to: "/assets",     icon: ImagePlay,        label: "Assets" },
  { to: "/settings",   icon: Settings,         label: "Settings" },
] as const;

// ── Sidebar header row — handles all logo/toggle states via React ─────────────
function SidebarHeaderRow() {
  const { state, toggleSidebar } = useSidebar();
  const collapsed = state === "collapsed";
  const [hovered, setHovered] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  const LogoMark = () => (
    <div className="flex h-5 w-5 shrink-0 items-center justify-center rounded-[5px] bg-sidebar-foreground">
      <Mail className="h-3 w-3 text-sidebar" />
    </div>
  );

  return (
    <div
      ref={ref}
      className="flex h-11 items-center gap-2 px-2 border-b border-sidebar-border"
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
    >
      {collapsed ? (
        // Collapsed: mail icon at rest, expand button on hover — never both
        <div className="flex w-full items-center justify-center">
          {hovered ? (
            <Tooltip>
              <TooltipTrigger asChild>
                <button
                  onClick={toggleSidebar}
                  className="flex items-center justify-center h-7 w-7 rounded-md bg-sidebar-accent text-sidebar-foreground cursor-pointer hover:bg-sidebar-accent/80 transition-colors"
                >
                  <PanelLeftOpen className="h-4 w-4" />
                </button>
              </TooltipTrigger>
              <TooltipContent side="right">Expand sidebar</TooltipContent>
            </Tooltip>
          ) : (
            <LogoMark />
          )}
        </div>
      ) : (
        // Expanded: logo + name on left, collapse button on right
        <>
          <div className="flex items-center gap-2 flex-1 min-w-0">
            <LogoMark />
            <span className="text-[13px] font-semibold tracking-tight text-sidebar-foreground truncate">
              OpenMail
            </span>
          </div>
          <Tooltip>
            <TooltipTrigger asChild>
              <button
                onClick={toggleSidebar}
                className="h-7 w-7 flex items-center justify-center rounded-md text-sidebar-foreground/40 hover:text-sidebar-foreground hover:bg-sidebar-accent transition-colors cursor-pointer shrink-0"
              >
                <PanelLeftOpen className="h-4 w-4 rotate-180" />
              </button>
            </TooltipTrigger>
            <TooltipContent side="right">
              Collapse sidebar <kbd className="ml-1 font-mono text-[10px] opacity-60">⌘B</kbd>
            </TooltipContent>
          </Tooltip>
        </>
      )}
    </div>
  );
}

// ── Workspace switcher (Popover) ─────────────────────────────────────────────
function WorkspaceSwitcher() {
  const { activeWorkspaceId, setActiveWorkspaceId } = useWorkspaceStore();
  const { workspaces } = useWorkspaces();
  const { state } = useSidebar();
  const collapsed = state === "collapsed";
  const [open, setOpen] = useState(false);
  const [creating, setCreating] = useState(false);
  const [newName, setNewName] = useState("");
  const newNameRef = useRef<HTMLInputElement>(null);
  const qc = useQueryClient();

  const activeWs = workspaces?.find((w) => w.id === activeWorkspaceId);

  const createMutation = useMutation({
    mutationFn: (name: string) => {
      const slug = name.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 48) || "workspace";
      return apiFetch<{ id: string; name: string; slug: string }>("/api/session/workspaces", {
        method: "POST",
        body: JSON.stringify({ name, slug: `${slug}-${Math.random().toString(36).slice(2, 6)}` }),
      });
    },
    onSuccess: (data) => {
      qc.invalidateQueries({ queryKey: ["workspaces"] });
      setActiveWorkspaceId(data.id);
      setCreating(false);
      setNewName("");
      setOpen(false);
      toast.success(`Workspace "${data.name}" created`);
    },
    onError: (e: Error) => toast.error(e.message),
  });

  if (!workspaces?.length) return null;

  const initial = (activeWs?.name ?? "W")[0].toUpperCase();

  return (
    <Popover.Root open={open} onOpenChange={(v) => { setOpen(v); if (!v) { setCreating(false); setNewName(""); } }}>
      <Popover.Trigger asChild>
        <SidebarMenuButton
          size="lg"
          className={cn("w-full cursor-pointer", collapsed && "justify-center")}
        >
          <div
            className={cn(
              "flex items-center justify-center h-7 w-7 rounded-md bg-violet-500/20 text-violet-300 text-xs font-bold shrink-0 uppercase select-none",
              collapsed && "group-hover/sidebar:hidden"
            )}
          >
            {initial}
          </div>
          {!collapsed && (
            <>
              <div className="flex-1 min-w-0 text-left">
                <p className="text-[13px] font-semibold truncate leading-tight text-sidebar-foreground">
                  {activeWs?.name ?? "Select workspace"}
                </p>
                <p className="text-[10px] text-sidebar-foreground/50 leading-tight">Free plan</p>
              </div>
              <ChevronDown className="h-3.5 w-3.5 shrink-0 text-sidebar-foreground/40" />
            </>
          )}
        </SidebarMenuButton>
      </Popover.Trigger>
      <Popover.Portal>
        <Popover.Content
          align="start"
          side={collapsed ? "right" : "bottom"}
          sideOffset={4}
          className="z-50 w-60 rounded-lg border border-border bg-popover p-1 shadow-xl shadow-black/40 animate-in fade-in-0 zoom-in-95 data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=closed]:zoom-out-95"
        >
          {/* Workspace list */}
          <p className="px-2 py-1.5 text-[10px] font-semibold uppercase tracking-wider text-muted-foreground/50">
            Workspaces
          </p>
          {workspaces.map((ws) => (
            <button
              key={ws.id}
              onClick={() => { setActiveWorkspaceId(ws.id); setOpen(false); }}
              className="flex w-full items-center gap-2.5 rounded-md px-2 py-1.5 text-[13px] transition-colors hover:bg-accent cursor-pointer text-left"
            >
              <div className="flex h-6 w-6 shrink-0 items-center justify-center rounded bg-violet-500/20 text-violet-300 text-[10px] font-bold uppercase">
                {ws.name[0]}
              </div>
              <span className="flex-1 min-w-0 truncate font-medium">{ws.name}</span>
              {ws.id === activeWorkspaceId && <Check className="h-3.5 w-3.5 shrink-0 text-foreground/50" />}
            </button>
          ))}

          {/* Separator + actions */}
          <div className="my-1 h-px bg-border/60" />

          {/* Workspace settings */}
          <Link
            to="/settings"
            onClick={() => setOpen(false)}
            className="flex w-full items-center gap-2.5 rounded-md px-2 py-1.5 text-[13px] text-muted-foreground transition-colors hover:bg-accent hover:text-foreground cursor-pointer"
          >
            <Settings className="h-3.5 w-3.5 shrink-0" />
            Workspace settings
          </Link>

          {/* Create workspace — inline form */}
          {!creating ? (
            <button
              onClick={() => { setCreating(true); setTimeout(() => newNameRef.current?.focus(), 50); }}
              className="flex w-full items-center gap-2.5 rounded-md px-2 py-1.5 text-[13px] text-muted-foreground transition-colors hover:bg-accent hover:text-foreground cursor-pointer"
            >
              <Plus className="h-3.5 w-3.5 shrink-0" />
              New workspace
            </button>
          ) : (
            <form
              className="mt-1 px-1"
              onSubmit={(e) => {
                e.preventDefault();
                if (newName.trim()) createMutation.mutate(newName.trim());
              }}
            >
              <input
                ref={newNameRef}
                value={newName}
                onChange={(e) => setNewName(e.target.value)}
                placeholder="Workspace name"
                className="mb-1.5 w-full rounded-md border border-border bg-muted/40 px-2.5 py-1.5 text-[12.5px] text-foreground placeholder:text-muted-foreground/50 outline-none focus:border-ring focus:ring-1 focus:ring-ring/30"
              />
              <div className="flex gap-1.5">
                <button
                  type="submit"
                  disabled={!newName.trim() || createMutation.isPending}
                  className="flex-1 rounded-md bg-foreground px-2 py-1.5 text-[12px] font-medium text-background transition-opacity hover:opacity-85 disabled:opacity-40 cursor-pointer"
                >
                  {createMutation.isPending ? "Creating…" : "Create"}
                </button>
                <button
                  type="button"
                  onClick={() => { setCreating(false); setNewName(""); }}
                  className="rounded-md border border-border px-2 py-1.5 text-[12px] text-muted-foreground transition-colors hover:bg-accent hover:text-foreground cursor-pointer"
                >
                  Cancel
                </button>
              </div>
            </form>
          )}
        </Popover.Content>
      </Popover.Portal>
    </Popover.Root>
  );
}

// ── Search trigger ───────────────────────────────────────────────────────────
function SearchButton() {
  const { state } = useSidebar();
  const collapsed = state === "collapsed";

  const trigger = () => {
    document.dispatchEvent(new KeyboardEvent("keydown", { key: "k", metaKey: true, bubbles: true }));
  };

  if (collapsed) {
    return (
      <SidebarMenuItem>
        <SidebarMenuButton tooltip="Search  ⌘K" onClick={trigger} className="cursor-pointer">
          <Search className="h-4 w-4" />
          <span>Search</span>
        </SidebarMenuButton>
      </SidebarMenuItem>
    );
  }

  return (
    <SidebarMenuItem>
      <button
        onClick={trigger}
        className={cn(
          "flex w-full items-center gap-2 rounded-md px-2 py-1.5",
          "text-[12px] text-sidebar-foreground/50 cursor-pointer",
          "border border-sidebar-border/60 bg-sidebar-accent/30",
          "transition-colors hover:bg-sidebar-accent hover:text-sidebar-foreground/90 hover:border-sidebar-border",
          "group"
        )}
      >
        <Search className="h-3.5 w-3.5 shrink-0" />
        <span className="flex-1 text-left">Search…</span>
        <kbd className="flex items-center gap-0.5 rounded bg-sidebar-accent px-1 py-0.5 font-mono text-[9px] text-sidebar-foreground/40">
          ⌘K
        </kbd>
      </button>
    </SidebarMenuItem>
  );
}

// ── Nav item ─────────────────────────────────────────────────────────────────
function NavItem({ to, icon: Icon, label }: { to: string; icon: ComponentType<{ className?: string }>; label: string }) {
  const location = useLocation();
  const isActive = location.pathname === to || location.pathname.startsWith(to + "/");

  return (
    <SidebarMenuItem>
      <SidebarMenuButton asChild isActive={isActive} tooltip={label}>
        <Link
          to={to}
          className="cursor-pointer"
        >
          <Icon className="h-4 w-4" />
          <span>{label}</span>
        </Link>
      </SidebarMenuButton>
    </SidebarMenuItem>
  );
}

// ── User footer row ──────────────────────────────────────────────────────────
function UserRow() {
  const { state } = useSidebar();
  const collapsed = state === "collapsed";
  const { data: session } = useSession();
  const { setActiveWorkspaceId } = useWorkspaceStore();
  const queryClient = useQueryClient();
  const router = useRouter();
  const { theme, setTheme } = useTheme();
  const [open, setOpen] = useState(false);

  if (!session?.user) return null;

  const name = session.user.name ?? session.user.email;
  const email = session.user.email;
  const initial = name[0].toUpperCase();

  const handleSignOut = () => {
    setOpen(false);
    signOut()
      .then(() => {
        queryClient.clear();
        setActiveWorkspaceId(null);
        router.navigate({ to: "/login" });
      })
      .catch(() => toast.error("Sign out failed"));
  };

  const THEMES: { value: Theme; icon: React.ElementType; label: string }[] = [
    { value: "system",  icon: Monitor, label: "System" },
    { value: "light",   icon: Sun,     label: "Light"  },
    { value: "dark",    icon: Moon,    label: "Dark"   },
  ];

  const trigger = (
    <button
      className={cn(
        "flex w-full items-center gap-2 rounded-md px-2 py-1.5 cursor-pointer",
        "transition-colors hover:bg-sidebar-accent",
        collapsed && "justify-center px-0"
      )}
    >
      <div className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-sidebar-accent text-[10px] font-semibold text-sidebar-foreground/80 uppercase select-none">
        {initial}
      </div>
      {!collapsed && (
        <div className="min-w-0 flex-1 text-left">
          <p className="truncate text-[12px] font-medium leading-none text-sidebar-foreground">{name}</p>
          {session.user.name && (
            <p className="mt-0.5 truncate text-[10px] leading-none text-sidebar-foreground/50">{email}</p>
          )}
        </div>
      )}
    </button>
  );

  return (
    <Popover.Root open={open} onOpenChange={setOpen}>
      <Popover.Trigger asChild>
        {collapsed ? (
          <Tooltip>
            <TooltipTrigger asChild>{trigger}</TooltipTrigger>
            <TooltipContent side="right">{name}</TooltipContent>
          </Tooltip>
        ) : trigger}
      </Popover.Trigger>
      <Popover.Portal>
        <Popover.Content
          side="top"
          align="start"
          sideOffset={6}
          className="z-50 w-60 rounded-lg border border-border bg-popover p-1 shadow-xl shadow-black/40 animate-in fade-in-0 zoom-in-95 data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=closed]:zoom-out-95"
        >
          {/* User info header */}
          <div className="px-2 py-2 mb-1">
            <p className="text-[13px] font-medium text-foreground truncate">{name}</p>
            <p className="text-[11px] text-muted-foreground truncate">{email}</p>
          </div>

          <div className="my-1 h-px bg-border/60" />

          {/* Settings */}
          <Link
            to="/settings"
            onClick={() => setOpen(false)}
            className="flex w-full items-center gap-2.5 rounded-md px-2 py-1.5 text-[13px] text-muted-foreground transition-colors hover:bg-accent hover:text-foreground cursor-pointer"
          >
            <Settings className="h-3.5 w-3.5 shrink-0" />
            Settings
          </Link>

          <div className="my-1 h-px bg-border/60" />

          {/* Theme toggle */}
          <div className="px-2 py-1.5 flex items-center justify-between">
            <span className="text-[12px] text-muted-foreground">Theme</span>
            <div className="flex items-center gap-0.5 rounded-md border border-border/60 bg-muted/40 p-0.5">
              {THEMES.map(({ value, icon: Icon, label }) => (
                <Tooltip key={value}>
                  <TooltipTrigger asChild>
                    <button
                      onClick={() => setTheme(value)}
                      className={cn(
                        "flex h-6 w-6 items-center justify-center rounded transition-colors cursor-pointer",
                        theme === value
                          ? "bg-background text-foreground shadow-sm"
                          : "text-muted-foreground hover:text-foreground"
                      )}
                    >
                      <Icon className="h-3.5 w-3.5" />
                    </button>
                  </TooltipTrigger>
                  <TooltipContent side="top">{label}</TooltipContent>
                </Tooltip>
              ))}
            </div>
          </div>

          <div className="my-1 h-px bg-border/60" />

          {/* Sign out */}
          <button
            onClick={handleSignOut}
            className="flex w-full items-center gap-2.5 rounded-md px-2 py-1.5 text-[13px] text-muted-foreground transition-colors hover:bg-accent hover:text-foreground cursor-pointer"
          >
            <LogOut className="h-3.5 w-3.5 shrink-0" />
            Sign out
          </button>
        </Popover.Content>
      </Popover.Portal>
    </Popover.Root>
  );
}

// ── Main sidebar ──────────────────────────────────────────────────────────────
export function AppSidebar() {
  return (
    <Sidebar collapsible="icon" className="border-r border-sidebar-border group/sidebar">
      {/* Header — logo + workspace switcher */}
      <SidebarHeader className="pb-0 gap-0">
        <SidebarHeaderRow />

        {/* Workspace switcher */}
        <div className="px-0 py-1 border-b border-sidebar-border">
          <SidebarMenu>
            <SidebarMenuItem>
              <WorkspaceSwitcher />
            </SidebarMenuItem>
          </SidebarMenu>
        </div>
      </SidebarHeader>

      {/* Nav */}
      <SidebarContent>
        <SidebarGroup className="py-2 gap-1">
          <SidebarMenu>
            <SearchButton />
            {NAV_ITEMS.map(({ to, icon, label }) => (
              <NavItem key={to} to={to} icon={icon} label={label} />
            ))}
          </SidebarMenu>
        </SidebarGroup>
      </SidebarContent>

      {/* Footer — user */}
      <SidebarFooter className="gap-1 pb-2">
        <SidebarSeparator className="mb-1" />
        <UserRow />
      </SidebarFooter>

      <SidebarRail />
    </Sidebar>
  );
}
