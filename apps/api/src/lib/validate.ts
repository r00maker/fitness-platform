import type { z } from "zod";
import { badRequest } from "./errors.js";

/** Validate input against a shared schema, turning problems into a friendly 400 with per-field messages. */
export function parse<S extends z.ZodType>(schema: S, input: unknown): z.output<S> {
  const result = schema.safeParse(input ?? {});
  if (result.success) return result.data;
  const fields: Record<string, string> = {};
  for (const issue of result.error.issues) {
    const key = issue.path.join(".") || "_";
    fields[key] ??= issue.message;
  }
  throw badRequest("invalid_input", "Some details need fixing.", { fields });
}

/**
 * For PATCH requests: validate, then keep only the fields the request actually sent. (A partial
 * schema still fills in defaults, which would quietly reset settings the person didn't touch.)
 */
export function parsePatch<S extends z.ZodType>(schema: S, input: unknown): Partial<z.output<S>> {
  const data = parse(schema, input) as Record<string, unknown>;
  const sent = input && typeof input === "object" ? Object.keys(input) : [];
  return Object.fromEntries(Object.entries(data).filter(([k]) => sent.includes(k))) as Partial<z.output<S>>;
}
