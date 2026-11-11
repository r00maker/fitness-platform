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
} from "drizzle-orm/pg-core";
import {
  ATTENDANCE,
  FEE_STATUSES,
  FEE_TYPES,
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
export const feeTypeEnum = pgEnum("fee_type", FEE_TYPES);
export const feeStatusEnum = pgEnum("fee_status", FEE_STATUSES);
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
    bookingId: uuid("booking_id").notNull().references(() => bookings.id),
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
