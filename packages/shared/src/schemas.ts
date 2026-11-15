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
  THEMES,
  MAX_PACKAGE_SHARERS,
  PACKAGE_KINDS,
  PACKAGE_STARTS,
  PAY_HEADCOUNTS,
  PAY_PERIODS,
  PAY_RATE_TYPES,
  SHARING_MODES,
  VALIDITY_UNITS,
  EXTENSION_ATTACHMENT,
  EXTENSION_FEE_MODES,
  EXTENSION_MODES,
  PACKAGE_BILLING,
  PLAN_EDIT_SCOPES,
  ROLLOVER_MODES,
  EARLY_CANCEL_FEE_MODES,
  CALENDAR_VIEWS,
  CLASS_TYPE_KINDS,
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
  clientsNeedPackage: z.boolean().optional(),
  allowBookingWithoutPackage: z.boolean().optional(),
  payPeriod: z.enum(PAY_PERIODS).optional(),
  /** Fortnightly pay: the first day of any one pay fortnight. */
  payPeriodAnchor: localDate.optional(),
  payHeadcount: z.enum(PAY_HEADCOUNTS).optional(),
  instructorsSeeOwnPay: z.boolean().optional(),
  // Package extensions and rollovers
  extensionMode: z.enum(EXTENSION_MODES).optional(),
  extensionAutoDays: z.number().int().min(1).max(365).optional(),
  extensionMaxDays: z.number().int().min(1).max(365).optional(),
  extensionAttachment: z.enum(EXTENSION_ATTACHMENT).optional(),
  extensionFeeMode: z.enum(EXTENSION_FEE_MODES).optional(),
  extensionFeeCents: z.number().int().min(0).max(1_000_000).optional(),
  rolloverMode: z.enum(ROLLOVER_MODES).optional(),
  rolloverMaxCredits: z.number().int().min(1).max(1000).nullable().optional(),
  rolloverWithinDays: z.number().int().min(0).max(365).optional(),
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
  /** How many spots sit side by side in the booking screen's room layout. */
  spotColumns: z.number().int().min(1).max(20).nullish(),
});
/** Change a room. Leaving out spotLabels keeps them; null removes spot selection for the room. */
export const updateRoom = createRoom.omit({ locationId: true }).partial().extend({ acknowledge: z.array(z.string()).default([]) });
/** Remove a room. Its upcoming classes move to another room at the same location, or are left without one. */
export const removeRoom = z.object({ moveToRoomId: id.nullish(), acknowledge: z.array(z.string()).default([]) });
/**
 * Colours to choose from for class types: each is dark enough for white text on the calendar,
 * and they're spread around the colour wheel so neighbouring classes look different.
 * Studios can also type their own hex colour.
 */
export const CLASS_COLORS = [
  { hex: "#4F46E5", name: "Indigo" },
  { hex: "#2563EB", name: "Blue" },
  { hex: "#0E7490", name: "Teal" },
  { hex: "#047857", name: "Green" },
  { hex: "#4D7C0F", name: "Olive" },
  { hex: "#B45309", name: "Amber" },
  { hex: "#C2410C", name: "Orange" },
  { hex: "#B91C1C", name: "Red" },
  { hex: "#BE185D", name: "Pink" },
  { hex: "#A21CAF", name: "Magenta" },
  { hex: "#7C3AED", name: "Violet" },
  { hex: "#475569", name: "Slate" },
] as const;

/** Contrast of white text on a colour (WCAG). Under 3 means calendar labels would be hard to read. */
export function whiteTextContrast(hex: string): number {
  const ch = (i: number) => {
    const c = parseInt(hex.slice(i, i + 2), 16) / 255;
    return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
  };
  const l = 0.2126 * ch(1) + 0.7152 * ch(3) + 0.0722 * ch(5);
  return 1.05 / (l + 0.05);
}

export const createClassType = z.object({
  name,
  color: hexColor.refine((c) => whiteTextContrast(c) >= 3, "That colour is too light for white text on the calendar. Pick a darker shade."),
  description: z.string().max(2000).optional(),
  defaultDurationMinutes: duration.optional(),
  /** Appointments are private sessions: hidden from the public schedule, and the studio books the client in. */
  kind: z.enum(CLASS_TYPE_KINDS).default("class"),
});
export const updateClassType = createClassType.partial();

/**
 * Auto-cancel: if fewer than `minBookings` people are booked `hoursBefore` hours before the
 * class, it's cancelled and everyone booked is told and given their class back. Null = off.
 */
export const autoCancel = z
  .object({
    hoursBefore: z.number().int().min(1, "At least 1 hour before.").max(72, "At most 72 hours (3 days) before."),
    minBookings: z.number().int().min(1, "At least 1 person.").max(1000),
  })
  .nullable();

/** ClassPass: whether ClassPass clients can book, and the most spots they can take. */
const classpassEnabled = z.boolean();
const classpassSpots = z.number().int().min(1, "Open at least 1 spot to ClassPass, or switch it off.").max(1000);
/** Appointments: clients to book in straight away (optional). */
const clientIds = z.array(id).max(20).refine((a) => new Set(a).size === a.length, "Each client can only be added once.");
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
  classpassEnabled: classpassEnabled.default(false),
  classpassSpots: classpassSpots.nullish(),
  autoCancel: autoCancel.optional(),
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
  classpassEnabled: classpassEnabled.optional(),
  classpassSpots: classpassSpots.nullish(),
  /** Left out = the template's setting. */
  autoCancel: autoCancel.optional(),
  /** Appointments only: book these clients in as it's created. */
  clientIds: clientIds.optional(),
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
    classpassEnabled,
    classpassSpots: classpassSpots.nullable(),
    autoCancel,
    /** Move to another location: give the room there too (or null for none). */
    locationId: id,
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

/**
 * Which classes a bulk change applies to: everything matching, across any span of dates (up to
 * 13 months), not just what's on screen. Only classes that haven't started are included.
 */
export const sessionFilter = z
  .object({
    from: localDate,
    to: localDate,
    classTypeIds: z.array(id).max(100).optional(),
    /** null in the list = classes with no instructor yet (TBC). */
    instructorIds: z.array(id.nullable()).max(100).optional(),
    locationId: id.optional(),
    roomIds: z.array(id).max(100).optional(),
    /** ISO weekdays: 1 = Monday … 7 = Sunday */
    weekdays: z.array(z.number().int().min(1).max(7)).max(7).optional(),
    /** Local start times, e.g. ["07:00", "18:30"]. */
    startTimes: z.array(localTime).max(48).optional(),
    seriesId: id.optional(),
    kind: z.enum(["class", "appointment", "all"]).default("class"),
  })
  .refine((f) => f.to >= f.from, { message: "The end date must be on or after the start date.", path: ["to"] })
  .refine((f) => (Date.parse(f.to) - Date.parse(f.from)) / 86_400_000 <= 400, { message: "Choose up to 13 months at a time.", path: ["to"] });
export type SessionFilter = z.infer<typeof sessionFilter>;
export const bulkPreview = z.object({ filter: sessionFilter });

export const bulkUpdateSessions = z.object({
  /** Either the classes picked on the calendar, or a filter. */
  sessionIds: z.array(id).min(1).max(2000).optional(),
  filter: sessionFilter.optional(),
  changes: sessionChanges.refine((c) => c.date === undefined, "Dates can't be bulk-edited. Use duplicate instead."),
  notifyClients: z.boolean().default(true),
  asCover: z.boolean().default(false),
  acknowledge,
})
  .refine((b) => !!b.sessionIds !== !!b.filter, "Pick classes on the calendar or choose them with filters, not both.");

export const cancelSession = z.object({
  /** Shared with booked clients in the cancellation email and push. */
  reason: z.string().max(1000, "Keep the message under 1,000 characters.").optional(),
  refund: z.enum(REFUND_METHODS).default("credit"),
  notifyClients: z.boolean().default(true),
  scope: z.enum(EDIT_SCOPES).default("this"),
  acknowledge,
});
export const bulkCancelSessions = cancelSession
  .omit({ scope: true })
  .extend({ sessionIds: z.array(id).min(1).max(2000).optional(), filter: sessionFilter.optional() })
  .refine((b) => !!b.sessionIds !== !!b.filter, "Pick classes on the calendar or choose them with filters, not both.");

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
    classpassEnabled: classpassEnabled.optional(),
    classpassSpots: classpassSpots.nullish(),
    autoCancel: autoCancel.optional(),
    /** Appointments only: book these clients into every session in the series. */
    clientIds: clientIds.optional(),
    notes: z.string().max(2000).nullish(),
    acknowledge,
  })
  .refine((s) => !(s.endDate && s.occurrences), "Choose an end date or a number of classes, not both.");

// ---- Closures and holidays ------------------------------------------------
/** Days the studio is closed. Dates are inclusive and in each location's own time. */
const closureDates = z
  .object({
    /** Leave out for every location. */
    locationId: id.nullish(),
    startDate: localDate,
    endDate: localDate,
  })
  .refine((c) => c.endDate >= c.startDate, { message: "The last day can't be before the first day.", path: ["endDate"] });
export const closurePreview = closureDates;
export const createClosure = z
  .object({
    locationId: id.nullish(),
    startDate: localDate,
    endDate: localDate,
    name: z.string().trim().min(1, "Give the closure a name, like “Hari Raya”.").max(80, "Keep the name under 80 characters."),
    /** Shown to clients on the schedule and in the email. */
    message: z.string().trim().max(500, "Keep the message under 500 characters.").nullish(),
    /** Cancel the classes already on these days (default). Off keeps them, e.g. for a special event. */
    cancelClasses: z.boolean().default(true),
    refund: z.enum(REFUND_METHODS).default("credit"),
    notifyClients: z.boolean().default(true),
    acknowledge,
  })
  .refine((c) => c.endDate >= c.startDate, { message: "The last day can't be before the first day.", path: ["endDate"] });
export const updateClosure = z.object({
  name: z.string().trim().min(1, "Give the closure a name, like “Hari Raya”.").max(80, "Keep the name under 80 characters.").optional(),
  message: z.string().trim().max(500, "Keep the message under 500 characters.").nullish(),
});
export const deleteClosure = z.object({
  /** Put back recurring classes that were left out because of this closure. */
  restoreClasses: z.boolean().default(true),
});
export const closureList = z.object({ include: z.enum(["upcoming", "all"]).default("upcoming") });

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
  /** Which package pays for it. Left out = the package that runs out soonest. */
  clientPackageId: id.optional(),
  /** Staff only: book for free. */
  complimentary: z.boolean().optional(),
  /** Staff booking someone in: send them a confirmation. */
  notifyClient: z.boolean().default(true),
  /** Staff only: a booking that came through ClassPass (uses one of the class's ClassPass spots; nothing to pay the studio). */
  viaClasspass: z.boolean().optional(),
  acknowledge,
});
export const cancelBooking = z.object({
  /** Left out = the studio's policy (credit back, unless it's a late cancellation). */
  refund: z.enum(REFUND_METHODS).optional(),
  /** Staff only. Left out = late if inside the late-cancellation window. */
  lateCancel: z.boolean().optional(),
  /** Staff only, for late cancellations. Left out = charge it if the studio charges one. */
  chargeLateFee: z.boolean().optional(),
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
/** Personal settings that follow the person to every device. */
export const updatePreferences = z.object({ theme: z.enum(THEMES) });
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

// ---- Packages -------------------------------------------------------------
const money = z.number().int().min(0, "Can't be negative.").max(100_000_000);
const planDescription = z.string().trim().max(2000, "Keep it under 2,000 characters.").nullish();
export const packagePlan = z
  .object({
    name,
    description: planDescription,
    /** An uploaded photo (POST /files?purpose=package_photo). */
    photoFileId: id.nullish(),
    categoryId: id.nullish(),
    /** One-time, or a membership that renews every validity period. */
    billing: z.enum(PACKAGE_BILLING).default("one_time"),
    kind: z.enum(PACKAGE_KINDS),
    /** Credit packs: how many classes. */
    credits: z.number().int().min(1, "At least 1 class.").max(1000).nullish(),
    priceCents: money.default(0),
    /** Both empty = never expires. */
    validityValue: z.number().int().min(1).max(1000).nullish(),
    validityUnit: z.enum(VALIDITY_UNITS).nullish(),
    startsOn: z.enum(PACKAGE_STARTS).default("purchase"),
    /** Countdown starts on first booking: it expires if nothing is booked within this many days of buying. */
    activateWithinDays: z.number().int().min(1).max(365).nullish(),
    maxUsers: z.number().int().min(1).max(MAX_PACKAGE_SHARERS).default(1),
    sharingMode: z.enum(SHARING_MODES).nullish(),
    weeklyLimit: z.number().int().min(1).max(50).nullish(),
    /** Empty = every class. */
    classTypeIds: z.array(id).max(100).default([]),
    onSale: z.boolean().default(true),
    /** Recurring class packs: unused classes carried into the next period, up to this many. */
    rolloverCap: z.number().int().min(0).max(1000).nullish(),
    /** Recurring: the fewest periods before it can be stopped. */
    commitmentCycles: z.number().int().min(1).max(60).nullish(),
    /** Leaving before the minimum term ends: "none" = it simply runs to the end of the term. */
    earlyCancelFeeMode: z.enum(EARLY_CANCEL_FEE_MODES).default("none"),
    earlyCancelFeeCents: money.nullish(),
  })
  .superRefine((p, ctx) => {
    const issue = (path: string, message: string) => ctx.addIssue({ code: "custom", path: [path], message });
    if (p.billing === "recurring") {
      if (!p.validityValue) issue("validityValue", "How often does it renew? e.g. every 1 month.");
      if (p.startsOn !== "purchase") issue("startsOn", "Recurring packages start when they're bought.");
    } else {
      if (p.rolloverCap) issue("rolloverCap", "Carrying classes over to the next period only applies to recurring packages.");
      if (p.commitmentCycles) issue("commitmentCycles", "A minimum term only applies to recurring packages.");
    }
    if (p.billing === "recurring" && p.sharingMode === "allocated") issue("sharingMode", "Recurring packages can be shared as one pool, but not split into shares.");
    if (p.earlyCancelFeeMode !== "none" && !(p.billing === "recurring" && (p.commitmentCycles ?? 0) > 1)) issue("earlyCancelFeeMode", "An early cancellation fee needs a recurring package with a minimum term.");
    if (p.earlyCancelFeeMode === "flat" && !p.earlyCancelFeeCents) issue("earlyCancelFeeCents", "Set the fee amount.");
    if (p.rolloverCap && p.kind !== "credits") issue("rolloverCap", "Unlimited packages have no classes to carry over.");
    if (p.kind === "credits" && !p.credits) issue("credits", "How many classes does this package include?");
    if (p.kind === "unlimited" && p.credits) issue("credits", "Unlimited packages don't have a number of classes.");
    if (!!p.validityValue !== !!p.validityUnit) issue("validityValue", "Give both a number and a unit (e.g. 3 months), or leave both empty for no expiry.");
    if (p.kind === "unlimited" && !p.validityValue) issue("validityValue", "Unlimited packages need a validity period, e.g. 1 month.");
    if (p.activateWithinDays && p.startsOn !== "first_booking") issue("activateWithinDays", "Only needed when the countdown starts at the first booking.");
    if (p.maxUsers > 1 && p.kind === "credits" && !p.sharingMode) issue("sharingMode", "Choose whether sharers use one pool of credits or each get their own share.");
    if (p.maxUsers === 1 && p.sharingMode) issue("sharingMode", "Only needed when the package can be shared.");
    if (p.kind === "unlimited" && p.sharingMode === "allocated") issue("sharingMode", "Unlimited packages can't be split: everyone sharing gets unlimited classes.");
  });
/**
 * Changing a package type. `applyTo` decides what it changes: packages sold from now on,
 * packages clients already have, or both. The type of package, how it's paid for, when its
 * countdown starts and how sharing works can't change (set up a new package type instead).
 */
export const updatePackagePlan = z.object({
  changes: z
    .object({
      name,
      description: planDescription,
      photoFileId: id.nullable(),
      categoryId: id.nullable(),
      priceCents: money,
      onSale: z.boolean(),
      credits: z.number().int().min(1).max(1000),
      validityValue: z.number().int().min(1).max(1000).nullable(),
      validityUnit: z.enum(VALIDITY_UNITS).nullable(),
      activateWithinDays: z.number().int().min(1).max(365).nullable(),
      maxUsers: z.number().int().min(1).max(MAX_PACKAGE_SHARERS),
      weeklyLimit: z.number().int().min(1).max(50).nullable(),
      classTypeIds: z.array(id).max(100),
      rolloverCap: z.number().int().min(0).max(1000).nullable(),
      commitmentCycles: z.number().int().min(1).max(60).nullable(),
      earlyCancelFeeMode: z.enum(EARLY_CANCEL_FEE_MODES),
      earlyCancelFeeCents: money.nullable(),
    })
    .partial()
    .refine((c) => Object.keys(c).length > 0, "Nothing to change.")
    .refine((c) => (c.validityValue === undefined) === (c.validityUnit === undefined), "Change the number and the unit together (e.g. 3 months)."),
  applyTo: z.enum(PLAN_EDIT_SCOPES).default("new"),
  /** Tell clients whose packages change. */
  notifyClients: z.boolean().default(true),
  acknowledge,
});
export const packageCategory = z.object({ name: z.string().trim().min(1, "Give the category a name.").max(60), description: z.string().trim().max(300).nullish() });
export const updatePackageCategory = packageCategory.partial();
export const reorderCategories = z.object({ ids: z.array(id).min(1).max(100) });
/** The packages in a category, in the order clients see them. Packages left out move to "No category". */
export const categoryPackages = z.object({ planIds: z.array(id).max(200).refine((a) => new Set(a).size === a.length, "Each package can only be listed once.") });
/** Deleting a package type wipes it and every package sold from it. The name must be typed to confirm. */
export const deletePackagePlan = z.object({ confirmName: z.string().trim().min(1, "Type the package's name to confirm.") });
export const deleteClientPackage = z.object({ confirmName: z.string().trim().min(1, "Type the package's name to confirm.") });

// ---- Extensions, rollovers, renewals, checkout ------------------------------------
export const requestExtension = z.object({
  days: z.number().int().min(1, "Ask for at least 1 day.").max(365),
  reason: z.string().trim().min(3, "Tell the studio why, e.g. “Knee injury, physio says 3 weeks off”.").max(1000),
  attachmentFileId: id.optional(),
});
export const approveExtension = z.object({
  /** Left out = the days asked for. */
  days: z.number().int().min(1).max(365).optional(),
  /** Left out = the studio's extension fee. 0 = free this time. */
  feeCents: money.optional(),
  note: z.string().trim().max(500).optional(),
});
export const declineExtension = z.object({ note: z.string().trim().min(1, "Let them know why.").max(500) });
export const rollover = z.object({
  fromPackageId: id,
  /** Left out = as many as allowed. */
  credits: z.number().int().min(1).max(1000).optional(),
});
export const stopRenewing = z.object({
  reason: z.string().trim().max(500).optional(),
  /** During the minimum term: end at the end of this period instead, paying the early cancellation fee. */
  endEarly: z.boolean().default(false),
  /** Admins only: the fee to charge instead (0 waives it). */
  feeCents: money.optional(),
});
export const checkout = z.object({
  planId: id,
  startDate: localDate.optional(),
  /** Bring unused classes across from another package (if the studio allows it). */
  rolloverFromPackageId: id.optional(),
  /** A one-time discount to use (from a referral or the studio). */
  voucherId: id.optional(),
  /** Use studio credit (gift cards, rewards) towards it. On unless turned off. */
  useCredit: z.boolean().default(true),
});
export const checkoutQuote = z.object({ planId: id, rolloverFromPackageId: id.optional(), voucherId: id.optional(), useCredit: z.stringbool().default(true) });
export const sellPackage = z.object({
  planId: id,
  /** Bring unused classes across from another of the client's packages. */
  rolloverFromPackageId: id.optional(),
  /** Countdown starts when bought: start on a later date instead (e.g. a membership from the 1st). */
  startDate: localDate.optional(),
  /** What the client paid. Left out = the package's price. */
  pricePaidCents: money.optional(),
  /** How they paid at the desk (for the invoice and receipt). */
  paymentMethod: z.enum(["card", "cash", "qr", "bank_transfer", "online", "credit", "other"]).default("card"),
  note: z.string().trim().max(500).optional(),
  notifyClient: z.boolean().default(true),
});
export const adjustPackage = z
  .object({
    /** + adds classes, − removes them. */
    credits: z.number().int().min(-1000).max(1000).refine((n) => n !== 0, "Add or remove at least 1.").optional(),
    /** New last day the package can be used. */
    validUntil: localDate.optional(),
    reason: z.string().trim().min(1, "Add a short reason.").max(500),
  })
  .refine((a) => a.credits !== undefined || a.validUntil !== undefined, "Change the classes, the expiry date, or both.");
export const cancelPackage = z.object({ reason: z.string().trim().min(1, "Add a short reason.").max(500) });
export const addPackageSharer = z.object({ email: z.email("That email doesn't look right.").optional(), clientId: id.optional() }).refine((a) => !!a.email !== !!a.clientId, "Give the person's email.");
/** Allocated sharing: how many of the remaining credits each person can use. */
export const setPackageAllocations = z.object({ allocations: z.array(z.object({ userId: id, credits: z.number().int().min(0).max(1000) })).min(1).max(MAX_PACKAGE_SHARERS) });

// ---- Payroll ------------------------------------------------------------------
export const payRate = z
  .object({
    staffId: id,
    /**
     * Leave empty for their usual rate. Or pick class types that share a different rate,
     * e.g. Reformer Pilates and Vinyasa Yoga at one rate, private sessions at another.
     */
    classTypeIds: z.array(id).max(50).default([]),
    type: z.enum(PAY_RATE_TYPES),
    amountCents: money.nullish(),
    perClientCents: money.nullish(),
    clientsIncluded: z.number().int().min(0).max(500).nullish(),
    minimumCents: money.nullish(),
    tiers: z.array(z.object({ fromClients: z.number().int().min(0).max(1000), amountCents: money })).min(2, "Add at least two tiers.").max(10).nullish(),
    /** Used for classes from this date. Left out = today. */
    effectiveFrom: localDate.optional(),
  })
  .superRefine((r, ctx) => {
    const issue = (path: string, message: string) => ctx.addIssue({ code: "custom", path: [path], message });
    if (["per_class", "hourly", "salary"].includes(r.type) && !r.amountCents) issue("amountCents", "Set the amount.");
    if (r.type === "per_client" && !r.perClientCents) issue("perClientCents", "Set the amount per client.");
    if (r.type === "tiered") {
      if (!r.tiers?.length) issue("tiers", "Add the tiers.");
      else {
        const from = r.tiers.map((t) => t.fromClients);
        if (!from.includes(0)) issue("tiers", "The first tier should start at 0 clients, so every class is covered.");
        if (new Set(from).size !== from.length) issue("tiers", "Each tier needs a different starting number.");
      }
    }
    if (r.type === "salary" && r.classTypeIds.length) issue("classTypeIds", "Salaries apply to the whole pay period, not particular classes.");
  });
export const payAdjustment = z.object({
  staffId: id,
  date: localDate,
  /** Negative for a deduction. */
  amountCents: z.number().int().min(-100_000_000).max(100_000_000).refine((n) => n !== 0, "Enter an amount."),
  reason: z.string().trim().min(1, "Add a short reason, e.g. “Workshop on 3 Nov”.").max(300),
});
export const payrollQuery = z.object({ date: localDate.optional() });
export const markPaid = z.object({ date: localDate, acknowledge });

// ---- Push tokens -----------------------------------------------------------
export const registerPushToken = z.object({
  token: z.string().min(10).max(500),
  platform: z.enum(["ios", "android", "web"]),
});

// ---- Staff ------------------------------------------------------------------
/** Add a staff member. They get an email with a link to set their password; no 2FA is required for staff. */
export const inviteStaff = z.object({
  email: z.email("Enter a valid email address.").max(200),
  firstName: z.string().trim().min(1, "Add their first name.").max(60),
  lastName: z.string().trim().min(1, "Add their last name.").max(60),
  role: z.enum(["admin", "front_desk", "instructor"]),
  phone: z.string().trim().max(30).nullish(),
});
export const changeStaffRole = z.object({ role: z.enum(["admin", "front_desk", "instructor"]) });
export const deleteClassType = z.object({ acknowledge });
