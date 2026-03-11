/**
 * Post-build script: generate plain .md files from MDX source files.
 *
 * Each MDX file in src/content/**\/*.mdx becomes a dist/**\/*.md
 * with the frontmatter stripped, so LLMs can fetch raw Markdown
 * directly from the same URL paths used in llms.txt.
 *
 * Example:
 *   src/content/getting-started/introduction.mdx
 *   → dist/getting-started/introduction.md
 *   → served at https://openmail.win/docs/getting-started/introduction.md
 */
import { readdir, readFile, writeFile, mkdir } from "fs/promises";
import { join, dirname } from "path";
import { fileURLToPath } from "url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const CONTENT_DIR = join(__dirname, "../src/content");
const DIST_DIR    = join(__dirname, "../dist");

/** Strip YAML frontmatter (---...---) from the top of a file. */
function stripFrontmatter(content) {
  if (!content.startsWith("---")) return content;
  const end = content.indexOf("\n---", 3);
  if (end === -1) return content;
  return content.slice(end + 4).replace(/^\n/, ""); // trim leading newline
}

/** Recursively collect all .mdx files under a directory. */
async function walkMdx(dir) {
  const entries = await readdir(dir, { withFileTypes: true });
  const files = [];
  for (const entry of entries) {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) {
      files.push(...(await walkMdx(full)));
    } else if (entry.name.endsWith(".mdx")) {
      files.push(full);
    }
  }
  return files;
}

async function main() {
  const mdxFiles = await walkMdx(CONTENT_DIR);
  let count = 0;

  for (const file of mdxFiles) {
    const relative = file.slice(CONTENT_DIR.length + 1); // e.g. getting-started/introduction.mdx
    const mdRelative = relative.replace(/\.mdx$/, ".md"); // getting-started/introduction.md
    const outPath = join(DIST_DIR, mdRelative);

    const raw = await readFile(file, "utf-8");
    const md  = stripFrontmatter(raw);

    await mkdir(dirname(outPath), { recursive: true });
    await writeFile(outPath, md, "utf-8");
    count++;
  }

  console.log(`✓ Generated ${count} .md files in dist/`);
}

main().catch((err) => { console.error(err); process.exit(1); });
