/**
 * Request shapes for the API. The API validates every request against these,
 * and the web/mobile forms use the same schemas so errors show before submitting.
 */
import { z } from "zod";
import {
  ATTENDANCE,
  FLAG_CODES,
  HEALTH_CATEGORIES,
  HEALTH_NOTE_MAX_LENGTH,
  CALENDAR_VIEWS,
  EDIT_SCOPES,
  REFUND_METHODS,
  SUB_APPROVAL_MODES,
  TIMES_OF_DAY,
  WAITLIST_MODES,
} from "./enums.js";

export const id = z.uuid({ message: "That ID doesn't look right." });
export const hexColor = z.string().regex(/^#[0-9a-fA-F]{6}$/, "Pick a colour (like #4F46E5).");
export const localDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Use a date like 2026-03-14.");
export const localTime = z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/, "Use a 24-hour time like 07:30.");
const name = z.string().trim().min(1, "This can't be empty.").max(120);
// Up to 24h is accepted so a likely mistake (e.g. 11am–12am) can be flagged for the user rather than rejected.
const duration = z.number().int().min(1, "Classes must be at least 1 minute.").max(1440, "Classes can be at most 24 hours.");
const capacity = z.number().int().min(1, "At least 1 spot is needed.").max(1000);
const timezone = z.string().refine(
  (tz) => {
    try {
      new Intl.DateTimeFormat("en", { timeZone: tz });
      return true;
    } catch {
      return false;
    }
  },
  { message: "Pick a valid time zone, like Europe/London." },
);

// ---- Studio settings -------------------------------------------------------
export const updateOrgSettings = z.object({
  substituteApproval: z.enum(SUB_APPROVAL_MODES).optional(),
  waitlistHoldMinutes: z.number().int().min(1).max(120).optional(),
  waitlistExpiryOptionsHours: z
    .array(z.number().int().min(0).max(168))
    .length(3, "Give exactly three choices.")
    .optional(),
  lateCancelWindowHours: z.number().int().min(0).max(168).optional(),
  notifyClientsOnInstructorChange: z.boolean().optional(),
  observesDaylightSaving: z.boolean().optional(),
  bookingOpensDaysBefore: z.number().int().min(0).max(365).optional(),
  bookingClosesMinutesBefore: z.number().int().min(0).max(7 * 24 * 60).optional(),
  weeklyBookingLimit: z.number().int().min(1).max(100).nullable().optional(),
  lateCancelFeeEnabled: z.boolean().optional(),
  lateCancelFeeCents: z.number().int().min(0).max(1_000_000).optional(),
  noShowFeeEnabled: z.boolean().optional(),
  noShowFeeCents: z.number().int().min(0).max(1_000_000).optional(),
  currency: z.string().regex(/^[A-Z]{3}$/, "Use a 3-letter currency code like SGD.").optional(),
  waiverRequired: z.boolean().optional(),
  waiverText: z.string().trim().min(20, "Paste in your full waiver.").max(20_000).nullable().optional(),
  spotBookingEnabled: z.boolean().optional(),
});
export const waiveFee = z.object({ reason: z.string().trim().min(1, "Add a short reason.").max(500) });

/** Warning codes the user has seen and chosen to go ahead with (see FLAG_CODES). */
const acknowledge = z.array(z.enum(FLAG_CODES)).max(50).default([]);

// ---- Locations, rooms, class types ----------------------------------------
export const createLocation = z.object({ name, timezone, address: z.string().max(500).optional() });
export const createRoom = z.object({
  locationId: id,
  name,
  capacity: capacity.optional(),
  /** Named spots (e.g. "Reformer 1"); clients choose one when booking. */
  spotLabels: z.array(z.string().trim().min(1).max(40)).min(1).max(200).nullish(),
});
export const createClassType = z.object({
  name,
  color: hexColor,
  description: z.string().max(2000).optional(),
  defaultDurationMinutes: duration.optional(),
});
export const updateClassType = createClassType.partial();
export const setClassTypeInstructors = z.object({ instructorIds: z.array(id).max(200) });

// ---- Templates --------------------------------------------------------------
export const createTemplate = z.object({
  name,
  classTypeId: id,
  locationId: id,
  roomId: id.nullish(),
  instructorId: id.nullish(),
  capacity,
  durationMinutes: duration,
  startTime: localTime.nullish(),
  waitlistEnabled: z.boolean().default(true),
  waitlistCapacity: z.number().int().min(1).max(1000).nullish(),
});
export const updateTemplate = createTemplate.partial();

// ---- Sessions (a single class on the calendar) -----------------------------
/** Create one class. Pass a templateId to fill in anything you leave out. */
export const createSession = z.object({
  templateId: id.optional(),
  date: localDate,
  startTime: localTime.optional(),
  /** Alternative to durationMinutes. An end time earlier than the start means the next day. */
  endTime: localTime.optional(),
  classTypeId: id.optional(),
  locationId: id.optional(),
  roomId: id.nullish(),
  instructorId: id.nullish(),
  durationMinutes: duration.optional(),
  capacity: capacity.optional(),
  waitlistEnabled: z.boolean().optional(),
  waitlistCapacity: z.number().int().min(1).max(1000).nullish(),
  notes: z.string().max(2000).nullish(),
  acknowledge,
});
export type CreateSessionInput = z.infer<typeof createSession>;

export const sessionChanges = z
  .object({
    date: localDate,
    startTime: localTime,
    endTime: localTime,
    durationMinutes: duration,
    instructorId: id.nullable(),
    roomId: id.nullable(),
    capacity,
    waitlistEnabled: z.boolean(),
    waitlistCapacity: z.number().int().min(1).max(1000).nullable(),
    notes: z.string().max(2000).nullable(),
    classTypeId: id,
  })
  .partial()
  .refine((c) => Object.keys(c).length > 0, "Nothing to change.")
  .refine((c) => !(c.endTime && c.durationMinutes), "Give an end time or a length, not both.");
export type SessionChanges = z.infer<typeof sessionChanges>;

export const updateSession = z.object({
  changes: sessionChanges,
  scope: z.enum(EDIT_SCOPES).default("this"),
  notifyClients: z.boolean().default(true),
  /** The new instructor is covering for the usual one (one class at a time). */
  asCover: z.boolean().default(false),
  acknowledge,
});

export const bulkUpdateSessions = z.object({
  sessionIds: z.array(id).min(1).max(500),
  changes: sessionChanges.refine((c) => c.date === undefined, "Dates can't be bulk-edited. Use duplicate instead."),
  notifyClients: z.boolean().default(true),
  asCover: z.boolean().default(false),
  acknowledge,
});

export const cancelSession = z.object({
  /** Shared with booked clients in the cancellation email and push. */
  reason: z.string().max(1000, "Keep the message under 1,000 characters.").optional(),
  refund: z.enum(REFUND_METHODS).default("credit"),
  notifyClients: z.boolean().default(true),
  scope: z.enum(EDIT_SCOPES).default("this"),
  acknowledge,
});
export const bulkCancelSessions = cancelSession.omit({ scope: true }).extend({ sessionIds: z.array(id).min(1).max(500) });

export const duplicateSession = z.object({ dates: z.array(localDate).min(1).max(100), acknowledge });
export const duplicateRange = z.object({
  fromDate: localDate,
  toDate: localDate,
  targetStartDate: localDate,
  locationId: id.optional(),
  acknowledge,
});

// ---- Recurring classes ------------------------------------------------------
export const createSeries = z
  .object({
    templateId: id.optional(),
    classTypeId: id.optional(),
    locationId: id.optional(),
    roomId: id.nullish(),
    instructorId: id.nullish(),
    durationMinutes: duration.optional(),
    capacity: capacity.optional(),
    waitlistEnabled: z.boolean().optional(),
    waitlistCapacity: z.number().int().min(1).max(1000).nullish(),
    startTime: localTime.optional(),
    endTime: localTime.optional(),
    /** ISO weekdays: 1 = Monday … 7 = Sunday */
    daysOfWeek: z.array(z.number().int().min(1).max(7)).min(1, "Pick at least one day."),
    everyNWeeks: z.number().int().min(1).max(8).default(1),
    startDate: localDate,
    endDate: localDate.optional(),
    occurrences: z.number().int().min(1).max(520).optional(),
    acknowledge,
  })
  .refine((s) => !(s.endDate && s.occurrences), "Choose an end date or a number of classes, not both.");

// ---- Calendar ---------------------------------------------------------------
export const calendarQuery = z.object({
  view: z.enum(CALENDAR_VIEWS).default("week"),
  date: localDate,
  timezone: timezone.optional(),
  locationId: id.optional(),
  classTypeId: id.optional(),
  instructorId: id.optional(),
  timeOfDay: z.enum(TIMES_OF_DAY).optional(),
  q: z.string().trim().max(100).optional(),
  includeCancelled: z.stringbool().default(false),
  /** Clients: only classes with their favourite instructor (one-tap filter). */
  favouriteInstructor: z.stringbool().default(false),
});

// ---- Waivers ----------------------------------------------------------------
/** A client signing the studio's waiver: tick "I agree" and type their full name. */
export const signWaiver = z.object({
  agree: z.literal(true, { message: "Tick the box to agree to the waiver." }),
  signedName: z.string().trim().min(2, "Type your full name to sign.").max(120),
});
export const confirmWaiver = z.object({ acknowledge });
export const reverseWaiver = z.object({ reason: z.string().trim().min(1, "Add a short reason.").max(500) });

// ---- Health notes -----------------------------------------------------------
const healthDescription = z
  .string()
  .trim()
  .min(3, "Add a few words, e.g. “sore left knee”.")
  .max(HEALTH_NOTE_MAX_LENGTH, `Keep it under ${HEALTH_NOTE_MAX_LENGTH} characters.`);
export const createHealthNote = z.object({
  /** Left out = worked out from the description (see suggestHealthCategory). */
  category: z.enum(HEALTH_CATEGORIES).optional(),
  description: healthDescription,
});
export const updateHealthNote = z
  .object({ category: z.enum(HEALTH_CATEGORIES), description: healthDescription })
  .partial()
  .refine((c) => Object.keys(c).length > 0, "Nothing to change.");

// ---- Bookings & attendance -------------------------------------------------
export const createBooking = z.object({
  sessionId: id,
  clientId: id.optional(),
  /** Spot number (1-based) in rooms with spot selection. Left out = the next free spot. */
  spot: z.number().int().min(1).max(500).optional(),
  /** First booking: sign the studio's waiver in the same step. */
  waiver: signWaiver.optional(),
  acknowledge,
});
export const cancelBooking = z.object({
  refund: z.enum(REFUND_METHODS).optional(),
  reason: z.string().max(500).optional(),
  notifyClient: z.boolean().default(true),
  acknowledge,
});
export const moveBooking = z.object({ targetSessionId: id, notifyClient: z.boolean().default(true), acknowledge });
export const refundBooking = z.object({
  method: z.enum(REFUND_METHODS).exclude(["none"]),
  amountCents: z.number().int().min(1).optional(),
  reason: z.string().min(1, "Add a short reason.").max(500),
  acknowledge,
});
export const markAttendance = z.object({ attendance: z.enum(ATTENDANCE) });
export const createClientTag = z.object({
  name: z.string().trim().min(1, "Give the tag a name.").max(40),
  color: hexColor.optional(),
  /** Shown straight under the client's name on class lists (others are in “More”). */
  pinned: z.boolean().optional(),
});
export const updateClientTag = createClientTag.partial();
export const setClientTags = z.object({ tagIds: z.array(id).max(50) });
export const updatePrivacy = z.object({ showInAttendeeList: z.boolean() });
export const clientSearch = z.object({ q: z.string().trim().max(100).optional() });
export const markAllAttendance = z.object({
  attendance: z.enum(ATTENDANCE).exclude(["unmarked"]).default("present"),
  overwrite: z.boolean().default(false),
  acknowledge,
});

// ---- Waitlist ---------------------------------------------------------------
export const joinWaitlist = z.object({
  sessionId: id,
  clientId: id.optional(),
  acknowledge,
  mode: z.enum(WAITLIST_MODES),
  /** Must be one of the studio's three expiry options, or null to wait until class starts. */
  expiresHoursBeforeStart: z.number().int().min(0).nullable().default(null),
  waiver: signWaiver.optional(),
});

// ---- Substitutes ------------------------------------------------------------
export const createSubRequest = z.object({
  sessionId: id,
  reason: z.string().max(500).optional(),
  /** Admins only. Instructors' requests go to the class's teaching list; the admin decides who covers. */
  invitedInstructorIds: z.array(id).max(200).optional(),
});
export const approveSub = z.object({ instructorId: id, acknowledge });
export const respondToSub = z.object({ acknowledge });

// ---- Push tokens -----------------------------------------------------------
export const registerPushToken = z.object({
  token: z.string().min(10).max(500),
  platform: z.enum(["ios", "android", "web"]),
});
