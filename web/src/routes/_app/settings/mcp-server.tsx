import { createFileRoute } from "@tanstack/react-router";
import { Link } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { useState, useMemo } from "react";
import { Bot, ExternalLink, Key, Plug, Loader2, Check, X } from "lucide-react";
import { toast } from "sonner";
import { apiFetch, sessionFetch } from "@/lib/api";
import { useWorkspaceStore } from "@/store/workspace";
import { Button } from "@/components/ui/button";
import { SectionCard, SectionHeader, CopyButton, type ApiKey } from "@/components/settings/shared";

export const Route = createFileRoute("/_app/settings/mcp-server")({
  component: McpServerSettingsPage,
});

interface DeploymentConfig {
  apiUrl: string;
  mcpUrl: string;
  docsUrl: string;
  mcp: {
    authScheme: "bearer-api-key" | string;
    keysHref: string;
  };
  version: string;
}

type TestState =
  | { kind: "idle" }
  | { kind: "running" }
  | { kind: "ok"; serverInfo?: { name?: string; version?: string } }
  | { kind: "error"; message: string };

function McpServerSettingsPage() {
  const { activeWorkspaceId } = useWorkspaceStore();

  const { data: config, isLoading: configLoading } = useQuery<DeploymentConfig>({
    queryKey: ["deployment-config"],
    queryFn: () => apiFetch("/api/session/config"),
  });

  const { data: apiKeys = [], isLoading: keysLoading } = useQuery<ApiKey[]>({
    queryKey: ["api-keys", activeWorkspaceId],
    queryFn: () => sessionFetch(activeWorkspaceId!, "/api-keys"),
    enabled: !!activeWorkspaceId,
  });

  // Persist key selection across renders (not yet across visits — could go to
  // workspace store later if needed).
  const [selectedKeyId, setSelectedKeyId] = useState<string | null>(null);
  // Holds the freshly-issued plaintext key when the user creates one. Without
  // this we can never construct a working snippet because /api-keys only
  // returns prefixes for existing keys.
  const [freshKey, setFreshKey] = useState<string | null>(null);
  const [testState, setTestState] = useState<TestState>({ kind: "idle" });

  // The user must have either an existing key (for which we only know the
  // prefix — they paste their stored key) OR a freshly-issued key from this
  // session. Selection model: if freshKey is set, use it; else show prefix
  // selector with placeholder.
  const selectedKey = apiKeys.find((k) => k.id === selectedKeyId) ?? null;
  const credentialForSnippet = freshKey ?? "<your-api-key>";

  const snippet = useMemo(() => {
    if (!config) return "";
    return JSON.stringify(
      {
        mcpServers: {
          openmail: {
            url: config.mcpUrl,
            headers: { Authorization: `Bearer ${credentialForSnippet}` },
          },
        },
      },
      null,
      2,
    );
  }, [config, credentialForSnippet]);

  async function handleTestConnection() {
    if (!config) return;
    if (!freshKey && !selectedKey) {
      toast.error("Choose an API key first or create one to test the connection.");
      return;
    }
    // Prompt for the stored key if user picked an existing-prefix entry but
    // doesn't have the plaintext. Honest UX: api-keys can't be retrieved.
    let keyToUse = freshKey;
    if (!keyToUse && selectedKey) {
      const entered = window.prompt(
        `Paste the full API key for "${selectedKey.name}" (${selectedKey.keyPrefix}…) to test the connection.\n\nKeys are not retrievable — use the one you copied when you created it, or create a new one.`,
      );
      if (!entered) return;
      keyToUse = entered.trim();
    }
    if (!keyToUse) return;

    setTestState({ kind: "running" });
    try {
      const res = await fetch(config.mcpUrl, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Accept: "application/json, text/event-stream",
          Authorization: `Bearer ${keyToUse}`,
        },
        body: JSON.stringify({
          jsonrpc: "2.0",
          id: 1,
          method: "initialize",
          params: {
            protocolVersion: "2024-11-05",
            capabilities: {},
            clientInfo: { name: "openmail-dashboard-test", version: "1.0" },
          },
        }),
      });
      if (!res.ok) {
        setTestState({ kind: "error", message: `MCP server returned HTTP ${res.status}` });
        return;
      }
      const text = await res.text();
      // The MCP server returns SSE-framed JSON-RPC: "event: message\ndata: {...}"
      // Parse the first data line.
      const dataLine = text.split("\n").find((l) => l.startsWith("data: "));
      if (!dataLine) {
        setTestState({ kind: "error", message: "MCP server response was not in expected format." });
        return;
      }
      const parsed = JSON.parse(dataLine.slice(6));
      if (parsed.error) {
        setTestState({ kind: "error", message: parsed.error.message ?? "MCP returned an error" });
        return;
      }
      setTestState({
        kind: "ok",
        serverInfo: parsed.result?.serverInfo,
      });
    } catch (err) {
      setTestState({
        kind: "error",
        message: err instanceof Error ? err.message : "Network error reaching MCP server",
      });
    }
  }

  const noKeys = !keysLoading && apiKeys.length === 0;

  return (
    <div className="space-y-4">
      {/* ── Section 1: How it works ──────────────────────────────────── */}
      <SectionCard>
        <SectionHeader
          icon={Bot}
          title="MCP Server"
          description="Let AI agents (Claude, Cursor, GPT) operate your workspace through natural language"
        />
        <div className="px-5 py-4 space-y-2.5">
          <p className="text-[13px] text-foreground/80 leading-relaxed">
            OpenMail exposes a Model Context Protocol server. Any MCP-compatible AI agent can
            authenticate with a workspace API key and create campaigns, enroll contacts, send
            broadcasts, and pull analytics — all in scope of this workspace.
          </p>
          <p className="text-[12px] text-muted-foreground">
            Capabilities are discovered live by the agent on connect — there's no static list to
            keep in sync.{" "}
            {config && (
              <a
                href={config.docsUrl}
                target="_blank"
                rel="noreferrer"
                className="inline-flex items-center gap-0.5 text-foreground/70 underline-offset-2 hover:underline hover:text-foreground transition-colors"
              >
                Read the MCP docs
                <ExternalLink className="h-2.5 w-2.5" />
              </a>
            )}
          </p>
        </div>
      </SectionCard>

      {/* ── Section 2: Connection details ────────────────────────────── */}
      <SectionCard>
        <SectionHeader icon={Plug} title="Connection details" description="What to point your AI agent at" />
        <div className="divide-y divide-border/60">
          {/* Endpoint URL */}
          <div className="px-5 py-3.5">
            <p className="text-[11px] font-medium uppercase tracking-wide text-muted-foreground/60 mb-1.5">
              Endpoint URL
            </p>
            {configLoading ? (
              <div className="h-5 w-72 rounded shimmer" />
            ) : (
              <div className="flex items-center gap-2">
                <code className="flex-1 truncate rounded border border-border bg-background px-2.5 py-1.5 font-mono text-[12px] text-foreground/90">
                  {config?.mcpUrl}
                </code>
                {config && <CopyButton value={config.mcpUrl} />}
              </div>
            )}
          </div>

          {/* Auth scheme */}
          <div className="px-5 py-3.5">
            <p className="text-[11px] font-medium uppercase tracking-wide text-muted-foreground/60 mb-1.5">
              Authentication
            </p>
            {configLoading ? (
              <div className="h-4 w-48 rounded shimmer" />
            ) : (
              <p className="text-[13px] text-foreground/80">
                {schemeLabel(config?.mcp.authScheme)}{" "}
                <span className="text-muted-foreground">
                  — pass <code className="font-mono text-[11px] text-foreground/70">Authorization: Bearer &lt;key&gt;</code> on every request
                </span>
              </p>
            )}
          </div>

          {/* API key link */}
          <div className="px-5 py-3.5 flex items-center justify-between gap-3">
            <div>
              <p className="text-[11px] font-medium uppercase tracking-wide text-muted-foreground/60 mb-1.5">
                Workspace API key
              </p>
              <p className="text-[13px] text-foreground/80">
                {noKeys ? (
                  <span className="text-muted-foreground">No keys yet — create one to use the MCP server.</span>
                ) : (
                  <>
                    <span className="font-mono text-[12px]">{apiKeys.length}</span>{" "}
                    {apiKeys.length === 1 ? "key" : "keys"} in this workspace
                  </>
                )}
              </p>
            </div>
            <Link to="/settings/api-keys">
              <Button size="sm" variant="outline">
                <Key className="h-3.5 w-3.5" />
                Manage keys
              </Button>
            </Link>
          </div>
        </div>
      </SectionCard>

      {/* ── Section 3: Configuration snippet ─────────────────────────── */}
      <SectionCard>
        <SectionHeader
          icon={Bot}
          title="Configuration snippet"
          description="Paste into Claude Desktop, Cursor, or any MCP-compatible client"
        />
        <div className="px-5 py-4 space-y-3">
          {/* Key picker */}
          {!noKeys && (
            <div className="flex items-center gap-2 text-[12px] text-muted-foreground">
              <span>Use key:</span>
              <select
                value={selectedKeyId ?? ""}
                onChange={(e) => {
                  setSelectedKeyId(e.target.value || null);
                  setFreshKey(null); // unset fresh key when picking an existing one
                  setTestState({ kind: "idle" });
                }}
                className="rounded-md border border-border bg-input px-2 py-1 text-[12px] text-foreground/90 outline-none focus:ring-1 focus:ring-ring/30 cursor-pointer"
              >
                <option value="">(placeholder)</option>
                {apiKeys.map((k) => (
                  <option key={k.id} value={k.id}>
                    {k.name} ({k.keyPrefix}…)
                  </option>
                ))}
              </select>
              {selectedKey && !freshKey && (
                <span className="text-muted-foreground/60">
                  — only the prefix is shown; paste your stored key when prompted to test
                </span>
              )}
            </div>
          )}

          <div className="relative">
            <pre className="overflow-x-auto rounded-lg border border-border bg-background p-3.5 font-mono text-[11px] leading-relaxed text-foreground/85">
              {snippet || ""}
            </pre>
            {snippet && (
              <div className="absolute right-2 top-2">
                <CopyButton value={snippet} />
              </div>
            )}
          </div>

          {/* Test connection */}
          <div className="flex items-center gap-3 pt-1">
            <Button
              size="sm"
              variant="outline"
              onClick={handleTestConnection}
              disabled={!config || testState.kind === "running" || noKeys}
            >
              {testState.kind === "running" ? (
                <>
                  <Loader2 className="h-3.5 w-3.5 animate-spin" />
                  Testing…
                </>
              ) : (
                "Test connection"
              )}
            </Button>
            {testState.kind === "ok" && (
              <span className="inline-flex items-center gap-1.5 text-[12px] text-emerald-400">
                <Check className="h-3.5 w-3.5" />
                Connected
                {testState.serverInfo?.name && (
                  <span className="text-muted-foreground">
                    — {testState.serverInfo.name}
                    {testState.serverInfo.version && ` v${testState.serverInfo.version}`}
                  </span>
                )}
              </span>
            )}
            {testState.kind === "error" && (
              <span className="inline-flex items-center gap-1.5 text-[12px] text-destructive">
                <X className="h-3.5 w-3.5" />
                {testState.message}
              </span>
            )}
          </div>
        </div>
      </SectionCard>
    </div>
  );
}

function schemeLabel(scheme: string | undefined): string {
  switch (scheme) {
    case "bearer-api-key":
      return "Bearer API key";
    default:
      return scheme ?? "—";
  }
}
