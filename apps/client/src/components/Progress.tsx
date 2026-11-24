/**
 * Progress on Home and in Me: the bar to the next milestone, this month against the goal
 * (read-only here; it's set in Me), and achievements kept short. The studio's motif shapes
 * the marks (leaf, wave, seal, spark).
 */
import type { Badge, Progress } from "../data/types";
import { ordinal, plural, shortDate } from "../lib/format";
import { useStore } from "../store";

/** The studio's mark: a leaf, a wave crest, a seal or a spark. */
export function Mark({ className = "mark" }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 24 24" aria-hidden="true">
      <path className="m-leaf" d="M4 18 C 6 8 14 4 20 4 C 20 11 15 19 4 18 Z M5 17 L 15 9" />
      <path className="m-wave" d="M2 15 C 5 9 9 9 12 13 S 19 17 22 9" />
      <rect className="m-stamp" x="4" y="4" width="16" height="16" />
      <path className="m-spark" d="M12.00 2.00 L14.29 4.96 L17.88 3.91 L17.99 7.65 L21.51 8.91 L19.40 12.00 L21.51 15.09 L17.99 16.35 L17.88 20.09 L14.29 19.04 L12.00 22.00 L9.71 19.04 L6.12 20.09 L6.01 16.35 L2.49 15.09 L4.60 12.00 L2.49 8.91 L6.01 7.65 L6.12 3.91 L9.71 4.96 Z" />
    </svg>
  );
}

/** Classes so far, and a bar from the last milestone to the next one, with the studio's mark at the end. */
export function MilestoneCard({ p }: { p: Progress }) {
  const { previous, next, toGo, progress } = p.milestone;
  return (
    <section className="ms" aria-labelledby="msT">
      <div className="ms-top">
        <h2 id="msT" className="ms-count"><b>{p.classes}</b> {p.classes === 1 ? "class" : "classes"}</h2>
        <p className="ms-next">{next ? <><b>{toGo}</b> to your {ordinal(next)}</> : "Every milestone reached"}</p>
      </div>
      {next && (
        <>
          <div className="ms-bar" role="progressbar" aria-label={`From ${previous} to ${next} classes`} aria-valuemin={previous} aria-valuemax={next} aria-valuenow={p.classes}>
            <span className="ms-fill" style={{ "--p": Math.max(0.02, progress) } as React.CSSProperties} />
            <span className="ms-end"><Mark /></span>
          </div>
          <div className="ms-ends" aria-hidden="true"><span>{previous || "Start"}</span><span>{next}</span></div>
        </>
      )}
    </section>
  );
}

/** This month against the goal: a dot per class (filled = done, ringed = booked). Set or changed in Me. */
export function GoalSummary({ p }: { p: Progress }) {
  const { go } = useStore();
  const { done, booked, goal, label, daysLeft } = p.month;
  if (!goal) {
    return (
      <section className="goal is-empty" aria-labelledby="goalT">
        <h2 id="goalT">{label}</h2>
        <p className="goal-line">{done ? `${plural(done, "class", "classes")} so far this month.` : "A monthly goal helps you keep a rhythm."}</p>
        <button type="button" className="btn btn-quiet" onClick={() => go("me/goal")}>Set a monthly goal</button>
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
        {Array.from({ length: count }, (_, i) => <li key={i} className={i < done ? "done" : i < done + booked ? "booked" : ""} />)}
      </ol>
      <p className="goal-line">
        {done >= goal ? "Goal met. Anything more is a bonus." : left === 0 ? `Booked up to your goal, with ${plural(daysLeft, "day")} to go.` : `${booked ? `${booked} booked, ` : ""}${plural(left, "more to book", "more to book")}. ${plural(daysLeft, "day")} left.`}
      </p>
    </section>
  );
}

const GLYPH: Record<string, string> = { first: "1", goal: "✓", streak: "4w", early: "6am", explorer: "3" };
export function BadgeMark({ b }: { b: Badge }) {
  const n = b.key.startsWith("classes_") ? b.key.slice(8) : null;
  return (
    <span className={`badge${b.earned ? " is-earned" : ""}`} aria-hidden="true">
      <span className="badge-shape" />
      <span className="badge-text">{n ?? GLYPH[b.key] ?? "★"}</span>
    </span>
  );
}

const milestonesOf = (p: Progress) => p.achievements.filter((b) => b.key.startsWith("classes_"));
const othersOf = (p: Progress) => p.achievements.filter((b) => !b.key.startsWith("classes_"));
/** The achievement closest to being earned. */
export const nextUp = (p: Progress) => p.achievements.filter((b) => !b.earned && b.progress).sort((a, b) => b.progress!.have / b.progress!.need - a.progress!.have / a.progress!.need)[0];

/** Home: the last few earned (just their marks) and the one coming up. */
export function AchievementsStrip({ p }: { p: Progress }) {
  const { go } = useStore();
  const earned = p.achievements.filter((b) => b.earned).sort((a, b) => (b.earnedOn ?? "").localeCompare(a.earnedOn ?? ""));
  const up = nextUp(p);
  return (
    <button type="button" className="ach-strip" onClick={() => go("me/achievements")} aria-label={`Achievements: ${earned.length} earned${up ? `. Next: ${up.title}, ${up.progress!.have} of ${up.progress!.need}` : ""}. See all`}>
      <span className="ach-marks">{earned.slice(0, 4).map((b) => <BadgeMark key={b.key} b={b} />)}</span>
      <span className="ach-text">
        <b>{plural(earned.length, "achievement")}</b>
        {up && <span>Next: {up.title}, {up.progress!.need - up.progress!.have} to go</span>}
      </span>
      <svg className="row-go" viewBox="0 0 24 24" aria-hidden="true"><path d="M9 5l7 7-7 7" /></svg>
    </button>
  );
}

/** The full set: milestones along one line, then the other achievements. */
export function AchievementsFull({ p }: { p: Progress }) {
  const ms = milestonesOf(p);
  const nextIndex = ms.findIndex((b) => !b.earned);
  return (
    <>
      <section aria-labelledby="milesT" className="miles-wrap">
        <h2 id="milesT">Milestones</h2>
        <ol className="miles">
          {ms.map((b, i) => (
            <li key={b.key} className={b.earned ? "earned" : i === nextIndex ? "next" : ""}>
              <BadgeMark b={b} />
              <span className="miles-label">{b.earned ? (b.earnedOn ? shortDate(b.earnedOn) : "Earned") : i === nextIndex ? `${b.progress!.need - b.progress!.have} to go` : ""}</span>
            </li>
          ))}
        </ol>
      </section>
      <section aria-labelledby="othersT">
        <h2 id="othersT">Along the way</h2>
        <ul className="badges">
          {othersOf(p).map((b) => (
            <li key={b.key} className={b.earned ? "earned" : "to-earn"}>
              <BadgeMark b={b} />
              <div>
                <h3>{b.title}</h3>
                <p>{b.earned ? (b.earnedOn ? `Earned ${shortDate(b.earnedOn)}` : "Earned") : b.detail}</p>
                {!b.earned && b.progress && <span className="mini-bar" style={{ "--p": b.progress.have / b.progress.need } as React.CSSProperties} aria-label={`${b.progress.have} of ${b.progress.need}`} />}
              </div>
            </li>
          ))}
        </ul>
      </section>
    </>
  );
}
