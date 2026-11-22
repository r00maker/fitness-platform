/**
 * Booking a class, used in timetable rows and on the class's own screen. Book opens one short
 * check (what it uses, until when cancelling is free); Confirm books it. If the studio needs its
 * waiver signed first, it's signed right there and the class is booked in the same step.
 */
import { useState } from "react";
import { AppError, type ClassItem, type PackageOptions } from "../data/types";
import { clock, dayLabel, shortDate } from "../lib/format";
import { useStore } from "../store";

export type BookState =
  | { at: "idle" }
  | { at: "confirm"; options: PackageOptions | null; checks: { code: string; message: string }[]; waiver?: string; error?: string; busy?: boolean }
  | { at: "waitlist"; busy?: boolean; error?: string }
  | { at: "done"; bookingId: string | null; waitlisted?: boolean };

/** "11:00pm today", "7:00pm tomorrow", "Wednesday 25 Nov, 7:00am". */
function freeUntil(iso: string, tz: string) {
  const d = dayLabel(iso, tz);
  return d === "Today" || d === "Tomorrow" ? `${clock(iso, tz)} ${d.toLowerCase()}` : `${d}, ${clock(iso, tz)}`;
}

export function useBook(c: ClassItem) {
  const { api, studio, refresh, toast } = useStore();
  const [s, set] = useState<BookState>({ at: "idle" });
  const tz = studio.timezone;

  async function start() {
    if (c.availability === "waitlist") return set({ at: "waitlist" });
    set({ at: "confirm", options: null, checks: [] });
    try {
      set({ at: "confirm", options: await api.packageOptions(c.id), checks: [] });
    } catch (e) {
      set({ at: "confirm", options: null, checks: [], error: (e as Error).message });
    }
  }

  async function confirm(extra: string[] = [], signedName?: string) {
    if (s.at !== "confirm") return;
    set({ ...s, busy: true, error: undefined });
    const ack = [...(s.options?.insideLateWindow ? ["no_free_cancel"] : []), ...extra];
    try {
      const r = await api.book(c.id, ack, signedName ? { signedName } : undefined);
      set({ at: "done", bookingId: r.id });
      toast(`Booked: ${c.name}, ${dayLabel(c.startsAt, tz)}, ${clock(c.startsAt, tz)}`, s.options?.insideLateWindow ? undefined : { label: "Undo", run: () => void undo(r.id) });
      void refresh();
    } catch (e) {
      const err = e as AppError;
      if (err.code === "needs_confirmation" && err.flags.length) set({ ...s, busy: false, checks: err.flags });
      else if (err.code === "waiver_required") set({ ...s, busy: false, waiver: ((err.details.waiver as { text?: string } | undefined)?.text) ?? err.message });
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
  return { s, set, start, confirm, joinWaitlist, tz };
}

export function ConfirmBox({ c, b }: { c: ClassItem; b: ReturnType<typeof useBook> }) {
  const { go } = useStore();
  const { s, set, confirm, joinWaitlist, tz } = b;
  const [name, setName] = useState("");
  const [agree, setAgree] = useState(false);
  const opt = s.at === "confirm" && s.options ? s.options.options.find((o) => o.id === s.options!.suggested) : undefined;

  if (s.at === "waitlist") {
    return (
      <div className="confirm-box" role="group" aria-label={`Join the waitlist for ${c.name}`}>
        <p className="confirm-line">It's full. Join the waitlist and we'll tell you the moment a spot opens.</p>
        {s.error && <p className="confirm-line is-error" role="alert">{s.error}</p>}
        <div className="confirm-btns">
          <button type="button" className="btn btn-main" disabled={s.busy} onClick={() => void joinWaitlist()}>{s.busy ? "Joining…" : "Join the waitlist"}</button>
          <button type="button" className="btn btn-text" onClick={() => set({ at: "idle" })}>Not now</button>
        </div>
      </div>
    );
  }
  if (s.at !== "confirm") return null;
  return (
    <div className="confirm-box" role="group" aria-label={`Confirm ${c.name}`}>
      {!s.options && !s.error && <p className="confirm-line is-loading">Checking your packages…</p>}
      {s.options?.message && (
        <>
          <p className="confirm-line">{s.options.message}</p>
          <div className="confirm-btns">
            <button type="button" className="btn btn-main" onClick={() => go("me/buy")}>Buy a package</button>
            <button type="button" className="btn btn-text" onClick={() => set({ at: "idle" })}>Not now</button>
          </div>
        </>
      )}
      {opt && !s.waiver && (
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
      {s.waiver && (
        <form className="waiver-inline" onSubmit={(e) => { e.preventDefault(); void confirm(s.checks.map((f) => f.code), name.trim()); }}>
          <p className="confirm-line">Before your first class, please read and sign the studio's waiver. You only do this once.</p>
          <div className="waiver-text" tabIndex={0}>{s.waiver}</div>
          <label className="check"><input type="checkbox" checked={agree} onChange={(e) => setAgree(e.target.checked)} required /> I've read it and agree</label>
          <label className="field"><span>Your full name</span><input value={name} onChange={(e) => setName(e.target.value)} autoComplete="name" required minLength={2} /></label>
          <div className="confirm-btns">
            <button className="btn btn-main" disabled={s.busy || !agree || name.trim().length < 2}>{s.busy ? "Booking…" : "Sign and book"}</button>
            <button type="button" className="btn btn-text" onClick={() => set({ at: "idle" })}>Not now</button>
          </div>
        </form>
      )}
      {s.error && (
        <>
          <p className="confirm-line is-error" role="alert">{s.error}</p>
          <button type="button" className="btn btn-text" onClick={() => set({ at: "idle" })}>Close</button>
        </>
      )}
    </div>
  );
}
