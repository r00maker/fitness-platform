/**
 * What the app shows, in the shapes the API returns. The app talks to a `Backend`: the real API
 * (http.ts) or the built-in demo studios (demo.ts), so screens never know which.
 */
import type { AppTheme } from "@studio/shared";

export interface Studio {
  id: string;
  slug: string;
  name: string;
  logoUrl: string | null;
  timezone: string;
  currency: string;
  theme: AppTheme;
  locations: { id: string; name: string; address: string | null }[];
  classTypes: { id: string; name: string; color: string; description: string | null }[];
  rules: { cancelling: string; needPackage: boolean };
}

export interface Me {
  firstName: string;
  email: string | null;
  /** The instructor they've been to most (worked out by the studio), for the one-tap filter. */
  favouriteInstructor?: { id: string; firstName: string; name: string } | null;
}

export type Availability = "open" | "few_left" | "full" | "waitlist" | "not_open_yet" | "closed";
export interface ClassItem {
  id: string;
  name: string;
  color: string;
  startsAt: string;
  endsAt: string;
  localDate: string;
  time: string;
  endTime: string;
  durationMinutes: number;
  location: { id: string; name: string };
  room: string | null;
  instructor: { id?: string; name: string | null; photoUrl: string | null } | null;
  spotsLeft: number;
  availability: Availability;
  label: string;
}
export interface ScheduleDay { date: string; label: string; closed: { name: string; message: string | null } | null; classes: ClassItem[] }

export interface MyBooking {
  booking: { id: string; sessionId: string; status: string; payment: string; clientPackageId: string | null; heldForPeriod?: number | null };
  session: { id: string; startsAt: string; endsAt: string; locationId: string };
  classType: { id: string; name: string; color: string };
}

export interface Package {
  id: string;
  name: string;
  kind: "credits" | "unlimited";
  state: "not_started" | "active" | "used_up" | "expired" | "cancelled";
  stateLabel: string;
  creditsTotal: number | null;
  creditsLeft: number | null;
  yourCreditsLeft?: number | null;
  validUntil: string | null;
  startedOn: string | null;
  startNote: string | null;
  billing: "one_time" | "recurring";
  renewal?: { period: number; renewsOn: string | null; endsOn: string | null; bookedAhead: { period: number; classes: number; periodStarts: string; note: string }[] };
  terms: string[];
}

export interface PackageOptions {
  packageNeeded: boolean;
  suggested: string | null;
  freeCancelUntil: string;
  insideLateWindow: boolean;
  options: (Package & { usable: boolean; reason: string | null; bookedAhead: { period: number; periodStarts: string } | null })[];
  message?: string;
}

export interface Badge { key: string; title: string; detail: string; earned: boolean; earnedOn: string | null; progress: { have: number; need: number } | null }
export interface Celebration { key: string; kind: "milestone" | "goal" | "badge"; title: string; message: string; number: number | null }
export interface Progress {
  classes: number;
  milestones: number[];
  milestone: { previous: number; next: number | null; toGo: number; progress: number };
  month: { month: string; label: string; done: number; booked: number; goal: number | null; daysLeft: number };
  streak: { weeks: number; best: number };
  achievements: Badge[];
  celebration: Celebration | null;
  nudge: string | null;
}

// --- Buying ---------------------------------------------------------------------------------
export interface Plan { id: string; name: string; description: string | null; kind: "credits" | "unlimited"; billing: "one_time" | "recurring"; price: string; priceCents: number; terms: string[] }
export interface PayOption { payWith: string; label: string; fee: string | null; total: string; note?: string }
export interface Quote {
  package: { id: string; name: string; billing: string; terms: string[] };
  lines: { label: string; amount: string }[];
  total: string;
  totalCents: number;
  studioCredit: { balance: string; balanceCents: number; using: string };
  recurringNote: string | null;
  startsNote: string | null;
  startDate: { earliest: string; latest: string; default: string } | null;
  payments: { online: boolean; options: PayOption[]; message: string | null };
  /** Discounts they can use (from a referral, a reward or the studio). */
  vouchers: { id: string; label: string; note: string | null }[];
  /** Unused classes they can bring across from another package (if the studio allows it). */
  rolloverOptions: { packageId: string; name: string; classes: number; validUntil: string | null }[];
}
export interface CheckoutChoices { useCredit: boolean; voucherId?: string; rolloverFromPackageId?: string; startDate?: string; payWith?: string }
/** After placing an order: either it's done, or pay online (redirect), or pay at the desk. */
export interface Placed {
  done: boolean;
  message: string;
  redirectUrl?: string;
  /** Demo studios only: a stand-in for Stripe's payment page. Paying there finishes the order. */
  demoPay?: { amount: string; description: string; confirm(): Promise<Placed> };
}

// --- Managing packages -----------------------------------------------------------------------
export interface PackageDetail extends Package {
  classes: { bookingId: string; date: string; time: string; className: string; status: string; credit: string }[];
  changes: { date: string; kind: string; title: string; detail: string | null }[];
  extensionRequests: { id: string; days: number; reason: string; statusLabel: string; status: string; requestedOn: string }[];
  sharing: { maxUsers: number; spacesLeft: number; members: { userId: string; name: string; isOwner: boolean }[] };
}
export interface ExtensionPolicy { allowed: boolean; maxDays: number; fee: string | null; summary: string; attachment: "off" | "optional" | "required" }
export interface StopOptions {
  inMinimumTerm: boolean;
  minimumTermEndsOn: string | null;
  stopAtEndOfTerm: { endsOn: string };
  endEarly: { allowed: boolean; endsOn: string; fee: string | null } | null;
  bookedAheadAfterEnd?: { atEndOfTerm: number; endingEarly: number };
}

// --- Health, waiver ----------------------------------------------------------------------------
export interface HealthNote { id: string; description: string; categoryLabel?: string; status: string; updatedAt?: string; needsCheck?: boolean }
export interface Waiver { required: boolean; done: boolean; signedAt: string | null; text: string | null }

// --- Shop, gift cards, credit, rewards -------------------------------------------------------
export interface Product { id: string; name: string; description: string | null; price: string; priceCents: number; photoUrl: string | null; category: string | null; options: { name: string; soldOut: boolean }[]; soldOut: boolean }
export interface GiftCardShop { enabled: boolean; designs?: { id: string; name: string; imageUrl: string }[]; amounts?: { cents: number; label: string }[]; howToGive?: string[] }
export interface GiftCard { id: string; code: string; amount: string; status: string; statusLabel: string; design: { name: string; imageUrl: string } | null; from: string | null; to: string | null; message: string | null; daysLeftToGive: number | null }
export interface MyGiftCards { toGive: GiftCard[]; received: GiftCard[]; given: GiftCard[]; kept: GiftCard[]; credit: { balance: string; balanceCents: number } }
export interface Loyalty {
  enabled: boolean;
  name?: string;
  namePlural?: string;
  balance?: number;
  balanceText?: string;
  nextExpiry?: { text: string } | null;
  rules?: string[];
  rewards?: { id: string; name: string; description: string | null; costText: string; cost: number; whatYouGet: string; canRedeem: boolean; needMore: number; soldOut: boolean }[];
  redemptions?: { id: string; reward: string; statusLabel: string; code: string | null }[];
}
export interface Referral { enabled: boolean; code?: string; link?: string; howItWorks?: string[]; friends?: { name: string; statusLabel: string }[]; rewardsEarned?: number }
export interface Purchase { id: string; number: string; receiptNumber: string | null; statusLabel: string; description: string; total: string; issuedAt: string }
export interface PaymentCard { card: { brand: string; last4: string; expires: string } | null; canSave: boolean; note: string }
export interface Notifications { marketingEmail: boolean; marketingPush: boolean; marketingWhatsapp: boolean }

export interface Banner { id: string; title: string; subtitle: string | null; imageUrl: string; link: { type: string; target: string | null } }

/** The API's own explanation of something it refused, with any "please check" flags. */
export class AppError extends Error {
  constructor(readonly code: string, message: string, readonly flags: { code: string; message: string }[] = [], readonly details: Record<string, unknown> = {}) {
    super(message);
  }
}

export interface Backend {
  /** Demo studios can be switched between; the real app serves one studio. */
  readonly demo: boolean;
  studio(): Promise<Studio>;
  me(): Promise<Me | null>;
  signIn?(email: string, code?: string): Promise<"code_sent" | "signed_in">;
  signOut(): Promise<void>;
  schedule(from: string, days: number): Promise<ScheduleDay[]>;
  myBookings(): Promise<MyBooking[]>;
  packages(): Promise<Package[]>;
  packageOptions(classId: string): Promise<PackageOptions>;
  /** Book a class. `acknowledge` confirms the checks the person has already seen (e.g. a late booking); `waiver` signs it in the same step. */
  book(classId: string, acknowledge: string[], waiver?: { signedName: string }): Promise<{ id: string; waitlisted?: boolean }>;
  joinWaitlist(classId: string): Promise<void>;
  /** Cancel a booking. Inside the late window the API asks first (code "needs_confirmation", with flags). */
  cancel(bookingId: string, acknowledge?: string[]): Promise<{ classReturned: boolean }>;
  progress(): Promise<Progress>;
  setGoal(classes: number | null): Promise<Progress>;
  seen(celebrationKey: string): Promise<void>;
  banners(): Promise<{ rotateSeconds: number; banners: Banner[] }>;

  // Buying
  plans(): Promise<Plan[]>;
  quote(planId: string, choices: CheckoutChoices): Promise<Quote>;
  checkout(planId: string, choices: CheckoutChoices): Promise<Placed>;
  // Managing packages
  packageDetail(id: string): Promise<PackageDetail>;
  extensionPolicy(): Promise<ExtensionPolicy>;
  /** Upload a document (a doctor's note) for a request for more time: a photo or a PDF. */
  uploadAttachment(file: File): Promise<{ id: string }>;
  requestExtension(id: string, days: number, reason: string, attachmentFileId?: string): Promise<{ message: string }>;
  share(id: string, email: string): Promise<void>;
  unshare(id: string, userId: string): Promise<void>;
  stopOptions(id: string): Promise<StopOptions>;
  stopRenewing(id: string, endEarly: boolean): Promise<{ endsOn: string; fee: string | null }>;
  resumeRenewing(id: string): Promise<void>;
  // Health and the waiver
  healthNotes(): Promise<{ active: HealthNote[]; resolved: HealthNote[] }>;
  addHealthNote(description: string): Promise<void>;
  resolveHealthNote(id: string): Promise<void>;
  stillCurrent(id: string): Promise<void>;
  waiver(): Promise<Waiver>;
  signWaiver(name: string): Promise<void>;
  // Shop, gift cards, credit, rewards
  shop(): Promise<{ visible: boolean; giftCards: boolean; products: Product[] }>;
  buyProducts(items: { productId: string; option?: string; quantity: number }[], payWith?: string): Promise<Placed>;
  giftCardShop(): Promise<GiftCardShop>;
  buyGiftCard(input: { designId: string; amountCents: number; give?: { to: string; message?: string }; payWith?: string }): Promise<Placed>;
  myGiftCards(): Promise<MyGiftCards>;
  giveGiftCard(id: string, to: string, message?: string): Promise<void>;
  keepGiftCard(id: string): Promise<void>;
  loyalty(): Promise<Loyalty>;
  redeem(rewardId: string): Promise<{ message: string }>;
  referral(): Promise<Referral>;
  // Account
  purchases(): Promise<Purchase[]>;
  paymentCard(): Promise<PaymentCard>;
  addCard(): Promise<{ redirectUrl?: string; message?: string }>;
  notifications(): Promise<Notifications>;
  setNotifications(n: Partial<Notifications>): Promise<Notifications>;
}
