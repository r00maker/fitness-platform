/**
 * Database schema. Every business table carries `org_id` so one studio can
 * never read or change another studio's data (multi-tenant isolation).
 * All timestamps are stored in UTC (`timestamptz`); local times are worked out
 * from each location's time zone.
 */
import { sql } from "drizzle-orm";
import {
  boolean,
  check,
  index,
  integer,
  jsonb,
  pgEnum,
  pgTable,
  smallint,
  text,
  timestamp,
  uniqueIndex,
  uuid,
  date,
  time,
  customType,
} from "drizzle-orm/pg-core";
import {
  ATTENDANCE,
  FEE_STATUSES,
  FEE_TYPES,
  HEALTH_CATEGORIES,
  HEALTH_NOTE_STATUSES,
  THEMES,
  BOOKING_PAYMENTS,
  PACKAGE_KINDS,
  PACKAGE_LEDGER_REASONS,
  PACKAGE_STARTS,
  PAY_HEADCOUNTS,
  PAY_PERIODS,
  PAY_RATE_TYPES,
  SHARING_MODES,
  VALIDITY_UNITS,
  type PayTier,
  EXTENSION_ATTACHMENT,
  EXTENSION_FEE_MODES,
  EXTENSION_MODES,
  EXTENSION_STATUSES,
  FILE_PURPOSES,
  ORDER_STATUSES,
  PACKAGE_BILLING,
  ROLLOVER_MODES,
  EARLY_CANCEL_FEE_MODES,
  WAIVER_METHODS,
  MEMBER_SOURCES,
  BOOKING_SOURCES,
  BOOKING_STATUSES,
  NOTIFICATION_CHANNELS,
  REFUND_METHODS,
  ROLES,
  SESSION_STATUSES,
  SUB_APPROVAL_MODES,
  SUB_REQUEST_STATUSES,
  WAITLIST_MODES,
  WAITLIST_STATUSES,
} from "@studio/shared";

export const roleEnum = pgEnum("role", ROLES);
export const sessionStatusEnum = pgEnum("session_status", SESSION_STATUSES);
export const bookingStatusEnum = pgEnum("booking_status", BOOKING_STATUSES);
export const bookingSourceEnum = pgEnum("booking_source", BOOKING_SOURCES);
export const attendanceEnum = pgEnum("attendance", ATTENDANCE);
export const waitlistModeEnum = pgEnum("waitlist_mode", WAITLIST_MODES);
export const waitlistStatusEnum = pgEnum("waitlist_status", WAITLIST_STATUSES);
export const subApprovalEnum = pgEnum("sub_approval_mode", SUB_APPROVAL_MODES);
export const subStatusEnum = pgEnum("sub_request_status", SUB_REQUEST_STATUSES);
export const refundMethodEnum = pgEnum("refund_method", REFUND_METHODS);
export const channelEnum = pgEnum("notification_channel", NOTIFICATION_CHANNELS);
export const memberSourceEnum = pgEnum("member_source", MEMBER_SOURCES);
export const feeTypeEnum = pgEnum("fee_type", FEE_TYPES);
export const feeStatusEnum = pgEnum("fee_status", FEE_STATUSES);
export const waiverMethodEnum = pgEnum("waiver_method", WAIVER_METHODS);
export const healthCategoryEnum = pgEnum("health_category", HEALTH_CATEGORIES);
export const healthNoteStatusEnum = pgEnum("health_note_status", HEALTH_NOTE_STATUSES);
export const themeEnum = pgEnum("theme", THEMES);
export const packageKindEnum = pgEnum("package_kind", PACKAGE_KINDS);
export const validityUnitEnum = pgEnum("validity_unit", VALIDITY_UNITS);
export const packageStartEnum = pgEnum("package_start", PACKAGE_STARTS);
export const sharingModeEnum = pgEnum("sharing_mode", SHARING_MODES);
export const ledgerReasonEnum = pgEnum("package_ledger_reason", PACKAGE_LEDGER_REASONS);
export const bookingPaymentEnum = pgEnum("booking_payment", BOOKING_PAYMENTS);
export const payRateTypeEnum = pgEnum("pay_rate_type", PAY_RATE_TYPES);
export const payPeriodEnum = pgEnum("pay_period", PAY_PERIODS);
export const payHeadcountEnum = pgEnum("pay_headcount", PAY_HEADCOUNTS);
export const packageBillingEnum = pgEnum("package_billing", PACKAGE_BILLING);
export const extensionModeEnum = pgEnum("extension_mode", EXTENSION_MODES);
export const extensionAttachmentEnum = pgEnum("extension_attachment", EXTENSION_ATTACHMENT);
export const extensionFeeModeEnum = pgEnum("extension_fee_mode", EXTENSION_FEE_MODES);
export const extensionStatusEnum = pgEnum("extension_status", EXTENSION_STATUSES);
export const rolloverModeEnum = pgEnum("rollover_mode", ROLLOVER_MODES);
export const filePurposeEnum = pgEnum("file_purpose", FILE_PURPOSES);
export const orderStatusEnum = pgEnum("order_status", ORDER_STATUSES);
export const earlyCancelFeeModeEnum = pgEnum("early_cancel_fee_mode", EARLY_CANCEL_FEE_MODES);
const bytea = customType<{ data: Buffer }>({ dataType: () => "bytea" });
export const notificationStatusEnum = pgEnum("notification_status", ["pending", "sent", "failed"]);

const pk = () => uuid("id").primaryKey().defaultRandom();
const createdAt = () => timestamp("created_at", { withTimezone: true }).notNull().defaultNow();
const updatedAt = () =>
  timestamp("updated_at", { withTimezone: true })
    .notNull()
    .defaultNow()
    .$onUpdate(() => new Date());
const ts = (name: string) => timestamp(name, { withTimezone: true });

// ---------------------------------------------------------------------------
// Studios, people and access
// ---------------------------------------------------------------------------
export const organizations = pgTable("organizations", {
  id: pk(),
  name: text("name").notNull(),
  timezone: text("timezone").notNull().default("UTC"),
  substituteApproval: subApprovalEnum("substitute_approval").notNull().default("manual"),
  waitlistHoldMinutes: integer("waitlist_hold_minutes").notNull().default(10),
  waitlistExpiryOptionsHours: integer("waitlist_expiry_options_hours")
    .array()
    .notNull()
    .default(sql`'{5,3,1}'::integer[]`),
  lateCancelWindowHours: integer("late_cancel_window_hours").notNull().default(12),
  notifyClientsOnInstructorChange: boolean("notify_clients_on_instructor_change").notNull().default(true),
  /** Off by default: most of Southeast Asia has no daylight saving, so a fixed offset is used. */
  observesDaylightSaving: boolean("observes_daylight_saving").notNull().default(false),
  // Booking rules
  /** Calendar days before the class date that booking opens (at local midnight). */
  bookingOpensDaysBefore: integer("booking_opens_days_before").notNull().default(14),
  bookingClosesMinutesBefore: integer("booking_closes_minutes_before").notNull().default(60),
  /** Null = unlimited (the default). */
  weeklyBookingLimit: integer("weekly_booking_limit"),
  currency: text("currency").notNull().default("SGD"),
  lateCancelFeeEnabled: boolean("late_cancel_fee_enabled").notNull().default(false),
  lateCancelFeeCents: integer("late_cancel_fee_cents").notNull().default(0),
  noShowFeeEnabled: boolean("no_show_fee_enabled").notNull().default(false),
  noShowFeeCents: integer("no_show_fee_cents").notNull().default(0),
  // Waivers
  waiverRequired: boolean("waiver_required").notNull().default(true),
  /** The studio's own wording. Null = a short standard waiver is shown until the studio adds theirs. */
  waiverText: text("waiver_text"),
  /** Goes up by one each time the wording changes, so each signature records which version was signed. */
  waiverVersion: integer("waiver_version").notNull().default(1),
  /** Studio-wide switch for choosing a spot when booking (rooms also need named spots). */
  spotBookingEnabled: boolean("spot_booking_enabled").notNull().default(true),
  /** Clients need a package that covers the class to book it (off = book now, pay at the studio). */
  clientsNeedPackage: boolean("clients_need_package").notNull().default(true),
  // Payroll
  payPeriod: payPeriodEnum("pay_period").notNull().default("monthly"),
  /** Fortnightly pay: any date a pay fortnight starts on. */
  payPeriodAnchor: date("pay_period_anchor"),
  payHeadcount: payHeadcountEnum("pay_headcount").notNull().default("attended"),
  instructorsSeeOwnPay: boolean("instructors_see_own_pay").notNull().default(true),
  // Package extensions and rollovers
  extensionMode: extensionModeEnum("extension_mode").notNull().default("review"),
  extensionAutoDays: integer("extension_auto_days").notNull().default(14),
  extensionMaxDays: integer("extension_max_days").notNull().default(60),
  extensionAttachment: extensionAttachmentEnum("extension_attachment").notNull().default("optional"),
  extensionFeeMode: extensionFeeModeEnum("extension_fee_mode").notNull().default("free"),
  extensionFeeCents: integer("extension_fee_cents").notNull().default(0),
  rolloverMode: rolloverModeEnum("rollover_mode").notNull().default("off"),
  rolloverMaxCredits: integer("rollover_max_credits"),
  rolloverWithinDays: integer("rollover_within_days").notNull().default(30),
  createdAt: createdAt(),
  updatedAt: updatedAt(),
});

/** A person. One login can belong to several studios via memberships. */
export const users = pgTable(
  "users",
  {
    id: pk(),
    email: text("email").notNull(),
    firstName: text("first_name").notNull(),
    lastName: text("last_name").notNull(),
    phone: text("phone"),
    /** Profile photo, stored in private file storage and served through short-lived links. */
    photoUrl: text("photo_url"),
    /** Light/dark colours, kept on the account so web and mobile match. */
    theme: themeEnum("theme").notNull().default("system"),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [uniqueIndex("users_email_lower_uq").on(sql`lower(${t.email})`)],
);

export const memberships = pgTable(
  "memberships",
  {
    id: pk(),
    orgId: uuid("org_id").notNull().references(() => organizations.id, { onDelete: "cascade" }),
    userId: uuid("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
    role: roleEnum("role").notNull(),
    active: boolean("active").notNull().default(true),
    /** Clients only: direct studio member, or booked in through ClassPass (integration to come). */
    source: memberSourceEnum("source").notNull().default("direct"),
    /** Clients only: whether other members can see them on class lists. */
    showInAttendeeList: boolean("show_in_attendee_list").notNull().default(true),
    createdAt: createdAt(),
  },
  (t) => [uniqueIndex("memberships_org_user_uq").on(t.orgId, t.userId)],
);

export const pushTokens = pgTable(
  "push_tokens",
  {
    id: pk(),
    userId: uuid("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
    token: text("token").notNull(),
    platform: text("platform").notNull(),
    createdAt: createdAt(),
  },
  (t) => [uniqueIndex("push_tokens_token_uq").on(t.token)],
);

// ---------------------------------------------------------------------------
// Places and class definitions
// ---------------------------------------------------------------------------
export const locations = pgTable("locations", {
  id: pk(),
  orgId: uuid("org_id").notNull().references(() => organizations.id, { onDelete: "cascade" }),
  name: text("name").notNull(),
  timezone: text("timezone").notNull(),
  address: text("address"),
  archivedAt: ts("archived_at"),
  createdAt: createdAt(),
});

export const rooms = pgTable("rooms", {
  id: pk(),
  orgId: uuid("org_id").notNull().references(() => organizations.id, { onDelete: "cascade" }),
  locationId: uuid("location_id").notNull().references(() => locations.id),
  name: text("name").notNull(),
  capacity: integer("capacity"),
  /** Named spots ("Reformer 1", "Bike 12"…). When set, clients pick a spot when booking. */
  spotLabels: text("spot_labels").array(),
  archivedAt: ts("archived_at"),
  createdAt: createdAt(),
});

export const classTypes = pgTable("class_types", {
  id: pk(),
  orgId: uuid("org_id").notNull().references(() => organizations.id, { onDelete: "cascade" }),
  name: text("name").notNull(),
  description: text("description"),
  color: text("color").notNull(),
  defaultDurationMinutes: integer("default_duration_minutes"),
  archivedAt: ts("archived_at"),
  createdAt: createdAt(),
  updatedAt: updatedAt(),
});

/** Who can teach (and cover) each class type. Empty = anyone who teaches. */
export const classTypeInstructors = pgTable(
  "class_type_instructors",
  {
    orgId: uuid("org_id").notNull().references(() => organizations.id, { onDelete: "cascade" }),
    classTypeId: uuid("class_type_id").notNull().references(() => classTypes.id, { onDelete: "cascade" }),
    instructorId: uuid("instructor_id").notNull().references(() => users.id, { onDelete: "cascade" }),
    createdAt: createdAt(),
  },
  (t) => [uniqueIndex("class_type_instructor_uq").on(t.classTypeId, t.instructorId)],
);

// ---------------------------------------------------------------------------
// Packages
// ---------------------------------------------------------------------------
/**
 * Uploaded files (package photos, extension attachments). Kept in the database for now,
 * size-limited and type-checked; they can move to object storage later behind the same API.
 */
export const files = pgTable(
  "files",
  {
    id: pk(),
    orgId: uuid("org_id").notNull().references(() => organizations.id, { onDelete: "cascade" }),
    uploadedBy: uuid("uploaded_by").notNull().references(() => users.id, { onDelete: "cascade" }),
    purpose: filePurposeEnum("purpose").notNull(),
    contentType: text("content_type").notNull(),
    sizeBytes: integer("size_bytes").notNull(),
    data: bytea("data").notNull(),
    createdAt: createdAt(),
  },
  (t) => [index("files_org_idx").on(t.orgId)],
);

/** Groups on the buying page ("Class packs", "Memberships", "Intro offers"…). */
export const packageCategories = pgTable("package_categories", {
  id: pk(),
  orgId: uuid("org_id").notNull().references(() => organizations.id, { onDelete: "cascade" }),
  name: text("name").notNull(),
  description: text("description"),
  sortOrder: integer("sort_order").notNull().default(0),
  createdAt: createdAt(),
});

/** A package the studio sells (its terms). Changes reach packages already sold only if the admin chooses. */
export const packagePlans = pgTable("package_plans", {
  id: pk(),
  orgId: uuid("org_id").notNull().references(() => organizations.id, { onDelete: "cascade" }),
  name: text("name").notNull(),
  description: text("description"),
  photoFileId: uuid("photo_file_id").references(() => files.id, { onDelete: "set null" }),
  categoryId: uuid("category_id").references(() => packageCategories.id, { onDelete: "set null" }),
  /** Position within its category on the buying page. */
  sortOrder: integer("sort_order").notNull().default(0),
  billing: packageBillingEnum("billing").notNull().default("one_time"),
  rolloverCap: integer("rollover_cap"),
  commitmentCycles: integer("commitment_cycles"),
  earlyCancelFeeMode: earlyCancelFeeModeEnum("early_cancel_fee_mode").notNull().default("none"),
  earlyCancelFeeCents: integer("early_cancel_fee_cents"),
  /** Hidden and no longer sold; packages already sold keep working. */
  archivedAt: ts("archived_at"),
  kind: packageKindEnum("kind").notNull(),
  credits: integer("credits"),
  priceCents: integer("price_cents").notNull().default(0),
  validityValue: integer("validity_value"),
  validityUnit: validityUnitEnum("validity_unit"),
  startsOn: packageStartEnum("starts_on").notNull().default("purchase"),
  activateWithinDays: integer("activate_within_days"),
  maxUsers: integer("max_users").notNull().default(1),
  sharingMode: sharingModeEnum("sharing_mode"),
  weeklyLimit: integer("weekly_limit"),
  /** Empty = every class. */
  classTypeIds: uuid("class_type_ids").array().notNull().default(sql`'{}'::uuid[]`),
  onSale: boolean("on_sale").notNull().default(true),
  createdAt: createdAt(),
  updatedAt: updatedAt(),
});

/** A package a client owns: a copy of the terms at the time it was sold, plus its balance and dates. */
export const clientPackages = pgTable(
  "client_packages",
  {
    id: pk(),
    orgId: uuid("org_id").notNull().references(() => organizations.id, { onDelete: "cascade" }),
    planId: uuid("plan_id").references(() => packagePlans.id),
    ownerId: uuid("owner_id").notNull().references(() => users.id, { onDelete: "cascade" }),
    name: text("name").notNull(),
    kind: packageKindEnum("kind").notNull(),
    creditsTotal: integer("credits_total"),
    /** Credit packs: classes left for everyone sharing it. Null for unlimited. */
    creditsLeft: integer("credits_left"),
    validityValue: integer("validity_value"),
    validityUnit: validityUnitEnum("validity_unit"),
    startsOn: packageStartEnum("starts_on").notNull(),
    /** Countdown starts at the first booking: it expires if nothing is booked by then. */
    activateBy: ts("activate_by"),
    startedAt: ts("started_at"),
    /** First moment it can no longer be used. Null = never expires (or not started yet). */
    expiresAt: ts("expires_at"),
    maxUsers: integer("max_users").notNull().default(1),
    sharingMode: sharingModeEnum("sharing_mode"),
    weeklyLimit: integer("weekly_limit"),
    classTypeIds: uuid("class_type_ids").array().notNull().default(sql`'{}'::uuid[]`),
    billing: packageBillingEnum("billing").notNull().default("one_time"),
    rolloverCap: integer("rollover_cap"),
    commitmentCycles: integer("commitment_cycles"),
    /** Recurring: classes each period gives. */
    creditsPerCycle: integer("credits_per_cycle"),
    /** Recurring: which period it's in (1 = the first). */
    cycle: integer("cycle").notNull().default(1),
    /** Recurring: set when it's been stopped; it ends at the end of the current period (or minimum term). */
    stopsRenewingAt: ts("stops_renewing_at"),
    /** Stopped during the minimum term with the early cancellation fee: ends at the end of the current period. */
    endsEarly: boolean("ends_early").notNull().default(false),
    /** The early cancellation terms agreed at purchase. */
    earlyCancelFeeMode: earlyCancelFeeModeEnum("early_cancel_fee_mode").notNull().default("none"),
    earlyCancelFeeCents: integer("early_cancel_fee_cents"),
    pricePaidCents: integer("price_paid_cents").notNull().default(0),
    currency: text("currency").notNull(),
    soldBy: uuid("sold_by").references(() => users.id),
    note: text("note"),
    purchasedAt: ts("purchased_at").notNull().defaultNow(),
    cancelledAt: ts("cancelled_at"),
    cancelReason: text("cancel_reason"),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [index("client_packages_owner_idx").on(t.orgId, t.ownerId), check("client_packages_credits_ok", sql`${t.creditsLeft} is null or ${t.creditsLeft} >= 0`)],
);

/** Everyone who can use a package, the buyer included. `allocatedCredits` = their own share left (allocated sharing only). */
export const clientPackageMembers = pgTable(
  "client_package_members",
  {
    orgId: uuid("org_id").notNull().references(() => organizations.id, { onDelete: "cascade" }),
    packageId: uuid("package_id").notNull().references(() => clientPackages.id, { onDelete: "cascade" }),
    userId: uuid("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
    allocatedCredits: integer("allocated_credits"),
    addedBy: uuid("added_by").references(() => users.id),
    createdAt: createdAt(),
  },
  (t) => [uniqueIndex("package_member_uq").on(t.packageId, t.userId), index("package_member_user_idx").on(t.orgId, t.userId), check("package_member_alloc_ok", sql`${t.allocatedCredits} is null or ${t.allocatedCredits} >= 0`)],
);

/** Every change to a package's credits, so staff and clients can see where each class went. */
export const packageLedger = pgTable(
  "package_ledger",
  {
    id: pk(),
    orgId: uuid("org_id").notNull().references(() => organizations.id, { onDelete: "cascade" }),
    packageId: uuid("package_id").notNull().references(() => clientPackages.id, { onDelete: "cascade" }),
    userId: uuid("user_id").references(() => users.id),
    bookingId: uuid("booking_id"),
    change: integer("change").notNull(),
    reason: ledgerReasonEnum("reason").notNull(),
    note: text("note"),
    details: jsonb("details").$type<Record<string, unknown>>(),
    createdBy: uuid("created_by").references(() => users.id),
    createdAt: createdAt(),
  },
  (t) => [index("package_ledger_pkg_idx").on(t.packageId, t.createdAt)],
);

export const classTemplates = pgTable("class_templates", {
  id: pk(),
  orgId: uuid("org_id").notNull().references(() => organizations.id, { onDelete: "cascade" }),
  name: text("name").notNull(),
  classTypeId: uuid("class_type_id").notNull().references(() => classTypes.id),
  locationId: uuid("location_id").notNull().references(() => locations.id),
  roomId: uuid("room_id").references(() => rooms.id),
  instructorId: uuid("instructor_id").references(() => users.id),
  capacity: integer("capacity").notNull(),
  durationMinutes: integer("duration_minutes").notNull(),
  /** Default local start time, e.g. 07:30 */
  startTime: time("start_time"),
  waitlistEnabled: boolean("waitlist_enabled").notNull().default(true),
  waitlistCapacity: integer("waitlist_capacity"),
  archivedAt: ts("archived_at"),
  createdAt: createdAt(),
  updatedAt: updatedAt(),
});

// ---------------------------------------------------------------------------
// Schedule
// ---------------------------------------------------------------------------
/** A recurring rule ("every Mon & Wed at 07:00"). It generates sessions. */
export const classSeries = pgTable("class_series", {
  id: pk(),
  orgId: uuid("org_id").notNull().references(() => organizations.id, { onDelete: "cascade" }),
  templateId: uuid("template_id").references(() => classTemplates.id),
  classTypeId: uuid("class_type_id").notNull().references(() => classTypes.id),
  locationId: uuid("location_id").notNull().references(() => locations.id),
  roomId: uuid("room_id").references(() => rooms.id),
  instructorId: uuid("instructor_id").references(() => users.id),
  capacity: integer("capacity").notNull(),
  durationMinutes: integer("duration_minutes").notNull(),
  waitlistEnabled: boolean("waitlist_enabled").notNull(),
  waitlistCapacity: integer("waitlist_capacity"),
  startTime: time("start_time").notNull(),
  daysOfWeek: smallint("days_of_week").array().notNull(),
  everyNWeeks: smallint("every_n_weeks").notNull().default(1),
  startDate: date("start_date").notNull(),
  endDate: date("end_date"),
  occurrences: integer("occurrences"),
  /** Sessions have been generated up to (and including) this local date. */
  generatedThrough: date("generated_through"),
  endedAt: ts("ended_at"),
  createdAt: createdAt(),
  updatedAt: updatedAt(),
});

/** One class on the calendar. */
export const classSessions = pgTable(
  "class_sessions",
  {
    id: pk(),
    orgId: uuid("org_id").notNull().references(() => organizations.id, { onDelete: "cascade" }),
    seriesId: uuid("series_id").references(() => classSeries.id),
    templateId: uuid("template_id").references(() => classTemplates.id),
    classTypeId: uuid("class_type_id").notNull().references(() => classTypes.id),
    locationId: uuid("location_id").notNull().references(() => locations.id),
    roomId: uuid("room_id").references(() => rooms.id),
    instructorId: uuid("instructor_id").references(() => users.id),
    /** Set when the instructor is covering: who usually teaches this class. */
    coverForInstructorId: uuid("cover_for_instructor_id").references(() => users.id),
    startsAt: ts("starts_at").notNull(),
    endsAt: ts("ends_at").notNull(),
    capacity: integer("capacity").notNull(),
    waitlistEnabled: boolean("waitlist_enabled").notNull().default(true),
    waitlistCapacity: integer("waitlist_capacity"),
    status: sessionStatusEnum("status").notNull().default("scheduled"),
    cancelledAt: ts("cancelled_at"),
    cancelReason: text("cancel_reason"),
    notes: text("notes"),
    /** True once this occurrence was edited on its own, so series-wide edits skip it. */
    detachedFromSeries: boolean("detached_from_series").notNull().default(false),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    index("sessions_org_start_idx").on(t.orgId, t.startsAt),
    index("sessions_instructor_start_idx").on(t.instructorId, t.startsAt),
    index("sessions_series_idx").on(t.seriesId, t.startsAt),
    check("sessions_end_after_start", sql`${t.endsAt} > ${t.startsAt}`),
    check("sessions_capacity_positive", sql`${t.capacity} > 0`),
  ],
);

export const bookings = pgTable(
  "bookings",
  {
    id: pk(),
    orgId: uuid("org_id").notNull().references(() => organizations.id, { onDelete: "cascade" }),
    sessionId: uuid("session_id").notNull().references(() => classSessions.id),
    clientId: uuid("client_id").notNull().references(() => users.id),
    status: bookingStatusEnum("status").notNull().default("confirmed"),
    attendance: attendanceEnum("attendance").notNull().default("unmarked"),
    source: bookingSourceEnum("source").notNull(),
    /** 1-based spot number in rooms with spot selection. */
    spot: integer("spot"),
    /** How it's paid for, and the package used (if any). */
    payment: bookingPaymentEnum("payment").notNull().default("pay_later"),
    clientPackageId: uuid("client_package_id").references(() => clientPackages.id),
    bookedBy: uuid("booked_by").references(() => users.id),
    cancelledAt: ts("cancelled_at"),
    attendanceMarkedAt: ts("attendance_marked_at"),
    attendanceMarkedBy: uuid("attendance_marked_by").references(() => users.id),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    // A client can only hold one active booking per class.
    uniqueIndex("bookings_one_active_per_client")
      .on(t.sessionId, t.clientId)
      .where(sql`${t.status} = 'confirmed'`),
    uniqueIndex("bookings_one_client_per_spot")
      .on(t.sessionId, t.spot)
      .where(sql`${t.status} = 'confirmed' and ${t.spot} is not null`),
    index("bookings_session_idx").on(t.sessionId),
    index("bookings_client_idx").on(t.clientId),
  ],
);

export const refunds = pgTable("refunds", {
  id: pk(),
  orgId: uuid("org_id").notNull().references(() => organizations.id, { onDelete: "cascade" }),
  bookingId: uuid("booking_id").notNull().references(() => bookings.id),
  method: refundMethodEnum("method").notNull(),
  amountCents: integer("amount_cents"),
  reason: text("reason"),
  /** Reference from the payment provider once the payments module is connected. */
  providerRef: text("provider_ref"),
  createdBy: uuid("created_by").references(() => users.id),
  createdAt: createdAt(),
});

/** The studio's own client labels, e.g. "Injury: lower back", "VIP", "Prenatal". */
export const clientTags = pgTable(
  "client_tags",
  {
    id: pk(),
    orgId: uuid("org_id").notNull().references(() => organizations.id, { onDelete: "cascade" }),
    name: text("name").notNull(),
    color: text("color").notNull().default("#64748b"),
    /** Shown straight under the client's name on class lists; other tags sit under "More". */
    pinned: boolean("pinned").notNull().default(false),
    createdAt: createdAt(),
  },
  (t) => [uniqueIndex("client_tags_name_uq").on(t.orgId, sql`lower(${t.name})`)],
);

export const clientTagAssignments = pgTable(
  "client_tag_assignments",
  {
    orgId: uuid("org_id").notNull().references(() => organizations.id, { onDelete: "cascade" }),
    clientId: uuid("client_id").notNull().references(() => users.id, { onDelete: "cascade" }),
    tagId: uuid("tag_id").notNull().references(() => clientTags.id, { onDelete: "cascade" }),
    createdAt: createdAt(),
  },
  (t) => [uniqueIndex("client_tag_assignment_uq").on(t.clientId, t.tagId), index("client_tag_assignment_org_idx").on(t.orgId, t.clientId)],
);

/**
 * Completed waivers. Rows are never deleted: undoing one (admins only) sets
 * `revokedAt`, so there's always a record of who signed or marked what, and when.
 */
export const clientWaivers = pgTable(
  "client_waivers",
  {
    id: pk(),
    orgId: uuid("org_id").notNull().references(() => organizations.id, { onDelete: "cascade" }),
    clientId: uuid("client_id").notNull().references(() => users.id, { onDelete: "cascade" }),
    method: waiverMethodEnum("method").notNull(),
    /** Signed in the app: the name the client typed, and the waiver version they agreed to. */
    signedName: text("signed_name"),
    waiverVersion: integer("waiver_version"),
    recordedBy: uuid("recorded_by").notNull().references(() => users.id),
    recordedAt: ts("recorded_at").notNull().defaultNow(),
    revokedAt: ts("revoked_at"),
    revokedBy: uuid("revoked_by").references(() => users.id),
    revokeReason: text("revoke_reason"),
  },
  (t) => [uniqueIndex("client_waivers_one_active").on(t.orgId, t.clientId).where(sql`${t.revokedAt} is null`)],
);

/**
 * Injuries and conditions a client has told the studio about. Visible to the
 * client, studio staff and the instructors of classes they're booked into.
 * Resolved notes are hidden from instructors; clients can delete theirs entirely.
 */
export const clientHealthNotes = pgTable(
  "client_health_notes",
  {
    id: pk(),
    orgId: uuid("org_id").notNull().references(() => organizations.id, { onDelete: "cascade" }),
    clientId: uuid("client_id").notNull().references(() => users.id, { onDelete: "cascade" }),
    category: healthCategoryEnum("category").notNull(),
    description: text("description").notNull(),
    status: healthNoteStatusEnum("status").notNull().default("active"),
    createdBy: uuid("created_by").notNull().references(() => users.id),
    /** When the client last said it's still current (or added/changed it). */
    reviewedAt: ts("reviewed_at").notNull().defaultNow(),
    resolvedAt: ts("resolved_at"),
    resolvedBy: uuid("resolved_by").references(() => users.id),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [index("health_notes_client_idx").on(t.orgId, t.clientId, t.status)],
);

/**
 * Late-cancellation and no-show fees. Recorded as "pending" now and collected
 * once the payments module is connected. Waiving keeps the record for history.
 */
export const fees = pgTable(
  "fees",
  {
    id: pk(),
    orgId: uuid("org_id").notNull().references(() => organizations.id, { onDelete: "cascade" }),
    clientId: uuid("client_id").notNull().references(() => users.id),
    /** The booking a late-cancel or no-show fee is for; null for package fees (e.g. extensions). */
    bookingId: uuid("booking_id").references(() => bookings.id),
    clientPackageId: uuid("client_package_id").references(() => clientPackages.id, { onDelete: "cascade" }),
    type: feeTypeEnum("type").notNull(),
    amountCents: integer("amount_cents").notNull(),
    currency: text("currency").notNull(),
    status: feeStatusEnum("status").notNull().default("pending"),
    waivedBy: uuid("waived_by").references(() => users.id),
    waivedAt: ts("waived_at"),
    waivedReason: text("waived_reason"),
    createdAt: createdAt(),
  },
  (t) => [
    uniqueIndex("fees_one_active_per_booking").on(t.bookingId, t.type).where(sql`${t.status} <> 'waived'`),
    index("fees_client_idx").on(t.clientId),
  ],
);

export const waitlistEntries = pgTable(
  "waitlist_entries",
  {
    id: pk(),
    orgId: uuid("org_id").notNull().references(() => organizations.id, { onDelete: "cascade" }),
    sessionId: uuid("session_id").notNull().references(() => classSessions.id),
    clientId: uuid("client_id").notNull().references(() => users.id),
    mode: waitlistModeEnum("mode").notNull(),
    status: waitlistStatusEnum("status").notNull().default("waiting"),
    expiresHoursBeforeStart: integer("expires_hours_before_start"),
    /** When this entry stops being considered (class start minus the client's chosen cut-off). */
    expiresAt: ts("expires_at").notNull(),
    /** Manual mode: when the held spot is released to the next person. */
    offerExpiresAt: ts("offer_expires_at"),
    bookingId: uuid("booking_id").references(() => bookings.id),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    uniqueIndex("waitlist_one_active_per_client")
      .on(t.sessionId, t.clientId)
      .where(sql`${t.status} in ('waiting','offered')`),
    index("waitlist_queue_idx").on(t.sessionId, t.status, t.createdAt),
    index("waitlist_offer_expiry_idx").on(t.offerExpiresAt).where(sql`${t.status} = 'offered'`),
    index("waitlist_expiry_idx").on(t.expiresAt).where(sql`${t.status} = 'waiting'`),
  ],
);

export const substituteRequests = pgTable(
  "substitute_requests",
  {
    id: pk(),
    orgId: uuid("org_id").notNull().references(() => organizations.id, { onDelete: "cascade" }),
    sessionId: uuid("session_id").notNull().references(() => classSessions.id),
    requestedBy: uuid("requested_by").notNull().references(() => users.id),
    originalInstructorId: uuid("original_instructor_id").references(() => users.id),
    reason: text("reason"),
    approvalMode: subApprovalEnum("approval_mode").notNull(),
    status: subStatusEnum("status").notNull().default("open"),
    /** Empty array = every active instructor was asked. */
    invitedInstructorIds: uuid("invited_instructor_ids").array().notNull().default(sql`'{}'::uuid[]`),
    filledBy: uuid("filled_by").references(() => users.id),
    resolvedAt: ts("resolved_at"),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    uniqueIndex("sub_one_open_per_session")
      .on(t.sessionId)
      .where(sql`${t.status} in ('open','awaiting_approval')`),
  ],
);

export const substituteResponses = pgTable(
  "substitute_responses",
  {
    id: pk(),
    orgId: uuid("org_id").notNull().references(() => organizations.id, { onDelete: "cascade" }),
    requestId: uuid("request_id").notNull().references(() => substituteRequests.id, { onDelete: "cascade" }),
    instructorId: uuid("instructor_id").notNull().references(() => users.id),
    accepted: boolean("accepted").notNull(),
    createdAt: createdAt(),
  },
  (t) => [uniqueIndex("sub_response_once").on(t.requestId, t.instructorId)],
);

/** A client asking for more time on a package. */
export const packageExtensionRequests = pgTable(
  "package_extension_requests",
  {
    id: pk(),
    orgId: uuid("org_id").notNull().references(() => organizations.id, { onDelete: "cascade" }),
    packageId: uuid("package_id").notNull().references(() => clientPackages.id, { onDelete: "cascade" }),
    requestedBy: uuid("requested_by").notNull().references(() => users.id, { onDelete: "cascade" }),
    days: integer("days").notNull(),
    reason: text("reason").notNull(),
    attachmentFileId: uuid("attachment_file_id").references(() => files.id, { onDelete: "set null" }),
    status: extensionStatusEnum("status").notNull().default("pending"),
    autoApproved: boolean("auto_approved").notNull().default(false),
    daysGranted: integer("days_granted"),
    feeCents: integer("fee_cents"),
    decidedBy: uuid("decided_by").references(() => users.id),
    decidedAt: ts("decided_at"),
    decisionNote: text("decision_note"),
    createdAt: createdAt(),
  },
  (t) => [
    index("extension_requests_org_idx").on(t.orgId, t.status),
    uniqueIndex("extension_one_pending").on(t.packageId).where(sql`${t.status} = 'pending'`),
  ],
);

/**
 * Checkout: a client's order for a package. It becomes a package once paid (by the payment
 * provider, when connected, or marked paid at the desk by an admin).
 */
export const orders = pgTable(
  "orders",
  {
    id: pk(),
    orgId: uuid("org_id").notNull().references(() => organizations.id, { onDelete: "cascade" }),
    clientId: uuid("client_id").notNull().references(() => users.id, { onDelete: "cascade" }),
    planId: uuid("plan_id").references(() => packagePlans.id, { onDelete: "set null" }),
    amountCents: integer("amount_cents").notNull(),
    currency: text("currency").notNull(),
    status: orderStatusEnum("status").notNull().default("pending"),
    startDate: date("start_date"),
    rolloverFromPackageId: uuid("rollover_from_package_id").references(() => clientPackages.id, { onDelete: "set null" }),
    clientPackageId: uuid("client_package_id").references(() => clientPackages.id, { onDelete: "set null" }),
    provider: text("provider"),
    providerRef: text("provider_ref"),
    paidAt: ts("paid_at"),
    createdAt: createdAt(),
  },
  (t) => [index("orders_client_idx").on(t.orgId, t.clientId)],
);

// ---------------------------------------------------------------------------
// Payroll
// ---------------------------------------------------------------------------
/** How someone is paid. A new rate gets a new row from its start date, so past pay never changes. */
export const payRates = pgTable(
  "pay_rates",
  {
    id: pk(),
    orgId: uuid("org_id").notNull().references(() => organizations.id, { onDelete: "cascade" }),
    staffId: uuid("staff_id").notNull().references(() => users.id, { onDelete: "cascade" }),
    /** Empty = their usual rate; otherwise the class types this rate covers (one or a group). */
    classTypeIds: uuid("class_type_ids").array().notNull().default(sql`'{}'::uuid[]`),
    type: payRateTypeEnum("type").notNull(),
    amountCents: integer("amount_cents"),
    perClientCents: integer("per_client_cents"),
    clientsIncluded: integer("clients_included"),
    minimumCents: integer("minimum_cents"),
    tiers: jsonb("tiers").$type<PayTier[]>(),
    effectiveFrom: date("effective_from").notNull(),
    createdBy: uuid("created_by").references(() => users.id),
    createdAt: createdAt(),
  },
  (t) => [index("pay_rates_staff_idx").on(t.orgId, t.staffId, t.effectiveFrom)],
);

/** One-off additions or deductions: workshops, bonuses, reimbursements. */
export const payAdjustments = pgTable(
  "pay_adjustments",
  {
    id: pk(),
    orgId: uuid("org_id").notNull().references(() => organizations.id, { onDelete: "cascade" }),
    staffId: uuid("staff_id").notNull().references(() => users.id, { onDelete: "cascade" }),
    date: date("date").notNull(),
    amountCents: integer("amount_cents").notNull(),
    reason: text("reason").notNull(),
    createdBy: uuid("created_by").references(() => users.id),
    createdAt: createdAt(),
  },
  (t) => [index("pay_adjustments_idx").on(t.orgId, t.date)],
);

/** A pay period marked as paid: the figures at that moment, kept as they were. */
export const payRuns = pgTable(
  "pay_runs",
  {
    id: pk(),
    orgId: uuid("org_id").notNull().references(() => organizations.id, { onDelete: "cascade" }),
    periodStart: date("period_start").notNull(),
    periodEnd: date("period_end").notNull(),
    totalCents: integer("total_cents").notNull(),
    snapshot: jsonb("snapshot").$type<Record<string, unknown>>().notNull(),
    paidBy: uuid("paid_by").references(() => users.id),
    paidAt: ts("paid_at").notNull().defaultNow(),
  },
  (t) => [uniqueIndex("pay_runs_period_uq").on(t.orgId, t.periodStart)],
);

// ---------------------------------------------------------------------------
// Notifications (transactional outbox) and audit trail
// ---------------------------------------------------------------------------
/**
 * Messages are written here in the same database transaction as the change
 * that caused them, then a background worker delivers them. If the email or
 * push provider is down, nothing is lost: the worker retries.
 */
export const notifications = pgTable(
  "notifications",
  {
    id: pk(),
    orgId: uuid("org_id").notNull().references(() => organizations.id, { onDelete: "cascade" }),
    userId: uuid("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
    channel: channelEnum("channel").notNull(),
    template: text("template").notNull(),
    data: jsonb("data").$type<Record<string, unknown>>().notNull(),
    status: notificationStatusEnum("status").notNull().default("pending"),
    attempts: integer("attempts").notNull().default(0),
    sendAfter: ts("send_after").notNull().defaultNow(),
    sentAt: ts("sent_at"),
    lastError: text("last_error"),
    createdAt: createdAt(),
  },
  (t) => [index("notifications_pending_idx").on(t.sendAfter).where(sql`${t.status} = 'pending'`)],
);

export const auditLog = pgTable(
  "audit_log",
  {
    id: pk(),
    orgId: uuid("org_id").notNull().references(() => organizations.id, { onDelete: "cascade" }),
    actorId: uuid("actor_id").references(() => users.id),
    action: text("action").notNull(),
    entityType: text("entity_type").notNull(),
    entityId: uuid("entity_id").notNull(),
    details: jsonb("details").$type<Record<string, unknown>>(),
    createdAt: createdAt(),
  },
  (t) => [index("audit_entity_idx").on(t.entityType, t.entityId)],
);
