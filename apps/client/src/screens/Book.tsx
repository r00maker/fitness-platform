/**
 * The timetable: two weeks of days across the top, filters as one row of taps (kinds of class,
 * time of day, teacher, location), and the day's classes. Filters apply instantly, are
 * remembered, and the day strip shows how many classes match on each day, so nobody taps
 * through empty days. Booking happens in the row.
 */
import { useEffect, useMemo, useState } from "react";
import { ClassRow } from "../components/ClassRow";
import type { ClassItem, ScheduleDay } from "../data/types";
import { isoToday } from "../lib/format";
import { useStore } from "../store";

type When = "any" | "morning" | "midday" | "evening";
interface Filters { types: string[]; when: When; teacher: string; location: string }
const NONE: Filters = { types: [], when: "any", teacher: "", location: "" };
const WHEN: { key: When; label: string; test: (h: number) => boolean }[] = [
  { key: "any", label: "Any time", test: () => true },
  { key: "morning", label: "Morning", test: (h) => h < 11 },
  { key: "midday", label: "Midday", test: (h) => h >= 11 && h < 16 },
  { key: "evening", label: "Evening", test: (h) => h >= 16 },
];

export function Book() {
  const { api, studio, bookings } = useStore();
  const store = `filters.${studio.slug}`;
  const [days, setDays] = useState<ScheduleDay[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [day, setDay] = useState(0);
  const [f, setF] = useState<Filters>(() => {
    try { return { ...NONE, ...JSON.parse(localStorage.getItem(store) ?? "{}") }; } catch { return NONE; }
  });
  useEffect(() => { try { localStorage.setItem(store, JSON.stringify(f)); } catch { /* not kept: fine */ } }, [f, store]);
  useEffect(() => {
    api.schedule(isoToday(studio.timezone), 14).then((d) => {
      setDays(d);
      // Late in the day, today may have nothing left: open on the next day that has classes.
      const first = d.findIndex((x) => x.classes.length);
      if (first > 0) setDay(first);
    }, (e: Error) => setError(e.message));
  }, [api, studio.timezone]);

  const teachers = useMemo(() => [...new Set((days ?? []).flatMap((d) => d.classes.map((c) => c.instructor?.name).filter((x): x is string => !!x)))].sort(), [days]);
  const match = (c: ClassItem) =>
    (!f.types.length || f.types.includes(c.name)) &&
    WHEN.find((w) => w.key === f.when)!.test(Number(c.time.slice(0, 2))) &&
    (!f.teacher || c.instructor?.name === f.teacher) &&
    (!f.location || c.location.id === f.location);
  const shown = (days ?? []).map((d) => ({ ...d, classes: d.classes.filter(match) }));
  const active = f.types.length + (f.when !== "any" ? 1 : 0) + (f.teacher ? 1 : 0) + (f.location ? 1 : 0);
  const bookedIds = new Map(bookings.map((b) => [b.session.id, b.booking.id]));
  const typeNames = [...new Set(studio.classTypes.map((t) => t.name))];
  const today = shown[day];
  const nextWith = shown.findIndex((d, i) => i > day && d.classes.length);

  const toggleType = (name: string) => setF((x) => ({ ...x, types: x.types.includes(name) ? x.types.filter((t) => t !== name) : [...x.types, name] }));

  return (
    <div className="book">
      <header className="screen-head">
        <h1>Book a class</h1>
      </header>

      <div className="filters" role="group" aria-label="Filter classes">
        <div className="chips">
          {typeNames.map((n) => {
            const t = studio.classTypes.find((x) => x.name === n)!;
            return (
              <button key={n} type="button" className="chip" aria-pressed={f.types.includes(n)} onClick={() => toggleType(n)} style={{ "--type": t.color } as React.CSSProperties}>
                <span className="chip-dot" aria-hidden="true" />{n}
              </button>
            );
          })}
        </div>
        <div className="filter-row">
          <div className="seg" role="radiogroup" aria-label="Time of day">
            {WHEN.map((w) => <button key={w.key} type="button" role="radio" aria-checked={f.when === w.key} onClick={() => setF((x) => ({ ...x, when: w.key }))}>{w.label}</button>)}
          </div>
          <label className="select">
            <span className="sr-only">Teacher</span>
            <select value={f.teacher} onChange={(e) => setF((x) => ({ ...x, teacher: e.target.value }))}>
              <option value="">Any teacher</option>
              {teachers.map((t) => <option key={t} value={t}>{t}</option>)}
            </select>
          </label>
          {studio.locations.length > 1 && (
            <label className="select">
              <span className="sr-only">Location</span>
              <select value={f.location} onChange={(e) => setF((x) => ({ ...x, location: e.target.value }))}>
                <option value="">All locations</option>
                {studio.locations.map((l) => <option key={l.id} value={l.id}>{l.name}</option>)}
              </select>
            </label>
          )}
          {active > 0 && <button type="button" className="btn btn-text" onClick={() => setF(NONE)}>Clear filters</button>}
        </div>
      </div>

      <div className="days" role="tablist" aria-label="Day">
        {shown.map((d, i) => {
          const dt = new Date(`${d.date}T00:00:00Z`);
          return (
            <button key={d.date} type="button" role="tab" aria-selected={i === day} className={`day${d.classes.length ? "" : " is-empty"}`} onClick={() => setDay(i)}>
              <span className="day-name">{i === 0 ? "Today" : dt.toLocaleDateString("en-GB", { weekday: "short", timeZone: "UTC" })}</span>
              <span className="day-num">{dt.getUTCDate()}</span>
              <span className="day-count" aria-label={`${d.classes.length} classes`}>{d.classes.length || ""}</span>
            </button>
          );
        })}
      </div>

      <section aria-live="polite" aria-busy={!days}>
        {error && <p className="empty" role="alert">{error}</p>}
        {!days && !error && <ul className="class-list is-loading">{[0, 1, 2].map((i) => <li key={i} className="class-row skeleton" />)}</ul>}
        {today?.closed && <p className="empty">The studio is closed: {today.closed.name}.{today.closed.message ? ` ${today.closed.message}` : ""}</p>}
        {today && !today.closed && (today.classes.length ? (
          <ul className="class-list">{today.classes.map((c) => <ClassRow key={c.id} c={c} booked={bookedIds.get(c.id) ?? null} />)}</ul>
        ) : (
          <div className="empty">
            <p>{active ? "No classes match your filters on this day." : "No classes on this day."}</p>
            {nextWith > 0 && <button type="button" className="btn btn-quiet" onClick={() => setDay(nextWith)}>Go to {shown[nextWith]!.label === "Today" ? "today" : new Date(`${shown[nextWith]!.date}T00:00:00Z`).toLocaleDateString("en-GB", { weekday: "long", day: "numeric", month: "short", timeZone: "UTC" })}</button>}
            {active > 0 && <button type="button" className="btn btn-text" onClick={() => setF(NONE)}>Clear filters</button>}
          </div>
        ))}
      </section>
    </div>
  );
}
