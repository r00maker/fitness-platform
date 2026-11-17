// Builds the marketing site. Each file in src/pages/ is one page: its head part (title, description,
// page styles) above <!-- BODY -->, its content below. The build adds the shared styles (src/site.css),
// the header, footer and helpers (src/partials/, src/site.js) and writes:
//   dist/<page>.html           full pages, ready to host as they are
//   dist/artifact/index.html   the home page without the document wrapper (the artifact host adds it),
//   dist/artifact/<page>.html  the other pages as full documents, published beside it
// No framework, no bundler.
import { copyFileSync, existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
const read = (p) => readFileSync(new URL(p, import.meta.url), "utf8");
const css = read("./src/site.css");
const js = read("./src/site.js");
const header = read("./src/partials/header.html");
const footer = read("./src/partials/footer.html");
const close = read("./src/partials/close.html");
const PAGES = ["index", "product", "pricing", "switching"];
const found = readdirSync(new URL("./src/pages/", import.meta.url)).map((f) => f.replace(/\.html$/, ""));
for (const p of PAGES) if (!found.includes(p)) throw new Error(`src/pages/${p}.html is missing.`);

const shared = `<meta name="claude:viewport-fit-sides" content="cover">
<link rel="preconnect" href="https://fonts.googleapis.com">
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Instrument+Sans:wdth,wght@75..100,400..700&family=Manrope:wght@500..700&display=swap">
<style>
${css.trim()}
</style>`;

function parts(name) {
  const src = read(`./src/pages/${name}.html`);
  const [head, body] = src.split("<!-- BODY -->");
  if (!body) throw new Error(`src/pages/${name}.html needs a <!-- BODY --> marker between its head part and its content.`);
  if (!/<title>[^<]+<\/title>/.test(head)) throw new Error(`src/pages/${name}.html needs a <title>.`);
  const nav = header.replace(`data-page="${name}"`, `data-page="${name}" aria-current="page"`);
  const content = body.trim().replace("{{close}}", close.trim());
  // Title first: the artifact host reads the title from the top of the file.
  const title = head.match(/<title>[^<]+<\/title>/)[0];
  return {
    head: `${title}\n${shared}\n${head.replace(title, "").trim()}`,
    body: `${nav.trim()}\n<script>\n${js.trim()}\n</script>\n${content}\n${footer.trim()}`,
  };
}
const full = ({ head, body }) => `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">
${head}
</head>
<body>
${body}
</body>
</html>
`;

mkdirSync(new URL("./dist/artifact/", import.meta.url), { recursive: true });
for (const name of PAGES) {
  const p = parts(name);
  const html = full(p);
  writeFileSync(new URL(`./dist/${name}.html`, import.meta.url), html);
  writeFileSync(new URL(`./dist/artifact/${name}.html`, import.meta.url), name === "index" ? `${p.head}\n${p.body}\n` : html);
  console.log(`dist/${name}.html (${(html.length / 1024).toFixed(1)} KB)`);
}

// The product films and their posters (rendered by media/film/render.mjs), next to the pages.
const media = new URL("./media/out/", import.meta.url);
if (existsSync(media)) {
  const dirs = ["./dist/media/", "./dist/artifact/media/"];
  for (const dir of dirs) mkdirSync(new URL(dir, import.meta.url), { recursive: true });
  const files = readdirSync(media).filter((f) => /^film-.*\.(mp4|webm|jpg)$/.test(f));
  for (const f of files) for (const dir of dirs) copyFileSync(new URL(f, media), new URL(dir + f, import.meta.url));
  console.log(`media: ${files.length} files`);
}
