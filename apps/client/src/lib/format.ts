/** Dates and times in the studio's time zone, written the way people say them. */
export function dayLabel(iso: string, tz: string, now = new Date()): string {
  const d = new Date(iso);
  const key = (x: Date) => x.toLocaleDateString("en-CA", { timeZone: tz });
  const today = key(now);
  const tomorrow = key(new Date(now.getTime() + 86_400_000));
  if (key(d) === today) return "Today";
  if (key(d) === tomorrow) return "Tomorrow";
  return d.toLocaleDateString("en-GB", { weekday: "long", day: "numeric", month: "short", timeZone: tz });
}
export const clock = (iso: string, tz: string) => new Date(iso).toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit", timeZone: tz }).replace(" ", "").toLowerCase();
export const hhmm = (t: string) => {
  const [h, m] = t.split(":").map(Number);
  return { time: `${((h! + 11) % 12) + 1}:${String(m).padStart(2, "0")}`, half: h! < 12 ? "am" : "pm" };
};
export const isoToday = (tz: string) => new Date().toLocaleDateString("en-CA", { timeZone: tz });
export const addDays = (iso: string, n: number) => new Date(Date.parse(`${iso}T00:00:00Z`) + n * 86_400_000).toISOString().slice(0, 10);
/** "21 Nov", or "30 Nov 2024" when it isn't this year. */
export const shortDate = (iso: string) => {
  const d = new Date(`${iso}T00:00:00Z`);
  return d.toLocaleDateString("en-GB", { day: "numeric", month: "short", ...(d.getUTCFullYear() !== new Date().getUTCFullYear() ? { year: "numeric" } : {}), timeZone: "UTC" });
};
export const ordinal = (n: number) => `${n}${["th", "st", "nd", "rd"][n % 100 > 10 && n % 100 < 14 ? 0 : n % 10 < 4 ? n % 10 : 0]}`;
export function greeting(tz: string) {
  const h = Number(new Date().toLocaleTimeString("en-GB", { hour: "2-digit", hourCycle: "h23", timeZone: tz }).slice(0, 2));
  return h < 12 ? "Good morning" : h < 18 ? "Good afternoon" : "Good evening";
}
export const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;
