/**
 * The real API. Every call sends the sign-in token and the studio (X-Studio-Id); the API reads
 * the person's role from its own records. The studio comes from the address: /s/<slug>, or
 * ?studio=<slug>, or VITE_STUDIO for a studio's own build of the app.
 */
import { auth } from "./auth";
import { AppError, type Backend, type Banner, type MyBooking, type Package, type PackageOptions, type Progress, type ScheduleDay, type Studio } from "./types";

export const API_URL = (import.meta.env.VITE_API_URL ?? "http://localhost:3000").replace(/\/$/, "");

export function studioSlug(): string {
  const fromPath = location.pathname.match(/\/s\/([a-z0-9-]+)/)?.[1];
  return fromPath ?? new URLSearchParams(location.search).get("studio") ?? import.meta.env.VITE_STUDIO ?? "";
}

export function httpBackend(slug: string): Backend {
  let studioId: string | null = null;
  async function call<T>(method: string, path: string, body?: unknown, signedIn = true): Promise<T> {
    const headers: Record<string, string> = {};
    if (body !== undefined) headers["content-type"] = "application/json";
    if (signedIn) {
      const t = await auth.token();
      if (t) headers.authorization = `Bearer ${t}`;
      if (studioId) headers["x-studio-id"] = studioId;
    }
    let res: Response;
    try {
      res = await fetch(`${API_URL}/v1${path}`, { method, headers, body: body === undefined ? undefined : JSON.stringify(body) });
    } catch {
      throw new AppError("offline", "We couldn't reach the studio. Check your connection and try again.");
    }
    const text = await res.text();
    const json = text ? JSON.parse(text) : {};
    if (!res.ok) {
      const e = json.error ?? {};
      throw new AppError(e.code ?? "error", e.message ?? "Something went wrong. Try again.", e.flags ?? []);
    }
    return json as T;
  }

  return {
    demo: false,
    async studio() {
      const s = await call<Studio>("GET", `/public/studios/${encodeURIComponent(slug)}`, undefined, false);
      studioId = s.id;
      return s;
    },
    async me() {
      if (!(await auth.token())) return null;
      const mine = await call<{ firstName: string | null; studios: { id: string }[] }>("GET", "/me/studios");
      if (!mine.studios.some((x) => x.id === studioId)) throw new AppError("not_member", "You're signed in, but not with this studio yet.");
      return { firstName: mine.firstName ?? "there", email: await auth.email() };
    },
    async signIn(email, code) {
      if (!code) {
        await auth.sendCode(email, location.href);
        return "code_sent";
      }
      await auth.verifyCode(email, code);
      return "signed_in";
    },
    signOut: () => auth.signOut(),
    async schedule(from, days) {
      return (await call<{ days: ScheduleDay[] }>("GET", `/public/studios/${encodeURIComponent(slug)}/schedule?date=${from}&days=${days}`, undefined, false)).days;
    },
    async myBookings() {
      return (await call<{ classes: MyBooking[] }>("GET", "/me/bookings?show=classes")).classes;
    },
    async packages() {
      return (await call<{ packages: Package[] }>("GET", "/me/packages")).packages;
    },
    packageOptions: (id) => call<PackageOptions>("GET", `/sessions/${id}/package-options`),
    async book(sessionId, acknowledge) {
      return call<{ id: string }>("POST", "/bookings", { sessionId, acknowledge });
    },
    async joinWaitlist(sessionId) {
      await call("POST", "/waitlist", { sessionId });
    },
    async cancel(id, acknowledge = []) {
      const r = await call<{ classReturnedToPackage: boolean }>("POST", `/bookings/${id}/cancel`, { acknowledge });
      return { classReturned: r.classReturnedToPackage };
    },
    progress: () => call<Progress>("GET", "/me/progress"),
    setGoal: (classes) => call<Progress>("PUT", "/me/goal", { classes }),
    async seen(key) {
      await call("POST", `/me/celebrations/${encodeURIComponent(key)}/seen`);
    },
    banners: () => call<{ rotateSeconds: number; banners: Banner[] }>("GET", "/me/banners?placement=home"),
  };
}
