/** Me: packages (with how their dates work), the monthly goal, every achievement, the studio's details. */
import { Achievements, GoalCard } from "../components/Progress";
import type { Package } from "../data/types";
import { plural, shortDate } from "../lib/format";
import { useStore } from "../store";

export function Me() {
  const { me, packages, progress, studio, api } = useStore();
  const live = packages.filter((p) => p.state === "active" || p.state === "not_started");
  return (
    <div className="me">
      <header className="screen-head">
        <h1>{me.firstName}</h1>
        {me.email && <p>{me.email}</p>}
      </header>

      <section id="packages" aria-labelledby="pkgT">
        <h2 id="pkgT">Packages</h2>
        {live.length ? <ul className="packages">{live.map((p) => <PackageCard key={p.id} p={p} />)}</ul> : <p className="empty">No packages yet. Buy one at the studio or on its booking page.</p>}
      </section>

      {progress && (
        <section aria-labelledby="goalMeT" className="me-goal">
          <h2 id="goalMeT" className="sr-only">Monthly goal</h2>
          <GoalCard p={progress} />
        </section>
      )}

      {progress && (
        <section id="achievements" aria-labelledby="achT">
          <h2 id="achT">Achievements</h2>
          <p className="section-sub">{progress.streak.weeks > 1 ? `${progress.streak.weeks} weeks in a row with a class. Your best is ${progress.streak.best}.` : `Your best run is ${plural(progress.streak.best, "week")} in a row.`}</p>
          <Achievements p={progress} all />
        </section>
      )}

      <section aria-labelledby="studioT" className="studio-info">
        <h2 id="studioT">{studio.name}</h2>
        <ul>{studio.locations.map((l) => <li key={l.id}><b>{l.name}</b>{l.address ? <span>{l.address}</span> : null}</li>)}</ul>
        <p>{studio.rules.cancelling}</p>
        {!api.demo && <button type="button" className="btn btn-text" onClick={() => void api.signOut().then(() => location.reload())}>Sign out</button>}
      </section>
    </div>
  );
}

function PackageCard({ p }: { p: Package }) {
  const credits = p.kind === "credits" && p.creditsTotal ? p.creditsLeft! / p.creditsTotal : null;
  return (
    <li className="pkg">
      <div className="pkg-head">
        <h3>{p.name}</h3>
        <p className="pkg-left">{p.kind === "credits" ? <><b>{p.creditsLeft}</b> of {p.creditsTotal} left</> : <b>Unlimited</b>}</p>
      </div>
      {credits !== null && <span className="pkg-bar" style={{ "--p": credits } as React.CSSProperties} aria-hidden="true" />}
      <p className="pkg-dates">
        {p.renewal?.renewsOn ? `Renews ${shortDate(p.renewal.renewsOn)}` : p.validUntil ? `Valid until ${shortDate(p.validUntil)}` : p.state === "not_started" ? "Not started yet" : "Never expires"}
      </p>
      {p.startNote && <p className="pkg-note">{p.startNote}</p>}
      {p.renewal?.bookedAhead.map((a) => <p key={a.period} className="pkg-note is-ahead">{a.note}.</p>)}
      {p.billing === "recurring" && !p.renewal?.bookedAhead.length && <p className="pkg-note">You can book into next month before it renews. Those classes come out of next month's.</p>}
    </li>
  );
}
