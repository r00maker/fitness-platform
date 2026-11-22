/**
 * One class in a list. Tapping the class opens its own screen; Book opens the short check right
 * in the row (no new screen), and one more tap books it.
 */
import type { ClassItem } from "../data/types";
import { dayLabel, hhmm } from "../lib/format";
import { useStore } from "../store";
import { ConfirmBox, useBook } from "./BookFlow";

export function ClassRow({ c, booked, showDate = false, from = "book" }: { c: ClassItem; booked: string | null; showDate?: boolean; from?: string }) {
  const { studio, me, go } = useStore();
  const b = useBook(c);
  const { s, set, start } = b;
  const t = hhmm(c.time);
  const isBooked = !!booked || (s.at === "done" && !s.waitlisted);
  const full = c.availability === "full" || c.availability === "waitlist";
  const unavailable = c.availability === "not_open_yet" || c.availability === "closed" || c.availability === "full";
  const open = s.at === "confirm" || s.at === "waitlist";
  const fav = !!me.favouriteInstructor && !!c.instructor?.id && c.instructor.id === me.favouriteInstructor.id;

  return (
    <li className={`class-row${open ? " is-open" : ""}${isBooked ? " is-booked" : ""}`} style={{ "--type": c.color } as React.CSSProperties}>
      <div className="class-main">
        <button type="button" className="class-open" onClick={() => go(`${from}/class/${c.id}`)} aria-label={`${c.name}, ${dayLabel(c.startsAt, studio.timezone)} ${t.time}${t.half}. Details`}>
          <span className="class-time">
            {showDate && <span className="class-day">{dayLabel(c.startsAt, studio.timezone)}</span>}
            <span className="class-clock">{t.time}<small>{t.half}</small></span>
            <span className="class-len">{c.durationMinutes} min</span>
          </span>
          <span className="class-what">
            <span className="class-name">{c.name}</span>
            <span className="class-sub">
              {c.instructor?.name}{fav && <span className="fav" title="Your favourite instructor" aria-label="your favourite instructor"> ★</span>}
              {(studio.locations.length > 1 ? c.location.name : c.room) ? `, ${studio.locations.length > 1 ? c.location.name : c.room}` : ""}
            </span>
            <span className={`class-spots spots-${c.availability}`}>{isBooked ? "You're booked in" : s.at === "done" && s.waitlisted ? "You're on the waitlist" : c.label}</span>
          </span>
        </button>
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
        <div className="confirm-in">{open && <ConfirmBox c={c} b={b} />}</div>
      </div>
    </li>
  );
}
