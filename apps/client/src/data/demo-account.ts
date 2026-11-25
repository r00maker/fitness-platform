/**
 * The demo studios' buying and account side: packages for sale, checkout, managing a package
 * (history, extensions, sharing, stopping a membership), health notes, the waiver, the shop,
 * gift cards, rewards, referrals, receipts, the saved card and notifications. It behaves like the
 * API in the ways a person would notice; payment is "at the front desk" (no card details in a demo).
 */
import { ART } from "./art";
import { money as fmtMoney } from "../lib/format";
import { AppError, type Backend, type Placed, type GiftCard, type HealthNote, type Loyalty, type Notifications, type Package, type PackageDetail, type Plan, type Product, type Purchase, type Quote } from "./types";

const money = (c: number) => fmtMoney(c, "SGD");
const today = () => new Date(Date.now() + 8 * 3_600_000).toISOString().slice(0, 10);
const plusDays = (iso: string, n: number) => new Date(Date.parse(`${iso}T00:00:00Z`) + n * 86_400_000).toISOString().slice(0, 10);
const nice = (iso: string) => new Date(`${iso}T00:00:00Z`).toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric", timeZone: "UTC" });
const wait = <T,>(v: T, ms = 160) => new Promise<T>((r) => setTimeout(() => r(v), ms));
let seq = 100;
const id = (p: string) => `${p}${seq++}`;

type PlanDef = Plan & { validityDays: number | null; credits: number | null; startsOnPurchase?: boolean };
const PLANS: Record<string, PlanDef[]> = {
  linden: [
    { id: "lp1", name: "Intro: 3 classes", description: "For your first two weeks with us.", kind: "credits", billing: "one_time", priceCents: 9900, credits: 3, validityDays: 14, price: "", terms: ["3 classes", "Valid for 14 days from the first class", "New members only"] },
    { id: "lp2", name: "10-class pack", description: null, kind: "credits", billing: "one_time", priceCents: 38000, credits: 10, validityDays: 90, price: "", terms: ["10 classes", "Valid for 3 months from the first class", "Every class"] },
    { id: "lp3", name: "20-class pack", description: "Our best value per class.", kind: "credits", billing: "one_time", priceCents: 68000, credits: 20, validityDays: 180, price: "", terms: ["20 classes", "Valid for 6 months from the first class", "Up to 2 people can share it"] },
    { id: "lp5", name: "30-day unlimited pass", description: "Every class for 30 days. Pick the day it starts.", kind: "unlimited", billing: "one_time", priceCents: 39000, credits: null, validityDays: 30, startsOnPurchase: true, price: "", terms: ["Unlimited classes", "Valid for 30 days from the day you choose"] },
    { id: "lp4", name: "Unlimited monthly", description: null, kind: "unlimited", billing: "recurring", priceCents: 42000, credits: null, validityDays: 30, price: "", terms: ["Unlimited classes", "Up to 5 classes a week", "Renews every month until you stop it", "Minimum 3 months"] },
  ],
  tidal: [
    { id: "tp1", name: "Drop-in", description: null, kind: "credits", billing: "one_time", priceCents: 4200, credits: 1, validityDays: 30, price: "", terms: ["1 class", "Valid for 30 days"] },
    { id: "tp2", name: "8 classes a month", description: null, kind: "credits", billing: "recurring", priceCents: 26000, credits: 8, validityDays: 30, price: "", terms: ["8 classes a month", "Renews every month until you stop it"] },
    { id: "tp3", name: "Unlimited monthly", description: "Barre as often as you like.", kind: "unlimited", billing: "recurring", priceCents: 34000, credits: null, validityDays: 30, price: "", terms: ["Unlimited classes", "Renews every month until you stop it"] },
  ],
  aizome: [
    { id: "ap1", name: "5-class pass", description: null, kind: "credits", billing: "one_time", priceCents: 15500, credits: 5, validityDays: 60, price: "", terms: ["5 classes", "Valid for 2 months from the first class"] },
    { id: "ap2", name: "Unlimited monthly", description: null, kind: "unlimited", billing: "recurring", priceCents: 26000, credits: null, validityDays: 30, price: "", terms: ["Unlimited classes", "Renews every month until you stop it"] },
  ],
};

const PRODUCTS: Record<string, Product[]> = {
  linden: [
    { id: "s1", name: "Grip socks", description: "Non-slip, for the reformer.", priceCents: 1800, price: "", photoUrl: null, category: "Studio", options: [{ name: "S", soldOut: false }, { name: "M", soldOut: false }, { name: "L", soldOut: true }], soldOut: false },
    { id: "s2", name: "Linden water bottle", description: "Steel, 750ml.", priceCents: 3200, price: "", photoUrl: null, category: "Studio", options: [], soldOut: false },
    { id: "s3", name: "Cold-pressed juice", description: "Collect after class.", priceCents: 900, price: "", photoUrl: null, category: "Café", options: [{ name: "Green", soldOut: false }, { name: "Beet", soldOut: false }], soldOut: false },
  ],
  tidal: [
    { id: "s4", name: "Tidal grip socks", description: "Pink, of course.", priceCents: 1600, price: "", photoUrl: null, category: "Studio", options: [{ name: "S/M", soldOut: false }, { name: "M/L", soldOut: false }], soldOut: false },
    { id: "s5", name: "Tidal tote", description: null, priceCents: 2800, price: "", photoUrl: null, category: "Studio", options: [], soldOut: false },
  ],
  aizome: [
    { id: "s6", name: "Cork block", description: null, priceCents: 2400, price: "", photoUrl: null, category: "Practice", options: [], soldOut: false },
    { id: "s7", name: "Indigo mat strap", description: "Hand-dyed.", priceCents: 3800, price: "", photoUrl: null, category: "Practice", options: [], soldOut: false },
  ],
};

export function demoAccount(key: string, ctx: { packages: Package[]; studioName: string; member: string }) {
  const plans = (PLANS[key] ?? PLANS.linden!).map((p) => ({ ...p, price: money(p.priceCents) }));
  const products = (PRODUCTS[key] ?? []).map((p) => ({ ...p, price: money(p.priceCents) }));
  let credit = key === "linden" ? 2500 : 0;
  // A discount from a friend's referral, and classes that can move across from the current pack.
  const vouchers: { id: string; label: string; note: string; percent?: number; cents?: number }[] = key === "linden" ? [{ id: "v1", label: "10% off", note: "From Hannah's referral", percent: 10 }] : key === "tidal" ? [{ id: "v2", label: "SGD 20 off", note: "Your birthday treat", cents: 2000 }] : [];
  const rollovers = () => key === "linden" ? ctx.packages.filter((p) => p.kind === "credits" && p.billing === "one_time" && (p.creditsLeft ?? 0) > 0).slice(0, 1).map((p) => ({ packageId: p.id, name: p.name, classes: Math.min(5, p.creditsLeft ?? 0), validUntil: p.validUntil })) : [];
  const priceOf = (p: PlanDef, c: { useCredit: boolean; voucherId?: string }) => {
    const v = vouchers.find((x) => x.id === c.voucherId);
    const discount = v ? (v.percent ? Math.round((p.priceCents * v.percent) / 100) : Math.min(p.priceCents, v.cents ?? 0)) : 0;
    const using = c.useCredit ? Math.min(credit, p.priceCents - discount) : 0;
    return { v, discount, using, due: p.priceCents - discount - using };
  };
  const purchases: Purchase[] = [
    { id: "i1", number: "INV-0412", receiptNumber: "RC-0412", statusLabel: "Paid", description: ctx.packages[0]!.name, total: key === "linden" ? money(38000) : key === "tidal" ? money(26000) : money(26000), issuedAt: plusDays(today(), -16) },
  ];
  const health: { active: HealthNote[]; resolved: HealthNote[] } = {
    active: key === "linden" ? [{ id: "h1", description: "Tight lower back, easing off", categoryLabel: "Back", status: "active", needsCheck: true }] : [],
    resolved: key === "tidal" ? [{ id: "h2", description: "Sprained right ankle", categoryLabel: "Ankle and foot", status: "resolved" }] : [],
  };
  const waiver = { required: key !== "aizome", done: key !== "aizome", signedAt: key === "linden" ? "2025-03-08" : "2026-06-14", text: "I understand that exercise carries some risk. I'll tell my instructor about any injury or condition before class, and I take part at my own risk. The studio isn't responsible for lost items." };
  const notifications: Notifications = { marketingEmail: true, marketingPush: true, marketingWhatsapp: false };
  const cards: GiftCard[] = key === "linden" ? [{ id: "g1", code: "LINDEN-7Q2K", amount: money(10000), status: "unsent", statusLabel: "Ready to give", design: { name: "Leaves", imageUrl: ART.lindenFriend }, from: null, to: null, message: null, daysLeftToGive: 41 }] : [];
  const loyalty: Loyalty = key === "aizome"
    ? { enabled: false }
    : {
        enabled: true, name: key === "tidal" ? "pulse" : "leaf", namePlural: key === "tidal" ? "pulses" : "leaves",
        balance: key === "tidal" ? 190 : 470, balanceText: key === "tidal" ? "190 pulses" : "470 leaves",
        nextExpiry: null,
        rules: [key === "tidal" ? "10 pulses for every class you come to" : "10 leaves for every class you come to", "1 for every SGD 1 you spend"],
        rewards: [
          { id: "r1", name: "A free class", description: null, cost: 500, costText: key === "tidal" ? "500 pulses" : "500 leaves", whatYouGet: "1 class added to your account", canRedeem: false, needMore: 0, soldOut: false },
          { id: "r2", name: "Grip socks", description: "Collect at the front desk.", cost: 300, costText: key === "tidal" ? "300 pulses" : "300 leaves", whatYouGet: "Show the code at the front desk", canRedeem: false, needMore: 0, soldOut: false },
        ],
        redemptions: [],
      };
  const recalcRewards = () => loyalty.rewards?.forEach((r) => { r.canRedeem = (loyalty.balance ?? 0) >= r.cost; r.needMore = Math.max(0, r.cost - (loyalty.balance ?? 0)); });
  recalcRewards();

  const desk = (what: string) => ({ done: false, message: `Order placed. Pay at the front desk and ${what}.` });
  const addPurchase = (description: string, cents: number, paid: boolean) => purchases.unshift({ id: id("i"), number: `INV-0${seq}`, receiptNumber: paid ? `RC-0${seq}` : null, statusLabel: paid ? "Paid" : "Waiting for payment", description, total: money(cents), issuedAt: today() });

  const detail = (p: Package): PackageDetail => ({
    ...p,
    classes: p === ctx.packages[0] ? [
      { bookingId: "x1", date: plusDays(today(), -9), time: "7:00am", className: key === "aizome" ? "Hatha" : key === "tidal" ? "Barre Burn" : "Reformer Intermediate", status: "Attended", credit: p.kind === "credits" ? "1 class used" : "Unlimited" },
      { bookingId: "x2", date: plusDays(today(), -6), time: "12:15pm", className: key === "aizome" ? "Yin" : key === "tidal" ? "Barre Sculpt" : "Reformer Flow", status: "Attended", credit: p.kind === "credits" ? "1 class used" : "Unlimited" },
      { bookingId: "x3", date: plusDays(today(), -3), time: "6:00pm", className: key === "aizome" ? "Vinyasa" : key === "tidal" ? "Cardio Barre" : "Mat Pilates", status: "Cancelled", credit: p.kind === "credits" ? "Class given back" : "Unlimited" },
    ] : [],
    changes: [{ date: plusDays(today(), -16), kind: "purchase", title: p.kind === "credits" ? `Bought: ${p.creditsTotal} classes` : "Bought", detail: null }],
    extensionRequests: [],
    sharing: { maxUsers: p.name.startsWith("20") ? 2 : 1, spacesLeft: p.name.startsWith("20") ? 1 : 0, members: [{ userId: "me", name: ctx.member, isOwner: true }] },
  });
  const find = (pid: string) => {
    const p = ctx.packages.find((x) => x.id === pid);
    if (!p) throw new AppError("not_found", "That package isn't here any more.");
    return p;
  };
  const extras = new Map<string, Partial<PackageDetail>>();

  const methods: Omit<Backend, "demo" | "studio" | "me" | "signIn" | "signOut" | "schedule" | "myBookings" | "packages" | "packageOptions" | "book" | "joinWaitlist" | "cancel" | "progress" | "setGoal" | "seen" | "banners"> = {
    plans: () => wait(plans),
    async quote(planId, c) {
      const p = plans.find((x) => x.id === planId)!;
      const { v, discount, using, due } = priceOf(p, c);
      const roll = rollovers().find((r) => r.packageId === c.rolloverFromPackageId);
      const q: Quote = {
        package: { id: p.id, name: p.name, billing: p.billing, terms: p.terms },
        lines: [
          { label: p.name, amount: p.price },
          ...(roll && p.kind === "credits" ? [{ label: `${roll.classes} unused ${roll.classes === 1 ? "class" : "classes"} from ${roll.name}`, amount: "Included" }] : []),
          ...(discount ? [{ label: `Discount (${v!.label})`, amount: `−${money(discount)}` }] : []),
          ...(using ? [{ label: "Studio credit", amount: `−${money(using)}` }] : []),
        ],
        total: money(due),
        totalCents: due,
        studioCredit: { balance: money(credit), balanceCents: credit, using: money(using) },
        recurringNote: p.billing === "recurring" ? `You'll be charged ${p.price} each month until you stop it.${discount || using ? " The discount and credit apply to this first payment only." : ""}` : null,
        startsNote: p.billing === "one_time" && !p.startsOnPurchase ? "It starts on the day of the first class you book with it." : null,
        startDate: p.startsOnPurchase ? { earliest: today(), latest: plusDays(today(), 60), default: today() } : null,
        payments: p.billing === "recurring"
          ? { online: true, options: [{ payWith: "online", label: "Card, Apple Pay or Google Pay", fee: null, total: money(due) }], message: "Your card is kept securely by Stripe for the renewals." }
          : { online: true, options: [{ payWith: "online", label: "Pay online", fee: null, total: money(due) }, { payWith: "desk", label: "Pay at the studio", fee: null, total: money(due) }], message: null },
        vouchers: vouchers.map(({ id: vid, label, note }) => ({ id: vid, label, note })),
        rolloverOptions: p.kind === "credits" ? rollovers() : [],
      };
      return wait(q, 220);
    },
    async checkout(planId, c) {
      const p = plans.find((x) => x.id === planId)!;
      const { v, using, due } = priceOf(p, c);
      const roll = rollovers().find((r) => r.packageId === c.rolloverFromPackageId);
      const finish = (paid: boolean): Placed => {
        credit -= using;
        if (v) vouchers.splice(vouchers.indexOf(v), 1);
        addPurchase(p.name, due, paid);
        if (!paid) return desk("your package will be ready straight away");
        if (roll) { const from = find(roll.packageId); from.creditsLeft = (from.creditsLeft ?? 0) - roll.classes; }
        const start = c.startDate ?? (p.startsOnPurchase ? today() : null);
        const credits = p.credits === null ? null : p.credits + (roll && p.kind === "credits" ? roll.classes : 0);
        ctx.packages.push({
          id: id("p"), name: p.name, kind: p.kind, state: start && start > today() ? "not_started" : start ? "active" : "not_started", stateLabel: start && start <= today() ? "Active" : "Not started", creditsTotal: credits, creditsLeft: credits, billing: p.billing,
          validUntil: start && p.validityDays ? plusDays(start, p.validityDays - 1) : null, startedOn: start, startNote: p.billing === "one_time" && !start ? "Starts on the day of the first class you book with it." : null, terms: p.terms,
          ...(p.billing === "recurring" ? { renewal: { period: 1, renewsOn: plusDays(today(), 30), endsOn: null, bookedAhead: [] }, state: "active" as const, stateLabel: "Active" } : {}),
        });
        return { done: true, message: `Paid. ${p.name} is in your packages.` };
      };
      if (c.payWith === "desk" && due > 0) return wait(finish(false), 300);
      if (due === 0) return wait(finish(true), 300);
      // Online: the demo's stand-in for Stripe's page; paying there finishes the order.
      return wait({ done: false, message: "", demoPay: { amount: money(due), description: p.name, confirm: async () => wait(finish(true), 500) } }, 250);
    },
    packageDetail: async (pid) => wait({ ...detail(find(pid)), ...(extras.get(pid) ?? {}) }),
    async uploadAttachment(file) {
      if (file.size > 10 * 1024 * 1024) throw new AppError("too_big", "That file is too big. The limit is 10 MB.");
      if (!/^(image\/(jpeg|png|webp)|application\/pdf)$/.test(file.type)) throw new AppError("wrong_type", "Use a photo (JPEG, PNG or WebP) or a PDF.");
      return wait({ id: id("f") }, 300);
    },
    extensionPolicy: () => wait({ allowed: true, maxDays: 30, fee: null, attachment: "optional" as const, summary: "Ask for up to 30 days. Requests up to 7 days are approved straight away (once per package); longer ones are reviewed by the studio." }),
    async requestExtension(pid, days, reason, _attachment) {
      const p = find(pid);
      const auto = days <= 7 && !(extras.get(pid)?.extensionRequests?.length);
      if (auto && p.validUntil) p.validUntil = plusDays(p.validUntil, days);
      const list = [...(extras.get(pid)?.extensionRequests ?? []), { id: id("e"), days, reason, status: auto ? "approved" : "pending", statusLabel: auto ? "Approved" : "Waiting for the studio", requestedOn: today() }];
      extras.set(pid, { ...(extras.get(pid) ?? {}), extensionRequests: list });
      return wait({ message: auto ? `Done: extended by ${days} ${days === 1 ? "day" : "days"}.` : "Sent to the studio. You'll hear back soon." });
    },
    async share(pid, email) {
      const d = { ...detail(find(pid)), ...(extras.get(pid) ?? {}) };
      if (d.sharing.spacesLeft <= 0) throw new AppError("package_full", "This package can't be shared with anyone else.");
      if (!/@/.test(email)) throw new AppError("bad_email", "Enter their email address.");
      const name = email.split("@")[0]!.replace(/^\w/, (c) => c.toUpperCase());
      extras.set(pid, { ...(extras.get(pid) ?? {}), sharing: { ...d.sharing, spacesLeft: d.sharing.spacesLeft - 1, members: [...d.sharing.members, { userId: id("u"), name, isOwner: false }] } });
      await wait(null);
    },
    async unshare(pid, userId) {
      const d = { ...detail(find(pid)), ...(extras.get(pid) ?? {}) };
      extras.set(pid, { ...(extras.get(pid) ?? {}), sharing: { ...d.sharing, spacesLeft: d.sharing.spacesLeft + 1, members: d.sharing.members.filter((m) => m.userId !== userId) } });
      await wait(null);
    },
    stopOptions: async (pid) => {
      const p = find(pid);
      const ends = p.validUntil ?? plusDays(today(), 8);
      return wait({ inMinimumTerm: false, minimumTermEndsOn: null, stopAtEndOfTerm: { endsOn: ends }, endEarly: null, bookedAheadAfterEnd: { atEndOfTerm: p.renewal?.bookedAhead.reduce((a, b) => a + b.classes, 0) ?? 0, endingEarly: 0 } });
    },
    async stopRenewing(pid) {
      const p = find(pid);
      const ends = p.validUntil ?? plusDays(today(), 8);
      if (p.renewal) p.renewal = { ...p.renewal, renewsOn: null, endsOn: ends, bookedAhead: [] };
      return wait({ endsOn: ends, fee: null });
    },
    async resumeRenewing(pid) {
      const p = find(pid);
      if (p.renewal) p.renewal = { ...p.renewal, renewsOn: p.validUntil ? plusDays(p.validUntil, 1) : null, endsOn: null };
      await wait(null);
    },
    healthNotes: () => wait(structuredClone(health)),
    async addHealthNote(description) {
      if (description.trim().length < 3) throw new AppError("invalid_input", "Add a few words, e.g. “sore left knee”.");
      health.active.unshift({ id: id("h"), description: description.trim(), status: "active" });
      await wait(null);
    },
    async resolveHealthNote(hid) {
      const n = health.active.find((x) => x.id === hid);
      if (n) { health.active = health.active.filter((x) => x !== n); health.resolved.unshift({ ...n, status: "resolved" }); }
      await wait(null);
    },
    async stillCurrent(hid) {
      const n = health.active.find((x) => x.id === hid);
      if (n) n.needsCheck = false;
      await wait(null);
    },
    waiver: () => wait({ ...waiver }),
    async signWaiver(name) {
      if (name.trim().length < 2) throw new AppError("invalid_input", "Type your full name to sign.");
      Object.assign(waiver, { done: true, signedAt: today() });
      await wait(null);
    },
    shop: () => wait({ visible: true, giftCards: key !== "aizome", products }),
    async buyProducts(items, payWith) {
      const total = items.reduce((a, i) => a + products.find((p) => p.id === i.productId)!.priceCents * i.quantity, 0);
      const using = Math.min(credit, total);
      const finish = (paid: boolean): Placed => {
        credit -= using;
        addPurchase(items.map((i) => products.find((p) => p.id === i.productId)!.name).join(", "), total - using, paid);
        return paid ? { done: true, message: "Paid. Collect it at the front desk next time you're in." } : desk("collect it there");
      };
      if (payWith === "desk" && total - using > 0) return wait(finish(false), 300);
      if (total - using === 0) return wait(finish(true), 300);
      return wait({ done: false, message: "", demoPay: { amount: money(total - using), description: "Shop order", confirm: async () => wait(finish(true), 500) } }, 250);
    },
    giftCardShop: () => wait(key === "aizome" ? { enabled: false } : {
      enabled: true,
      designs: key === "tidal" ? [{ id: "d1", name: "Waves", imageUrl: ART.tidalChallenge }, { id: "d2", name: "Pink", imageUrl: ART.tidalSocks }] : [{ id: "d1", name: "Leaves", imageUrl: ART.lindenFriend }, { id: "d2", name: "Holiday", imageUrl: ART.lindenHoliday }],
      amounts: [5000, 10000, 20000].map((c) => ({ cents: c, label: money(c) })),
      howToGive: ["Give it now: enter their email. They need an account with us.", "Give it later: it waits under Gift cards until you send it."],
    }),
    async buyGiftCard(input) {
      const design = input.designId === "d2" ? (key === "tidal" ? ART.tidalSocks : ART.lindenHoliday) : key === "tidal" ? ART.tidalChallenge : ART.lindenFriend;
      if (input.payWith === "desk") { addPurchase(`Gift card (${money(input.amountCents)})`, input.amountCents, false); return wait(desk("the gift card will be ready to give")); }
      const finish = (): Placed => {
        addPurchase(`Gift card (${money(input.amountCents)})`, input.amountCents, true);
        if (input.give) {
          cards.unshift({ id: id("g"), code: `GIFT-${seq}`, amount: money(input.amountCents), status: "given", statusLabel: "Given", design: { name: "Card", imageUrl: design }, from: null, to: input.give.to, message: input.give.message ?? null, daysLeftToGive: null });
          return { done: true, message: `Paid. It's on its way to ${input.give.to}.` };
        }
        cards.unshift({ id: id("g"), code: `GIFT-${seq}`, amount: money(input.amountCents), status: "unsent", statusLabel: "Ready to give", design: { name: "Card", imageUrl: design }, from: null, to: null, message: null, daysLeftToGive: 60 });
        return { done: true, message: "Paid. It's under Gift cards, ready to give." };
      };
      return wait({ done: false, message: "", demoPay: { amount: money(input.amountCents), description: `Gift card (${money(input.amountCents)})`, confirm: async () => wait(finish(), 500) } }, 250);
    },
    myGiftCards: () => wait({ toGive: cards.filter((c) => c.status === "unsent"), received: [], given: cards.filter((c) => c.status === "given"), kept: cards.filter((c) => c.status === "kept"), credit: { balance: money(credit), balanceCents: credit } }),
    async giveGiftCard(gid, to, message) {
      const c = cards.find((x) => x.id === gid)!;
      if (!/@/.test(to)) throw new AppError("bad_email", "Enter their email address.");
      Object.assign(c, { status: "given", statusLabel: "Given", to, message: message ?? null, daysLeftToGive: null });
      await wait(null);
    },
    async keepGiftCard(gid) {
      const c = cards.find((x) => x.id === gid)!;
      Object.assign(c, { status: "kept", statusLabel: "Added to your credit", daysLeftToGive: null });
      credit += Math.round(Number(c.amount.replace(/[^\d.]/g, "")) * 100);
      await wait(null);
    },
    loyalty: () => wait(structuredClone(loyalty)),
    async redeem(rid) {
      const r = loyalty.rewards!.find((x) => x.id === rid)!;
      if ((loyalty.balance ?? 0) < r.cost) throw new AppError("not_enough", `You need ${r.cost - (loyalty.balance ?? 0)} more.`);
      loyalty.balance = (loyalty.balance ?? 0) - r.cost;
      loyalty.balanceText = `${loyalty.balance} ${loyalty.namePlural}`;
      loyalty.redemptions!.unshift({ id: id("rd"), reward: r.name, statusLabel: r.id === "r2" ? "Show the code at the front desk" : "Added to your account", code: r.id === "r2" ? `R-${seq}` : null });
      recalcRewards();
      return wait({ message: r.id === "r2" ? "Redeemed. Show the code at the front desk." : "Redeemed. It's in your account." });
    },
    referral: () => wait(key === "aizome" ? { enabled: false } : {
      enabled: true, code: `${ctx.member.toUpperCase()}${key === "tidal" ? "19" : "47"}`, link: `book.skedoo.io/r/${ctx.member.toLowerCase()}`,
      howItWorks: ["Your friend gets their first class free.", "You get SGD 20 of credit once they've been to 2 classes."],
      friends: key === "linden" ? [{ name: "Hannah W.", statusLabel: "You got your reward" }, { name: "Sam K.", statusLabel: "Joined: not qualified yet" }] : [],
      rewardsEarned: key === "linden" ? 1 : 0,
    }),
    purchases: () => wait([...purchases]),
    paymentCard: () => wait({ card: key === "linden" ? null : { brand: "Visa", last4: "4242", expires: "08/28" }, canSave: true, note: "Your card is kept securely by Stripe for your membership's renewals. The studio never sees the full number." }),
    addCard: () => wait({ message: "In the real app this opens Stripe's secure page to add a card." }),
    notifications: () => wait({ ...notifications }),
    async setNotifications(n) { Object.assign(notifications, n); return wait({ ...notifications }); },
  };
  return methods;
}

export { nice as niceDate };
