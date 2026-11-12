/**
 * The email builder's output: blocks → email-safe HTML (tables and inline styles, which every
 * inbox understands) plus a plain-text version.
 *
 * Safety: designs never contain HTML. Every piece of text is escaped, links must be http(s) or
 * mailto, and images come only from the studio's own uploads. Personal details ({{first_name}}…)
 * are escaped when they're filled in.
 */
import { and, eq, inArray, isNull } from "drizzle-orm";
import { MERGE_TAGS, describePackage, type EmailBlock, type EmailDesign, type MergeTag } from "@studio/shared";
import type { DbOrTx } from "../../db/client.js";
import { classTypes, files, packagePlans } from "../../db/schema.js";
import { badRequest } from "../../lib/errors.js";
import { money } from "../bookings/rules.js";
import { publicFileUrl } from "../files/routes.js";

export type MergeValues = Partial<Record<MergeTag, string>>;
type PlanInfo = { id: string; name: string; description: string | null; price: string; terms: string[]; photoFileId: string | null };
export interface RenderContext {
  studioName: string;
  publicApiUrl: string;
  appUrl: string;
  values: MergeValues;
  plans: Map<string, PlanInfo>;
  /** Marketing emails: the unsubscribe link (required). Service emails: null. */
  unsubscribeUrl: string | null;
}

const esc = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/'/g, "&#39;");
const TAG_RE = /\{\{\s*([a-z_]+)\s*\}\}/g;
const isSafeUrl = (u: string) => /^(https?:\/\/|mailto:)/i.test(u);

/** Tags used in a design that we don't know about (so typos are caught when saving). */
export function unknownTags(design: EmailDesign): string[] {
  const found = new Set<string>();
  const scan = (s: string | undefined) => { for (const m of (s ?? "").matchAll(TAG_RE)) if (!(m[1]! in MERGE_TAGS)) found.add(m[1]!); };
  scan(design.subject);
  scan(design.preheader);
  const walk = (blocks: EmailBlock[]) =>
    blocks.forEach((b) => {
      if (b.type === "heading" || b.type === "text") scan(b.text);
      if (b.type === "button") { scan(b.label); scan(b.url); }
      if (b.type === "columns") b.columns.forEach((c) => walk(c as EmailBlock[]));
    });
  walk(design.blocks);
  return [...found];
}

/** Fill in {{tags}} (plain text: not escaped). */
export const fillPlain = (s: string, v: MergeValues) => s.replace(TAG_RE, (_, k: string) => v[k as MergeTag] ?? "");
/** Fill in {{tags}} in text that's already been escaped. */
const fillHtml = (s: string, v: MergeValues) => s.replace(TAG_RE, (_, k: string) => esc(v[k as MergeTag] ?? ""));

/** **bold**, *italic*, [text](url) and line breaks, on top of escaped text. */
function inline(raw: string, v: MergeValues, linkColor: string): string {
  let s = esc(raw);
  s = s.replace(/\[([^\]]{1,200})\]\(([^)\s]{1,2000})\)/g, (_, text: string, url: string) => {
    const u = fillPlain(url.replace(/&amp;/g, "&"), v);
    return isSafeUrl(u) ? `<a href="${esc(u)}" style="color:${linkColor};text-decoration:underline">${text}</a>` : text;
  });
  s = s.replace(/\*\*([^*]+)\*\*/g, "<strong>$1</strong>").replace(/(^|[^*])\*([^*\n]+)\*/g, "$1<em>$2</em>");
  return fillHtml(s, v).replace(/\r?\n/g, "<br>");
}
const plainInline = (raw: string, v: MergeValues) => fillPlain(raw.replace(/\[([^\]]+)\]\(([^)\s]+)\)/g, (_, t: string, u: string) => `${t} (${fillPlain(u, v)})`).replace(/\*\*([^*]+)\*\*/g, "$1").replace(/\*([^*]+)\*/g, "$1"), v);

const FONTS = { sans: "Helvetica, Arial, sans-serif", serif: "Georgia, 'Times New Roman', serif", rounded: "'Trebuchet MS', 'Segoe UI', Helvetica, Arial, sans-serif" } as const;
const RADIUS = { rounded: "8px", pill: "999px", square: "0" } as const;

export function renderEmail(design: EmailDesign, ctx: RenderContext): { subject: string; preheader: string; html: string; text: string } {
  const t = design.theme;
  const v = { ...ctx.values, studio_name: ctx.studioName };
  const font = FONTS[t.font];
  const img = (id: string) => publicFileUrl(ctx.publicApiUrl, id);
  const text: string[] = [];

  const block = (b: EmailBlock, inner = false): string => {
    const pad = inner ? "8px 0" : "8px 32px";
    switch (b.type) {
      case "heading": {
        text.push(fillPlain(b.text, v), "");
        const size = b.level === 1 ? 26 : 20;
        return `<tr><td style="padding:${pad};text-align:${b.align};font-family:${font};font-size:${size}px;line-height:1.25;font-weight:700;color:${t.text}">${fillHtml(esc(b.text), v)}</td></tr>`;
      }
      case "text":
        text.push(plainInline(b.text, v), "");
        return `<tr><td style="padding:${pad};text-align:${b.align};font-family:${font};font-size:16px;line-height:1.55;color:${t.text}">${inline(b.text, v, t.accent)}</td></tr>`;
      case "image": {
        const w = inner ? 260 : { full: 536, medium: 360, small: 200 }[b.width];
        const tag = `<img src="${esc(img(b.fileId))}" width="${w}" alt="${esc(b.alt)}" style="display:block;width:100%;max-width:${w}px;height:auto;border:0;${b.align === "center" ? "margin:0 auto;" : b.align === "right" ? "margin-left:auto;" : ""}">`;
        const link = b.link ? fillPlain(b.link, v) : null;
        if (b.alt) text.push(`[${b.alt}]`);
        return `<tr><td style="padding:${pad}" align="${b.align}">${link && isSafeUrl(link) ? `<a href="${esc(link)}">${tag}</a>` : tag}</td></tr>`;
      }
      case "button": {
        const url = fillPlain(b.url, v);
        if (!isSafeUrl(url)) return "";
        text.push(`${fillPlain(b.label, v)}: ${url}`, "");
        const filled = b.style === "filled";
        return `<tr><td style="padding:${inner ? "8px 0" : "12px 32px"}" align="${b.align}"><table role="presentation" cellpadding="0" cellspacing="0" border="0"><tr><td style="border-radius:${RADIUS[t.buttonShape]};background:${filled ? t.accent : "transparent"};border:2px solid ${t.accent}"><a href="${esc(url)}" style="display:inline-block;padding:12px 24px;font-family:${font};font-size:16px;font-weight:700;color:${filled ? contrastOn(t.accent) : t.accent};text-decoration:none;border-radius:${RADIUS[t.buttonShape]}">${fillHtml(esc(b.label), v)}</a></td></tr></table></td></tr>`;
      }
      case "divider":
        text.push("———", "");
        return `<tr><td style="padding:16px 32px"><div style="height:1px;line-height:1px;background:${mix(t.text, t.content, 0.15)}">&nbsp;</div></td></tr>`;
      case "spacer":
        return `<tr><td style="height:${b.height}px;line-height:${b.height}px;font-size:1px">&nbsp;</td></tr>`;
      case "package": {
        const p = ctx.plans.get(b.planId);
        if (!p) return "";
        const url = `${ctx.appUrl.replace(/\/$/, "")}/packages/${p.id}`;
        text.push(`${p.name} — ${p.price}`, ...p.terms.map((x) => `• ${x}`), `${b.buttonLabel}: ${url}`, "");
        return `<tr><td style="padding:8px 32px"><table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="border:1px solid ${mix(t.text, t.content, 0.15)};border-radius:12px"><tr><td style="padding:18px 20px;font-family:${font};color:${t.text}">
          ${p.photoFileId ? `<img src="${esc(img(p.photoFileId))}" width="496" alt="" style="display:block;width:100%;max-width:496px;height:auto;border:0;border-radius:8px;margin-bottom:12px">` : ""}
          <div style="font-size:18px;font-weight:700">${esc(p.name)}</div>
          <div style="font-size:22px;font-weight:700;color:${t.accent};margin:4px 0 8px">${esc(p.price)}</div>
          ${p.description ? `<div style="font-size:15px;line-height:1.5;margin-bottom:8px">${esc(p.description)}</div>` : ""}
          <div style="font-size:14px;line-height:1.6;opacity:.85">${p.terms.map((x) => `• ${esc(x)}`).join("<br>")}</div>
          <div style="padding-top:14px"><a href="${esc(url)}" style="display:inline-block;padding:10px 20px;background:${t.accent};color:${contrastOn(t.accent)};font-weight:700;text-decoration:none;border-radius:${RADIUS[t.buttonShape]}">${esc(b.buttonLabel)}</a></div>
        </td></tr></table></td></tr>`;
      }
      case "social": {
        const names = { instagram: "Instagram", facebook: "Facebook", tiktok: "TikTok", youtube: "YouTube", website: "Website" } as const;
        const links = (Object.keys(names) as (keyof typeof names)[]).filter((k) => b.links[k] && isSafeUrl(b.links[k]!));
        if (!links.length) return "";
        text.push(links.map((k) => `${names[k]}: ${b.links[k]}`).join("\n"), "");
        return `<tr><td style="padding:12px 32px;text-align:${b.align};font-family:${font};font-size:14px">${links.map((k) => `<a href="${esc(b.links[k]!)}" style="color:${t.accent};font-weight:700;text-decoration:none;margin:0 8px">${names[k]}</a>`).join(" ")}</td></tr>`;
      }
      case "columns":
        return `<tr><td style="padding:8px 24px"><table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0"><tr>${b.columns
          .map((col) => `<td class="col" width="50%" valign="top" style="padding:0 8px"><table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0">${(col as EmailBlock[]).map((x) => block(x, true)).join("")}</table></td>`)
          .join("")}</tr></table></td></tr>`;
    }
  };

  const body = design.blocks.map((b) => block(b)).join("");
  const subject = fillPlain(design.subject, v);
  const preheader = fillPlain(design.preheader, v);
  const footer = ctx.unsubscribeUrl
    ? `You're getting this because you said yes to news from ${esc(ctx.studioName)}. <a href="${esc(ctx.unsubscribeUrl)}" style="color:inherit;text-decoration:underline">Unsubscribe</a>`
    : `This email is about your account with ${esc(ctx.studioName)}.`;
  text.push("", ctx.unsubscribeUrl ? `You're getting this because you said yes to news from ${ctx.studioName}. Unsubscribe: ${ctx.unsubscribeUrl}` : `This email is about your account with ${ctx.studioName}.`);
  const html = `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="x-apple-disable-message-reformatting"><title>${esc(subject)}</title>
<style>@media (max-width:620px){.wrap{width:100%!important}.col{display:block!important;width:100%!important;padding:0!important}}</style></head>
<body style="margin:0;padding:0;background:${t.background}">
<div style="display:none;max-height:0;overflow:hidden;opacity:0">${esc(preheader)}&nbsp;</div>
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="background:${t.background}"><tr><td align="center" style="padding:24px 12px">
<table role="presentation" class="wrap" width="600" cellpadding="0" cellspacing="0" border="0" style="width:600px;max-width:600px;background:${t.content};border-radius:12px">
${t.logoFileId ? `<tr><td align="center" style="padding:24px 32px 8px"><img src="${esc(img(t.logoFileId))}" width="140" alt="${esc(ctx.studioName)}" style="display:block;max-width:140px;height:auto;border:0"></td></tr>` : ""}
<tr><td style="height:16px;line-height:16px;font-size:1px">&nbsp;</td></tr>
${body}
<tr><td style="height:16px;line-height:16px;font-size:1px">&nbsp;</td></tr>
</table>
<table role="presentation" class="wrap" width="600" cellpadding="0" cellspacing="0" border="0" style="width:600px;max-width:600px"><tr><td style="padding:16px 32px;text-align:center;font-family:${font};font-size:12px;line-height:1.5;color:${mix(t.text, t.background, 0.6)}">${esc(ctx.studioName)}<br>${footer}</td></tr></table>
</td></tr></table></body></html>`;
  return { subject, preheader, html, text: text.join("\n").replace(/\n{3,}/g, "\n\n").trim() };
}

/** Black or white text, whichever reads better on a colour. */
function contrastOn(hex: string): string {
  const [r, g, b] = [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16) / 255).map((c) => (c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4));
  return 0.2126 * r! + 0.7152 * g! + 0.0722 * b! > 0.179 ? "#111111" : "#ffffff";
}
/** A colour part-way between two others (for hairlines and footer text). */
function mix(a: string, b: string, amount: number): string {
  const c = (h: string) => [1, 3, 5].map((i) => parseInt(h.slice(i, i + 2), 16));
  const [x, y] = [c(a), c(b)];
  return `#${x.map((v, i) => Math.round(v * amount + y[i]! * (1 - amount)).toString(16).padStart(2, "0")).join("")}`;
}

/** Check a design only uses this studio's images and packages, and known {{tags}}. */
export async function checkDesign(db: DbOrTx, orgId: string, design: EmailDesign) {
  const bad = unknownTags(design);
  if (bad.length) throw badRequest("unknown_tag", `${bad.map((t) => `{{${t}}}`).join(", ")} isn't something we can fill in. You can use: ${Object.keys(MERGE_TAGS).map((t) => `{{${t}}}`).join(", ")}.`);
  const imgs = new Set<string>(), plans = new Set<string>();
  if (design.theme.logoFileId) imgs.add(design.theme.logoFileId);
  const walk = (blocks: EmailBlock[]) => blocks.forEach((b) => { if (b.type === "image") imgs.add(b.fileId); if (b.type === "package") plans.add(b.planId); if (b.type === "columns") b.columns.forEach((c) => walk(c as EmailBlock[])); });
  walk(design.blocks);
  if (imgs.size) {
    const found = await db.select({ id: files.id }).from(files).where(and(eq(files.orgId, orgId), inArray(files.id, [...imgs]), inArray(files.purpose, ["email_image", "package_photo"])));
    if (found.length !== imgs.size) throw badRequest("missing_image", "One of the images couldn't be found. Upload it again.");
  }
  if (plans.size) {
    const found = await db.select({ id: packagePlans.id }).from(packagePlans).where(and(eq(packagePlans.orgId, orgId), inArray(packagePlans.id, [...plans])));
    if (found.length !== plans.size) throw badRequest("missing_package", "One of the packages in this email no longer exists.");
  }
}

/** The packages a design shows, with their current price and rules (archived or off-sale ones are left out). */
export async function plansFor(db: DbOrTx, orgId: string, currency: string, design: EmailDesign): Promise<Map<string, PlanInfo>> {
  const ids: string[] = [];
  const walk = (blocks: EmailBlock[]) => blocks.forEach((b) => { if (b.type === "package") ids.push(b.planId); if (b.type === "columns") b.columns.forEach((c) => walk(c as EmailBlock[])); });
  walk(design.blocks);
  if (!ids.length) return new Map();
  const rows = await db.select().from(packagePlans).where(and(eq(packagePlans.orgId, orgId), inArray(packagePlans.id, ids), eq(packagePlans.onSale, true), isNull(packagePlans.archivedAt)));
  const typeIds = [...new Set(rows.flatMap((r) => r.classTypeIds))];
  const names = typeIds.length ? new Map((await db.select({ id: classTypes.id, name: classTypes.name }).from(classTypes).where(inArray(classTypes.id, typeIds))).map((t) => [t.id, t.name])) : new Map<string, string>();
  return new Map(
    rows.map((r) => [
      r.id,
      { id: r.id, name: r.name, description: r.description, price: money(r.priceCents, currency), photoFileId: r.photoFileId, terms: describePackage(r, r.classTypeIds.map((i) => names.get(i) ?? "").filter(Boolean), (c) => money(c, currency)) },
    ]),
  );
}
