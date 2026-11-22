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
  theme: AppTheme;
  locations: { id: string; name: string; address: string | null }[];
  classTypes: { id: string; name: string; color: string; description: string | null }[];
  rules: { cancelling: string; needPackage: boolean };
}

export interface Me { firstName: string; email: string | null }

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
  instructor: { name: string | null; photoUrl: string | null } | null;
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

export interface Banner { id: string; title: string; subtitle: string | null; imageUrl: string; link: { type: string; target: string | null } }

/** The API's own explanation of something it refused, with any "please check" flags. */
export class AppError extends Error {
  constructor(readonly code: string, message: string, readonly flags: { code: string; message: string }[] = []) {
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
  /** Book a class. `acknowledge` confirms the checks the person has already seen (e.g. a late booking). */
  book(classId: string, acknowledge: string[]): Promise<{ id: string; waitlisted?: boolean }>;
  joinWaitlist(classId: string): Promise<void>;
  /** Cancel a booking. Inside the late window the API asks first (code "needs_confirmation", with flags). */
  cancel(bookingId: string, acknowledge?: string[]): Promise<{ classReturned: boolean }>;
  progress(): Promise<Progress>;
  setGoal(classes: number | null): Promise<Progress>;
  seen(celebrationKey: string): Promise<void>;
  banners(): Promise<{ rotateSeconds: number; banners: Banner[] }>;
}
