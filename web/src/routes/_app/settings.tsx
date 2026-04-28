import { createFileRoute, Outlet, Link, useMatchRoute } from "@tanstack/react-router";
import { Building2, Users, Mail, Globe, Code2, User, Bot } from "lucide-react";
import { cn } from "@/lib/utils";

export const Route = createFileRoute("/_app/settings")({
  component: SettingsLayout,
});

const SETTINGS_GROUPS = [
  {
    label: "Workspace",
    sections: [
      { to: "/settings/general",  label: "General",        icon: Building2 },
      { to: "/settings/team",     label: "Team Members",   icon: Users },
      { to: "/settings/email",    label: "Email Sending",  icon: Mail },
      { to: "/settings/domain",   label: "Sending Domain", icon: Globe },
      { to: "/settings/api-keys", label: "API Keys",       icon: Code2 },
      { to: "/settings/mcp-server", label: "MCP Server",   icon: Bot },
    ],
  },
  {
    label: "Account",
    sections: [
      { to: "/settings/account",  label: "Account",        icon: User },
    ],
  },
] as const;

function SettingsSideNav() {
  const matchRoute = useMatchRoute();

  return (
    <nav className="w-44 shrink-0">
      <div className="sticky top-6 space-y-5">
        {SETTINGS_GROUPS.map((group) => (
          <div key={group.label}>
            <p className="mb-1 px-2 text-[10px] font-semibold uppercase tracking-[0.1em] text-muted-foreground/40">
              {group.label}
            </p>
            <ul className="space-y-px">
              {group.sections.map(({ to, label, icon: Icon }) => {
                const isActive = !!matchRoute({ to, fuzzy: false });
                return (
                  <li key={to}>
                    <Link
                      to={to}
                      className={cn(
                        "flex w-full items-center gap-2.5 rounded-md px-2 py-1.5 text-[13px] transition-colors duration-100 cursor-pointer",
                        isActive
                          ? "bg-accent text-foreground font-medium"
                          : "text-muted-foreground hover:bg-accent/60 hover:text-foreground"
                      )}
                    >
                      <Icon className={cn("h-3.5 w-3.5 shrink-0", isActive ? "text-foreground" : "text-muted-foreground/50")} />
                      {label}
                    </Link>
                  </li>
                );
              })}
            </ul>
          </div>
        ))}
      </div>
    </nav>
  );
}

function SettingsLayout() {
  return (
    <div className="px-8 py-7 w-full">
      <div className="mb-7">
        <h1 className="text-[15px] font-semibold tracking-tight text-foreground">Settings</h1>
        <p className="mt-0.5 text-[12px] text-muted-foreground">Workspace &amp; account configuration</p>
      </div>
      <div className="flex gap-10">
        <SettingsSideNav />
        <div className="flex-1 min-w-0 max-w-2xl">
          <Outlet />
        </div>
      </div>
    </div>
  );
}
