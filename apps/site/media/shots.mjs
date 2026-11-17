// The website's workflow videos, each recorded from the real product (the clickable previews,
// with their sample data). The sample studio is called Linden Reformer Studio on film.
// node media/shots.mjs              records all of them into media/out/
// node media/shots.mjs todo ask     records only those
import { record } from "./rec.mjs";

const APP = "preview/studio-calendar-preview.html";
const HQ = "preview/hq-preview.html";
// Waivers aren't a selling point: keep their reminders out of shot.
const NO_WAIVERS = [
  { sel: "li.attrow", text: "waiver" },
  { sel: ".todo, .htodo", text: "waiver" },
  { sel: ".upfacts span, .upfacts b, .upfacts em", text: "waiver" },
  { sel: ".cirow .tag, .cirow em, .cirow small", text: "waiver" },
];
const desk = { viewport: { width: 1440, height: 900 } };

export const SHOTS = [
  {
    // Hero: the week on the schedule, and a class added in a few clicks.
    name: "schedule", file: APP, ...desk, hide: NO_WAIVERS, zoom: 1.03,
    setup: async (s) => { await s.nav("schedule"); },
    run: async (s) => {
      await s.moveTo("text=Sat", { ms: 900 }); await s.wait(400);
      await s.click("button:has-text('+ New class')"); await s.wait(500);
      await s.select("#fType", "Barre");
      await s.fill("#fDate", "2026-11-14");
      await s.select("#fStartH", "12pm");
      await s.select("#fIns", "Ana Lim");
      await s.click("#fSubmit"); await s.wait(600);
      await s.ifVisible("#mProceed", () => s.click("#mProceed"));
      await s.wait(500);
      await s.moveTo("text=SAT", { ms: 900, dy: 120 }).catch(() => {});
      await s.wait(1400);
    },
  },
  {
    // 7:00am: Home's to-do list, then one of its jobs done.
    name: "todo", file: APP, ...desk, hide: NO_WAIVERS, zoom: 1.04,
    run: async (s) => {
      await s.moveTo("text=Needs attention", { ms: 700 }); await s.wait(300);
      await s.moveTo("text=2 classes need cover", { ms: 600 }); await s.wait(400);
      await s.click("button:has-text('Open cover requests')"); await s.wait(800);
      await s.moveTo("text=Ben Tan · can cover", { ms: 700 }); await s.wait(300);
      await s.click("button:has-text('Approve Ben')"); await s.wait(1500);
    },
  },
  {
    // 12:20pm: the instructor checks the class in from their phone.
    name: "checkin", file: APP, phone: true, out: 640, hide: NO_WAIVERS,
    setup: async (s) => {
      await s.role("instructor");
      await s.ev('{ const s = SESSIONS.find((x) => x.instr === ME.instructor && sameDay(x.start, NOW) && x.start > NOW); const d = s.end - s.start; s.start = addMin(NOW, 30); s.end = new Date(s.start.getTime() + d); render(); }');
      await s.wait(300);
    },
    run: async (s) => {
      await s.moveTo(".upgo", { ms: 700 }); await s.wait(300);
      await s.click(".upgo"); await s.wait(800);
      // Check in people who are all set (skipping anyone the door would stop).
      const ok = await s.ev('SESSIONS.find((x) => x.id === state.ci.open).roster.map((r) => CLIENTS[r.ci]).filter((c) => !waiverMissing(c)).map((c) => c.name).slice(0, 4)');
      for (const n of ok) { await s.click(`.cirow:has-text("${n}") [data-ci$=":present"]`, { ms: 450 }); await s.wait(250); }
      await s.wait(700);
      await s.click("#ciClose"); await s.wait(1100);
    },
  },
  {
    // 6:02pm: a WhatsApp question answered from the shared inbox.
    name: "whatsapp", file: APP, viewport: { width: 1440, height: 1000 }, crop: { x: 244, y: 252, w: 1192, h: 745 },
    setup: async (s) => { await s.nav("comms"); },
    run: async (s) => {
      await s.click("[data-conv=c2]", { ms: 700 }); await s.wait(700);
      await s.type("#ibxText", "Hi Wei Jie! Yes, Reformer at 7am every weekday. A 10-class pack is SGD 280 and lasts 3 months. Shall I book you in for tomorrow?", 18);
      await s.wait(300);
      await s.click("#ibxSend"); await s.wait(1600);
    },
  },
  {
    // 11:59pm: pay, worked out from attendance, and marked paid.
    name: "pay", file: APP, ...desk, zoom: 1.03,
    setup: async (s) => { await s.nav("staff"); },
    run: async (s) => {
      await s.click("[data-hubtab=payroll]", { ms: 700 }); await s.wait(800);
      await s.moveTo("text=SGD 4,809.00", { ms: 700 }); await s.wait(500);
      await s.click("[data-payopen=ana]", { ms: 700 }); await s.wait(1400);
      await s.page.keyboard.press("Escape"); await s.wait(500);
      await s.click("button:has-text('Mark as paid')", { ms: 800 }); await s.wait(600);
      await s.ifVisible(".modal button:has-text('Mark as paid'), [role=dialog] button:has-text('Mark as paid')", () => s.click(".modal button:has-text('Mark as paid'), [role=dialog] button:has-text('Mark as paid')"));
      await s.wait(1400);
    },
  },
  {
    // Closing for a few days: the classes on them, cancelled and everyone told.
    name: "closure", file: APP, ...desk, hash: "closures", zoom: 1.03,
    run: async (s) => {
      await s.click("#clNew", { ms: 700 }); await s.wait(500);
      await s.type("#clN", "Team retreat", 45);
      await s.fill("#clS", "2026-11-21");
      await s.fill("#clE", "2026-11-22");
      await s.type("#clM", "Back on Monday, refreshed!", 40);
      await s.moveTo("text=What will happen", { ms: 700 }); await s.wait(1100);
      await s.click(".modal button:has-text('Add closure'), [role=dialog] button:has-text('Add closure')"); await s.wait(700);
      await s.ifVisible("button:has-text('Cancel 5 classes and close')", () => s.click("button:has-text('Cancel 5 classes and close')"));
      await s.wait(1600);
    },
  },
  {
    // A couple's or family's pack, shared from the client's own app.
    name: "share", file: APP, ...desk, crop: { x: 250, y: 100, w: 1180, h: 738 },
    hide: [{ sel: ".holdbox" }, { sel: "article.pkgcard", text: "on hold" }, { sel: "main .btn", text: "Update card and pay" }],
    setup: async (s) => {
      await s.role("client"); await s.nav("my-packages");

    },
    run: async (s) => {
      await s.moveTo("text=Family 30-pack", { ms: 800 }); await s.wait(500);
      await s.click('[data-pk="share:19"]', { ms: 600 }); await s.wait(600);
      await s.clear("#shEmail");
      await s.type("#shEmail", "mei.ling.goh@example.com", 34);
      await s.click(".modal .btn:has-text('Share'), [role=dialog] .btn:has-text('Share')"); await s.wait(1700);
    },
  },
  {
    // Plain-English warnings: a clash is caught, explained and fixed.
    name: "warning", file: APP, ...desk, zoom: 1.03,
    setup: async (s) => { await s.nav("schedule"); },
    run: async (s) => {
      await s.click("button:has-text('+ New class')", { ms: 700 }); await s.wait(500);
      await s.select("#fType", "Vinyasa Yoga");
      await s.fill("#fDate", "2026-11-13");
      await s.select("#fStartH", "7am");
      await s.select("#fIns", "Ana Lim");
      await s.select("#fRoom", "Studio 2 (holds 20)");
      await s.click("#fSubmit"); await s.wait(700);
      await s.moveTo("text=Instructor double-booked", { ms: 600 }); await s.wait(1100);
      await s.click("#mBack"); await s.wait(500);
      await s.select("#fIns", "Ben Tan");
      await s.click("#fSubmit"); await s.wait(600);
      await s.ifVisible("#mProceed", () => s.click("#mProceed"));
      await s.wait(1300);
    },
  },
  {
    // Journeys: the intro-offer follow-up, step by step.
    name: "journey", file: APP, ...desk,
    setup: async (s) => { await s.nav("automations"); },
    run: async (s) => {
      await s.moveTo('[data-auopen="journey:j1"]', { ms: 700 }); await s.wait(300);
      await s.click('[data-auopen="journey:j1"]'); await s.wait(900);
      await s.moveTo("text=Welcome to the studio", { ms: 700 }); await s.wait(500);
      await s.scroll(380, 1300); await s.wait(300);
      await s.moveTo("text=Your intro offer is waiting", { ms: 700 }); await s.wait(1000);
    },
  },
  {
    // Every location side by side.
    name: "locations", file: APP, ...desk, zoom: 1.03,
    setup: async (s) => { await s.nav("reports"); },
    run: async (s) => {
      await s.click("[data-rtab=locations]", { ms: 800 }); await s.wait(900);
      await s.moveTo("text=How full", { ms: 700 }); await s.wait(500);
      await s.click('[data-rdays="90"]', { ms: 700 }); await s.wait(1100);
      await s.click('[data-rdays="7"]', { ms: 500 }); await s.wait(1300);
    },
  },
  {
    // Ask: a question in plain words, answered.
    name: "ask", file: APP, ...desk, hide: NO_WAIVERS, zoom: 1.35, zoomAt: { x: 0.95, y: 0.95 },
    run: async (s) => {
      await s.click("#askBtn", { ms: 800 }); await s.wait(600);
      await s.type("#askIn", "How do I change lots of classes at once?", 40);
      await s.page.keyboard.press("Enter"); await s.wait(2600);
    },
  },
  {
    // HQ: the check before a move: every row accounted for, then the import.
    name: "move", file: HQ, ...desk, hash: "move-core-flow", zoom: 1.03,
    setup: async (s) => {
      await s.page.selectOption("#dateOrder", "dmy");
      await s.page.locator("#runCheck").scrollIntoViewIfNeeded();
      await s.wait(300);
    },
    run: async (s) => {
      await s.click("#runCheck", { ms: 800 }); await s.wait(1200);
      await s.moveTo("text=Every row accounted for", { ms: 800 }).catch(() => {}); await s.wait(900);
      await s.moveTo("text=Phone damaged by Excel", { ms: 700 }).catch(() => {}); await s.wait(700);
      await s.click("#import"); await s.wait(900);
      await s.click("#importYes"); await s.wait(1600);
    },
  },
];

const want = process.argv.slice(2);
for (const shot of SHOTS.filter((s) => !want.length || want.includes(s.name))) {
  try { await record(shot); } catch (e) { console.error(`${shot.name}: FAILED ${e.message.split("\n")[0]}`); }
}
