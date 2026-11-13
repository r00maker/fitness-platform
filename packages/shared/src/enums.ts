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
 * | Front of House  | the whole schedule + rosters, | attendance, client tags, health |
 * |                 | incl. client contact details  | notes, marking waivers complete |
 * | Instructor      | their own classes only, incl. | attendance and marking waivers  |
 * |                 | contact details for them      | complete on their own classes;  |
 * |                 |                               | asking for cover (not choosing) |
 * | Client          | the public schedule, own data | their own bookings, waiver and  |
 * |                 |                               | health notes                    |
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
  /** Choose who is asked to cover, approve offers and assign cover. Instructors can only ask for cover. */
  manageCover: ["owner", "admin"],
  /** Mark a client's waiver as complete (e.g. a ClassPass client who signed at the desk). Instructors: clients in their own classes. */
  confirmWaivers: ["owner", "admin", "front_desk", "instructor"],
  /** Undo a waiver marked complete. Admin only, so a mis-tap can't be undone by accident either way. */
  reverseWaivers: ["owner", "admin"],
  /** Add or resolve a health note on a client's behalf (clients manage their own). */
  manageHealthNotes: ["owner", "admin", "front_desk"],
  /** Set up package types, sell packages to clients, and adjust or cancel them. */
  managePackages: ["owner", "admin"],
  /** Pay rates, adjustments, pay reports and marking pay as paid. */
  managePayroll: ["owner", "admin"],
  /** Add staff (they get an email to set their password), change roles, remove access. */
  manageStaff: ["owner", "admin"],
  /** Read and answer client messages in the Communication inbox (Front of House answer messages too). */
  useInbox: ["owner", "admin", "front_desk"],
  /** Connect WhatsApp, choose how messages are paid for, buy message credits. */
  manageComms: ["owner", "admin"],
  /** Set up agents (name them, choose what they see and who they tell) and the support assistant. */
  manageAgents: ["owner", "admin"],
  /** Revenue, sales, attendance and conversion reports. */
  viewReports: ["owner", "admin"],
  /** Segments, emails, campaigns, journeys, banners, gift cards and referral settings. */
  manageMarketing: ["owner", "admin"],
  /** Post an announcement to clients, e.g. "The lift is out of order". Front desk can too, since they're first to know. */
  postAnnouncements: ["owner", "admin", "front_desk"],
} as const satisfies Record<string, readonly Role[]>;
export type Permission = keyof typeof PERMISSIONS;
export const can = (role: Role, permission: Permission): boolean => (PERMISSIONS[permission] as readonly Role[]).includes(role);

/**
 * Class: on the public schedule, clients book themselves.
 * Appointment: private sessions (e.g. one-to-ones). Not on the public schedule; the studio books the client in.
 */
export const CLASS_TYPE_KINDS = ["class", "appointment"] as const;
export type ClassTypeKind = (typeof CLASS_TYPE_KINDS)[number];

export const SESSION_STATUSES = ["scheduled", "cancelled"] as const;
export type SessionStatus = (typeof SESSION_STATUSES)[number];

export const BOOKING_STATUSES = ["confirmed", "cancelled", "late_cancelled"] as const;
export type BookingStatus = (typeof BOOKING_STATUSES)[number];

export const ATTENDANCE = ["unmarked", "present", "no_show"] as const;
export type Attendance = (typeof ATTENDANCE)[number];

export const BOOKING_SOURCES = ["client", "staff", "waitlist_automatic", "waitlist_claimed", "moved", "classpass"] as const;
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

/** How a waiver was completed: signed in the app by the client, or checked and marked by staff. */
export const WAIVER_METHODS = ["signed_by_client", "confirmed_by_staff"] as const;
export type WaiverMethod = (typeof WAIVER_METHODS)[number];

/** Injuries and conditions clients tell the studio about. The client picks one; we suggest it from what they type. */
export const HEALTH_CATEGORIES = ["injury", "pregnancy", "postnatal", "recent_surgery", "medical_condition", "other"] as const;
export type HealthCategory = (typeof HEALTH_CATEGORIES)[number];
export const HEALTH_NOTE_STATUSES = ["active", "resolved"] as const;
export type HealthNoteStatus = (typeof HEALTH_NOTE_STATUSES)[number];
/** A note is checked with the client ("still current?") when they book, once it's this many days since they last confirmed it. */
export const HEALTH_NOTE_REVIEW_DAYS = 30;
export const HEALTH_NOTE_MAX_LENGTH = 280;

// ---- Packages ----------------------------------------------------------------
/** "credits": a number of classes (e.g. a 10-class pack). "unlimited": any number of classes while it's valid. */
export const PACKAGE_KINDS = ["credits", "unlimited"] as const;
export type PackageKind = (typeof PACKAGE_KINDS)[number];
export const VALIDITY_UNITS = ["days", "weeks", "months"] as const;
export type ValidityUnit = (typeof VALIDITY_UNITS)[number];
/** When the validity countdown starts: when it's bought, or when its first class is booked. */
export const PACKAGE_STARTS = ["purchase", "first_booking"] as const;
export type PackageStart = (typeof PACKAGE_STARTS)[number];
/** Shared packages: everyone draws from one pool, or each person has their own share of the credits. */
export const SHARING_MODES = ["pool", "allocated"] as const;
export type SharingMode = (typeof SHARING_MODES)[number];
/** Worked out when needed, never stored, so a package can't be "stuck" in the wrong state. */
export const PACKAGE_STATES = ["not_started", "active", "used_up", "expired", "cancelled"] as const;
export type PackageState = (typeof PACKAGE_STATES)[number];
/**
 * Everything that happens to a package, so its history reads as a clear timeline.
 * Credit changes carry a number; other events (activation, extensions…) carry 0.
 */
export const PACKAGE_LEDGER_REASONS = [
  "purchase",
  "booked",
  "returned",
  "refunded",
  "adjusted",
  "activated",
  "extended",
  "expiry_changed",
  "rolled_over",
  "renewed",
  "cancelled",
  "plan_updated",
] as const;
export type PackageLedgerReason = (typeof PACKAGE_LEDGER_REASONS)[number];
/** How a booking is paid for. "pay_later" = settled at the studio (or once payments are switched on). */
/** "classpass": the client paid ClassPass, so no package or payment is taken by the studio. */
export const BOOKING_PAYMENTS = ["package", "complimentary", "pay_later", "classpass"] as const;
export type BookingPayment = (typeof BOOKING_PAYMENTS)[number];
export const MAX_PACKAGE_SHARERS = 10;
/** One-time: bought once. Recurring: a membership that renews every period until it's cancelled. */
export const PACKAGE_BILLING = ["one_time", "recurring"] as const;
export type PackageBilling = (typeof PACKAGE_BILLING)[number];
/**
 * Leaving a membership before its minimum term: not allowed (it runs to the end of the term),
 * a set fee, or the rest of the minimum term charged.
 */
export const EARLY_CANCEL_FEE_MODES = ["none", "flat", "remaining"] as const;
export type EarlyCancelFeeMode = (typeof EARLY_CANCEL_FEE_MODES)[number];
/** Package type edits: which packages they change. */
export const PLAN_EDIT_SCOPES = ["new", "existing", "both"] as const;
export type PlanEditScope = (typeof PLAN_EDIT_SCOPES)[number];

/** How a studio handles clients asking for more time on a package. */
export const EXTENSION_MODES = ["off", "review", "auto"] as const;
export type ExtensionMode = (typeof EXTENSION_MODES)[number];
export const EXTENSION_ATTACHMENT = ["off", "optional", "required"] as const;
export const EXTENSION_FEE_MODES = ["free", "flat", "per_week"] as const;
export type ExtensionFeeMode = (typeof EXTENSION_FEE_MODES)[number];
export const EXTENSION_STATUSES = ["pending", "approved", "declined", "withdrawn"] as const;
export type ExtensionStatus = (typeof EXTENSION_STATUSES)[number];
/** Moving unused classes from one package to a new one: off, staff only, or clients too when they buy. */
export const ROLLOVER_MODES = ["off", "staff", "clients"] as const;
export type RolloverMode = (typeof ROLLOVER_MODES)[number];

/** Uploaded files: package photos (visible to the studio's members) and extension attachments (private). */
export const FILE_PURPOSES = ["package_photo", "extension_attachment", "email_image", "banner", "gift_card_design"] as const;
/** Shown outside the app (in emails) or to anyone in the studio, so served from a public address. */
export const PUBLIC_FILE_PURPOSES: readonly FilePurpose[] = ["email_image", "banner", "gift_card_design", "package_photo"];
export type FilePurpose = (typeof FILE_PURPOSES)[number];
export const FILE_TYPES = ["image/jpeg", "image/png", "image/webp", "application/pdf"] as const;
export const MAX_FILE_BYTES = { package_photo: 2 * 1024 * 1024, extension_attachment: 5 * 1024 * 1024, email_image: 2 * 1024 * 1024, banner: 2 * 1024 * 1024, gift_card_design: 2 * 1024 * 1024 } as const;

export const ORDER_STATUSES = ["pending", "paid", "cancelled"] as const;
export type OrderStatus = (typeof ORDER_STATUSES)[number];
/** A package type nobody's using and that hasn't sold for this long is suggested for archiving. */
export const ARCHIVE_SUGGEST_AFTER_DAYS = 180;

// ---- Payroll -----------------------------------------------------------------
/**
 * per_class: a flat amount for each class taught.
 * per_client: an optional base, plus an amount for each client (optionally after the first few), with an optional minimum.
 * tiered: a set amount depending on how many clients came.
 * hourly: an hourly rate, paid on the class's length.
 * salary: a fixed amount each pay period (front desk, managers, salaried instructors).
 */
export const PAY_RATE_TYPES = ["per_class", "per_client", "tiered", "hourly", "salary"] as const;
export type PayRateType = (typeof PAY_RATE_TYPES)[number];
export const PAY_PERIODS = ["weekly", "fortnightly", "twice_monthly", "monthly"] as const;
export type PayPeriod = (typeof PAY_PERIODS)[number];
/** Who counts towards per-client and tiered pay: clients who attended, or everyone booked (no-shows included). */
export const PAY_HEADCOUNTS = ["attended", "booked"] as const;
export type PayHeadcount = (typeof PAY_HEADCOUNTS)[number];

/** Light or dark colours. "system" follows the phone or computer's own setting. */
export const THEMES = ["system", "light", "dark"] as const;
export type Theme = (typeof THEMES)[number];

export const FEE_TYPES = ["late_cancel", "no_show", "package_extension", "early_cancellation"] as const;
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

export const NOTIFICATION_CHANNELS = ["email", "push", "whatsapp"] as const;
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
  // Rooms
  "room_has_classes",
  "room_smaller",
  "spots_removed",
  // Marketing
  "send_to_many",
  "people_skipped",
  "journey_starts",
  // Waivers
  "waiver_missing",
  "confirm_waiver_complete",
  // Appointments and ClassPass
  "appointment_no_client",
  "delete_class_type",
  "whatsapp_charge",
  "classpass_reduced",
  // Packages and payroll
  "no_package",
  "package_expired",
  "pay_already_marked_paid",
  "period_not_over",
  "existing_packages_affected",
  "packages_would_expire",
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
