// Builds the Skedoo help centre: the articles in docs/help/centre/*.md become one page with the
// search built in, plus the screenshots next to it.
//   dist/index.html   the page (served by the API at /help/ to signed-in studio staff only)
//   dist/img/         the screenshots
// Each article starts with a block like:  ---  id / title / category / summary / keywords  ---
// No framework, no dependencies.
import { copyFileSync, existsSync, mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const src = path.resolve(here, "../../docs/help/centre");
const out = path.join(here, "dist");

const CATEGORIES = [
  ["Getting started", "Find your way around and get set up."],
  ["Day to day", "Classes, bookings, check-in, cover and closures."],
  ["Clients & packages", "Packages, memberships, clients, reviews and feedback."],
  ["Money", "Sales, refunds, fees, online payments and the shop."],
  ["Growth", "Telling clients, automations, reports, your booking page and app."],
  ["AI", "Ask, Write with AI and celebrations."],
  ["Setup", "Studio rules, class types and templates."],
  ["Troubleshooting", "Something not working? Start here."],
];

// --- Read the articles --------------------------------------------------------------------------
function parse(file) {
  const text = readFileSync(file, "utf8").replace(/\r\n/g, "\n");
  return text.split(/^---\n(?=id: )/m).filter((s) => s.trim()).map((chunk) => {
    const end = chunk.indexOf("\n---\n");
    if (end < 0) throw new Error(`${path.basename(file)}: an article's header isn't closed with ---`);
    const meta = Object.fromEntries(chunk.slice(0, end).split("\n").filter(Boolean).map((l) => [l.slice(0, l.indexOf(":")).trim(), l.slice(l.indexOf(":") + 1).trim()]));
    for (const k of ["id", "title", "category", "summary"]) if (!meta[k]) throw new Error(`${path.basename(file)}: an article is missing "${k}"`);
    if (!CATEGORIES.some(([c]) => c === meta.category)) throw new Error(`${meta.id}: unknown category "${meta.category}"`);
    return { ...meta, keywords: (meta.keywords ?? "").split(",").map((k) => k.trim()).filter(Boolean), body: chunk.slice(end + 5).trim(), file: path.basename(file) };
  });
}
const articles = readdirSync(src).filter((f) => f.endsWith(".md")).sort().flatMap((f) => parse(path.join(src, f)));
const ids = new Set();
for (const a of articles) { if (ids.has(a.id)) throw new Error(`Two articles are called "${a.id}"`); ids.add(a.id); }

// --- A small Markdown renderer (headings, lists, tables, images, links, bold, code) ------------
const esc = (s) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
const images = new Set();
function inline(s, id) {
  return esc(s)
    .replace(/`([^`]+)`/g, "<code>$1</code>")
    .replace(/\*\*([^*]+)\*\*/g, "<strong>$1</strong>")
    .replace(/\[([^\]]+)\]\(#([a-z0-9-]+)\)/g, (_, t, ref) => {
      if (!ids.has(ref)) throw new Error(`${id}: links to "#${ref}", which isn't an article`);
      return `<a href="#${ref}" data-article="${ref}">${t}</a>`;
    })
    .replace(/\[([^\]]+)\]\((https?:[^)\s]+)\)/g, '<a href="$2" target="_blank" rel="noopener">$1</a>');
}
function render(md, id) {
  const lines = md.split("\n");
  const html = [];
  let i = 0;
  const listAt = (l) => l.match(/^(\s*)(-|\d+\.)\s+(.*)$/);
  while (i < lines.length) {
    const line = lines[i];
    if (!line.trim()) { i++; continue; }
    let m;
    if ((m = line.match(/^(#{2,3})\s+(.*)$/))) { const lvl = m[1].length; html.push(`<h${lvl}>${inline(m[2], id)}</h${lvl}>`); i++; continue; }
    if ((m = line.match(/^!\[([^\]]*)\]\(([^)\s]+)(?:\s+"([^"]*)")?\)$/))) {
      const file = m[2];
      if (!existsSync(path.join(src, file))) throw new Error(`${id}: image ${file} is missing (run apps/help/screens.mjs)`);
      images.add(file);
      html.push(`<figure><button type="button" class="zoom" aria-label="Enlarge: ${esc(m[1])}"><img src="${esc(file)}" alt="${esc(m[1])}" loading="lazy"></button><figcaption>${inline(m[1], id)}${m[3] ? ` <span>${inline(m[3], id)}</span>` : ""}</figcaption></figure>`);
      i++; continue;
    }
    if (line.startsWith("|")) {
      const rows = [];
      while (i < lines.length && lines[i].startsWith("|")) { rows.push(lines[i].trim().replace(/^\||\|$/g, "").split("|").map((c) => c.trim())); i++; }
      const [head, , ...body] = rows;
      html.push(`<div class="table"><table><thead><tr>${head.map((c) => `<th scope="col">${inline(c, id)}</th>`).join("")}</tr></thead><tbody>${body.map((r) => `<tr>${r.map((c, k) => (k === 0 ? `<th scope="row">${inline(c, id)}</th>` : `<td>${inline(c, id)}</td>`)).join("")}</tr>`).join("")}</tbody></table></div>`);
      continue;
    }
    if (listAt(line)) {
      // A list, with one level of nesting (indented items belong to the item above).
      const build = (indent) => {
        const first = listAt(lines[i]);
        const tag = /\d/.test(first[2]) ? "ol" : "ul";
        const items = [];
        while (i < lines.length) {
          const l = listAt(lines[i]);
          if (!l || l[1].length !== indent) break;
          let text = l[3]; i++;
          while (i < lines.length && lines[i].trim() && !listAt(lines[i]) && /^\s+/.test(lines[i])) { text += " " + lines[i].trim(); i++; }
          let sub = "";
          if (i < lines.length && listAt(lines[i]) && listAt(lines[i])[1].length > indent) sub = build(listAt(lines[i])[1].length);
          items.push(`<li>${inline(text, id)}${sub}</li>`);
        }
        return `<${tag}>${items.join("")}</${tag}>`;
      };
      html.push(build(listAt(line)[1].length));
      continue;
    }
    let para = line.trim(); i++;
    while (i < lines.length && lines[i].trim() && !/^(#{2,3}\s|!\[|\||\s*(-|\d+\.)\s)/.test(lines[i])) { para += " " + lines[i].trim(); i++; }
    html.push(`<p>${inline(para, id)}</p>`);
  }
  return html.join("\n");
}
const plain = (md) => md.replace(/!\[[^\]]*\]\([^)]*\)/g, " ").replace(/\[([^\]]+)\]\([^)]*\)/g, "$1").replace(/[*`#|>]/g, " ").replace(/\s+/g, " ").trim();

const data = articles.map((a) => ({
  id: a.id, title: a.title, category: a.category, summary: a.summary, keywords: a.keywords,
  headings: [...a.body.matchAll(/^#{2,3}\s+(.*)$/gm)].map((m) => m[1]),
  html: render(a.body, a.id), text: plain(a.body),
}));

// --- The page -----------------------------------------------------------------------------------
const page = readFileSync(path.join(here, "page.html"), "utf8")
  .replace("/*CATEGORIES*/[]", JSON.stringify(CATEGORIES))
  .replace("/*ARTICLES*/[]", JSON.stringify(data).replace(/</g, "\\u003c"))
  .replace("{{count}}", String(data.length));
rmSync(out, { recursive: true, force: true });
mkdirSync(path.join(out, "img"), { recursive: true });
writeFileSync(path.join(out, "index.html"), page);
for (const f of images) copyFileSync(path.join(src, f), path.join(out, f));
// A copy for publishing the preview on claude.ai (a private page): the same page without its
// document wrapper, which the host adds, with the screenshots beside it.
const head = page.slice(page.indexOf("<head>") + 6, page.indexOf("</head>")).replace(/<meta charset[^>]*>\s*|<meta name="viewport"[^>]*>\s*/g, "").trim();
const title = head.match(/<title>[^<]*<\/title>/)[0];
const body = page.slice(page.indexOf("<body>") + 6, page.indexOf("</body>")).trim();
mkdirSync(path.join(out, "artifact", "img"), { recursive: true });
writeFileSync(path.join(out, "artifact", "index.html"), `${title}\n${head.replace(title, "").trim()}\n${body}\n`);
for (const f of images) copyFileSync(path.join(src, f), path.join(out, "artifact", f));
console.log(`help centre: ${data.length} articles in ${CATEGORIES.length} sections, ${images.size} screenshots (${(page.length / 1024).toFixed(0)} KB)`);
