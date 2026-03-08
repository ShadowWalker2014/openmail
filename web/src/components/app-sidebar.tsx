import { Link, useLocation } from "@tanstack/react-router";
import { LayoutDashboard, Users, Mail, Zap, FileText, Settings, Check } from "lucide-react";
import { cn } from "@/lib/utils";
import { useWorkspaceStore } from "@/store/workspace";
import { useWorkspaces } from "@/hooks/use-workspaces";

const NAV_ITEMS = [
  { to: "/dashboard", icon: LayoutDashboard, label: "Dashboard" },
  { to: "/contacts", icon: Users, label: "Contacts" },
  { to: "/broadcasts", icon: Mail, label: "Broadcasts" },
  { to: "/campaigns", icon: Zap, label: "Campaigns" },
  { to: "/templates", icon: FileText, label: "Templates" },
  { to: "/settings", icon: Settings, label: "Settings" },
] as const;

export function AppSidebar() {
  const location = useLocation();
  const { activeWorkspaceId, setActiveWorkspaceId } = useWorkspaceStore();
  const { workspaces } = useWorkspaces();

  return (
    <aside className="w-56 border-r bg-white flex flex-col h-screen sticky top-0">
      {/* Logo */}
      <div className="px-4 py-4 border-b">
        <div className="flex items-center gap-2">
          <div className="w-7 h-7 bg-black rounded-md flex items-center justify-center">
            <Mail className="w-4 h-4 text-white" />
          </div>
          <span className="font-semibold text-sm">OpenMail</span>
        </div>
      </div>

      {/* Workspace Switcher */}
      <div className="px-3 py-2 border-b">
        <div className="text-xs text-muted-foreground px-1 mb-1">Workspace</div>
        <div className="flex flex-col gap-0.5">
          {workspaces?.map((ws) => (
            <button
              key={ws.id}
              onClick={() => setActiveWorkspaceId(ws.id)}
              className={cn(
                "flex items-center justify-between w-full px-2 py-1.5 rounded-md text-sm hover:bg-accent transition-colors cursor-pointer",
                activeWorkspaceId === ws.id && "bg-accent"
              )}
            >
              <span className="truncate">{ws.name}</span>
              {activeWorkspaceId === ws.id && <Check className="w-3 h-3 shrink-0" />}
            </button>
          ))}
        </div>
      </div>

      {/* Nav */}
      <nav className="flex-1 px-3 py-2 overflow-y-auto">
        {NAV_ITEMS.map(({ to, icon: Icon, label }) => {
          const isActive = location.pathname === to || location.pathname.startsWith(to + "/");
          return (
            <Link
              key={to}
              to={to}
              className={cn(
                "flex items-center gap-2.5 px-2 py-1.5 rounded-md text-sm transition-colors mb-0.5 cursor-pointer",
                isActive
                  ? "bg-accent font-medium text-foreground"
                  : "text-muted-foreground hover:text-foreground hover:bg-accent"
              )}
            >
              <Icon className="w-4 h-4 shrink-0" />
              <span className="truncate">{label}</span>
            </Link>
          );
        })}
      </nav>
    </aside>
  );
}
