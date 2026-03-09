import type { Config } from "tailwindcss";
import typography from "@tailwindcss/typography";

export default {
  content: ["./index.html", "./src/**/*.{ts,tsx,mdx}"],
  theme: {
    extend: {
      fontFamily: {
        sans: ["Inter", "system-ui", "-apple-system", "sans-serif"],
        mono: ['"JetBrains Mono"', '"Fira Code"', "monospace"],
      },
      colors: {
        brand: "#8b5cf6",
      },
      typography: () => ({
        DEFAULT: {
          css: {
            "--tw-prose-body": "rgb(212 212 212)",
            "--tw-prose-headings": "rgb(245 245 245)",
            "--tw-prose-lead": "rgb(163 163 163)",
            "--tw-prose-links": "rgb(167 139 250)",
            "--tw-prose-bold": "rgb(245 245 245)",
            "--tw-prose-counters": "rgb(163 163 163)",
            "--tw-prose-bullets": "rgb(82 82 82)",
            "--tw-prose-hr": "rgba(255 255 255 / 0.06)",
            "--tw-prose-quotes": "rgb(245 245 245)",
            "--tw-prose-quote-borders": "rgb(139 92 246)",
            "--tw-prose-captions": "rgb(163 163 163)",
            "--tw-prose-code": "rgb(245 245 245)",
            "--tw-prose-pre-code": "rgb(212 212 212)",
            "--tw-prose-pre-bg": "rgb(23 23 23)",
            "--tw-prose-th-borders": "rgba(255 255 255 / 0.06)",
            "--tw-prose-td-borders": "rgba(255 255 255 / 0.04)",
            maxWidth: "none",
            "code::before": { content: '""' },
            "code::after": { content: '""' },
            "a": {
              textDecoration: "none",
              fontWeight: "normal",
              "&:hover": { textDecoration: "underline" },
            },
            "h1,h2,h3,h4": {
              fontWeight: "600",
              letterSpacing: "-0.02em",
            },
            "h2": {
              marginTop: "2.5rem",
              marginBottom: "1rem",
              paddingBottom: "0.75rem",
              borderBottom: "1px solid rgba(255 255 255 / 0.06)",
            },
            "pre": {
              background: "rgb(15 15 15) !important",
              border: "1px solid rgba(255 255 255 / 0.06)",
              borderRadius: "0.5rem",
            },
            "table": {
              border: "1px solid rgba(255 255 255 / 0.06)",
              borderRadius: "0.5rem",
              overflow: "hidden",
            },
          },
        },
      }),
    },
  },
  plugins: [typography],
} satisfies Config;
