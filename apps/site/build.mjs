// Builds the marketing site. Each file in src/pages/ is one page: its head part (title, description,
// page styles) above <!-- BODY -->, its content below. The build adds the shared styles (src/site.css),
// the header, footer and helpers (src/partials/, src/site.js) and writes:
//   dist/<page>.html           full pages, ready to host as they are
//   dist/artifact/index.html   the home page without the document wrapper (the artifact host adds it),
//   dist/artifact/<page>.html  the other pages as full documents, published beside it
// No framework, no bundler.
import { copyFileSync, existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
const read = (p) => readFileSync(new URL(p, import.meta.url), "utf8");

// Where the free trial signs up (see .env.example). Read from the environment, or from apps/site/.env.
// Left empty, the trial page is a preview that says so.
const fileEnv = existsSync(new URL("./.env", import.meta.url))
  ? Object.fromEntries(read("./.env").split("\n").map((l) => l.trim()).filter((l) => l && !l.startsWith("#") && l.includes("=")).map((l) => [l.slice(0, l.indexOf("=")).trim(), l.slice(l.indexOf("=") + 1).trim().replace(/^["']|["']$/g, "")]))
  : {};
const env = (k) => (process.env[k] ?? fileEnv[k] ?? "").trim();
const trialConf = { api: env("SITE_API_URL"), supabaseUrl: env("SITE_SUPABASE_URL"), supabaseKey: env("SITE_SUPABASE_KEY"), studioApp: env("SITE_STUDIO_APP_URL") };
// The page is public, so only the publishable key may go in it: never the secret or service-role key.
{
  const k = trialConf.supabaseKey;
  let role = null;
  if (k.split(".").length === 3) { try { role = JSON.parse(Buffer.from(k.split(".")[1], "base64url").toString()).role; } catch {} }
  if (/^sb_secret_/.test(k) || role === "service_role") throw new Error("SITE_SUPABASE_KEY is a secret key. Use the project's publishable key (sb_publishable_...), which is made for web pages.");
  if (k && !/^sb_publishable_/.test(k) && role !== "anon") throw new Error("SITE_SUPABASE_KEY should be the project's publishable key (sb_publishable_...).");
  for (const [name, v] of [["SITE_API_URL", trialConf.api], ["SITE_SUPABASE_URL", trialConf.supabaseUrl], ["SITE_STUDIO_APP_URL", trialConf.studioApp]]) {
    if (v && !/^https:\/\/[^\s"<>]+$/.test(v) && !/^http:\/\/(localhost|127\.0\.0\.1)(:\d+)?(\/[^\s"<>]*)?$/.test(v)) throw new Error(`${name} should be an https:// address.`);
  }
  if (trialConf.supabaseUrl && !trialConf.supabaseKey) throw new Error("SITE_SUPABASE_URL is set without SITE_SUPABASE_KEY.");
}
const attr = (v) => v.replace(/&/g, "&amp;").replace(/"/g, "&quot;");
const fillTrial = (body) => body.replace('data-api="" data-supabase-url="" data-supabase-key="" data-studio-app=""',
  `data-api="${attr(trialConf.api.replace(/\/$/, ""))}" data-supabase-url="${attr(trialConf.supabaseUrl.replace(/\/$/, ""))}" data-supabase-key="${attr(trialConf.supabaseKey)}" data-studio-app="${attr(trialConf.studioApp)}"`);
const css = read("./src/site.css");
const js = read("./src/site.js");
const header = read("./src/partials/header.html");
const footer = read("./src/partials/footer.html");
const close = read("./src/partials/close.html");
const PAGES = ["index", "product", "pricing", "switching", "trial"];
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
  const content = fillTrial(body.trim().replace("{{close}}", close.trim()));
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

mkdirSync(new URL(process.env.RENDER ? "./dist/" : "./dist/artifact/", import.meta.url), { recursive: true });
console.log(`free trial: ${trialConf.api && trialConf.supabaseKey ? `live (API ${trialConf.api}, Supabase ${trialConf.supabaseUrl})` : trialConf.api ? `local (API ${trialConf.api}, dev sign-in)` : "preview (set SITE_API_URL and the Supabase settings to switch it on)"}`);
for (const name of PAGES) {
  const p = parts(name);
  const html = full(p);
  writeFileSync(new URL(`./dist/${name}.html`, import.meta.url), html);
  // The artifact copy is for the claude.ai preview; a real host (Render sets RENDER) doesn't need it.
  if (!process.env.RENDER) writeFileSync(new URL(`./dist/artifact/${name}.html`, import.meta.url), name === "index" ? `${p.head}\n${p.body}\n` : html);
  console.log(`dist/${name}.html (${(html.length / 1024).toFixed(1)} KB)`);
}

// The product films, their posters and the stills (media/film/render.mjs, media/stills.mjs), next to the pages.
const media = new URL("./media/out/", import.meta.url);
if (existsSync(media)) {
  const dirs = process.env.RENDER ? ["./dist/media/"] : ["./dist/media/", "./dist/artifact/media/"];
  for (const dir of dirs) mkdirSync(new URL(dir, import.meta.url), { recursive: true });
  const files = readdirSync(media).filter((f) => /^(film|still)-.*\.(mp4|webm|jpg)$/.test(f));
  for (const f of files) for (const dir of dirs) copyFileSync(new URL(f, media), new URL(dir + f, import.meta.url));
  console.log(`media: ${files.length} files`);
}
