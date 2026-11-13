/**
 * File uploads: package photos, extension attachments, and marketing images (email images,
 * banners and gift card designs).
 *
 * Security:
 *  - Only images (JPEG, PNG, WebP) and PDFs, checked by their actual contents (not just the
 *    name or the type the browser claims), with size limits per purpose.
 *  - Package photos can be seen by anyone in the studio. Attachments (e.g. a doctor's note)
 *    only by the person who uploaded them and the studio's admins.
 *  - Files are served with their real type, never sniffed, and PDFs download rather than open inline.
 */
import type { FastifyInstance } from "fastify";
import { and, eq, inArray } from "drizzle-orm";
import { FILE_PURPOSES, MAX_FILE_BYTES, PUBLIC_FILE_PURPOSES, can, schemas, type FilePurpose } from "@studio/shared";
import { z } from "zod";
import type { DbOrTx } from "../../db/client.js";
import { files } from "../../db/schema.js";
import { badRequest, forbidden, notFound } from "../../lib/errors.js";
import { parse } from "../../lib/validate.js";

/** The real type of a file, from its first bytes. */
export function sniff(buf: Buffer): string | null {
  if (buf.length >= 3 && buf[0] === 0xff && buf[1] === 0xd8 && buf[2] === 0xff) return "image/jpeg";
  if (buf.length >= 8 && buf.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))) return "image/png";
  if (buf.length >= 12 && buf.subarray(0, 4).toString("ascii") === "RIFF" && buf.subarray(8, 12).toString("ascii") === "WEBP") return "image/webp";
  if (buf.length >= 5 && buf.subarray(0, 5).toString("ascii") === "%PDF-") return "application/pdf";
  if (buf.length >= 6 && /^GIF8[79]a$/.test(buf.subarray(0, 6).toString("ascii"))) return "image/gif";
  return null;
}

const ALLOWED: Record<FilePurpose, string[]> = {
  package_photo: ["image/jpeg", "image/png", "image/webp"],
  extension_attachment: ["image/jpeg", "image/png", "image/webp", "application/pdf"],
  email_image: ["image/jpeg", "image/png", "image/webp", "image/gif"],
  banner: ["image/jpeg", "image/png", "image/webp"],
  gift_card_design: ["image/jpeg", "image/png", "image/webp"],
};
const MARKETING_PURPOSES: readonly FilePurpose[] = ["email_image", "banner", "gift_card_design"];
const uploadQuery = z.object({ purpose: z.enum(FILE_PURPOSES) });
const idParam = z.object({ id: schemas.id });

/** The file belongs to this studio, has this purpose, and (for attachments) was uploaded by this person. */
export async function assertFile(db: DbOrTx, orgId: string, id: string, purpose: FilePurpose, uploadedBy?: string) {
  const [f] = await db.select({ id: files.id, purpose: files.purpose, uploadedBy: files.uploadedBy }).from(files).where(and(eq(files.id, id), eq(files.orgId, orgId)));
  if (!f || f.purpose !== purpose || (uploadedBy && f.uploadedBy !== uploadedBy)) throw notFound("file");
}

export const publicFileUrl = (base: string, id: string) => `${base.replace(/\/$/, "")}/v1/public/files/${id}`;

export async function fileRoutes(app: FastifyInstance) {
  // Accept raw file bodies (the app sends the file as-is with its type), up to the biggest limit.
  const maxBytes = Math.max(...Object.values(MAX_FILE_BYTES));
  for (const type of ["image/jpeg", "image/png", "image/webp", "image/gif", "application/pdf", "application/octet-stream"]) {
    app.addContentTypeParser(type, { parseAs: "buffer", bodyLimit: maxBytes }, (_req, body, done) => done(null, body));
  }

  /** Upload: POST /files?purpose=package_photo with the file as the body. Returns its id and address. */
  app.post("/files", { bodyLimit: maxBytes, config: { rateLimit: { max: 30, timeWindow: "1 minute" } } }, async (req, reply) => {
    const { purpose } = parse(uploadQuery, req.query);
    if (purpose === "package_photo" && !can(req.auth.role, "managePackages")) throw forbidden("Only admins can add package photos.");
    if (MARKETING_PURPOSES.includes(purpose) && !can(req.auth.role, "manageMarketing")) throw forbidden("Only admins can add marketing images.");
    const body = req.body;
    if (!Buffer.isBuffer(body) || body.length === 0) throw badRequest("no_file", "Choose a file to upload.");
    if (body.length > MAX_FILE_BYTES[purpose]) throw badRequest("too_big", `That file is too big. The limit is ${MAX_FILE_BYTES[purpose] / 1024 / 1024} MB.`);
    const type = sniff(body);
    if (!type || !ALLOWED[purpose].includes(type)) {
      throw badRequest(
        "wrong_type",
        purpose === "extension_attachment" ? "Attachments need to be a photo (JPG, PNG, WebP) or a PDF." : purpose === "email_image" ? "Email images need to be JPG, PNG, WebP or GIF." : "Photos need to be JPG, PNG or WebP.",
      );
    }
    const [f] = await app.db
      .insert(files)
      .values({ orgId: req.auth.orgId, uploadedBy: req.auth.userId, purpose, contentType: type, sizeBytes: body.length, data: body })
      .returning({ id: files.id, contentType: files.contentType, sizeBytes: files.sizeBytes });
    reply.code(201);
    return { ...f, url: `/v1/files/${f!.id}`, publicUrl: PUBLIC_FILE_PURPOSES.includes(purpose) ? publicFileUrl(app.config.PUBLIC_API_URL, f!.id) : null };
  });

  /**
   * Images that appear in emails (opened outside the app) and anywhere clients see them.
   * Only those purposes are served here; the id is random and unguessable.
   */
  app.get("/public/files/:id", { config: { public: true } }, async (req, reply) => {
    const { id } = parse(idParam, req.params);
    const [f] = await app.db.select().from(files).where(and(eq(files.id, id), inArray(files.purpose, [...PUBLIC_FILE_PURPOSES])));
    if (!f) throw notFound("file");
    reply.header("content-type", f.contentType).header("content-disposition", "inline").header("cache-control", "public, max-age=86400").header("cross-origin-resource-policy", "cross-origin");
    return reply.send(f.data);
  });

  app.get("/files/:id", async (req, reply) => {
    const { id } = parse(idParam, req.params);
    const [f] = await app.db.select().from(files).where(and(eq(files.id, id), eq(files.orgId, req.auth.orgId)));
    if (!f) throw notFound("file");
    if (f.purpose === "extension_attachment" && f.uploadedBy !== req.auth.userId && !can(req.auth.role, "managePackages")) throw notFound("file");
    reply
      .header("content-type", f.contentType)
      .header("content-disposition", f.contentType === "application/pdf" ? `attachment; filename="attachment-${f.id}.pdf"` : "inline")
      .header("cache-control", "private, max-age=3600");
    return reply.send(f.data);
  });
}
