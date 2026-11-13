/**
 * Encrypting secrets we have to store (ad platform access tokens), with AES-256-GCM and a key
 * from the environment (SECRETS_KEY, 64 hex characters). Stored as "v1:<iv>:<tag>:<data>" (base64).
 * Tokens are never sent back to the apps once saved; only whether one is set.
 */
import { createCipheriv, createDecipheriv, createHash, randomBytes, timingSafeEqual } from "node:crypto";
import { badRequest } from "./errors.js";

function key(): Buffer {
  const hex = process.env.SECRETS_KEY;
  if (!hex || !/^[0-9a-f]{64}$/i.test(hex)) throw badRequest("secrets_not_configured", "Saving access tokens needs the server's SECRETS_KEY to be set. Ask whoever runs your server to add it.");
  return Buffer.from(hex, "hex");
}

export function encryptSecret(plain: string): string {
  const iv = randomBytes(12);
  const c = createCipheriv("aes-256-gcm", key(), iv);
  const data = Buffer.concat([c.update(plain, "utf8"), c.final()]);
  return ["v1", iv.toString("base64"), c.getAuthTag().toString("base64"), data.toString("base64")].join(":");
}

export function decryptSecret(stored: string): string {
  const [v, iv, tag, data] = stored.split(":");
  if (v !== "v1" || !iv || !tag || !data) throw new Error("Unrecognised secret format");
  const d = createDecipheriv("aes-256-gcm", key(), Buffer.from(iv, "base64"));
  d.setAuthTag(Buffer.from(tag, "base64"));
  return Buffer.concat([d.update(Buffer.from(data, "base64")), d.final()]).toString("utf8");
}

/** Compare two secrets without leaking how much matched through timing. */
export function sameSecret(a: string, b: string): boolean {
  const x = createHash("sha256").update(a).digest();
  const y = createHash("sha256").update(b).digest();
  return timingSafeEqual(x, y);
}

export const sha256 = (s: string) => createHash("sha256").update(s).digest("hex");
export const randomToken = (bytes = 24) => randomBytes(bytes).toString("hex");
