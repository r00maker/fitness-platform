/**
 * Plain-English labels and hover help for every field and option a user can see.
 *
 * The web and mobile apps both read from this file, so wording stays identical
 * everywhere and can be edited in one place (and later translated).
 * `help` is the short tooltip shown on hover (web) or on tapping the (i) icon (mobile).
 */
import type { FlagCode } from "./enums.js";

export interface FieldText {
  label: string;
  help: string;
}

export const FIELDS = {
  // Class types
  classTypeName: { label: "Class name", help: "What clients see on the schedule, e.g. “Reformer Pilates – Beginners”." },
  classTypeColor: { label: "Calendar colour", help: "Every class of this type shows in this colour on the calendar so you can spot it at a glance." },
  classTypeDescription: { label: "Description", help: "A short summary clients read before booking: what to expect, who it suits, what to bring." },

  // Locations & rooms
  locationName: { label: "Location name", help: "The studio or site where classes happen." },
  locationTimezone: { label: "Time zone", help: "Class times at this location are shown in this time zone, including daylight-saving changes." },
  roomName: { label: "Room", help: "The specific room or space inside a location, e.g. “Studio 2”." },
  roomCapacity: { label: "Room limit", help: "The most people this room can safely hold. Classes in this room can't be set higher." },

  // Templates & sessions
  templateName: { label: "Template name", help: "A name only your team sees, e.g. “Morning Flow – 60 min”. Use templates to create classes in a couple of clicks." },
  instructor: { label: "Instructor", help: "Who is teaching. They're notified by email and push when they're added, removed or the class changes." },
  date: { label: "Date", help: "The day the class runs, in the location's time zone." },
  startTime: { label: "Start time", help: "When the class begins, in the location's time zone." },
  durationMinutes: { label: "Length (minutes)", help: "How long the class runs. You can give this or an end time." },
  endTime: { label: "End time", help: "When the class finishes. We'll check it looks right, e.g. that 12am wasn't meant to be 12pm." },
  capacity: { label: "Spots available", help: "The most people who can book. Once it's full, new clients can join the waitlist." },
  waitlistEnabled: { label: "Allow waitlist", help: "When the class is full, clients can queue for a spot that opens up." },
  waitlistCapacity: { label: "Waitlist limit", help: "The most people who can wait for this class. Leave empty for no limit." },
  notes: { label: "Staff notes", help: "Private notes for your team. Clients never see these." },

  // Recurring classes
  daysOfWeek: { label: "Repeats on", help: "The days of the week this class runs." },
  everyNWeeks: { label: "Every … weeks", help: "1 means every week, 2 means every other week, and so on." },
  startDate: { label: "First class", help: "The date of the first class in the series." },
  endDate: { label: "Last class", help: "The series stops after this date. Leave empty to repeat until you stop it." },
  occurrences: { label: "Number of classes", help: "Stop after this many classes instead of on a date." },
  editScope: { label: "Apply changes to", help: "Change just this class, this and all later classes in the series, or the whole series." },

  // Bookings
  refundMethod: { label: "Refund", help: "Give the client their class credit back, refund their payment, or give nothing back." },
  refundReason: { label: "Reason", help: "Kept on the client's history so your team knows why a refund was given." },
  attendance: { label: "Attendance", help: "Mark whether the client came. No-shows can be charged a fee if your policy allows it." },
  notifyClients: { label: "Tell clients", help: "Send booked clients an email and push notification about this change." },

  // Waitlist
  waitlistMode: { label: "When a spot opens", help: "“Book me in automatically” takes the spot for you. “Ask me first” holds it for you for a short time so you can confirm." },
  waitlistExpiry: { label: "Stop waiting", help: "If you haven't got a spot by this long before class, we'll take you off the waitlist so you're not booked last-minute." },
  waitlistHoldMinutes: { label: "Hold time", help: "How long a spot is held for someone who chose “Ask me first” before it goes to the next person." },
  waitlistExpiryOptions: { label: "Waitlist cut-off choices", help: "The three options clients can pick from for when to stop waiting, in hours before class." },

  // Substitutes
  subReason: { label: "Reason", help: "Optional. Shared with instructors you're asking to cover." },
  subInvitees: { label: "Ask", help: "Admins only. Instructors who'll be asked to cover. Leave empty to ask the class's teaching list (or everyone who teaches)." },
  subApprovalMode: { label: "Approving cover", help: "“Automatic” gives the class to the first instructor who accepts. “Manual” lets an admin choose from everyone who accepted." },

  // Studio policies
  lateCancelWindowHours: { label: "Late cancellation window", help: "Cancelling within this many hours of class counts as a late cancellation." },
  notifyClientsOnInstructorChange: { label: "Tell clients about instructor changes", help: "Let booked clients know when a different instructor will teach their class." },
  observesDaylightSaving: {
    label: "Adjust for daylight saving",
    help: "Turn on if your clocks change in summer (e.g. UK, Europe, Australia, North America). Classes then stay at the same local time all year. Not needed in most of Southeast Asia.",
  },
  // Booking rules
  bookingOpensDaysBefore: { label: "Booking opens", help: "How many days before class clients can start booking. 14 means a class on the 25th opens at midnight on the 11th." },
  bookingClosesMinutesBefore: { label: "Booking closes", help: "How many minutes before class online booking stops. Admins can still add people after this." },
  weeklyBookingLimit: { label: "Weekly class limit", help: "The most classes one client can have booked in a week (Monday–Sunday). Leave empty for unlimited, which suits most studios." },
  lateCancelFeeEnabled: { label: "Charge a late-cancellation fee", help: "Clients who cancel inside the late-cancellation window are charged this fee, on top of losing their credit." },
  lateCancelFee: { label: "Late-cancellation fee", help: "The amount charged for a late cancellation." },
  noShowFeeEnabled: { label: "Charge a no-show fee", help: "Clients marked as a no-show are charged this fee. It's removed automatically if attendance is corrected." },
  noShowFee: { label: "No-show fee", help: "The amount charged when a client doesn't turn up." },
  currency: { label: "Currency", help: "The currency your fees and prices are shown in, e.g. SGD." },
  feeWaiveReason: { label: "Reason for waiving", help: "Kept on the client's history so your team knows why the fee was removed." },
  asCover: { label: "Covering this class", help: "Tick if this instructor is standing in for the usual instructor. The calendar shows them as cover, and the usual instructor stays on future classes." },
  coverList: { label: "Who can teach this class", help: "The instructors who teach or cover this class type. Cover requests go to them first, and you'll be warned if someone else is assigned." },
  favouriteInstructor: { label: "Favourite instructor", help: "The instructor a client has taken the most classes with (at least 3)." },
  clientTags: { label: "Tags", help: "Your own labels for clients, e.g. “VIP” or “Teacher training”. Staff see them on class lists. Injuries and pregnancy go in health notes instead." },
  tagName: { label: "Tag name", help: "Keep it short so it fits on the class list, e.g. “VIP”." },
  tagColor: { label: "Tag colour", help: "Helps the tag stand out on the class list." },
  tagPinned: { label: "Show up front", help: "Shows this tag straight under the client's name on class lists. Other tags are tucked under “More” so the list stays easy to read." },
  spot: { label: "Spot", help: "The reformer, bike or mat the client will use. Clients pick theirs when booking." },
  spotBookingEnabled: {
    label: "Clients choose a spot",
    help: "Clients pick their reformer, bike or mat when they book. Turn off if people just take any spot: they'll still see who's coming and confirm before booking.",
  },

  // Waivers
  waiverRequired: {
    label: "Clients must sign a waiver",
    help: "Studio members sign your waiver in the app when they book their first class. Staff mark ClassPass clients' waivers as done. Turn off if you don't use waivers.",
  },
  waiverText: { label: "Your waiver", help: "The wording clients agree to. If you change it, existing signatures stay valid and new clients sign the new version." },
  waiverStatus: { label: "Waiver", help: "Whether this client has completed the studio's waiver. Clients without one are shown in red on class lists." },
  waiverSignedName: { label: "Type your full name", help: "Typing your name counts as your signature on the waiver." },
  waiverReverseReason: { label: "Why undo it?", help: "Kept on the client's record, e.g. “Marked by mistake – not signed yet”." },

  // Health notes
  healthNotes: {
    label: "Injuries & conditions",
    help: "Anything your instructor should know, like an injury or pregnancy. It stays on your profile until you mark it as resolved, so you don't need to add it every time you book.",
  },
  healthCategory: { label: "Type", help: "We suggest one from what you write. Change it if it's not right." },
  healthDescription: { label: "In a few words", help: "e.g. “Sore left knee, avoiding deep lunges” or “18 weeks pregnant”. Only your instructors and studio staff can see this." },

  spotLabels: { label: "Spots in this room", help: "Name each spot, e.g. “Reformer 1”. Clients choose one when they book. Leave empty if clients don't pick a spot." },
  showInAttendeeList: { label: "Show me on class lists", help: "Other studio members can see your first name, initial and photo on the classes you've booked. Turn off to stay hidden." },
  role: { label: "Access level", help: "Admin: sees and changes everything. Front of House: sees the full schedule and can take attendance. Instructor: sees and takes attendance for their own classes only." },
  acknowledge: { label: "Go ahead anyway", help: "You've seen the warnings and want to continue." },
  theme: { label: "Appearance", help: "Light or dark colours. “Match my device” follows your phone or computer's own setting. Saved to your account, so it's the same on every device." },
} as const satisfies Record<string, FieldText>;

/** Short titles for the "please check" warnings. The full message comes with each warning. */
export const FLAG_TITLES: Record<FlagCode, string> = {
  instructor_double_booked: "Instructor double-booked",
  room_double_booked: "Room already in use",
  possible_duplicate: "Looks like a duplicate",
  client_double_booked: "Client already booked at this time",
  ends_after_midnight: "Ends after midnight",
  unusually_long: "Unusually long class",
  unusually_short: "Unusually short class",
  unusual_start_time: "Unusual start time",
  duration_differs_from_usual: "Different length from usual",
  in_the_past: "Date is in the past",
  far_future: "Date is over a year away",
  over_room_limit: "More spots than the room holds",
  clients_affected: "Booked clients will be affected",
  waitlist_affected: "Waitlisted clients will be affected",
  short_notice: "Short notice",
  no_refund: "No refund",
  already_happened: "Class has already happened",
  many_classes: "Lots of classes at once",
  no_instructor: "No instructor yet",
  instructor_not_listed: "Not on this class's teaching list",
  late_booking: "Class has already started",
  outside_booking_window: "Outside the booking window",
  over_weekly_limit: "Over the weekly limit",
  late_cancel: "Late cancellation",
  no_free_cancel: "No free cancellation",
  late_move: "Late change",
  fee_applies: "Fee applies",
  already_refunded: "Already refunded",
  refund_after_attending: "Client attended",
  class_not_started: "Class hasn't started yet",
  waiver_missing: "Waiver not signed",
  confirm_waiver_complete: "Check the waiver first",
};

/** Friendly wording for option values shown in dropdowns and badges. */
export const OPTION_LABELS = {
  waitlistMode: { automatic: "Book me in automatically", manual: "Ask me first" },
  subApprovalMode: { automatic: "First to accept gets it", manual: "Admin chooses" },
  refundMethod: { none: "No refund", credit: "Return class credit", original_payment: "Refund payment" },
  attendance: { unmarked: "Not marked", present: "Attended", no_show: "No-show" },
  editScope: { this: "This class only", following: "This and later classes", all: "Every class in the series" },
  bookingStatus: { confirmed: "Booked", cancelled: "Cancelled", late_cancelled: "Late cancel" },
  waitlistStatus: {
    waiting: "On waitlist",
    offered: "Spot held for you",
    enrolled: "Booked from waitlist",
    expired: "Waitlist ended",
    offer_lapsed: "Hold expired",
    declined: "Spot declined",
    left: "Left waitlist",
    closed: "Waitlist closed",
  },
  role: { owner: "Owner", admin: "Admin", front_desk: "Front of House", instructor: "Instructor", client: "Client" },
  feeType: { late_cancel: "Late-cancellation fee", no_show: "No-show fee" },
  feeStatus: { pending: "To be collected", waived: "Waived", charged: "Paid" },
  memberSource: { direct: "Studio member", classpass: "ClassPass" },
  waiverStatus: { complete: "Waiver done", missing: "No waiver", not_required: "No waiver needed" },
  waiverMethod: { signed_by_client: "Signed in the app", confirmed_by_staff: "Marked done by staff" },
  healthCategory: {
    injury: "Injury",
    pregnancy: "Pregnancy",
    postnatal: "Postnatal",
    recent_surgery: "Recent surgery",
    medical_condition: "Medical condition",
    other: "Other",
  },
  bookingWindow: { not_open_yet: "Booking not open yet", open: "Open for booking", closed: "Booking closed" },
  theme: { system: "Match my device", light: "Light", dark: "Dark" },
  timeOfDay: { morning: "Morning (before 12pm)", afternoon: "Afternoon (12–5pm)", evening: "Evening (after 5pm)" },
} as const;

/** How long the pointer must rest on something before its help note appears (desktop only). */
export const HELP_TIP_DELAY_MS = 1500;

/** Hover help for buttons and menu items, in the same plain-English voice as FIELDS. */
export const ACTION_HELP = {
  newClass: "Add a one-off class, or start from a template so most details are filled in for you.",
  selectClasses: "Pick several classes on the calendar, then change or cancel them all in one go.",
  editClass: "Change the time, instructor, room or spots. For a repeating class you can change just this one or the rest of the series.",
  duplicateClass: "Copy this class to the same time next week. You'll be warned if it clashes with anything.",
  askForCover: "Ask for this class to be covered. Your studio's admin arranges who covers it, and you'll be told once it's sorted.",
  chooseCover: "Choose who is asked to cover, or assign someone directly.",
  cancelClass: "Cancel this class. Booked clients are told and given the refund you choose.",
  markAllPresent: "Mark everyone not yet marked as attended. People already marked as a no-show stay that way.",
  attended: "Mark this client as attended.",
  noShow: "Mark this client as a no-show. A no-show fee is added if your studio charges one.",
  chooseSpot: "Pick where you'll be in the room. You'll check the details before anything is booked.",
  joinWaitlist: "Queue for a spot. We'll book you in or ask you first, depending on what you choose.",
  cancelBooking: "Cancel your place. You'll see whether you get your credit back before you confirm.",
  editTags: "Add or remove your studio's own labels for this client.",
  waiveFee: "Remove this fee. The reason is kept on the client's history.",
  markWaiverDone: "Mark that this client has completed the waiver, e.g. a ClassPass client who signed at the desk. You'll be asked to check first, and only an admin can undo it.",
  undoWaiver: "Admins only. Undo a waiver that was marked done by mistake.",
  signWaiver: "Read and sign the studio's waiver. You only need to do this once.",
  addHealthNote: "Tell your instructors about an injury, pregnancy or condition. It stays on your profile until you mark it resolved.",
  healthStillCurrent: "Still the same? One tap keeps it on your profile.",
  resolveHealthNote: "All better? Instructors stop seeing it straight away.",
  favouriteFilter: "Show only classes with your favourite instructor. Tap again to see everything.",
  today: "Jump back to today.",
  dayView: "One day, hour by hour.",
  weekView: "Monday to Sunday, hour by hour.",
  monthView: "The whole month at a glance. Tap a day to open it.",
} as const satisfies Record<string, string>;

/** The left-hand menu. Each item shows only to the roles listed. */
export const NAV_ITEMS = [
  { id: "schedule", label: "Schedule", group: "Studio", roles: ["owner", "admin", "front_desk", "instructor", "client"], help: "The class calendar." },
  { id: "my-bookings", label: "My bookings", group: "Studio", roles: ["client"], help: "Classes you're booked into or waiting for." },
  { id: "cover", label: "Cover requests", group: "Studio", roles: ["owner", "admin", "instructor"], help: "Classes that need another instructor, and requests waiting for you." },
  { id: "clients", label: "Clients", group: "Studio", roles: ["owner", "admin"], help: "Everyone who books with you: contact details, history, tags and fees." },
  { id: "fees", label: "Fees", group: "Studio", roles: ["owner", "admin"], help: "Late-cancellation and no-show fees to collect or waive." },
  { id: "class-types", label: "Class types", group: "Setup", roles: ["owner", "admin"], help: "Your classes, their calendar colours and who can teach them." },
  { id: "templates", label: "Templates", group: "Setup", roles: ["owner", "admin"], help: "Saved class details so new classes take a couple of clicks." },
  { id: "locations", label: "Locations & rooms", group: "Setup", roles: ["owner", "admin"], help: "Your studios, their rooms and the spots in each room." },
  { id: "policies", label: "Studio rules", group: "Setup", roles: ["owner", "admin"], help: "Booking window, cancellations, fees, waivers, spot booking, waitlist and cover settings." },
  { id: "health", label: "Injuries & conditions", group: "Account", roles: ["client"], help: "Let your instructors know about an injury, pregnancy or condition, and mark it resolved when you're better." },
  { id: "preferences", label: "Preferences", group: "Account", roles: ["owner", "admin", "front_desk", "instructor", "client"], help: "Appearance (light or dark) and other personal settings." },
  { id: "profile", label: "Profile & privacy", group: "Account", roles: ["client"], help: "Your details, your waiver and who can see you on class lists." },
] as const;
