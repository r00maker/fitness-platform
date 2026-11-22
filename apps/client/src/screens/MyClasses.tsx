/** Upcoming classes, each cancellable in place (with the studio's late-cancellation check). */
import { useState } from "react";
import { AppError, type MyBooking } from "../data/types";
import { clock, dayLabel, shortDate } from "../lib/format";
import { useStore } from "../store";

export function MyClasses() {
  const { bookings, studio, go, progress } = useStore();
  return (
    <div className="mine">
      <header className="screen-head">
        <h1>My classes</h1>
        {progress && <p>{progress.classes} {progress.classes === 1 ? "class" : "classes"} so far with {studio.name}.</p>}
      </header>
      {bookings.length ? (
        <ul className="booking-list">{bookings.map((b) => <BookingRow key={b.booking.id} b={b} />)}</ul>
      ) : (
        <div className="empty">
          <p>No classes booked.</p>
          <button type="button" className="btn btn-main" onClick={() => go("book")}>Find a class</button>
        </div>
      )}
    </div>
  );
}

function BookingRow({ b }: { b: MyBooking }) {
  const { api, studio, refresh, toast } = useStore();
  const [s, set] = useState<{ at: "idle" | "ask" | "late"; busy?: boolean; message?: string }>({ at: "idle" });
  const tz = studio.timezone;
  async function cancel(ack: string[] = []) {
    set({ ...s, busy: true });
    try {
      const r = await api.cancel(b.booking.id, ack);
      toast(r.classReturned ? `Cancelled: ${b.classType.name}. The class is back in your package.` : `Cancelled: ${b.classType.name}.`);
      await refresh();
    } catch (e) {
      const err = e as AppError;
      if (err.code === "needs_confirmation") set({ at: "late", message: err.flags[0]?.message ?? err.message });
      else set({ at: "ask", message: err.message });
    }
  }
  const open = s.at !== "idle";
  return (
    <li className={`class-row booking${open ? " is-open" : ""}`} style={{ "--type": b.classType.color } as React.CSSProperties}>
      <div className="class-main">
        <div className="class-time">
          <span className="class-day">{dayLabel(b.session.startsAt, tz)}</span>
          <span className="class-clock">{clock(b.session.startsAt, tz)}</span>
        </div>
        <div className="class-what">
          <h3>{b.classType.name}</h3>
          <p>{studio.locations.find((l) => l.id === b.session.locationId)?.name}</p>
          {b.booking.heldForPeriod && <p className="class-spots">Booked ahead into next month's membership</p>}
        </div>
        <div className="class-act">
          <button type="button" className="btn btn-quiet" aria-expanded={open} onClick={() => set(open ? { at: "idle" } : { at: "ask" })}>Cancel</button>
        </div>
      </div>
      <div className="confirm" aria-hidden={!open}>
        <div className="confirm-in">
          {open && (
            <div className="confirm-box" role="group" aria-label={`Cancel ${b.classType.name}`}>
              <p className={`confirm-line${s.at === "late" ? " is-warn" : ""}`}>
                {s.at === "late" ? s.message : s.message ?? `Cancel ${b.classType.name} on ${shortDate(new Date(b.session.startsAt).toLocaleDateString("en-CA", { timeZone: tz }))}?`}
              </p>
              <div className="confirm-btns">
                <button type="button" className="btn btn-danger" disabled={s.busy} onClick={() => void cancel(s.at === "late" ? ["late_cancel"] : [])}>{s.busy ? "Cancelling…" : s.at === "late" ? "Cancel anyway" : "Cancel class"}</button>
                <button type="button" className="btn btn-text" onClick={() => set({ at: "idle" })}>Keep it</button>
              </div>
            </div>
          )}
        </div>
      </div>
    </li>
  );
}
