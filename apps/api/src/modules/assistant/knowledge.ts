/**
 * What the assistant knows about the app: the help guide (docs/help/) and the product notes
 * (docs/PRODUCT_NOTES.md), read once at start-up. Hosting and security docs are left out on
 * purpose: they're for the people running the platform, not for studios.
 */
import { existsSync, readdirSync, readFileSync } from "node:fs";
import path from "node:path";

const FILES = ["help", "PRODUCT_NOTES.md"];
let cached: { dir: string; text: string } | null = null;

function docsDir(configured?: string): string | null {
  const candidates = [configured, path.resolve(process.cwd(), "docs"), path.resolve(process.cwd(), "../../docs")].filter((x): x is string => !!x);
  return candidates.find((d) => existsSync(path.join(d, "PRODUCT_NOTES.md"))) ?? null;
}

/** The whole guide as one block of text, with each file marked so answers can be traced. */
export function knowledge(configured?: string): string {
  const dir = docsDir(configured);
  if (!dir) return "";
  if (cached?.dir === dir) return cached.text;
  const parts: string[] = [];
  for (const f of FILES) {
    const p = path.join(dir, f);
    if (!existsSync(p)) continue;
    const files = f.endsWith(".md") ? [p] : readdirSync(p).filter((x) => x.endsWith(".md")).sort().map((x) => path.join(p, x));
    for (const file of files) parts.push(`<document name="${path.relative(dir, file)}">\n${readFileSync(file, "utf8").trim()}\n</document>`);
  }
  cached = { dir, text: parts.join("\n\n") };
  return cached.text;
}

/**
 * Everything, for our own team's HQ assistant: every doc (product notes, hosting, security,
 * handoff, market, migration and HQ), the studio help guide and the README with the API list.
 */
let platformCached: { dir: string; text: string } | null = null;
export function platformKnowledge(configured?: string): string {
  const dir = docsDir(configured);
  if (!dir) return "";
  if (platformCached?.dir === dir) return platformCached.text;
  const files = [
    ...readdirSync(dir).filter((x) => x.endsWith(".md")).sort().map((x) => path.join(dir, x)),
    ...(existsSync(path.join(dir, "help")) ? readdirSync(path.join(dir, "help")).filter((x) => x.endsWith(".md")).sort().map((x) => path.join(dir, "help", x)) : []),
    path.join(dir, "..", "README.md"),
  ].filter((f) => existsSync(f));
  const text = files.map((file) => `<document name="${path.relative(path.join(dir, ".."), file)}">\n${readFileSync(file, "utf8").trim()}\n</document>`).join("\n\n");
  platformCached = { dir, text };
  return text;
}
