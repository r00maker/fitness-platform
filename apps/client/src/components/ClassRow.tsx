/**
 * One class in a list, and booking it. Tapping Book opens a short confirmation right in the row
 * (no new screen): what it uses, and whether cancelling later gives the class back. One more
 * tap books it. That single check catches mis-taps without adding steps.
 */
import { useState } from "react";
import { AppError, type ClassItem, type PackageOptions } from "../data/types";
import { clock, dayLabel, hhmm, shortDate } from "../lib/format";
import { useStore } from "../store";

type State =
  | { at: "idle" }
  | { at: "confirm"; options: PackageOptions | null; checks: { code: string; message: string }[]; error?: string; busy?: boolean }
  | { at: "waitlist"; busy?: boolean; error?: string }
  | { at: "done"; bookingId: string | null; waitlisted?: boolean };

/** "11:00pm today", "7:00pm tomorrow", "Wednesday 25 Nov, 7:00am". */
function freeUntil(iso: string, tz: string) {
  const d = dayLabel(iso, tz);
  return d === "Today" || d === "Tomorrow" ? `${clock(iso, tz)} ${d.toLowerCase()}` : `${d}, ${clock(iso, tz)}`;
}

export function ClassRow({ c, booked, showDate = false }: { c: ClassItem; booked: string | null; showDate?: boolean }) {
  const { api, studio, refresh, toast, go } = useStore();
  const [s, set] = useState<State>({ at: "idle" });
  const tz = studio.timezone;
  const t = hhmm(c.time);
  const isBooked = !!booked || (s.at === "done" && !s.waitlisted);
  const full = c.availability === "full" || c.availability === "waitlist";
  const unavailable = c.availability === "not_open_yet" || c.availability === "closed" || (c.availability === "full");

  async function start() {
    if (c.availability === "waitlist") return set({ at: "waitlist" });
    set({ at: "confirm", options: null, checks: [] });
    try {
      set({ at: "confirm", options: await api.packageOptions(c.id), checks: [] });
    } catch (e) {
      set({ at: "confirm", options: null, checks: [], error: (e as Error).message });
    }
  }

  async function confirm(extra: string[] = []) {
    if (s.at !== "confirm") return;
    set({ ...s, busy: true, error: undefined });
    const ack = [...(s.options?.insideLateWindow ? ["no_free_cancel"] : []), ...extra];
    try {
      const r = await api.book(c.id, ack);
      set({ at: "done", bookingId: r.id });
      const when = `${dayLabel(c.startsAt, tz)}, ${clock(c.startsAt, tz)}`;
      toast(`Booked: ${c.name}, ${when}`, s.options?.insideLateWindow ? undefined : { label: "Undo", run: () => void undo(r.id) });
      void refresh();
    } catch (e) {
      const err = e as AppError;
      // The studio wants one more check (for example, over a weekly limit): show it here.
      if (err.code === "needs_confirmation" && err.flags.length) set({ ...s, busy: false, checks: err.flags });
      else set({ ...s, busy: false, error: err.message });
    }
  }

  async function undo(id: string) {
    try {
      await api.cancel(id);
      set({ at: "idle" });
      toast(`Cancelled: ${c.name}. The class is back in your package.`);
      void refresh();
    } catch (e) {
      toast((e as Error).message);
    }
  }

  async function joinWaitlist() {
    set({ at: "waitlist", busy: true });
    try {
      await api.joinWaitlist(c.id);
      set({ at: "done", bookingId: null, waitlisted: true });
      toast(`You're on the waitlist for ${c.name}. We'll tell you if a spot opens.`);
    } catch (e) {
      set({ at: "waitlist", error: (e as Error).message });
    }
  }

  const open = s.at === "confirm" || s.at === "waitlist";
  const opt = s.at === "confirm" && s.options ? s.options.options.find((o) => o.id === s.options!.suggested) : undefined;
  const instructor = c.instructor?.name;

  return (
    <li className={`class-row${open ? " is-open" : ""}${isBooked ? " is-booked" : ""}`} style={{ "--type": c.color } as React.CSSProperties}>
      <div className="class-main">
        <div className="class-time">
          {showDate && <span className="class-day">{dayLabel(c.startsAt, tz)}</span>}
          <span className="class-clock">{t.time}<small>{t.half}</small></span>
          <span className="class-len">{c.durationMinutes} min</span>
        </div>
        <div className="class-what">
          <h3>{c.name}</h3>
          <p>{[instructor, studio.locations.length > 1 ? c.location.name : c.room].filter(Boolean).join(", ")}</p>
          <p className={`class-spots spots-${c.availability}`}>{isBooked ? "You're booked in" : s.at === "done" && s.waitlisted ? "You're on the waitlist" : c.label}</p>
        </div>
        <div className="class-act">
          {isBooked ? (
            <span className="booked-mark" aria-label="Booked"><svg viewBox="0 0 20 20" aria-hidden="true"><path d="M5 10.5l3.2 3L15 6.5" /></svg>Booked</span>
          ) : s.at === "done" && s.waitlisted ? (
            <span className="booked-mark is-wait">Waitlisted</span>
          ) : unavailable ? null : (
            <button type="button" className={`btn ${full ? "btn-quiet" : "btn-main"}`} aria-expanded={open} onClick={() => (open ? set({ at: "idle" }) : void start())}>
              {full ? "Waitlist" : "Book"}
            </button>
          )}
        </div>
      </div>

      <div className="confirm" aria-hidden={!open}>
        <div className="confirm-in">
          {s.at === "confirm" && (
            <div className="confirm-box" role="group" aria-label={`Confirm ${c.name}`}>
              {!s.options && !s.error && <p className="confirm-line is-loading">Checking your packages…</p>}
              {s.options?.message && (
                <>
                  <p className="confirm-line">{s.options.message}</p>
                  <div className="confirm-btns">
                    <button type="button" className="btn btn-main" onClick={() => go("me", "packages")}>See my packages</button>
                    <button type="button" className="btn btn-text" onClick={() => set({ at: "idle" })}>Not now</button>
                  </div>
                </>
              )}
              {opt && (
                <>
                  <p className="confirm-line">
                    {opt.bookedAhead
                      ? <>Booked ahead into your {opt.name} for the month starting {shortDate(opt.bookedAhead.periodStarts)}{opt.kind === "credits" ? ", taken from that month's classes when it renews" : ""}.</>
                      : opt.kind === "credits"
                        ? <>Uses 1 class from your {opt.name}. <strong>{(opt.yourCreditsLeft ?? opt.creditsLeft ?? 1) - 1} left</strong> after this.</>
                        : <>Uses your {opt.name}.</>}
                  </p>
                  <p className={`confirm-note${s.options!.insideLateWindow ? " is-warn" : ""}`}>
                    {s.options!.insideLateWindow ? "It starts soon, so cancelling won't give the class back." : `Free to cancel until ${freeUntil(s.options!.freeCancelUntil, tz)}.`}
                  </p>
                  {s.checks.map((f) => <p key={f.code} className="confirm-note is-warn">{f.message}</p>)}
                  <div className="confirm-btns">
                    <button type="button" className="btn btn-main" disabled={s.busy} onClick={() => void confirm(s.checks.map((f) => f.code))}>
                      {s.busy ? "Booking…" : s.checks.length ? "Book anyway" : "Confirm booking"}
                    </button>
                    <button type="button" className="btn btn-text" onClick={() => set({ at: "idle" })}>Not now</button>
                  </div>
                </>
              )}
              {s.error && (
                <>
                  <p className="confirm-line is-error" role="alert">{s.error}</p>
                  <button type="button" className="btn btn-text" onClick={() => set({ at: "idle" })}>Close</button>
                </>
              )}
            </div>
          )}
          {s.at === "waitlist" && (
            <div className="confirm-box" role="group" aria-label={`Join the waitlist for ${c.name}`}>
              <p className="confirm-line">It's full. Join the waitlist and we'll tell you the moment a spot opens.</p>
              {s.error && <p className="confirm-line is-error" role="alert">{s.error}</p>}
              <div className="confirm-btns">
                <button type="button" className="btn btn-main" disabled={s.busy} onClick={() => void joinWaitlist()}>{s.busy ? "Joining…" : "Join the waitlist"}</button>
                <button type="button" className="btn btn-text" onClick={() => set({ at: "idle" })}>Not now</button>
              </div>
            </div>
          )}
        </div>
      </div>
    </li>
  );
}
