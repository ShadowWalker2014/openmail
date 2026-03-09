/// <reference types="vite/client" />

declare module "*.mdx" {
  export const frontmatter: {
    title: string;
    description?: string;
    [key: string]: unknown;
  };
  export default function MDXContent(props: Record<string, unknown>): JSX.Element;
}
