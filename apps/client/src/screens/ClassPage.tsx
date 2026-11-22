/**
 * One class: when, where, with whom, what it's like, spots left, and Book or Cancel. Opened from
 * the timetable, Home or My classes; Back returns there.
 */
import { useEffect, useState } from "react";
import { ConfirmBox, useBook } from "../components/BookFlow";
import { SubHead } from "../components/ui";
import { AppError, type ClassItem, type MyBooking } from "../data/types";
import { clock, dayLabel, isoToday } from "../lib/format";
import { useStore } from "../store";

export function ClassPage({ id }: { id: string }) {
  const { api, studio, bookings } = useStore();
  const [c, setC] = useState<ClassItem | null | undefined>(undefined);
  const booking = bookings.find((b) => b.session.id === id);
  useEffect(() => {
    void api.schedule(isoToday(studio.timezone), 14).then((days) => {
      const found = days.flatMap((d) => d.classes).find((x) => x.id === id);
      setC(found ?? null);
    });
  }, [api, id, studio.timezone]);

  // Booked further ahead than the timetable shows: what the booking itself knows.
  const shown: ClassItem | null = c ?? (booking ? fromBooking(booking, studio.locations) : null);
  if (c === undefined && !booking) return <div><SubHead title="Class" /><p className="loading">Loading…</p></div>;
  if (!shown) return <div><SubHead title="Class" /><p className="empty">This class isn't on the timetable any more.</p></div>;
  return <ClassView c={shown} booking={booking ?? null} />;
}

function fromBooking(b: MyBooking, locations: { id: string; name: string }[]): ClassItem {
  return {
    id: b.session.id, name: b.classType.name, color: b.classType.color, startsAt: b.session.startsAt, endsAt: b.session.endsAt, localDate: b.session.startsAt.slice(0, 10), time: "", endTime: "",
    durationMinutes: Math.round((Date.parse(b.session.endsAt) - Date.parse(b.session.startsAt)) / 60_000),
    location: { id: b.session.locationId, name: locations.find((l) => l.id === b.session.locationId)?.name ?? "" }, room: null, instructor: null, spotsLeft: 0, availability: "open", label: "",
  };
}

function ClassView({ c, booking }: { c: ClassItem; booking: MyBooking | null }) {
  const { studio, me } = useStore();
  const tz = studio.timezone;
  const b = useBook(c);
  const type = studio.classTypes.find((t) => t.name === c.name);
  const loc = studio.locations.find((l) => l.id === c.location.id);
  const fav = !!me.favouriteInstructor && c.instructor?.id === me.favouriteInstructor.id;
  const booked = !!booking || (b.s.at === "done" && !b.s.waitlisted);
  const open = b.s.at === "confirm" || b.s.at === "waitlist";
  const past = Date.parse(c.startsAt) <= Date.now();

  return (
    <div className="class-page" style={{ "--type": c.color } as React.CSSProperties}>
      <SubHead title={c.name} sub={`${dayLabel(c.startsAt, tz)}, ${clock(c.startsAt, tz)} to ${clock(c.endsAt, tz)}`} />
      <dl className="facts">
        {c.instructor?.name && <div><dt>Instructor</dt><dd>{c.instructor.name}{fav && <span className="fav-note"> ★ your favourite</span>}</dd></div>}
        <div><dt>Where</dt><dd>{[c.location.name, c.room].filter(Boolean).join(", ")}{loc?.address ? <small>{loc.address}</small> : null}</dd></div>
        <div><dt>Length</dt><dd>{c.durationMinutes} minutes</dd></div>
        {!booked && c.label && <div><dt>Spots</dt><dd>{c.label}</dd></div>}
      </dl>
      {type?.description && <p className="class-desc">{type.description}</p>}

      <div className="class-cta">
        {booked ? (
          <BookedPanel bookingId={booking?.booking.id ?? (b.s.at === "done" ? b.s.bookingId : null)} name={c.name} startsAt={c.startsAt} heldAhead={!!booking?.booking.heldForPeriod} />
        ) : b.s.at === "done" && b.s.waitlisted ? (
          <p className="booked-mark is-wait">You're on the waitlist</p>
        ) : past || c.availability === "full" || c.availability === "closed" || c.availability === "not_open_yet" ? (
          <p className="muted">{past ? "This class has started." : c.label}</p>
        ) : open ? (
          <ConfirmBox c={c} b={b} />
        ) : (
          <button type="button" className="btn btn-main btn-wide" onClick={() => void b.start()}>{c.availability === "waitlist" ? "Join the waitlist" : "Book this class"}</button>
        )}
      </div>
    </div>
  );
}

/** Booked: say so, with Cancel (and the studio's late-cancellation check when it applies). */
export function BookedPanel({ bookingId, name, startsAt, heldAhead }: { bookingId: string | null; name: string; startsAt: string; heldAhead: boolean }) {
  const { api, refresh, toast, back, studio } = useStore();
  const [s, set] = useState<{ at: "idle" | "ask" | "late"; busy?: boolean; message?: string }>({ at: "idle" });
  async function cancel(ack: string[] = []) {
    if (!bookingId) return;
    set({ ...s, busy: true });
    try {
      const r = await api.cancel(bookingId, ack);
      toast(r.classReturned ? `Cancelled: ${name}. The class is back in your package.` : `Cancelled: ${name}.`);
      await refresh();
      back();
    } catch (e) {
      const err = e as AppError;
      if (err.code === "needs_confirmation") set({ at: "late", message: err.flags[0]?.message ?? err.message });
      else set({ at: "ask", message: err.message });
    }
  }
  return (
    <div className="booked-panel">
      <p className="booked-mark"><svg viewBox="0 0 20 20" aria-hidden="true"><path d="M5 10.5l3.2 3L15 6.5" /></svg>You're booked in</p>
      {heldAhead && <p className="muted">Booked ahead into next month's membership.</p>}
      {s.at === "idle" ? (
        <button type="button" className="btn btn-quiet" onClick={() => set({ at: "ask" })} disabled={!bookingId}>Cancel booking</button>
      ) : (
        <div className="confirm-box" role="group" aria-label={`Cancel ${name}`}>
          <p className={`confirm-line${s.at === "late" ? " is-warn" : ""}`}>{s.message ?? `Cancel ${name}, ${dayLabel(startsAt, studio.timezone).toLowerCase() === "today" ? "today" : dayLabel(startsAt, studio.timezone)} at ${clock(startsAt, studio.timezone)}?`}</p>
          <div className="confirm-btns">
            <button type="button" className="btn btn-danger" disabled={s.busy} onClick={() => void cancel(s.at === "late" ? ["late_cancel"] : [])}>{s.busy ? "Cancelling…" : s.at === "late" ? "Cancel anyway" : "Cancel class"}</button>
            <button type="button" className="btn btn-text" onClick={() => set({ at: "idle" })}>Keep it</button>
          </div>
        </div>
      )}
    </div>
  );
}
