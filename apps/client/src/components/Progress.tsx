/**
 * The Home progress pieces: the tally to the next milestone, this month against the client's
 * goal, and achievements. Each studio's motif shapes the marks (leaf, wave, seal, spark).
 */
import { useState } from "react";
import type { Badge, Progress } from "../data/types";
import { ordinal, plural, shortDate } from "../lib/format";
import { useStore } from "../store";

/**
 * Classes since the last milestone as tally marks, grouped in fives like a rep count, with the
 * marks still to go drawn faintly. The count is the headline.
 */
export function MilestoneTrack({ p }: { p: Progress }) {
  const { previous, next, toGo } = p.milestone;
  const span = next ? next - previous : 0;
  const done = next ? p.classes - previous : 0;
  // Very long stretches (say 500 to 1000) are drawn as tens.
  const unit = span > 120 ? 10 : 1;
  const marks = Math.ceil(span / unit);
  const filled = Math.floor(done / unit);
  const groups = Math.ceil(marks / 5);
  return (
    <section className="track" aria-labelledby="trackT">
      <div className="track-head">
        <h2 id="trackT" className="track-count"><span>{p.classes}</span> {p.classes === 1 ? "class" : "classes"}</h2>
        {next ? <p className="track-next">{toGo === 1 ? "One more" : `${toGo} more`} to your {ordinal(next)}</p> : <p className="track-next">Every milestone reached</p>}
      </div>
      {next && (
        <div className="tally" role="img" aria-label={`${done} of ${span} classes from your ${previous ? ordinal(previous) : "first"} to your ${ordinal(next)}`}>
          {Array.from({ length: groups }, (_, g) => (
            <span className="tally-group" key={g}>
              {Array.from({ length: Math.min(5, marks - g * 5) }, (_, i) => {
                const n = g * 5 + i;
                return <i key={i} className={n < filled ? "on" : n === filled ? "now" : ""} />;
              })}
            </span>
          ))}
          <span className="tally-goal" aria-hidden="true"><Mark />{next}</span>
        </div>
      )}
      {unit > 1 && <p className="track-unit">Each mark is 10 classes.</p>}
    </section>
  );
}

/** The studio's mark: a leaf, a wave crest, a seal or a spark. */
export function Mark({ className = "mark" }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 24 24" aria-hidden="true">
      <path className="m-leaf" d="M4 18 C 6 8 14 4 20 4 C 20 11 15 19 4 18 Z M5 17 L 15 9" />
      <path className="m-wave" d="M2 15 C 5 9 9 9 12 13 S 19 17 22 9" />
      <rect className="m-stamp" x="4" y="4" width="16" height="16" />
      <path className="m-spark" d="M12 3 L13.6 10.4 L21 12 L13.6 13.6 L12 21 L10.4 13.6 L3 12 L10.4 10.4 Z" />
    </svg>
  );
}

/** This month: a dot per class in the goal. Filled = done, ringed = booked. The goal is set right here. */
export function GoalCard({ p }: { p: Progress }) {
  const { api, refresh, toast } = useStore();
  const [busy, setBusy] = useState(false);
  const { done, booked, goal, label, daysLeft } = p.month;
  async function setGoal(n: number | null) {
    setBusy(true);
    try {
      await api.setGoal(n);
      await refresh();
      if (n) toast(`Goal set: ${plural(n, "class", "classes")} a month.`);
    } catch (e) {
      toast((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  if (!goal) {
    return (
      <section className="goal" aria-labelledby="goalT">
        <h2 id="goalT">{label}</h2>
        <p className="goal-line">{done ? `${plural(done, "class", "classes")} so far.` : "No classes yet this month."} How many would you like to do?</p>
        <div className="goal-pick" role="group" aria-label="Set a monthly goal">
          {[4, 8, 12, 16].map((n) => <button key={n} type="button" className="chip" disabled={busy} onClick={() => void setGoal(n)}>{n} a month</button>)}
        </div>
      </section>
    );
  }
  const count = Math.max(goal, done + booked);
  const left = Math.max(0, goal - done - booked);
  return (
    <section className="goal" aria-labelledby="goalT">
      <div className="goal-head">
        <h2 id="goalT">{label}</h2>
        <p className="goal-score"><b>{done}</b> of {goal}</p>
      </div>
      <ol className="goal-dots" aria-label={`${done} done and ${booked} booked, of a goal of ${goal}`}>
        {Array.from({ length: count }, (_, i) => <li key={i} className={i < done ? "done" : i < done + booked ? "booked" : i >= goal ? "extra" : ""} />)}
      </ol>
      <p className="goal-line">
        {done >= goal ? "Goal met. Anything more is a bonus." : left === 0 ? `Booked up to your goal. ${plural(daysLeft, "day")} left in ${label}.` : `${booked ? `${booked} booked, ` : ""}${plural(left, "more class", "more classes")} to book. ${plural(daysLeft, "day")} left.`}
      </p>
      <div className="goal-edit" role="group" aria-label="Change your monthly goal">
        <span>Goal</span>
        <button type="button" className="step" aria-label="One fewer class" disabled={busy || goal <= 1} onClick={() => void setGoal(goal - 1)}>−</button>
        <output aria-live="polite">{goal}</output>
        <button type="button" className="step" aria-label="One more class" disabled={busy || goal >= 60} onClick={() => void setGoal(goal + 1)}>+</button>
        <span>a month</span>
      </div>
    </section>
  );
}

export function BadgeMark({ b, size = "md" }: { b: Badge; size?: "md" | "lg" }) {
  const n = b.key.startsWith("classes_") ? b.key.slice(8) : null;
  const glyph: Record<string, string> = { first: "1", goal: "✓", streak: "4w", early: "6am", explorer: "3" };
  return (
    <span className={`badge badge-${size}${b.earned ? " is-earned" : ""}`} aria-hidden="true">
      <span className="badge-shape" />
      <span className="badge-text">{n ?? glyph[b.key] ?? "★"}</span>
    </span>
  );
}

/** Earned achievements, newest first, then the closest ones still to earn. */
export function Achievements({ p, all = false }: { p: Progress; all?: boolean }) {
  const earned = p.achievements.filter((b) => b.earned).sort((a, b) => (b.earnedOn ?? "").localeCompare(a.earnedOn ?? ""));
  const toEarn = p.achievements.filter((b) => !b.earned && b.progress).sort((a, b) => b.progress!.have / b.progress!.need - a.progress!.have / a.progress!.need);
  const list = all ? [...earned, ...toEarn] : [...earned.slice(0, 3), ...toEarn.slice(0, 2)];
  return (
    <ul className={`badges${all ? " is-all" : ""}`}>
      {list.map((b) => (
        <li key={b.key} className={b.earned ? "earned" : "to-earn"}>
          <BadgeMark b={b} />
          <div>
            <h3>{b.title}</h3>
            <p>{b.earned ? (b.earnedOn ? `Earned ${shortDate(b.earnedOn)}` : "Earned") : `${b.progress!.have} of ${b.progress!.need}`}</p>
            {all && <p className="badge-detail">{b.detail}</p>}
          </div>
          {!b.earned && b.progress && <span className="badge-bar" style={{ "--p": b.progress.have / b.progress.need } as React.CSSProperties} aria-hidden="true" />}
        </li>
      ))}
    </ul>
  );
}
