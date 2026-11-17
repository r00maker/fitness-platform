// Builds the marketing site: src/page.html is the page (its head part above <!-- BODY -->),
// wrapped into a full document at dist/index.html. No framework, no bundler: one fast page.
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
const src = readFileSync(new URL("./src/page.html", import.meta.url), "utf8");
const [head, body] = src.split("<!-- BODY -->");
if (!body) throw new Error("src/page.html needs a <!-- BODY --> marker between its head part and its body.");
const html = `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">
${head.trim()}
</head>
<body>
${body.trim()}
</body>
</html>
`;
mkdirSync(new URL("./dist/", import.meta.url), { recursive: true });
writeFileSync(new URL("./dist/index.html", import.meta.url), html);
console.log(`dist/index.html (${(html.length / 1024).toFixed(1)} KB)`);
