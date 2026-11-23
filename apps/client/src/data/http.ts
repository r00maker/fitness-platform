/**
 * The real API. Every call sends the sign-in token and the studio (X-Studio-Id); the API reads
 * the person's role from its own records. The studio comes from the address: /s/<slug>, or
 * ?studio=<slug>, or VITE_STUDIO for a studio's own build of the app.
 */
import { auth } from "./auth";
import { AppError, type Backend, type Banner, type ExtensionPolicy, type GiftCardShop, type HealthNote, type Loyalty, type MyGiftCards, type MyBooking, type Notifications, type Package, type PackageDetail, type PackageOptions, type PaymentCard, type Placed, type Plan, type Product, type Progress, type Purchase, type Quote, type Referral, type ScheduleDay, type StopOptions, type Studio, type Waiver } from "./types";

/** What the API says after an order: paid, pay online (redirect), or pay at the desk. */
type Payment = { online: boolean; redirectUrl?: string; message?: string };
const placed = (status: string, payment: Payment, done: string): Placed =>
  status === "paid" ? { done: true, message: payment.message ?? done } : payment.online && payment.redirectUrl ? { done: false, message: "Taking you to the payment page…", redirectUrl: payment.redirectUrl } : { done: false, message: payment.message ?? "Order placed." };

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
      throw new AppError(e.code ?? "error", e.message ?? "Something went wrong. Try again.", e.flags ?? [], e);
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
      const me = await call<{ favouriteInstructor: { id: string; firstName: string; name: string } | null }>("GET", "/me");
      return { firstName: mine.firstName ?? "there", email: await auth.email(), favouriteInstructor: me.favouriteInstructor };
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
    async book(sessionId, acknowledge, waiver) {
      return call<{ id: string }>("POST", "/bookings", { sessionId, acknowledge, ...(waiver ? { waiver: { agree: true, signedName: waiver.signedName } } : {}) });
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

    async plans() {
      return (await call<{ packages: Plan[] }>("GET", `/public/studios/${encodeURIComponent(slug)}/packages`, undefined, false)).packages;
    },
    quote: (planId, c) => call<Quote>("GET", `/checkout/quote?${new URLSearchParams({ planId, useCredit: String(c.useCredit), ...(c.voucherId ? { voucherId: c.voucherId } : {}), ...(c.rolloverFromPackageId ? { rolloverFromPackageId: c.rolloverFromPackageId } : {}) })}`),
    async checkout(planId, c) {
      const r = await call<{ order: { status: string }; payment: Payment }>("POST", "/checkout", { planId, ...c });
      return placed(r.order.status, r.payment, "It's in your packages.");
    },
    packageDetail: (id) => call<PackageDetail>("GET", `/client-packages/${id}`),
    async extensionPolicy() {
      return (await call<{ extensions: ExtensionPolicy }>("GET", "/me/packages")).extensions;
    },
    async uploadAttachment(file) {
      // The file goes as it is, with its own type; the API checks what's actually inside.
      const t = await auth.token();
      let res: Response;
      try {
        res = await fetch(`${API_URL}/v1/files?purpose=extension_attachment`, { method: "POST", headers: { "content-type": file.type || "application/octet-stream", ...(t ? { authorization: `Bearer ${t}` } : {}), ...(studioId ? { "x-studio-id": studioId } : {}) }, body: file });
      } catch {
        throw new AppError("offline", "We couldn't upload that. Check your connection and try again.");
      }
      const j = await res.json().catch(() => ({}));
      if (!res.ok) throw new AppError(j.error?.code ?? "error", j.error?.message ?? "That file couldn't be uploaded.");
      return { id: j.id as string };
    },
    async requestExtension(id, days, reason, attachmentFileId) {
      const r = await call<{ approvedAutomatically: boolean }>("POST", `/client-packages/${id}/extension-requests`, { days, reason, ...(attachmentFileId ? { attachmentFileId } : {}) });
      return { message: r.approvedAutomatically ? `Done: extended by ${days} ${days === 1 ? "day" : "days"}.` : "Sent to the studio. You'll hear back soon." };
    },
    async share(id, email) {
      await call("POST", `/client-packages/${id}/members`, { email });
    },
    async unshare(id, userId) {
      await call("DELETE", `/client-packages/${id}/members/${userId}`);
    },
    stopOptions: (id) => call<StopOptions>("GET", `/client-packages/${id}/stop-options`),
    stopRenewing: (id, endEarly) => call<{ endsOn: string; fee: string | null }>("POST", `/client-packages/${id}/stop-renewing`, { endEarly }),
    async resumeRenewing(id) {
      await call("POST", `/client-packages/${id}/resume-renewing`);
    },
    healthNotes: () => call<{ active: HealthNote[]; resolved: HealthNote[] }>("GET", "/me/health-notes"),
    async addHealthNote(description) {
      await call("POST", "/me/health-notes", { description });
    },
    async resolveHealthNote(id) {
      await call("POST", `/me/health-notes/${id}/resolve`);
    },
    async stillCurrent(id) {
      await call("POST", `/me/health-notes/${id}/still-current`);
    },
    waiver: () => call<Waiver>("GET", "/me/waiver"),
    async signWaiver(name) {
      await call("POST", "/me/waiver", { agree: true, signedName: name });
    },
    shop: () => call<{ visible: boolean; giftCards: boolean; products: Product[] }>("GET", "/shop"),
    async buyProducts(items, payWith) {
      const r = await call<{ order: { status: string }; payment: Payment; message: string }>("POST", "/shop/checkout", { items, payWith });
      return placed(r.order.status === "ready" ? "paid" : "pending", { ...r.payment, message: r.message }, "All paid. Collect it at the front desk.");
    },
    giftCardShop: () => call<GiftCardShop>("GET", "/gift-cards/shop"),
    async buyGiftCard(input) {
      const r = await call<{ order: { status: string }; payment: Payment }>("POST", "/gift-cards/checkout", input);
      return placed(r.order.status, r.payment, "Your gift card is ready.");
    },
    myGiftCards: () => call<MyGiftCards>("GET", "/me/gift-cards"),
    async giveGiftCard(id, to, message) {
      await call("POST", `/gift-cards/${id}/give`, { to, message });
    },
    async keepGiftCard(id) {
      await call("POST", `/gift-cards/${id}/keep`);
    },
    loyalty: () => call<Loyalty>("GET", "/me/loyalty"),
    async redeem(rewardId) {
      const r = await call<{ message?: string }>("POST", `/me/loyalty/rewards/${rewardId}/redeem`);
      return { message: r.message ?? "Redeemed." };
    },
    referral: () => call<Referral>("GET", "/me/referral"),
    async purchases() {
      return (await call<{ purchases: Purchase[] }>("GET", "/me/purchases")).purchases;
    },
    paymentCard: () => call<PaymentCard>("GET", "/me/payment-card"),
    addCard: () => call<{ redirectUrl?: string; message?: string }>("POST", "/me/payment-card"),
    notifications: () => call<Notifications>("GET", "/me/marketing"),
    setNotifications: (n) => call<Notifications>("PATCH", "/me/marketing", n),
  };
}
