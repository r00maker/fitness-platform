/** Upcoming classes. Each opens its own screen, where it can be cancelled. */
import { clock, dayLabel } from "../lib/format";
import { useStore } from "../store";

export function MyClasses() {
  const { bookings, studio, go, progress } = useStore();
  const tz = studio.timezone;
  return (
    <div className="mine">
      <header className="screen-head">
        <h1>My classes</h1>
        {progress && <p>{progress.classes} {progress.classes === 1 ? "class" : "classes"} so far with {studio.name}.</p>}
      </header>
      {bookings.length ? (
        <ul className="list booking-list">
          {bookings.map((b) => (
            <li key={b.booking.id} style={{ "--type": b.classType.color } as React.CSSProperties}>
              <button type="button" className="row booking-row" onClick={() => go(`classes/class/${b.session.id}`)}>
                <span className="booking-when"><span>{dayLabel(b.session.startsAt, tz)}</span><b>{clock(b.session.startsAt, tz)}</b></span>
                <span className="row-text">
                  <span className="row-title">{b.classType.name}</span>
                  <span className="row-detail">{studio.locations.find((l) => l.id === b.session.locationId)?.name}{b.booking.heldForPeriod ? ", booked ahead into next month" : ""}</span>
                </span>
                <svg className="row-go" viewBox="0 0 24 24" aria-hidden="true"><path d="M9 5l7 7-7 7" /></svg>
              </button>
            </li>
          ))}
        </ul>
      ) : (
        <div className="empty">
          <p>No classes booked.</p>
          <button type="button" className="btn btn-main" onClick={() => go("book")}>Find a class</button>
        </div>
      )}
    </div>
  );
}
