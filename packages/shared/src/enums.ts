/**
 * Every fixed set of options in the platform lives here, so the API, web app
 * and mobile app always agree on what values exist.
 */
export const ROLES = ["owner", "admin", "front_desk", "instructor", "client"] as const;
export type Role = (typeof ROLES)[number];

/**
 * What each role can do. Owner has the same access as Admin (and will later hold
 * studio billing). Instructors can also take attendance and ask for cover on
 * their *own* classes, which is checked class by class rather than listed here.
 *
 * | Role            | Sees                          | Can change                      |
 * |-----------------|-------------------------------|---------------------------------|
 * | Admin / Owner   | everything, incl. client info | everything                      |
 * | Front of House  | the whole schedule + rosters, | attendance and client tags      |
 * |                 | incl. client contact details  |                                 |
 * | Instructor      | their own classes only, incl. | attendance on their own classes |
 * |                 | contact details for them      |                                 |
 * | Client          | the public schedule, own data | their own bookings              |
 */
export const PERMISSIONS = {
  /** See every class on the calendar (instructors see only their own). */
  viewFullSchedule: ["owner", "admin", "front_desk"],
  /** See who's booked into any class. */
  viewAllRosters: ["owner", "admin", "front_desk"],
  /** Take attendance on any class. */
  takeAttendanceAnyClass: ["owner", "admin", "front_desk"],
  /** Create, edit, cancel and duplicate classes; manage templates, rooms and class types. */
  editSchedule: ["owner", "admin"],
  /** Book, cancel, move, waitlist and refund on a client's behalf, and override booking rules. */
  manageBookings: ["owner", "admin"],
  /** Phone and email on class lists, so staff can reach a client about an issue. Instructors also get this for their own classes. */
  viewClientContacts: ["owner", "admin", "front_desk"],
  /** The client directory, full history and fees. */
  viewClientDetails: ["owner", "admin"],
  /** Create client tags and add them to clients. */
  manageClientTags: ["owner", "admin", "front_desk"],
  /** Payment details (when the payments module is built). */
  viewPayments: ["owner", "admin"],
  /** Studio policies and settings. */
  manageSettings: ["owner", "admin"],
  /** Approve or assign cover for any class. */
  manageCover: ["owner", "admin"],
} as const satisfies Record<string, readonly Role[]>;
export type Permission = keyof typeof PERMISSIONS;
export const can = (role: Role, permission: Permission): boolean => (PERMISSIONS[permission] as readonly Role[]).includes(role);

export const SESSION_STATUSES = ["scheduled", "cancelled"] as const;
export type SessionStatus = (typeof SESSION_STATUSES)[number];

export const BOOKING_STATUSES = ["confirmed", "cancelled", "late_cancelled"] as const;
export type BookingStatus = (typeof BOOKING_STATUSES)[number];

export const ATTENDANCE = ["unmarked", "present", "no_show"] as const;
export type Attendance = (typeof ATTENDANCE)[number];

export const BOOKING_SOURCES = ["client", "staff", "waitlist_automatic", "waitlist_claimed", "moved"] as const;
export type BookingSource = (typeof BOOKING_SOURCES)[number];

export const WAITLIST_MODES = ["automatic", "manual"] as const;
export type WaitlistMode = (typeof WAITLIST_MODES)[number];

export const WAITLIST_STATUSES = [
  "waiting", // in the queue
  "offered", // manual mode: a spot is being held for them
  "enrolled", // got a spot
  "expired", // their chosen cut-off passed without a spot
  "offer_lapsed", // didn't claim the held spot in time
  "declined", // turned down the held spot
  "left", // removed themselves
  "closed", // class started or was cancelled
] as const;
export type WaitlistStatus = (typeof WAITLIST_STATUSES)[number];
export const ACTIVE_WAITLIST_STATUSES: readonly WaitlistStatus[] = ["waiting", "offered"];

export const SUB_APPROVAL_MODES = ["automatic", "manual"] as const;
export type SubApprovalMode = (typeof SUB_APPROVAL_MODES)[number];

export const SUB_REQUEST_STATUSES = ["open", "awaiting_approval", "filled", "cancelled"] as const;
export type SubRequestStatus = (typeof SUB_REQUEST_STATUSES)[number];

/** How a client came to the studio. Only direct members see who else is booked in. */
export const MEMBER_SOURCES = ["direct", "classpass"] as const;
export type MemberSource = (typeof MEMBER_SOURCES)[number];

export const FEE_TYPES = ["late_cancel", "no_show"] as const;
export type FeeType = (typeof FEE_TYPES)[number];
/** pending = recorded, to be collected once payments are connected. */
export const FEE_STATUSES = ["pending", "waived", "charged"] as const;
export type FeeStatus = (typeof FEE_STATUSES)[number];

export const REFUND_METHODS = ["none", "credit", "original_payment"] as const;
export type RefundMethod = (typeof REFUND_METHODS)[number];

export const EDIT_SCOPES = ["this", "following", "all"] as const;
export type EditScope = (typeof EDIT_SCOPES)[number];

export const CALENDAR_VIEWS = ["day", "week", "month"] as const;
export type CalendarView = (typeof CALENDAR_VIEWS)[number];

export const TIMES_OF_DAY = ["morning", "afternoon", "evening"] as const;
export type TimeOfDay = (typeof TIMES_OF_DAY)[number];
/** Local-time hour ranges [from, to) used by the "time of day" filter. */
export const TIME_OF_DAY_HOURS: Record<TimeOfDay, [number, number]> = {
  morning: [0, 12],
  afternoon: [12, 17],
  evening: [17, 24],
};

export const NOTIFICATION_CHANNELS = ["email", "push"] as const;
export type NotificationChannel = (typeof NOTIFICATION_CHANNELS)[number];

/**
 * Checks that catch likely mistakes. "confirm" checks pause the action until the
 * user says "Yes, go ahead"; "info" checks are shown but never stop anything.
 */
export const FLAG_CODES = [
  // Clashes (allowed; studios run concurrent rooms and private sessions)
  "instructor_double_booked",
  "room_double_booked",
  "possible_duplicate",
  "client_double_booked",
  // Times and lengths
  "ends_after_midnight",
  "unusually_long",
  "unusually_short",
  "unusual_start_time",
  "duration_differs_from_usual",
  "in_the_past",
  "far_future",
  // Capacity
  "over_room_limit",
  // People affected
  "clients_affected",
  "waitlist_affected",
  "short_notice",
  "no_refund",
  "already_happened",
  "many_classes",
  "no_instructor",
  "instructor_not_listed",
  // Bookings, refunds and attendance
  "late_booking",
  "outside_booking_window",
  "over_weekly_limit",
  "late_cancel",
  "no_free_cancel",
  "late_move",
  "fee_applies",
  "already_refunded",
  "refund_after_attending",
  "class_not_started",
] as const;
export type FlagCode = (typeof FLAG_CODES)[number];
export type FlagSeverity = "confirm" | "info";

/** A client's favourite instructor: the one they've attended most, with at least this many classes. */
export const FAVOURITE_INSTRUCTOR_MIN_CLASSES = 3;

/** Thresholds for the checks, kept together so they're easy to tune. */
export const FLAG_LIMITS = {
  longClassMinutes: 180,
  shortClassMinutes: 15,
  earliestNormalHour: 5,
  latestNormalHour: 22,
  shortNoticeHours: 24,
  farFutureDays: 365,
  manyClasses: 20,
  durationDifferencePct: 50,
} as const;
