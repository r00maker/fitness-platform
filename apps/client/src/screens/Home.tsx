/**
 * Home: never a blank page. The studio's banners, the next class, the tally to the next
 * milestone, this month against the client's goal, achievements, and a few classes to book
 * straight from here.
 */
import { useEffect, useMemo, useState } from "react";
import { Banners } from "../components/Banners";
import { ClassRow } from "../components/ClassRow";
import { Achievements, GoalCard, MilestoneTrack } from "../components/Progress";
import type { ClassItem } from "../data/types";
import { clock, dayLabel, greeting, isoToday } from "../lib/format";
import { useStore } from "../store";

export function Home() {
  const { me, studio, progress, bookings, go, api } = useStore();
  const tz = studio.timezone;
  const nextUp = bookings[0];
  const [soon, setSoon] = useState<ClassItem[]>([]);

  // A few classes worth booking: the kinds they book most, with spots, over the next few days.
  useEffect(() => {
    void api.schedule(isoToday(tz), 4).then((days) => setSoon(days.flatMap((d) => d.classes)));
  }, [api, tz]);
  const bookedIds = useMemo(() => new Map(bookings.map((b) => [b.session.id, b.booking.id])), [bookings]);
  const picks = useMemo(() => {
    const liked = new Map<string, number>();
    bookings.forEach((b) => liked.set(b.classType.name, (liked.get(b.classType.name) ?? 0) + 1));
    return soon
      .filter((c) => !bookedIds.has(c.id) && (c.availability === "open" || c.availability === "few_left") && Date.parse(c.startsAt) > Date.now() + 3_600_000)
      .sort((a, b) => (liked.get(b.name) ?? 0) - (liked.get(a.name) ?? 0) || a.startsAt.localeCompare(b.startsAt))
      .slice(0, 3)
      .sort((a, b) => a.startsAt.localeCompare(b.startsAt));
  }, [soon, bookings, bookedIds]);

  return (
    <div className="home">
      <header className="hello">
        <h1>{greeting(tz)}, {me.firstName}.</h1>
        {studio.theme.welcome && <p>{studio.theme.welcome}</p>}
      </header>

      <Banners />

      <section className="up-next" aria-labelledby="nextT">
        <h2 id="nextT">Your next class</h2>
        {nextUp ? (
          <button type="button" className="next-card" onClick={() => go("classes")} style={{ "--type": nextUp.classType.color } as React.CSSProperties}>
            <span className="next-when">{dayLabel(nextUp.session.startsAt, tz)}, {clock(nextUp.session.startsAt, tz)}</span>
            <span className="next-name">{nextUp.classType.name}</span>
            <span className="next-where">{studio.locations.find((l) => l.id === nextUp.session.locationId)?.name ?? ""}{bookings.length > 1 ? `, and ${bookings.length - 1} more booked` : ""}</span>
          </button>
        ) : (
          <div className="next-card is-empty">
            <span className="next-name">Nothing booked yet</span>
            <button type="button" className="btn btn-main" onClick={() => go("book")}>Find a class</button>
          </div>
        )}
      </section>

      {progress && (
        <div className="progress-grid">
          <MilestoneTrack p={progress} />
          <GoalCard p={progress} />
        </div>
      )}

      {progress && (
        <section className="home-badges" aria-labelledby="badgesT">
          <div className="section-head">
            <h2 id="badgesT">Achievements</h2>
            <button type="button" className="btn btn-text" onClick={() => go("me", "achievements")}>See all</button>
          </div>
          <Achievements p={progress} />
        </section>
      )}

      {picks.length > 0 && (
        <section aria-labelledby="picksT">
          <div className="section-head">
            <h2 id="picksT">Book again</h2>
            <button type="button" className="btn btn-text" onClick={() => go("book")}>Full timetable</button>
          </div>
          <ul className="class-list">
            {picks.map((c) => <ClassRow key={c.id} c={c} booked={bookedIds.get(c.id) ?? null} showDate />)}
          </ul>
        </section>
      )}
      <p className="home-foot">{studio.rules.cancelling}</p>
    </div>
  );
}
