/**
 * Booking on the web: each studio's public booking page (<app>/s/<slug>) and a widget for the
 * studio's own website. Visitors see the timetable, a class and the packages without signing in;
 * booking and buying then use the normal client app (sign in, join, book, pay).
 */
import { z } from "zod";

/** Words that can't be a studio's link (pages of the app itself). */
export const RESERVED_SLUGS = ["admin", "api", "app", "book", "booking", "help", "hq", "join", "login", "logout", "new", "pay", "payments", "s", "settings", "setup", "signin", "signup", "static", "studio", "studios", "support", "widget", "www"] as const;
export const SLUG_PATTERN = /^[a-z0-9](?:[a-z0-9-]{1,38}[a-z0-9])$/;

/** "Breathe Pilates & Yoga!" → "breathe-pilates-yoga". */
export function slugify(name: string) {
  const s = name.toLowerCase().normalize("NFKD").replace(/[̀-ͯ]/g, "").replace(/&/g, " and ").replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 40).replace(/-+$/, "");
  return s.length >= 3 ? s : `${s || "studio"}-studio`.slice(0, 40);
}

const hex = z.string().regex(/^#[0-9a-fA-F]{6}$/, "Use a colour like #0C6156.");
export const bookingPageSettings = z.object({
  slug: z
    .string()
    .trim()
    .toLowerCase()
    .regex(SLUG_PATTERN, "Use 3 to 40 lowercase letters, numbers and dashes, starting and ending with a letter or number (like breathe-pilates).")
    .refine((s) => !(RESERVED_SLUGS as readonly string[]).includes(s), "That name is taken by the app itself. Try your studio's name."),
  enabled: z.boolean(),
  /** A line or two at the top of the booking page. */
  intro: z.string().trim().max(300).nullable().default(null),
  /** The widget's buttons and highlights. Left out: the studio's invoice colour. */
  accent: hex.nullable().default(null),
});
export type BookingPageSettings = z.infer<typeof bookingPageSettings>;

const localDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Use a date like 2026-11-20.");
export const publicScheduleQuery = z.object({
  date: localDate.optional(),
  days: z.coerce.number().int().min(1).max(14).default(7),
  locationId: z.uuid().optional(),
  classTypeId: z.uuid().optional(),
});
