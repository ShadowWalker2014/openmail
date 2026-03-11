/**
 * Notion-style WYSIWYG email editor built on Tiptap v3.
 *
 * Features:
 *  - Block type selector (Paragraph / H1-H3 / Code / Quote)
 *  - Text alignment (left / center / right)
 *  - Text color with email-safe color presets
 *  - Bold, Italic, Underline, Strike, inline Code
 *  - Bullet + numbered lists
 *  - Link editing via inline popover (not window.prompt)
 *  - Image upload via assets API (requires workspaceId prop)
 *  - Divider / HR insertion
 *  - Bubble menu for contextual formatting on text selection
 *  - Undo / Redo
 */

import { useEditor, EditorContent } from "@tiptap/react";
import { BubbleMenu } from "@tiptap/react/menus";
import StarterKit from "@tiptap/starter-kit";
import Link from "@tiptap/extension-link";
import Placeholder from "@tiptap/extension-placeholder";
import Underline from "@tiptap/extension-underline";
import Image from "@tiptap/extension-image";
import TextAlign from "@tiptap/extension-text-align";
import { TextStyle } from "@tiptap/extension-text-style";
import Color from "@tiptap/extension-color";
import {
  useEffect, useCallback, useRef, useState,
} from "react";
import { cn } from "@/lib/utils";
import {
  Bold, Italic, UnderlineIcon, Strikethrough, Code,
  AlignLeft, AlignCenter, AlignRight,
  List, ListOrdered,
  Link2, Link2Off, Image as ImageIcon, Minus,
  Quote, Code2, Undo2, Redo2,
  ChevronDown, ExternalLink, Pilcrow,
  Heading1, Heading2, Heading3,
  Type, Check, X,
} from "lucide-react";
import {
  Popover, PopoverContent, PopoverTrigger,
} from "@/components/ui/popover";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import {
  Tooltip, TooltipContent, TooltipTrigger,
} from "@/components/ui/tooltip";
import { sessionFetch } from "@/lib/api";

// ── Types ─────────────────────────────────────────────────────────────────────

interface EmailEditorProps {
  value: string;
  onChange: (html: string) => void;
  placeholder?: string;
  className?: string;
  /** Workspace ID — required for image upload via assets API */
  workspaceId?: string;
  minHeight?: string;
}

// ── Email-safe color palette ───────────────────────────────────────────────────

const TEXT_COLORS = [
  { label: "Default",    value: ""        },
  { label: "Black",      value: "#000000" },
  { label: "Dark gray",  value: "#374151" },
  { label: "Gray",       value: "#6B7280" },
  { label: "Light gray", value: "#9CA3AF" },
  { label: "Red",        value: "#DC2626" },
  { label: "Orange",     value: "#D97706" },
  { label: "Yellow",     value: "#CA8A04" },
  { label: "Green",      value: "#16A34A" },
  { label: "Teal",       value: "#0D9488" },
  { label: "Blue",       value: "#2563EB" },
  { label: "Indigo",     value: "#4F46E5" },
  { label: "Purple",     value: "#7C3AED" },
  { label: "Pink",       value: "#DB2777" },
];

// ── Sub-components ─────────────────────────────────────────────────────────────

interface ToolbarButtonProps {
  onClick: () => void;
  active?: boolean;
  disabled?: boolean;
  title: string;
  children: React.ReactNode;
  className?: string;
}

function TBtn({ onClick, active, disabled, title, children, className }: ToolbarButtonProps) {
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <button
          type="button"
          onMouseDown={(e) => {
            e.preventDefault();
            onClick();
          }}
          disabled={disabled}
          className={cn(
            "flex items-center justify-center w-7 h-7 rounded text-sm transition-colors cursor-pointer shrink-0",
            active
              ? "bg-foreground text-background"
              : "text-muted-foreground hover:bg-accent hover:text-foreground",
            disabled && "opacity-30 cursor-not-allowed pointer-events-none",
            className,
          )}
        >
          {children}
        </button>
      </TooltipTrigger>
      <TooltipContent side="bottom" className="text-xs">{title}</TooltipContent>
    </Tooltip>
  );
}

function Sep() {
  return <div className="w-px h-4 bg-border mx-0.5 shrink-0" />;
}

// ── Block type selector ────────────────────────────────────────────────────────

function BlockTypeSelector({ editor }: { editor: ReturnType<typeof useEditor> }) {
  if (!editor) return null;

  const [open, setOpen] = useState(false);

  const current =
    editor.isActive("heading", { level: 1 }) ? "H1" :
    editor.isActive("heading", { level: 2 }) ? "H2" :
    editor.isActive("heading", { level: 3 }) ? "H3" :
    editor.isActive("codeBlock")             ? "Code" :
    editor.isActive("blockquote")            ? "Quote" :
    "Text";

  const options = [
    { label: "Text",  icon: <Pilcrow className="h-3.5 w-3.5" />,  action: () => editor.chain().focus().setParagraph().run() },
    { label: "H1",    icon: <Heading1 className="h-3.5 w-3.5" />, action: () => editor.chain().focus().toggleHeading({ level: 1 }).run() },
    { label: "H2",    icon: <Heading2 className="h-3.5 w-3.5" />, action: () => editor.chain().focus().toggleHeading({ level: 2 }).run() },
    { label: "H3",    icon: <Heading3 className="h-3.5 w-3.5" />, action: () => editor.chain().focus().toggleHeading({ level: 3 }).run() },
    { label: "Quote", icon: <Quote className="h-3.5 w-3.5" />,    action: () => editor.chain().focus().toggleBlockquote().run() },
    { label: "Code",  icon: <Code2 className="h-3.5 w-3.5" />,   action: () => editor.chain().focus().toggleCodeBlock().run() },
  ];

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <Tooltip>
        <TooltipTrigger asChild>
          <PopoverTrigger asChild>
            <button
              type="button"
              onMouseDown={(e) => e.preventDefault()}
              className="flex items-center gap-1 h-7 px-2 rounded text-xs text-muted-foreground hover:bg-accent hover:text-foreground transition-colors cursor-pointer"
            >
              <Type className="h-3 w-3" />
              <span className="font-medium">{current}</span>
              <ChevronDown className="h-2.5 w-2.5 opacity-50" />
            </button>
          </PopoverTrigger>
        </TooltipTrigger>
        <TooltipContent side="bottom" className="text-xs">Block type</TooltipContent>
      </Tooltip>
      <PopoverContent className="w-36 p-1" align="start">
        {options.map((opt) => (
          <button
            key={opt.label}
            type="button"
            onMouseDown={(e) => {
              e.preventDefault();
              opt.action();
              setOpen(false);
            }}
            className={cn(
              "flex items-center gap-2 w-full px-2 py-1.5 rounded text-sm transition-colors cursor-pointer",
              current === opt.label
                ? "bg-accent text-foreground font-medium"
                : "text-muted-foreground hover:bg-accent hover:text-foreground",
            )}
          >
            {opt.icon}
            {opt.label}
          </button>
        ))}
      </PopoverContent>
    </Popover>
  );
}

// ── Color picker ───────────────────────────────────────────────────────────────

function ColorPicker({ editor }: { editor: ReturnType<typeof useEditor> }) {
  if (!editor) return null;
  const [open, setOpen] = useState(false);
  const current = editor.getAttributes("textStyle").color as string | undefined;

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <Tooltip>
        <TooltipTrigger asChild>
          <PopoverTrigger asChild>
            <button
              type="button"
              onMouseDown={(e) => e.preventDefault()}
              className="flex flex-col items-center justify-center w-7 h-7 rounded transition-colors cursor-pointer text-muted-foreground hover:bg-accent hover:text-foreground"
            >
              <span className="text-[10px] font-bold leading-none">A</span>
              <span
                className="h-[3px] w-4 rounded-full mt-0.5"
                style={{ backgroundColor: current || "#000" }}
              />
            </button>
          </PopoverTrigger>
        </TooltipTrigger>
        <TooltipContent side="bottom" className="text-xs">Text color</TooltipContent>
      </Tooltip>
      <PopoverContent className="w-auto p-2" align="start">
        <div className="grid grid-cols-7 gap-1">
          {TEXT_COLORS.map((c) => (
            <button
              key={c.value}
              type="button"
              title={c.label}
              onMouseDown={(e: React.MouseEvent) => {
                e.preventDefault();
                if (c.value) {
                  editor.chain().focus().setColor(c.value).run();
                } else {
                  editor.chain().focus().unsetColor().run();
                }
                setOpen(false);
              }}
              className={cn(
                "w-5 h-5 rounded-full border transition-transform hover:scale-110 cursor-pointer",
                c.value === "" && "border-border bg-gradient-to-br from-gray-100 to-gray-300",
                current === c.value && "ring-2 ring-offset-1 ring-foreground",
              )}
              style={c.value ? { backgroundColor: c.value, borderColor: c.value } : undefined}
            />
          ))}
        </div>
      </PopoverContent>
    </Popover>
  );
}

// ── Link popover ───────────────────────────────────────────────────────────────

function LinkPopover({ editor }: { editor: ReturnType<typeof useEditor> }) {
  if (!editor) return null;
  const [open, setOpen] = useState(false);
  const [url, setUrl] = useState("");
  const inputRef = useRef<HTMLInputElement>(null);

  const openPopover = useCallback(() => {
    const current = editor.getAttributes("link").href as string || "";
    setUrl(current);
    setOpen(true);
    setTimeout(() => inputRef.current?.focus(), 50);
  }, [editor]);

  const applyLink = useCallback(() => {
    if (!url.trim()) {
      editor.chain().focus().unsetLink().run();
    } else {
      const href = url.startsWith("http") ? url : `https://${url}`;
      editor.chain().focus().setLink({ href, target: "_blank" }).run();
    }
    setOpen(false);
  }, [editor, url]);

  const removeLink = useCallback(() => {
    editor.chain().focus().unsetLink().run();
    setOpen(false);
  }, [editor]);

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <TBtn
        onClick={openPopover}
        active={editor.isActive("link")}
        title="Add / edit link"
      >
        <PopoverTrigger asChild>
          <Link2 className="h-3.5 w-3.5" />
        </PopoverTrigger>
      </TBtn>
      <PopoverContent className="w-72 p-2" align="start" onOpenAutoFocus={(e) => e.preventDefault()}>
        <div className="flex items-center gap-1.5">
          <Input
            ref={inputRef}
            value={url}
            onChange={(e) => setUrl(e.target.value)}
            placeholder="https://example.com"
            className="h-7 text-xs flex-1"
            onKeyDown={(e) => {
              if (e.key === "Enter") { e.preventDefault(); applyLink(); }
              if (e.key === "Escape") setOpen(false);
            }}
          />
          <Button
            size="sm"
            onMouseDown={(e) => { e.preventDefault(); applyLink(); }}
            className="h-7 px-2"
          >
            <Check className="h-3.5 w-3.5" />
          </Button>
          {editor.isActive("link") && (
            <>
              <button
                type="button"
                title="Open link"
                onMouseDown={(e) => {
                  e.preventDefault();
                  const href = editor.getAttributes("link").href as string;
                  if (href) window.open(href, "_blank", "noopener");
                }}
                className="flex items-center justify-center w-7 h-7 rounded text-muted-foreground hover:text-foreground hover:bg-accent transition-colors cursor-pointer"
              >
                <ExternalLink className="h-3.5 w-3.5" />
              </button>
              <button
                type="button"
                title="Remove link"
                onMouseDown={(e) => { e.preventDefault(); removeLink(); }}
                className="flex items-center justify-center w-7 h-7 rounded text-muted-foreground hover:text-destructive hover:bg-accent transition-colors cursor-pointer"
              >
                <X className="h-3.5 w-3.5" />
              </button>
            </>
          )}
        </div>
      </PopoverContent>
    </Popover>
  );
}

// ── Main component ─────────────────────────────────────────────────────────────

export function EmailEditor({
  value,
  onChange,
  placeholder = "Start writing your email content…",
  className,
  workspaceId,
  minHeight = "240px",
}: EmailEditorProps) {
  const onChangeRef = useRef(onChange);
  onChangeRef.current = onChange;

  const fileInputRef = useRef<HTMLInputElement>(null);
  const [uploading, setUploading] = useState(false);

  const editor = useEditor({
    immediatelyRender: false,
    extensions: [
      StarterKit.configure({
        heading: { levels: [1, 2, 3] },
      }),
      Underline,
      TextStyle,
      Color,
      TextAlign.configure({ types: ["heading", "paragraph"] }),
      Link.configure({
        openOnClick: false,
        HTMLAttributes: {
          class: "text-primary underline underline-offset-2 cursor-pointer",
          target: "_blank",
          rel: "noopener noreferrer",
        },
      }),
      Image.configure({
        HTMLAttributes: {
          class: "max-w-full rounded my-2",
        },
      }),
      Placeholder.configure({
        placeholder,
        emptyEditorClass:
          "before:content-[attr(data-placeholder)] before:text-muted-foreground before:absolute before:opacity-50 before:pointer-events-none",
      }),
    ],
    content: value || "",
    editable: true,
    editorProps: {
      attributes: {
        class: cn(
          "prose prose-sm dark:prose-invert max-w-none focus:outline-none px-4 py-3",
          "prose-p:my-1.5 prose-ul:my-1.5 prose-ol:my-1.5 prose-li:my-0.5",
          "[&_ul]:list-disc [&_ul]:pl-6 [&_ol]:list-decimal [&_ol]:pl-6",
          "prose-headings:font-semibold prose-h1:text-2xl prose-h2:text-xl prose-h3:text-lg",
          "prose-blockquote:border-l-2 prose-blockquote:border-border prose-blockquote:pl-4 prose-blockquote:italic prose-blockquote:text-muted-foreground",
          "prose-code:bg-muted prose-code:px-1 prose-code:py-0.5 prose-code:rounded prose-code:text-xs prose-code:font-mono",
          "prose-pre:bg-muted prose-pre:rounded-md",
          "prose-a:text-primary prose-a:underline prose-a:underline-offset-2",
          "prose-hr:border-border",
          "[&_.tiptap-image]:max-w-full",
        ),
      },
    },
    onUpdate: ({ editor }) => {
      const html = editor.getHTML();
      onChangeRef.current(html === "<p></p>" ? "" : html);
    },
  });

  // Sync external value changes (e.g. mode switch from HTML → visual)
  useEffect(() => {
    if (!editor) return;
    const currentHtml = editor.getHTML();
    const normalized = value || "";
    const currentNormalized = currentHtml === "<p></p>" ? "" : currentHtml;
    if (normalized !== currentNormalized) {
      editor.commands.setContent(value || "");
    }
  }, [editor, value]);

  // ── Image upload ─────────────────────────────────────────────────────────────

  const handleImageUpload = useCallback(async (file: File) => {
    if (!workspaceId || !editor) return;
    setUploading(true);
    const resp = await sessionFetch(workspaceId, "assets/upload-url", {
      method: "POST",
      body: JSON.stringify({ name: file.name, mimeType: file.type, fileSize: file.size }),
    }) as Response;
    const { uploadUrl, proxyUrl } = await resp.json() as { uploadUrl: string; proxyUrl: string };
    await fetch(uploadUrl, { method: "PUT", body: file, headers: { "Content-Type": file.type } });
    editor.chain().focus().setImage({ src: proxyUrl, alt: file.name }).run();
    setUploading(false);
  }, [workspaceId, editor]);

  if (!editor) return null;

  return (
    <div className={cn("flex flex-col border border-input rounded-md overflow-hidden bg-background", className)}>
      {/* ── Toolbar ─────────────────────────────────────────────────────────── */}
      <div className="flex items-center gap-0.5 flex-wrap px-2 py-1.5 border-b border-border bg-muted/20 min-h-[40px]">

        {/* Block type */}
        <BlockTypeSelector editor={editor} />
        <Sep />

        {/* Inline formatting */}
        <TBtn onClick={() => editor.chain().focus().toggleBold().run()}        active={editor.isActive("bold")}      title="Bold (⌘B)"><Bold className="h-3.5 w-3.5" /></TBtn>
        <TBtn onClick={() => editor.chain().focus().toggleItalic().run()}      active={editor.isActive("italic")}    title="Italic (⌘I)"><Italic className="h-3.5 w-3.5" /></TBtn>
        <TBtn onClick={() => editor.chain().focus().toggleUnderline().run()}   active={editor.isActive("underline")} title="Underline (⌘U)"><UnderlineIcon className="h-3.5 w-3.5" /></TBtn>
        <TBtn onClick={() => editor.chain().focus().toggleStrike().run()}      active={editor.isActive("strike")}    title="Strikethrough"><Strikethrough className="h-3.5 w-3.5" /></TBtn>
        <TBtn onClick={() => editor.chain().focus().toggleCode().run()}        active={editor.isActive("code")}      title="Inline code"><Code className="h-3.5 w-3.5" /></TBtn>
        <Sep />

        {/* Alignment */}
        <TBtn onClick={() => editor.chain().focus().setTextAlign("left").run()}   active={editor.isActive({ textAlign: "left" })}   title="Align left"><AlignLeft className="h-3.5 w-3.5" /></TBtn>
        <TBtn onClick={() => editor.chain().focus().setTextAlign("center").run()} active={editor.isActive({ textAlign: "center" })} title="Align center"><AlignCenter className="h-3.5 w-3.5" /></TBtn>
        <TBtn onClick={() => editor.chain().focus().setTextAlign("right").run()}  active={editor.isActive({ textAlign: "right" })}  title="Align right"><AlignRight className="h-3.5 w-3.5" /></TBtn>
        <Sep />

        {/* Color */}
        <ColorPicker editor={editor} />
        <Sep />

        {/* Lists */}
        <TBtn onClick={() => editor.chain().focus().toggleBulletList().run()}  active={editor.isActive("bulletList")}  title="Bullet list"><List className="h-3.5 w-3.5" /></TBtn>
        <TBtn onClick={() => editor.chain().focus().toggleOrderedList().run()} active={editor.isActive("orderedList")} title="Numbered list"><ListOrdered className="h-3.5 w-3.5" /></TBtn>
        <Sep />

        {/* Insert */}
        <LinkPopover editor={editor} />

        {workspaceId && (
          <Tooltip>
            <TooltipTrigger asChild>
              <button
                type="button"
                disabled={uploading}
                onMouseDown={(e) => { e.preventDefault(); fileInputRef.current?.click(); }}
                className={cn(
                  "flex items-center justify-center w-7 h-7 rounded text-sm transition-colors cursor-pointer text-muted-foreground hover:bg-accent hover:text-foreground",
                  uploading && "opacity-50 cursor-wait pointer-events-none",
                )}
              >
                <ImageIcon className="h-3.5 w-3.5" />
              </button>
            </TooltipTrigger>
            <TooltipContent side="bottom" className="text-xs">Insert image</TooltipContent>
          </Tooltip>
        )}

        <TBtn
          onClick={() => editor.chain().focus().setHorizontalRule().run()}
          title="Divider"
        >
          <Minus className="h-3.5 w-3.5" />
        </TBtn>

        {editor.isActive("link") && (
          <TBtn
            onClick={() => editor.chain().focus().unsetLink().run()}
            title="Remove link"
          >
            <Link2Off className="h-3.5 w-3.5" />
          </TBtn>
        )}
        <Sep />

        {/* History */}
        <TBtn onClick={() => editor.chain().focus().undo().run()} disabled={!editor.can().undo()} title="Undo (⌘Z)"><Undo2 className="h-3.5 w-3.5" /></TBtn>
        <TBtn onClick={() => editor.chain().focus().redo().run()} disabled={!editor.can().redo()} title="Redo (⌘⇧Z)"><Redo2 className="h-3.5 w-3.5" /></TBtn>
      </div>

      {/* ── Bubble menu (appears on text selection) ──────────────────────────── */}
      <BubbleMenu
        editor={editor}
        className="flex items-center gap-0.5 bg-popover border border-border rounded-md shadow-md px-1.5 py-1"
      >
        <button type="button" onMouseDown={(e) => { e.preventDefault(); editor.chain().focus().toggleBold().run(); }}
          className={cn("flex items-center justify-center w-6 h-6 rounded text-xs transition-colors cursor-pointer", editor.isActive("bold") ? "bg-foreground text-background" : "text-muted-foreground hover:bg-accent hover:text-foreground")}>
          <Bold className="h-3 w-3" />
        </button>
        <button type="button" onMouseDown={(e) => { e.preventDefault(); editor.chain().focus().toggleItalic().run(); }}
          className={cn("flex items-center justify-center w-6 h-6 rounded text-xs transition-colors cursor-pointer", editor.isActive("italic") ? "bg-foreground text-background" : "text-muted-foreground hover:bg-accent hover:text-foreground")}>
          <Italic className="h-3 w-3" />
        </button>
        <button type="button" onMouseDown={(e) => { e.preventDefault(); editor.chain().focus().toggleUnderline().run(); }}
          className={cn("flex items-center justify-center w-6 h-6 rounded text-xs transition-colors cursor-pointer", editor.isActive("underline") ? "bg-foreground text-background" : "text-muted-foreground hover:bg-accent hover:text-foreground")}>
          <UnderlineIcon className="h-3 w-3" />
        </button>
        <button type="button" onMouseDown={(e) => { e.preventDefault(); editor.chain().focus().toggleStrike().run(); }}
          className={cn("flex items-center justify-center w-6 h-6 rounded text-xs transition-colors cursor-pointer", editor.isActive("strike") ? "bg-foreground text-background" : "text-muted-foreground hover:bg-accent hover:text-foreground")}>
          <Strikethrough className="h-3 w-3" />
        </button>
        <div className="w-px h-4 bg-border mx-0.5" />
        <button type="button" onMouseDown={(e) => {
          e.preventDefault();
          const prev = editor.getAttributes("link").href as string || "";
          const url = window.prompt("URL:", prev || "https://");
          if (url === null) return;
          if (!url) { editor.chain().focus().unsetLink().run(); return; }
          editor.chain().focus().setLink({ href: url.startsWith("http") ? url : `https://${url}`, target: "_blank" }).run();
        }}
          className={cn("flex items-center justify-center w-6 h-6 rounded text-xs transition-colors cursor-pointer", editor.isActive("link") ? "bg-foreground text-background" : "text-muted-foreground hover:bg-accent hover:text-foreground")}>
          <Link2 className="h-3 w-3" />
        </button>
      </BubbleMenu>

      {/* ── Editor content area ──────────────────────────────────────────────── */}
      <EditorContent
        editor={editor}
        className="flex-1 overflow-y-auto"
        style={{ minHeight }}
      />

      {/* Hidden file input for image upload */}
      <input
        ref={fileInputRef}
        type="file"
        accept="image/jpeg,image/png,image/gif,image/webp,image/svg+xml"
        className="hidden"
        onChange={(e) => {
          const file = e.target.files?.[0];
          if (file) handleImageUpload(file);
          e.target.value = "";
        }}
      />
    </div>
  );
}
