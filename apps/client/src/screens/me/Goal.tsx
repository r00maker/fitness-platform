/**
 * The monthly goal, set here (Home only shows it). Raising it gets some praise straight away.
 * Lowering it first shows how close they are to the goal they have, with "Keep it" as the main
 * button; they can still lower it.
 */
import { useState } from "react";
import { GoalSummary } from "../../components/Progress";
import { SubHead, useAction, Problem } from "../../components/ui";
import { plural } from "../../lib/format";
import { useStore } from "../../store";

const PRAISE = [
  (n: number) => `${n} a month. Love the ambition.`,
  (n: number) => `${n} a month it is. Your future self says thanks.`,
  (n: number) => `Up to ${n}. That's how habits get built.`,
];
const perWeek = (n: number) => (n <= 4 ? "about one a week" : n <= 8 ? "about two a week" : n <= 13 ? "about three a week" : `about ${Math.round(n / 4.3)} a week`);

export function Goal() {
  const { api, progress, refresh, toast } = useStore();
  const goal = progress?.month.goal ?? null;
  const [draft, setDraft] = useState<number>(goal ?? 8);
  const [lowering, setLowering] = useState<number | null>(null);
  const [praise, setPraise] = useState<string | null>(null);
  const a = useAction();
  if (!progress) return <div><SubHead title="Monthly goal" /></div>;
  const { done, booked, daysLeft, label } = progress.month;

  async function save(n: number | null) {
    const before = goal;
    const r = await a.run(() => api.setGoal(n));
    if (r === undefined) return;
    await refresh();
    setLowering(null);
    if (n === null) toast("Goal removed. Set a new one whenever you like.");
    else if (before === null) { setPraise(`${n} a month: ${perWeek(n)}. You've got this.`); toast(`Goal set: ${plural(n, "class", "classes")} a month.`); }
    else if (n > before) { setPraise(PRAISE[n % PRAISE.length]!(n)); toast(`Goal raised to ${n}.`); }
    else toast(`Goal changed to ${n}.`);
  }
  function choose(n: number) {
    setPraise(null);
    if (goal !== null && n < goal) setLowering(n);
    else void save(n);
  }

  // How close they are to the goal they have, to make the case for keeping it.
  const toGo = goal ? Math.max(0, goal - done) : 0;
  const keepCase = goal
    ? done >= goal
      ? `You've already met ${goal} this ${label}. Keeping it keeps the streak of good months going.`
      : `You've done ${done}${booked ? ` and booked ${booked}` : ""}, with ${plural(daysLeft, "day")} left. ${toGo - booked <= 0 ? "You're already booked up to it." : `${plural(toGo - booked, "more class", "more classes")} gets you there.`}`
    : "";

  return (
    <div className="goal-page">
      {goal === null ? (
        <SubHead title="Would you like to set a goal?" sub="A monthly goal helps you keep a rhythm. Pick a number that feels doable; you can change it any time." />
      ) : (
        <SubHead title="Your monthly goal" sub={`${plural(goal, "class", "classes")} a month, ${perWeek(goal)}.`} />
      )}

      {goal !== null && <GoalSummary p={progress} />}

      {praise && (
        <div className="praise" role="status">
          <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 3l2.6 5.6 6 .7-4.5 4.1 1.2 6L12 16.4 6.7 19.4l1.2-6-4.5-4.1 6-.7z" /></svg>
          <p>{praise}</p>
        </div>
      )}

      {lowering !== null && goal !== null ? (
        <div className="keep-box" role="group" aria-labelledby="keepT">
          <h2 id="keepT">You're closer than you think</h2>
          <p>{keepCase}</p>
          <div className="confirm-btns">
            <button type="button" className="btn btn-main" onClick={() => { setLowering(null); setDraft(goal); toast(`Keeping ${goal}. Nice.`); }}>Keep {goal}</button>
            <button type="button" className="btn btn-text" disabled={a.busy} onClick={() => void save(lowering === 0 ? null : lowering)}>{lowering === 0 ? "Remove it anyway" : `Change to ${lowering} anyway`}</button>
          </div>
        </div>
      ) : (
        <section className="goal-set" aria-label={goal === null ? "Choose a goal" : "Change your goal"}>
          <div className="goal-pick" role="group" aria-label="Quick choices">
            {[4, 8, 12, 16].map((n) => (
              <button key={n} type="button" className="chip" aria-pressed={draft === n} onClick={() => setDraft(n)}>{n} a month</button>
            ))}
          </div>
          <div className="goal-edit">
            <button type="button" className="step" aria-label="One fewer class" disabled={draft <= 1} onClick={() => setDraft((d) => Math.max(1, d - 1))}>−</button>
            <output aria-live="polite"><b>{draft}</b> {draft === 1 ? "class" : "classes"} a month</output>
            <button type="button" className="step" aria-label="One more class" disabled={draft >= 60} onClick={() => setDraft((d) => Math.min(60, d + 1))}>+</button>
          </div>
          <button type="button" className="btn btn-main btn-wide" disabled={a.busy || draft === goal} onClick={() => choose(draft)}>
            {goal === null ? "Set my goal" : draft === goal ? "This is your goal" : draft > goal ? `Raise it to ${draft}` : `Change it to ${draft}`}
          </button>
          <Problem text={a.error} />
          {goal !== null && <button type="button" className="btn btn-text" onClick={() => { setPraise(null); setLowering(0); }}>Remove my goal</button>}
        </section>
      )}
    </div>
  );
}
