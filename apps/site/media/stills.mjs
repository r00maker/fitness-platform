// The screens the films are cut from: 2x captures of the real product (the previews, sample data,
// shown as Linden Reformer Studio), each with the boxes of the details the films zoom into or label.
// node media/stills.mjs [name...]   -> media/stills/<name>.png + <name>.json
import { record } from "./rec.mjs";

const APP = "preview/studio-calendar-preview.html";
const HQ = "preview/hq-preview.html";
const NO_WAIVERS = [
  { sel: "li.attrow", text: "waiver" },
  { sel: ".todo, .htodo", text: "waiver" },
  { sel: ".upfacts span, .upfacts b, .upfacts em", text: "waiver" },
  { sel: ".cirow .tag, .cirow em, .cirow small", text: "waiver" },
];
const desk = { viewport: { width: 1440, height: 900 }, hide: NO_WAIVERS, still: true };
const phone = { phone: true, hide: NO_WAIVERS, still: true };
const click = (s, sel) => s.page.locator(sel).first().click({ timeout: 4000 }).then(() => s.wait(450));
const moveClassToSoon = '{ const s = SESSIONS.find((x) => x.instr === ME.instructor && sameDay(x.start, NOW) && x.start > NOW); const d = s.end - s.start; s.start = addMin(NOW, 30); s.end = new Date(s.start.getTime() + d); render(); }';

export const STILLS = [
  { name: "home", file: APP, ...desk,
    boxes: { att: "li.attrow:has-text('2 classes need cover')", attHead: "text=Needs attention", today: "text=people booked into 5 classes", classes: "text=Today’s classes" } },
  { name: "cover", file: APP, ...desk, setup: (s) => s.nav("cover"),
    boxes: { approve: "button:has-text('Approve Ben')", ben: "text=Ben Tan · can cover", card: "text=NEEDS YOUR APPROVAL" } },
  { name: "covered", file: APP, ...desk, setup: async (s) => { await s.nav("cover"); await click(s, "button:has-text('Approve Ben')"); },
    boxes: { covered: "text=Covered by >> nth=0", toast: ".toast" } },
  { name: "schedule", file: APP, ...desk, setup: (s) => s.nav("schedule"),
    boxes: { week: "text=9 – 15 Nov 2026", sat: "text=SAT", yoga: "text=Vinyasa Yoga >> nth=1" } },
  { name: "checkin", file: APP, ...phone,
    setup: async (s) => {
      await s.role("instructor"); await s.ev(moveClassToSoon); await s.wait(300);
      await click(s, ".upgo");
      const names = await s.ev('SESSIONS.find((x) => x.id === state.ci.open).roster.map((r) => CLIENTS[r.ci]).filter((c) => !waiverMissing(c)).map((c) => c.name).slice(0, 3)');
      for (const n of names) await click(s, `.cirow:has-text("${n}") [data-ci$=":present"]`);
    },
    boxes: { head: ".cihead", injury: "text=Injury · Shoulder", done: ".cirow.present >> nth=0", rows: ".cirow >> nth=0" } },
  { name: "upnext", file: APP, ...phone,
    setup: async (s) => { await s.role("instructor"); await s.ev(moveClassToSoon); await s.wait(300); },
    boxes: { up: ".upfirst", go: ".upgo" } },
  { name: "whatsapp", file: APP, ...desk,
    setup: async (s) => {
      await s.nav("comms"); await click(s, "[data-conv=c2]");
      await s.page.locator("#ibxText").fill("Hi Wei Jie! Yes, Reformer at 7am every weekday. A 10-class pack is SGD 280 and lasts 3 months. Shall I book you in for tomorrow?");
      await click(s, "#ibxSend");
    },
    boxes: { channels: "[data-ibxch=all]", inbox: "text=Every message from clients in one place", reply: "text=Hi Wei Jie! Yes >> nth=-1", question: "text=And do you have morning classes", list: ".ibx-row[data-conv=c2]", window: "text=Free to reply until" } },
  { name: "pay", file: APP, ...desk,
    setup: async (s) => { await s.nav("staff"); await click(s, "[data-hubtab=payroll]"); await click(s, "[data-payopen=ana]"); },
    boxes: { total: "text=SGD 4,809.00", ana: "[data-payopen=ana]", paid: "button:has-text('Mark as paid')", rows: "text=7am Reformer - Intermediate >> nth=0", rule: "text=SGD 25.00 per class >> nth=0", sofar: "text=So far: classes count once" } },
  { name: "paid", file: APP, ...desk,
    setup: async (s) => {
      await s.nav("staff"); await click(s, "[data-hubtab=payroll]");
      await click(s, "button:has-text('Mark as paid')");
      await click(s, ".modal button:has-text('Mark as paid'), [role=dialog] button:has-text('Mark as paid')");
    },
    boxes: { total: "text=SGD 4,809.00", badge: "text=/paid wed/i", toast: ".toast" } },
  { name: "closure", file: APP, ...desk, hash: "closures",
    setup: async (s) => {
      await click(s, "#clNew");
      await s.page.locator("#clN").fill("Team retreat");
      await s.page.locator("#clS").fill("2026-11-21"); await s.page.locator("#clE").fill("2026-11-22");
      await s.page.locator("#clM").fill("Back on Monday, refreshed!");
      await s.wait(400);
    },
    boxes: { what: "text=What will happen", list: "text=Reformer - Intermediate, Sat 21 Nov", add: ".modal button:has-text('Add closure'), [role=dialog] button:has-text('Add closure')", name: "#clN" } },
  { name: "share", file: APP, ...desk,
    hide: [...NO_WAIVERS, { sel: ".holdbox" }, { sel: "article.pkgcard", text: "on hold" }, { sel: "main .btn", text: "Update card and pay" }],
    setup: async (s) => {
      await s.role("client"); await s.nav("my-packages");
      await click(s, '[data-pk="share:19"]');
      await s.page.locator("#shEmail").fill("mei.ling.goh@example.com");
      await click(s, ".modal .btn:has-text('Share'), [role=dialog] .btn:has-text('Share')");
    },
    boxes: { family: "article.pkgcard:has-text('Family 30-pack')", mei: "text=Mei Ling Goh", couples: "article.pkgcard:has-text('Couples 20-pack')" } },
  { name: "newclass", file: APP, ...desk,
    setup: async (s) => { await s.nav("schedule"); await click(s, "button:has-text('+ New class')"); },
    boxes: { waitlist: "text=Allow waitlist", autocancel: "text=Cancel automatically if not enough people book", rule: "text=are booked >> nth=0", classpass: "text=Take ClassPass bookings" } },
  { name: "warning", file: APP, ...desk,
    setup: async (s) => {
      await s.nav("schedule"); await click(s, "button:has-text('+ New class')");
      await s.page.selectOption("#fType", { label: "Vinyasa Yoga" });
      await s.page.locator("#fDate").fill("2026-11-13");
      await s.page.selectOption("#fStartH", { label: "7am" });
      await s.page.selectOption("#fIns", { label: "Ana Lim" });
      await s.page.selectOption("#fRoom", { label: "Studio 2 (holds 20)" });
      await click(s, "#fSubmit");
    },
    boxes: { title: "text=Please check", double: "text=Instructor double-booked", why: "text=Ana Lim is also teaching", back: "#mBack" } },
  { name: "journey", file: APP, ...desk,
    setup: async (s) => { await s.nav("automations"); await click(s, '[data-auopen="journey:j1"]'); },
    boxes: { start: "text=When a client creates an account", wait: "text=Buys a package within 3 days", email: "text=Welcome to the studio >> nth=0", offer: "text=Your intro offer is waiting >> nth=0", stats: "text=86 started" } },
  { name: "locations", file: APP, ...desk,
    setup: async (s) => { await s.nav("reports"); await click(s, "[data-rtab=locations]"); },
    boxes: { headline: "text=Tanjong Pagar is the fullest", table: "text=Locations side by side", full: "text=How full", tp: "text=67.4% >> nth=1" } },
  { name: "ask", file: APP, ...desk,
    setup: async (s) => {
      await click(s, "#askBtn");
      await s.page.locator("#askIn").fill("How do I change lots of classes at once?");
      await s.page.keyboard.press("Enter"); await s.wait(2600);
    },
    boxes: { q: "text=How do I change lots of classes at once? >> nth=-1", a: "text=Use Edit many", panel: "text=Assistant" } },
  { name: "move", file: HQ, ...desk, hash: "move-core-flow",
    setup: async (s) => {
      await s.page.selectOption("#dateOrder", "dmy");
      await click(s, "#runCheck"); await s.wait(600);
      await s.page.locator("text=Every row accounted for").first().scrollIntoViewIfNeeded();
    },
    boxes: { every: "text=Every row accounted for", against: "text=Against the form", problems: "text=Problems, grouped", bar: "text=135 created" } },
  { name: "book", file: APP, ...phone,
    setup: async (s) => { await s.role("client"); await s.nav("schedule"); },
    boxes: { strip: "text=Today >> nth=0", first: "text=Reformer - Intermediate >> nth=0" } },
];

const want = process.argv.slice(2);
for (const st of STILLS.filter((x) => !want.length || want.includes(x.name))) {
  try { await record({ ...st, run: async () => {} }); } catch (e) { console.error(`${st.name}: FAILED ${e.message.split("\n")[0]}`); }
}
