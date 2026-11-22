/**
 * Me: one place for everything about the person, in short groups of rows that each open a
 * screen. Nothing long lives here, so it stays easy to scan.
 */
import { useEffect, useState } from "react";
import { nextUp } from "../components/Progress";
import { Row } from "../components/ui";
import type { Waiver } from "../data/types";
import { plural, shortDate } from "../lib/format";
import { useStore } from "../store";

const I = {
  goal: <><circle cx="12" cy="12" r="8" /><circle cx="12" cy="12" r="4" /><circle cx="12" cy="12" r=".6" /></>,
  badge: <><circle cx="12" cy="9" r="5" /><path d="M9 13.5 8 20l4-2 4 2-1-6.5" /></>,
  pack: <><rect x="4" y="6" width="16" height="13" rx="2" /><path d="M8 6V4h8v2M4 11h16" /></>,
  buy: <><path d="M5 7h14l-1.2 11H6.2z" /><path d="M9 7a3 3 0 0 1 6 0" /></>,
  shop: <><path d="M4 9h16l-1 11H5z" /><path d="M8 9V7a4 4 0 0 1 8 0v2" /></>,
  gift: <><rect x="4" y="9" width="16" height="11" rx="1.5" /><path d="M12 9v11M4 13h16M12 9c-2-4-6-3-5 0M12 9c2-4 6-3 5 0" /></>,
  star: <path d="M12 4l2.4 5 5.4.6-4 3.7 1.1 5.4L12 16l-4.9 2.7 1.1-5.4-4-3.7 5.4-.6z" />,
  friend: <><circle cx="9" cy="9" r="3" /><circle cx="17" cy="10" r="2.5" /><path d="M3 19c.8-3 3.2-5 6-5s5.2 2 6 5M15 15c2.6 0 4.4 1.4 5 4" /></>,
  health: <path d="M12 20s-7-4.4-7-10a4 4 0 0 1 7-2.6A4 4 0 0 1 19 10c0 5.6-7 10-7 10z" />,
  sign: <><path d="M5 19h14" /><path d="M7 15l9-9 2 2-9 9H7z" /></>,
  receipt: <><path d="M6 3h12v18l-3-2-3 2-3-2-3 2z" /><path d="M9 8h6M9 12h6" /></>,
  card: <><rect x="3" y="6" width="18" height="12" rx="2" /><path d="M3 10h18" /></>,
  bell: <><path d="M6 16V11a6 6 0 0 1 12 0v5l1.5 2h-15z" /><path d="M10 20a2 2 0 0 0 4 0" /></>,
};

export function Me() {
  const { me, packages, progress, studio, api } = useStore();
  const [waiver, setWaiver] = useState<Waiver | null>(null);
  const [extras, setExtras] = useState<{ shop: boolean; loyalty: string | null; referral: boolean }>({ shop: false, loyalty: null, referral: false });
  useEffect(() => {
    void api.waiver().then(setWaiver).catch(() => setWaiver(null));
    void Promise.all([api.shop().catch(() => null), api.loyalty().catch(() => null), api.referral().catch(() => null)]).then(([s, l, r]) =>
      setExtras({ shop: !!s?.visible, loyalty: l?.enabled ? l.balanceText ?? null : null, referral: !!r?.enabled }),
    );
  }, [api]);
  const live = packages.filter((p) => p.state === "active" || p.state === "not_started");
  const earned = progress?.achievements.filter((b) => b.earned) ?? [];
  const up = progress ? nextUp(progress) : undefined;
  const goal = progress?.month.goal;

  return (
    <div className="me">
      <header className="screen-head me-head">
        <span className="avatar" aria-hidden="true">{me.firstName.slice(0, 1)}</span>
        <div>
          <h1>{me.firstName}</h1>
          {me.email && <p>{me.email}</p>}
        </div>
      </header>

      <section aria-label="Your practice">
        <ul className="list">
          <Row to="me/goal" icon={<svg viewBox="0 0 24 24">{I.goal}</svg>} title="Monthly goal" detail={goal ? `${progress!.month.done} of ${goal} this ${progress!.month.label}` : "Would you like to set one?"} />
          <Row to="me/achievements" icon={<svg viewBox="0 0 24 24">{I.badge}</svg>} title="Achievements" detail={`${plural(earned.length, "earned", "earned")}${up ? `. Next: ${up.title}` : ""}`} />
        </ul>
      </section>

      <section aria-labelledby="pkgT">
        <h2 id="pkgT">Packages</h2>
        <ul className="list">
          {live.map((p) => (
            <Row key={p.id} to={`me/packages/${p.id}`} icon={<svg viewBox="0 0 24 24">{I.pack}</svg>} title={p.name}
              detail={`${p.kind === "credits" ? `${p.creditsLeft} of ${p.creditsTotal} left` : "Unlimited"}${p.renewal?.renewsOn ? `, renews ${shortDate(p.renewal.renewsOn)}` : p.renewal?.endsOn ? `, ends ${shortDate(p.renewal.endsOn)}` : p.validUntil ? `, until ${shortDate(p.validUntil)}` : p.state === "not_started" ? ", not started yet" : ""}`} />
          ))}
          <Row to="me/buy" icon={<svg viewBox="0 0 24 24">{I.buy}</svg>} title={live.length ? "Buy another package" : "Buy a package"} detail="Class packs and memberships" />
        </ul>
      </section>

      {(extras.shop || extras.loyalty || extras.referral) && (
        <section aria-labelledby="shopT">
          <h2 id="shopT">Shop and rewards</h2>
          <ul className="list">
            {extras.shop && <Row to="me/shop" icon={<svg viewBox="0 0 24 24">{I.shop}</svg>} title="Shop" detail="Merchandise and gift cards" />}
            {extras.shop && <Row to="me/gift-cards" icon={<svg viewBox="0 0 24 24">{I.gift}</svg>} title="My gift cards and credit" />}
            {extras.loyalty && <Row to="me/rewards" icon={<svg viewBox="0 0 24 24">{I.star}</svg>} title="Rewards" detail={extras.loyalty} />}
            {extras.referral && <Row to="me/refer" icon={<svg viewBox="0 0 24 24">{I.friend}</svg>} title="Refer a friend" />}
          </ul>
        </section>
      )}

      <section aria-labelledby="healthT">
        <h2 id="healthT">Health and safety</h2>
        <ul className="list">
          <Row to="me/health" icon={<svg viewBox="0 0 24 24">{I.health}</svg>} title="Injuries and health notes" detail="So your instructor knows before class" />
          {waiver?.required && <Row to="me/waiver" icon={<svg viewBox="0 0 24 24">{I.sign}</svg>} title="Waiver" detail={waiver.done ? `Signed${waiver.signedAt ? ` ${shortDate(waiver.signedAt.slice(0, 10))}` : ""}` : "Not signed yet"} badge={waiver.done ? undefined : <span className="dot-alert" aria-label="needs signing" />} />}
        </ul>
      </section>

      <section aria-labelledby="acctT">
        <h2 id="acctT">Account</h2>
        <ul className="list">
          <Row to="me/receipts" icon={<svg viewBox="0 0 24 24">{I.receipt}</svg>} title="Purchases and receipts" />
          <Row to="me/card" icon={<svg viewBox="0 0 24 24">{I.card}</svg>} title="Payment card" />
          <Row to="me/notifications" icon={<svg viewBox="0 0 24 24">{I.bell}</svg>} title="News and offers" />
        </ul>
      </section>

      <section className="studio-info" aria-labelledby="studioT">
        <h2 id="studioT">{studio.name}</h2>
        <ul>{studio.locations.map((l) => <li key={l.id}><b>{l.name}</b>{l.address ? <span>{l.address}</span> : null}</li>)}</ul>
        {!api.demo && <button type="button" className="btn btn-text" onClick={() => void api.signOut().then(() => location.reload())}>Sign out</button>}
      </section>
    </div>
  );
}
