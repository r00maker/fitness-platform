/**
 * The timetable: one week at a time (nothing cut off at the edges), filters that wrap onto the
 * next line rather than scrolling sideways, and the day's classes. Filters apply at once and are
 * remembered. "Classes with Ana" is one tap: the studio works out each person's favourite
 * instructor from the classes they've been to.
 */
import { useEffect, useMemo, useState } from "react";
import { ClassRow } from "../components/ClassRow";
import type { ClassItem, ScheduleDay } from "../data/types";
import { isoToday } from "../lib/format";
import { useStore } from "../store";

type When = "any" | "morning" | "midday" | "evening";
interface Filters { types: string[]; when: When; teacher: string; location: string; favourite: boolean }
const NONE: Filters = { types: [], when: "any", teacher: "", location: "", favourite: false };
const WHEN: { key: When; label: string; test: (h: number) => boolean }[] = [
  { key: "any", label: "Any time", test: () => true },
  { key: "morning", label: "Morning", test: (h) => h < 11 },
  { key: "midday", label: "Midday", test: (h) => h >= 11 && h < 16 },
  { key: "evening", label: "Evening", test: (h) => h >= 16 },
];
const DAYS = 14;

export function Book() {
  const { api, studio, bookings, me } = useStore();
  const store = `filters.${studio.slug}`;
  const [days, setDays] = useState<ScheduleDay[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [day, setDay] = useState(0);
  const [f, setF] = useState<Filters>(() => {
    try { return { ...NONE, ...JSON.parse(localStorage.getItem(store) ?? "{}") }; } catch { return NONE; }
  });
  useEffect(() => { try { localStorage.setItem(store, JSON.stringify(f)); } catch { /* not kept: fine */ } }, [f, store]);
  useEffect(() => {
    api.schedule(isoToday(studio.timezone), DAYS).then((d) => {
      setDays(d);
      // Late in the day, today may have nothing left: open on the next day that has classes.
      const first = d.findIndex((x) => x.classes.length);
      if (first > 0) setDay(first);
    }, (e: Error) => setError(e.message));
  }, [api, studio.timezone]);

  const fav = me.favouriteInstructor ?? null;
  const teachers = useMemo(() => [...new Set((days ?? []).flatMap((d) => d.classes.map((c) => c.instructor?.name).filter((x): x is string => !!x)))].sort(), [days]);
  const match = (c: ClassItem) =>
    (!f.types.length || f.types.includes(c.name)) &&
    WHEN.find((w) => w.key === f.when)!.test(Number(c.time.slice(0, 2))) &&
    (!f.teacher || c.instructor?.name === f.teacher) &&
    (!f.location || c.location.id === f.location) &&
    (!f.favourite || (!!fav && c.instructor?.id === fav.id));
  const shown = (days ?? []).map((d) => ({ ...d, classes: d.classes.filter(match) }));
  const active = f.types.length + (f.when !== "any" ? 1 : 0) + (f.teacher ? 1 : 0) + (f.location ? 1 : 0) + (f.favourite ? 1 : 0);
  const bookedIds = new Map(bookings.map((b) => [b.session.id, b.booking.id]));
  const typeNames = [...new Set(studio.classTypes.map((t) => t.name))];
  const week = day < 7 ? 0 : 1;
  const today = shown[day];
  const nextWith = shown.findIndex((d, i) => i > day && d.classes.length);
  /** Changing week opens on its first day with classes. */
  const firstIn = (from: number) => { const i = shown.slice(from, from + 7).findIndex((d) => d.classes.length); return from + Math.max(0, i); };
  const toggleType = (name: string) => setF((x) => ({ ...x, types: x.types.includes(name) ? x.types.filter((t) => t !== name) : [...x.types, name] }));
  const longDay = (iso: string) => new Date(`${iso}T00:00:00Z`).toLocaleDateString("en-GB", { weekday: "long", day: "numeric", month: "short", timeZone: "UTC" });

  return (
    <div className="book">
      <header className="screen-head">
        <h1>Book a class</h1>
      </header>

      <div className="filters" role="group" aria-label="Filter classes">
        <div className="chips">
          {fav && (
            <button type="button" className="chip chip-fav" aria-pressed={f.favourite} onClick={() => setF((x) => ({ ...x, favourite: !x.favourite, teacher: "" }))}>
              <span aria-hidden="true">★</span> Classes with {fav.firstName}
            </button>
          )}
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
            <span className="sr-only">Instructor</span>
            <select value={f.teacher} onChange={(e) => setF((x) => ({ ...x, teacher: e.target.value, favourite: false }))}>
              <option value="">Any instructor</option>
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

      <div className="week">
        <div className="week-head">
          <button type="button" className="week-nav" aria-label="Previous week" disabled={week === 0} onClick={() => setDay(firstIn(0))}>
            <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M15 5l-7 7 7 7" /></svg>
          </button>
          <span className="week-label">{week === 0 ? "This week" : "Next week"}</span>
          <button type="button" className="week-nav" aria-label="Next week" disabled={week === 1} onClick={() => setDay(firstIn(7))}>
            <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M9 5l7 7-7 7" /></svg>
          </button>
        </div>
        <div className="days" role="tablist" aria-label="Day">
          {shown.slice(week * 7, week * 7 + 7).map((d, k) => {
            const i = week * 7 + k;
            const dt = new Date(`${d.date}T00:00:00Z`);
            return (
              <button key={d.date} type="button" role="tab" aria-selected={i === day} aria-label={`${longDay(d.date)}${d.classes.length ? "" : ", no classes"}`} className={`day${d.classes.length ? "" : " is-empty"}`} onClick={() => setDay(i)}>
                <span className="day-name">{i === 0 ? "Today" : dt.toLocaleDateString("en-GB", { weekday: "short", timeZone: "UTC" })}</span>
                <span className="day-num">{dt.getUTCDate()}</span>
              </button>
            );
          })}
        </div>
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
            {nextWith > 0 && <button type="button" className="btn btn-quiet" onClick={() => setDay(nextWith)}>Go to {longDay(shown[nextWith]!.date)}</button>}
            {active > 0 && <button type="button" className="btn btn-text" onClick={() => setF(NONE)}>Clear filters</button>}
          </div>
        ))}
      </section>
    </div>
  );
}
