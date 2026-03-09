import type { ReactNode } from "react";
import CodeBlock from "./CodeBlock";

function extractText(node: ReactNode): string {
  if (typeof node === "string") return node;
  if (typeof node === "number") return String(node);
  if (Array.isArray(node)) return node.map(extractText).join("");
  if (node && typeof node === "object" && "props" in node) {
    return extractText((node as { props: { children?: ReactNode } }).props.children);
  }
  return "";
}

function Pre({ children, ...props }: { children?: ReactNode; [key: string]: unknown }) {
  const codeEl = children as React.ReactElement<{
    className?: string;
    children?: ReactNode;
  }>;

  if (!codeEl || typeof codeEl !== "object" || !("type" in codeEl)) {
    return <pre {...props}>{children}</pre>;
  }

  const className = codeEl.props?.className ?? "";
  const language = className.replace("language-", "") || "text";
  const code = extractText(codeEl.props?.children);

  // Extract filename from meta if passed as data attr
  const filename = (props["data-filename"] as string | undefined) || undefined;

  return <CodeBlock code={code} language={language} filename={filename} />;
}

function Callout({
  type = "note",
  children,
}: {
  type?: "note" | "warning" | "tip";
  children?: ReactNode;
}) {
  const icon = type === "note" ? "ℹ" : type === "warning" ? "⚠" : "✓";
  return (
    <div className={`callout callout-${type} my-5`}>
      <span className="text-base leading-none mt-0.5 shrink-0">{icon}</span>
      <div className="text-sm leading-relaxed">{children}</div>
    </div>
  );
}

function EndpointBadge({ method, path }: { method: string; path: string }) {
  const m = method.toLowerCase();
  return (
    <div className="flex items-center gap-2 my-4 p-3 rounded-lg bg-white/[0.02] border border-white/[0.04] font-mono text-sm">
      <span className={`method-${m} px-2 py-0.5 rounded text-xs font-semibold uppercase`}>
        {method}
      </span>
      <span className="text-neutral-300 truncate">{path}</span>
    </div>
  );
}

export const mdxComponents = {
  pre: Pre,
  Callout,
  EndpointBadge,
};
