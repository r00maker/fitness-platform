/**
 * Three made-up studios that run entirely in the browser, for the showcase and for trying the app
 * without a server. Each has its own look (one of the app's presets), timetable, member and
 * banners, and behaves like the API: booking takes a class from the package, the confirm step
 * knows about late bookings, membership classes in next month are booked ahead, and so on.
 */
import { APP_THEME_PRESETS, type AppTheme } from "@studio/shared";
import { ART } from "./art";
import { demoAccount } from "./demo-account";
import { AppError, type Backend, type Badge, type ClassItem, type MyBooking, type Package, type PackageOptions, type Progress, type ScheduleDay, type Studio } from "./types";

const TZ_OFFSET = "+08:00"; // all three studios are in Singapore
const DAY = 86_400_000;
const pad = (n: number) => String(n).padStart(2, "0");
const sgNow = () => new Date(Date.now() + 8 * 3_600_000); // "local" clock read with UTC getters
const todayIso = () => sgNow().toISOString().slice(0, 10);
const addDays = (iso: string, n: number) => new Date(Date.parse(`${iso}T00:00:00Z`) + n * DAY).toISOString().slice(0, 10);
const weekday = (iso: string) => new Date(`${iso}T00:00:00Z`).getUTCDay(); // 0 = Sunday
const at = (iso: string, hhmm: string) => new Date(`${iso}T${hhmm}:00${TZ_OFFSET}`);
const label = (iso: string, i: number) => (i === 0 ? "Today" : new Date(`${iso}T00:00:00Z`).toLocaleDateString("en-GB", { weekday: "short", day: "numeric", month: "short", timeZone: "UTC" }));
const firstOfNextMonth = () => { const d = sgNow(); return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + 1, 1)).toISOString().slice(0, 10); };
const nice = (iso: string) => new Date(`${iso}T00:00:00Z`).toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric", timeZone: "UTC" });
const hash = (s: string) => [...s].reduce((h, c) => (h * 31 + c.charCodeAt(0)) >>> 0, 7);

interface Slot { days: number[]; time: string; type: string; who: string; loc: string; room: string; cap: number; mins?: number }
interface DemoStudio {
  studio: Omit<Studio, "theme"> & { theme: AppTheme };
  member: { firstName: string; email: string };
  /** The instructor they go to most (the studio works this out). */
  favourite: string;
  slots: Slot[];
  /** Classes done before today, and this month so far. */
  classes: number;
  doneThisMonth: number;
  goal: number | null;
  streak: { weeks: number; best: number };
  earned: Record<string, string>; // badge key -> date earned
  celebrate: string | null;
  pkg: Package;
  banners: { id: string; title: string; subtitle: string; imageUrl: string }[];
  /** Upcoming classes already booked, by [days from today, slot time, class type]. */
  booked: [number, string, string][];
}

const theme = (key: string): AppTheme => { const { label: _l, description: _d, ...t } = APP_THEME_PRESETS[key]!; return t; };
const types = (list: [string, string, string][]) => list.map(([id, name, color]) => ({ id, name, color, description: null }));

const STUDIOS: Record<string, DemoStudio> = {
  linden: {
    studio: {
      id: "linden", slug: "linden", name: "Linden Reformer Studio", logoUrl: null, timezone: "Asia/Singapore", currency: "SGD", theme: theme("sage"),
      locations: [{ id: "tp", name: "Tanjong Pagar", address: "12 Duxton Road" }, { id: "hv", name: "Holland Village", address: "3 Lorong Liput" }],
      classTypes: types([["found", "Reformer Foundations", "#7FA36B"], ["inter", "Reformer Intermediate", "#2F5D46"], ["flow", "Reformer Flow", "#A9BF6E"], ["mat", "Mat Pilates", "#8C9A86"], ["jump", "Jumpboard", "#4E7A63"]]),
      rules: { cancelling: "Cancel up to 12 hours before to get the class back.", needPackage: true },
    },
    member: { firstName: "Rachel", email: "rachel@example.com" },
    favourite: "Ana L.",
    slots: [
      { days: [1, 3, 5], time: "07:00", type: "inter", who: "Ana L.", loc: "tp", room: "Studio 1", cap: 8 },
      { days: [1, 2, 3, 4, 5], time: "08:15", type: "found", who: "Ben T.", loc: "tp", room: "Studio 2", cap: 8 },
      { days: [2, 4], time: "07:30", type: "jump", who: "Mei W.", loc: "hv", room: "Studio 1", cap: 6, mins: 45 },
      { days: [1, 2, 3, 4, 5], time: "12:15", type: "flow", who: "Priya N.", loc: "tp", room: "Studio 1", cap: 8, mins: 45 },
      { days: [1, 3], time: "18:00", type: "mat", who: "Mei W.", loc: "hv", room: "Studio 2", cap: 14 },
      { days: [1, 2, 3, 4], time: "19:15", type: "inter", who: "Ana L.", loc: "tp", room: "Studio 1", cap: 8 },
      { days: [2, 4], time: "18:30", type: "found", who: "Ben T.", loc: "hv", room: "Studio 1", cap: 8 },
      { days: [6, 0], time: "09:00", type: "flow", who: "Priya N.", loc: "tp", room: "Studio 1", cap: 8 },
      { days: [6], time: "10:30", type: "inter", who: "Ana L.", loc: "hv", room: "Studio 1", cap: 8 },
    ],
    classes: 47, doneThisMonth: 5, goal: 8, streak: { weeks: 6, best: 9 },
    earned: { first: "2025-03-08", classes_10: "2025-05-02", classes_20: "2025-07-19", goal: "2025-09-30", streak: "2025-04-12", explorer: "2025-06-01" },
    celebrate: null,
    pkg: {
      id: "p1", name: "10-class pack", kind: "credits", state: "active", stateLabel: "Active", creditsTotal: 10, creditsLeft: 6, billing: "one_time",
      validUntil: addDays(todayIso(), 74), startedOn: addDays(todayIso(), -16), startNote: `Started on ${nice(addDays(todayIso(), -16))}, the day of your first class. Booking an earlier class moves the start back to that day, and the end with it.`,
      terms: ["10 classes", "Valid for 3 months from the first class", "Every class"],
    },
    banners: [
      { id: "b1", title: "Reformer week, 1 to 7 Dec", subtitle: "Seven days, seven teachers. Any pack works.", imageUrl: ART.lindenHoliday },
      { id: "b2", title: "Bring a friend for free", subtitle: "Their first class is on us when you book together.", imageUrl: ART.lindenFriend },
    ],
    booked: [[1, "07:00", "inter"], [3, "12:15", "flow"]],
  },
  tidal: {
    studio: {
      id: "tidal", slug: "tidal", name: "Tidal Barre", logoUrl: null, timezone: "Asia/Singapore", currency: "SGD", theme: theme("cobalt"),
      locations: [{ id: "jc", name: "Joo Chiat", address: "88 Joo Chiat Road" }],
      classTypes: types([["burn", "Barre Burn", "#2B3BE8"], ["sculpt", "Barre Sculpt", "#E2489A"], ["cardio", "Cardio Barre", "#7B5CFF"], ["stretch", "Barre Stretch", "#0E9F8E"]]),
      rules: { cancelling: "Cancel up to 8 hours before to get the class back.", needPackage: true },
    },
    member: { firstName: "Jasmine", email: "jasmine@example.com" },
    favourite: "Nadia S.",
    slots: [
      { days: [1, 2, 3, 4, 5], time: "07:00", type: "burn", who: "Kai R.", loc: "jc", room: "Main room", cap: 16, mins: 45 },
      { days: [1, 3, 5], time: "12:30", type: "sculpt", who: "Nadia S.", loc: "jc", room: "Main room", cap: 16, mins: 40 },
      { days: [2, 4], time: "12:30", type: "stretch", who: "Lou P.", loc: "jc", room: "Main room", cap: 16, mins: 40 },
      { days: [1, 2, 3, 4, 5], time: "18:30", type: "cardio", who: "Kai R.", loc: "jc", room: "Main room", cap: 16, mins: 45 },
      { days: [1, 2, 3, 4], time: "19:45", type: "sculpt", who: "Nadia S.", loc: "jc", room: "Main room", cap: 16, mins: 45 },
      { days: [6, 0], time: "09:30", type: "burn", who: "Lou P.", loc: "jc", room: "Main room", cap: 16, mins: 50 },
      { days: [6], time: "11:00", type: "stretch", who: "Nadia S.", loc: "jc", room: "Main room", cap: 16, mins: 50 },
    ],
    classes: 19, doneThisMonth: 6, goal: 10, streak: { weeks: 4, best: 4 },
    earned: { first: "2026-06-14", classes_5: "2026-07-02", streak: addDays(todayIso(), -2) },
    celebrate: "badge:streak",
    pkg: {
      id: "p2", name: "8 classes a month", kind: "credits", state: "active", stateLabel: "Active", creditsTotal: 8, creditsLeft: 2, billing: "recurring",
      validUntil: addDays(firstOfNextMonth(), -1), startedOn: null, startNote: null,
      renewal: { period: 6, renewsOn: firstOfNextMonth(), endsOn: null, bookedAhead: [] },
      terms: ["8 classes a month", "Renews every month until you stop it", "Unused classes don't carry over"],
    },
    banners: [
      { id: "b3", title: "December pulse challenge", subtitle: "12 classes in December gets you a Tidal tote.", imageUrl: ART.tidalChallenge },
      { id: "b4", title: "New grip socks are in", subtitle: "Pick up a pair at the front desk.", imageUrl: ART.tidalSocks },
    ],
    booked: [[0, "18:30", "cardio"]],
  },
  aizome: {
    studio: {
      id: "aizome", slug: "aizome", name: "Aizome Yoga", logoUrl: null, timezone: "Asia/Singapore", currency: "SGD", theme: theme("indigo"),
      locations: [{ id: "tb", name: "Tiong Bahru", address: "55 Eng Hoon Street" }],
      classTypes: types([["hatha", "Hatha", "#2E3D73"], ["yin", "Yin", "#6C7FB0"], ["vinyasa", "Vinyasa", "#C2412D"], ["breath", "Breathwork", "#7D8290"]]),
      rules: { cancelling: "Cancel up to 6 hours before to keep your place free for someone else.", needPackage: true },
    },
    member: { firstName: "Kenji", email: "kenji@example.com" },
    favourite: "Sachiko M.",
    slots: [
      { days: [1, 2, 3, 4, 5, 6, 0], time: "06:45", type: "hatha", who: "Sachiko M.", loc: "tb", room: "Upstairs", cap: 18, mins: 60 },
      { days: [1, 3, 5], time: "12:00", type: "breath", who: "Arun K.", loc: "tb", room: "Upstairs", cap: 18, mins: 30 },
      { days: [2, 4], time: "12:00", type: "vinyasa", who: "Elena G.", loc: "tb", room: "Upstairs", cap: 18, mins: 45 },
      { days: [1, 2, 3, 4, 5], time: "18:30", type: "vinyasa", who: "Elena G.", loc: "tb", room: "Upstairs", cap: 18, mins: 60 },
      { days: [1, 2, 3, 4, 0], time: "20:00", type: "yin", who: "Sachiko M.", loc: "tb", room: "Upstairs", cap: 18, mins: 75 },
      { days: [6], time: "08:30", type: "vinyasa", who: "Arun K.", loc: "tb", room: "Upstairs", cap: 18, mins: 75 },
    ],
    classes: 108, doneThisMonth: 14, goal: 16, streak: { weeks: 22, best: 31 },
    earned: { first: "2024-08-03", classes_10: "2024-08-30", classes_25: "2024-10-11", classes_50: "2025-01-20", classes_108: addDays(todayIso(), -1), goal: "2024-11-30", streak: "2024-09-01", early: "2024-09-05", explorer: "2024-08-24" },
    celebrate: "milestone:108",
    pkg: {
      id: "p3", name: "Unlimited monthly", kind: "unlimited", state: "active", stateLabel: "Active", creditsTotal: null, creditsLeft: null, billing: "recurring",
      validUntil: addDays(firstOfNextMonth(), -1), startedOn: null, startNote: null,
      renewal: { period: 16, renewsOn: firstOfNextMonth(), endsOn: null, bookedAhead: [] },
      terms: ["Unlimited classes", "Renews every month until you stop it"],
    },
    banners: [
      { id: "b5", title: "A quiet weekend in Bintan", subtitle: "Two days of practice, 13 to 15 Feb. Ten places.", imageUrl: ART.aizomeRetreat },
      { id: "b6", title: "Sunrise Hatha, every day", subtitle: "6:45am, all week. Come as you are.", imageUrl: ART.aizomeMorning },
    ],
    booked: [[0, "18:30", "vinyasa"], [2, "06:45", "hatha"]],
  },
};
export const DEMO_STUDIOS = Object.keys(STUDIOS);

const ORDINAL = (n: number) => `${n}${["th", "st", "nd", "rd"][n % 100 > 10 && n % 100 < 14 ? 0 : n % 10 < 4 ? n % 10 : 0]}`;

export function demoBackend(key: string): Backend {
  const d = STUDIOS[key] ?? STUDIOS.linden!;
  const studio = d.studio as Studio;
  const days = 14;
  const start = todayIso();
  const seenKeys = new Set<string>();
  let goal = d.goal;
  const pkg: Package = structuredClone(d.pkg);
  // Everything they own: the starting package, plus anything bought in the demo.
  const owned: Package[] = [pkg];

  // The timetable for the next two weeks, from each studio's weekly slots.
  const classes = new Map<string, ClassItem>();
  for (let i = 0; i < days; i++) {
    const date = addDays(start, i);
    for (const s of d.slots.filter((x) => x.days.includes(weekday(date)))) {
      const t = studio.classTypes.find((c) => c.id === s.type)!;
      const id = `${key}-${date}-${s.time}-${s.type}`;
      const startsAt = at(date, s.time);
      const mins = s.mins ?? 50;
      const h = hash(id);
      const taken = h % 10 < 2 ? s.cap : Math.min(s.cap, Math.floor(((h >>> 3) % 100) / 100 * s.cap * 1.05));
      const left = s.cap - taken;
      const endsAt = new Date(startsAt.getTime() + mins * 60_000);
      const end = new Date(endsAt.getTime() + 8 * 3_600_000).toISOString().slice(11, 16);
      if (startsAt.getTime() <= Date.now()) continue;
      classes.set(id, {
        id, name: t.name, color: t.color, startsAt: startsAt.toISOString(), endsAt: endsAt.toISOString(), localDate: date, time: s.time, endTime: end, durationMinutes: mins,
        location: { id: s.loc, name: studio.locations.find((l) => l.id === s.loc)!.name }, room: s.room, instructor: { id: s.who, name: s.who, photoUrl: null },
        spotsLeft: left, availability: left === 0 ? (h % 3 ? "waitlist" : "full") : left <= 3 ? "few_left" : "open", label: "",
      });
    }
  }
  const relabel = (c: ClassItem) => {
    c.availability = c.spotsLeft === 0 ? (c.availability === "full" ? "full" : "waitlist") : c.spotsLeft <= 3 ? "few_left" : "open";
    c.label = c.spotsLeft === 0 ? (c.availability === "full" ? "Full" : "Full: join the waitlist") : `${c.spotsLeft} ${c.spotsLeft === 1 ? "spot" : "spots"} left`;
  };
  classes.forEach(relabel);

  const mine = new Map<string, MyBooking>();
  const book = (c: ClassItem, heldForPeriod: number | null = null) => {
    const id = `bk-${c.id}`;
    mine.set(id, { booking: { id, sessionId: c.id, status: "confirmed", payment: "package", clientPackageId: pkg.id, heldForPeriod }, session: { id: c.id, startsAt: c.startsAt, endsAt: c.endsAt, locationId: c.location.id }, classType: { id: c.id, name: c.name, color: c.color } });
    c.spotsLeft = Math.max(0, c.spotsLeft - 1);
    relabel(c);
    return id;
  };
  // The member's upcoming classes: the first matching class on or after each day asked for.
  for (const [offset, time, type] of d.booked) {
    const name = studio.classTypes.find((t) => t.id === type)?.name;
    const c = [...classes.values()].sort((x, y) => x.startsAt.localeCompare(y.startsAt)).find((x) => x.localDate >= addDays(start, offset) && x.time === time && x.name === name && !mine.has(`bk-${x.id}`));
    if (c) { if (c.spotsLeft === 0) c.spotsLeft = 1; book(c); }
  }
  const nextMonth = firstOfNextMonth();
  const inNextPeriod = (c: ClassItem) => pkg.billing === "recurring" && c.localDate >= nextMonth;
  const bookedThisMonth = () => [...mine.values()].filter((b) => b.session.startsAt.slice(0, 7) === start.slice(0, 7)).length;

  function progress(): Progress {
    const total = d.classes;
    const ms = studio.theme.milestones;
    const previous = [...ms].reverse().find((m) => m <= total) ?? 0;
    const next = ms.find((m) => m > total) ?? null;
    const done = d.doneThisMonth;
    const booked = bookedThisMonth();
    const badges: Badge[] = [
      { key: "first", title: "First class", detail: "You came to your first class.", earned: true, earnedOn: d.earned.first ?? null, progress: null },
      ...ms.map((m) => ({ key: `classes_${m}`, title: `${m} classes`, detail: `Your ${ORDINAL(m)} class with us.`, earned: total >= m, earnedOn: d.earned[`classes_${m}`] ?? null, progress: total >= m ? null : { have: total, need: m } })),
      { key: "goal", title: "Goal met", detail: d.earned.goal ? "You met your monthly goal." : "Meet the goal you set for a month.", earned: !!d.earned.goal, earnedOn: d.earned.goal ?? null, progress: null },
      { key: "streak", title: "Four weeks running", detail: "A class every week for four weeks.", earned: d.streak.best >= 4, earnedOn: d.earned.streak ?? null, progress: d.streak.best >= 4 ? null : { have: d.streak.weeks, need: 4 } },
      { key: "early", title: "Early riser", detail: "Five classes before 8am.", earned: !!d.earned.early, earnedOn: d.earned.early ?? null, progress: d.earned.early ? null : { have: 2, need: 5 } },
      { key: "explorer", title: "Explorer", detail: "Three different kinds of class.", earned: !!d.earned.explorer, earnedOn: d.earned.explorer ?? null, progress: d.earned.explorer ? null : { have: 2, need: 3 } },
    ];
    const candidates: Progress["celebration"][] = [];
    if (d.celebrate?.startsWith("milestone:")) candidates.push({ key: d.celebrate, kind: "milestone", number: previous, title: `${previous} classes`, message: `That's your ${ORDINAL(previous)} class with ${studio.name}.${next ? ` Next stop: ${next}.` : ""}` });
    if (goal && done >= goal) candidates.push({ key: `goal:${start.slice(0, 7)}`, kind: "goal", number: done, title: "Goal met", message: `${done} classes this month: you set ${goal} and you did it.` });
    if (d.celebrate === "badge:streak") candidates.push({ key: "badge:streak", kind: "badge", number: null, title: "Four weeks running", message: "A class every week for four weeks. That's a habit now." });
    const left = goal ? Math.max(0, goal - done) : 0;
    const now = sgNow();
    const lastDay = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + 1, 0)).getUTCDate();
    return {
      classes: total,
      milestones: ms,
      milestone: { previous, next, toGo: next ? next - total : 0, progress: next ? (total - previous) / (next - previous) : 1 },
      month: { month: start.slice(0, 7), label: now.toLocaleDateString("en-GB", { month: "long", timeZone: "UTC" }), done, booked, goal, daysLeft: lastDay - now.getUTCDate() + 1 },
      streak: d.streak,
      achievements: badges,
      celebration: candidates.find((c) => c && !seenKeys.has(c.key)) ?? null,
      nudge: goal && left > 0 ? `${left} more ${left === 1 ? "class" : "classes"} to reach your goal of ${goal} this month${booked ? `, and you've ${booked} booked` : ""}.` : next ? `${next - total} ${next - total === 1 ? "class" : "classes"} to your ${ORDINAL(next)}.` : null,
    };
  }

  const wait = <T,>(v: T, ms = 160) => new Promise<T>((r) => setTimeout(() => r(v), ms));
  const signedIn = { current: true };

  return {
    demo: true,
    studio: () => wait(studio, 40),
    me: () => wait(signedIn.current ? { firstName: d.member.firstName, email: d.member.email, favouriteInstructor: { id: d.favourite, firstName: d.favourite.split(" ")[0]!, name: d.favourite } } : null, 40),
    async signIn() { signedIn.current = true; return "signed_in"; },
    async signOut() { signedIn.current = false; },
    schedule: async (from, n) => {
      const out: ScheduleDay[] = [];
      for (let i = 0; i < n; i++) {
        const date = addDays(from, i);
        out.push({ date, label: label(date, date === start ? 0 : 1), closed: null, classes: [...classes.values()].filter((c) => c.localDate === date).sort((a, b) => a.time.localeCompare(b.time)) });
      }
      return wait(out);
    },
    myBookings: () => wait([...mine.values()].sort((a, b) => a.session.startsAt.localeCompare(b.session.startsAt))),
    packages: () => wait(structuredClone(owned)),
    async packageOptions(id) {
      const c = classes.get(id);
      if (!c) throw new AppError("not_found", "That class isn't on the timetable any more.");
      const windowHours = key === "tidal" ? 8 : key === "aizome" ? 6 : 12;
      const freeUntil = new Date(Date.parse(c.startsAt) - windowHours * 3_600_000);
      const ahead = inNextPeriod(c) ? { period: (pkg.renewal?.period ?? 1) + 1, periodStarts: nextMonth } : null;
      const usable = pkg.kind === "unlimited" || !!ahead || (pkg.creditsLeft ?? 0) > 0;
      const o: PackageOptions = {
        packageNeeded: true,
        suggested: usable ? pkg.id : null,
        freeCancelUntil: freeUntil.toISOString(),
        insideLateWindow: Date.now() >= freeUntil.getTime(),
        options: [{ ...structuredClone(pkg), usable, reason: usable ? null : "There are no classes left on it", bookedAhead: ahead }],
      };
      if (!usable) o.message = `None of your packages can be used for this class: ${pkg.name} (there are no classes left on it).`;
      return wait(o, 220);
    },
    async book(id) {
      const c = classes.get(id);
      if (!c) throw new AppError("not_found", "That class isn't on the timetable any more.");
      if ([...mine.values()].some((b) => b.session.id === id)) throw new AppError("already_booked", "You're already booked into this class.");
      if (c.spotsLeft === 0) throw new AppError("class_full", "This class has just filled up. Join the waitlist and we'll let you know if a spot opens.");
      const ahead = inNextPeriod(c);
      if (pkg.kind === "credits" && !ahead) {
        if ((pkg.creditsLeft ?? 0) <= 0) throw new AppError("package_needed", "None of your packages can be used for this class.");
        pkg.creditsLeft = (pkg.creditsLeft ?? 0) - 1;
      }
      if (ahead && pkg.renewal) {
        const next = pkg.renewal.bookedAhead[0] ?? { period: pkg.renewal.period + 1, classes: 0, periodStarts: nextMonth, note: "" };
        next.classes += 1;
        next.note = `${next.classes === 1 ? "1 class" : `${next.classes} classes`} booked ahead, ${pkg.kind === "credits" ? "taken from" : "in"} the period starting ${nice(nextMonth)}${pkg.kind === "credits" ? " when it renews" : ""}`;
        pkg.renewal.bookedAhead = [next];
      }
      return wait({ id: book(c, ahead ? (pkg.renewal?.period ?? 1) + 1 : null) }, 260);
    },
    async joinWaitlist() { await wait(null, 200); },
    async cancel(id, acknowledge = []) {
      const b = mine.get(id);
      if (!b) throw new AppError("not_found", "That booking has already been cancelled.");
      const windowHours = key === "tidal" ? 8 : key === "aizome" ? 6 : 12;
      const late = Date.parse(b.session.startsAt) - Date.now() < windowHours * 3_600_000;
      if (late && !acknowledge.includes("late_cancel")) throw new AppError("needs_confirmation", "This class starts soon, so you won't get your class credit back. Cancel anyway?", [{ code: "late_cancel", message: "This class starts soon, so you won't get your class credit back. Cancel anyway?" }]);
      mine.delete(id);
      const c = classes.get(b.session.id);
      if (c) { c.spotsLeft += 1; relabel(c); }
      const heldAhead = !!b.booking.heldForPeriod;
      if (heldAhead && pkg.renewal?.bookedAhead[0]) {
        const a = pkg.renewal.bookedAhead[0];
        a.classes -= 1;
        pkg.renewal.bookedAhead = a.classes > 0 ? [a] : [];
      } else if (!late && pkg.kind === "credits") pkg.creditsLeft = (pkg.creditsLeft ?? 0) + 1;
      return wait({ classReturned: !late || heldAhead }, 220);
    },
    progress: () => wait(progress()),
    async setGoal(n) { goal = n; return wait(progress(), 120); },
    async seen(k) { seenKeys.add(k); },
    banners: () => wait({ rotateSeconds: 6, banners: d.banners.map((b) => ({ ...b, link: { type: "none", target: null } })) }),
    ...demoAccount(key, { packages: owned, studioName: studio.name, member: d.member.firstName }),
  };
}
