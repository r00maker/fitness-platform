/** The smaller screens under Me: achievements, rewards, referrals, health notes, the waiver, receipts, the card, news and offers. */
import { useEffect, useState } from "react";
import { AchievementsFull } from "../../components/Progress";
import { Problem, SubHead, useAction, Loading } from "../../components/ui";
import type { HealthNote, Loyalty, Notifications, PaymentCard, Purchase, Referral, Waiver } from "../../data/types";
import { plural, shortDate } from "../../lib/format";
import { useStore } from "../../store";

export function AchievementsPage() {
  const { progress } = useStore();
  if (!progress) return <div><SubHead title="Achievements" /><Loading /></div>;
  const earned = progress.achievements.filter((b) => b.earned).length;
  return (
    <div className="ach-page">
      <SubHead title="Achievements" sub={`${plural(earned, "earned", "earned")}. ${progress.streak.weeks > 1 ? `${progress.streak.weeks} weeks in a row with a class.` : `Your best run: ${plural(progress.streak.best, "week")} in a row.`}`} />
      <AchievementsFull p={progress} />
    </div>
  );
}

export function Rewards() {
  const { api, toast } = useStore();
  const [l, setL] = useState<Loyalty | null>(null);
  const a = useAction();
  const load = () => void api.loyalty().then(setL);
  useEffect(load, [api]);
  if (!l) return <div><SubHead title="Rewards" /><Loading /></div>;
  if (!l.enabled) return <div><SubHead title="Rewards" /><p className="empty">The studio isn't running rewards right now.</p></div>;
  return (
    <div className="rewards">
      <SubHead title="Rewards" />
      <section className="credit-card" aria-label="Your balance">
        <p className="credit-big">{l.balanceText}</p>
        {l.rules?.map((r) => <p key={r} className="muted">{r}</p>)}
        {l.nextExpiry && <p className="muted">{l.nextExpiry.text}</p>}
      </section>
      <ul className="list plain">
        {l.rewards?.map((r) => (
          <li key={r.id} className="reward">
            <div><b>{r.name}</b><small>{r.costText}. {r.whatYouGet}</small></div>
            {r.canRedeem
              ? <button type="button" className="btn btn-quiet" disabled={a.busy} onClick={() => void a.run(() => api.redeem(r.id)).then((x) => { if (x) { toast(x.message); load(); } })}>Redeem</button>
              : <span className="muted">{r.soldOut ? "Sold out" : `${r.needMore} more`}</span>}
          </li>
        ))}
      </ul>
      <Problem text={a.error} />
      {!!l.redemptions?.length && (
        <section aria-labelledby="redT">
          <h2 id="redT">Redeemed</h2>
          <ul className="list plain">{l.redemptions.map((r) => <li key={r.id} className="line"><span>{r.reward}<small>{r.statusLabel}</small></span>{r.code && <b className="code">{r.code}</b>}</li>)}</ul>
        </section>
      )}
    </div>
  );
}

export function Refer() {
  const { api, toast } = useStore();
  const [r, setR] = useState<Referral | null>(null);
  useEffect(() => void api.referral().then(setR), [api]);
  if (!r) return <div><SubHead title="Refer a friend" /><Loading /></div>;
  if (!r.enabled) return <div><SubHead title="Refer a friend" /><p className="empty">The studio isn't running referrals right now.</p></div>;
  const copy = async () => {
    try { await navigator.clipboard.writeText(r.link!); toast("Link copied."); } catch { toast("Select the link to copy it."); }
  };
  return (
    <div className="refer">
      <SubHead title="Refer a friend" />
      <ul className="steps">{r.howItWorks?.map((h) => <li key={h}>{h}</li>)}</ul>
      <section className="credit-card" aria-label="Your link">
        <p className="muted">Your code</p>
        <p className="credit-big">{r.code}</p>
        <p className="link-text">{r.link}</p>
        <button type="button" className="btn btn-quiet" onClick={() => void copy()}>Copy link</button>
      </section>
      {!!r.friends?.length && (
        <section aria-labelledby="friendsT">
          <h2 id="friendsT">Friends who joined</h2>
          <ul className="list plain">{r.friends.map((f) => <li key={f.name} className="line"><span>{f.name}</span><span className="muted">{f.statusLabel}</span></li>)}</ul>
        </section>
      )}
    </div>
  );
}

export function Health() {
  const { api, toast } = useStore();
  const [n, setN] = useState<{ active: HealthNote[]; resolved: HealthNote[] } | null>(null);
  const [text, setText] = useState("");
  const a = useAction();
  const load = () => void api.healthNotes().then(setN);
  useEffect(load, [api]);
  return (
    <div className="health">
      <SubHead title="Injuries and health notes" sub="Your instructor sees these on the class list, so they can suggest options. Only staff at the studio can see them." />
      <form className="panel" onSubmit={(e) => { e.preventDefault(); void a.run(() => api.addHealthNote(text)).then((r) => { if (r !== undefined) { toast("Added. Your instructor will see it."); setText(""); load(); } }); }}>
        <label className="field"><span>Add something</span><input value={text} onChange={(e) => setText(e.target.value)} placeholder="For example: sore left knee, 20 weeks pregnant" /></label>
        <Problem text={a.error} />
        <button className="btn btn-main" disabled={a.busy || text.trim().length < 3}>Add</button>
      </form>
      {!n ? <Loading /> : (
        <>
          <ul className="list plain">
            {n.active.map((h) => (
              <li key={h.id} className="note">
                <div><b>{h.description}</b>{h.categoryLabel && <small>{h.categoryLabel}</small>}{h.needsCheck && <small className="warn-text">Is this still the case?</small>}</div>
                <div className="note-act">
                  {h.needsCheck && <button type="button" className="btn btn-text" onClick={() => void api.stillCurrent(h.id).then(() => { toast("Thanks. Kept as it is."); load(); })}>Still the case</button>}
                  <button type="button" className="btn btn-quiet" onClick={() => void api.resolveHealthNote(h.id).then(() => { toast("Marked as better. Glad to hear it."); load(); })}>It's better</button>
                </div>
              </li>
            ))}
          </ul>
          {!n.active.length && <p className="muted">Nothing noted. Add anything your instructor should know.</p>}
          {n.resolved.length > 0 && <details className="resolved"><summary>Past notes ({n.resolved.length})</summary><ul className="list plain">{n.resolved.map((h) => <li key={h.id} className="line"><span>{h.description}</span><span className="muted">Better</span></li>)}</ul></details>}
        </>
      )}
    </div>
  );
}

export function WaiverPage() {
  const { api, toast } = useStore();
  const [w, setW] = useState<Waiver | null>(null);
  const [name, setName] = useState("");
  const [agree, setAgree] = useState(false);
  const a = useAction();
  const load = () => void api.waiver().then(setW);
  useEffect(load, [api]);
  if (!w) return <div><SubHead title="Waiver" /><Loading /></div>;
  return (
    <div className="waiver">
      <SubHead title="Waiver" sub={w.done ? `You signed it${w.signedAt ? ` on ${shortDate(w.signedAt.slice(0, 10))}` : ""}. Nothing more to do.` : "Please read and sign it before your first class. You only do this once."} />
      {w.text && <div className="waiver-text" tabIndex={0}>{w.text}</div>}
      {!w.done && (
        <form className="panel" onSubmit={(e) => { e.preventDefault(); void a.run(() => api.signWaiver(name)).then((r) => { if (r !== undefined) { toast("Signed. Thank you."); load(); } }); }}>
          <label className="check"><input type="checkbox" checked={agree} onChange={(e) => setAgree(e.target.checked)} required /> I've read it and agree</label>
          <label className="field"><span>Your full name</span><input value={name} onChange={(e) => setName(e.target.value)} autoComplete="name" required minLength={2} /></label>
          <Problem text={a.error} />
          <button className="btn btn-main" disabled={a.busy || !agree || name.trim().length < 2}>Sign</button>
        </form>
      )}
    </div>
  );
}

export function Receipts() {
  const { api } = useStore();
  const [list, setList] = useState<Purchase[] | null>(null);
  useEffect(() => void api.purchases().then(setList), [api]);
  return (
    <div className="receipts">
      <SubHead title="Purchases and receipts" sub="Every receipt is also emailed to you." />
      {!list ? <Loading /> : list.length ? (
        <ul className="list plain">{list.map((p) => <li key={p.id} className="line"><span>{p.description}<small>{shortDate(String(p.issuedAt).slice(0, 10))}, {p.receiptNumber ?? p.number}</small></span><span><b>{p.total}</b><small>{p.statusLabel}</small></span></li>)}</ul>
      ) : <p className="empty">Nothing bought yet.</p>}
    </div>
  );
}

export function Card() {
  const { api, toast } = useStore();
  const [c, setC] = useState<PaymentCard | null>(null);
  const a = useAction();
  useEffect(() => void api.paymentCard().then(setC), [api]);
  if (!c) return <div><SubHead title="Payment card" /><Loading /></div>;
  return (
    <div className="card-page">
      <SubHead title="Payment card" sub={c.note} />
      {c.card ? <p className="saved-card"><b>{c.card.brand} ending {c.card.last4}</b><small>Expires {c.card.expires}</small></p> : <p className="muted">No card saved. One is saved when you buy a membership.</p>}
      {c.canSave && <button type="button" className="btn btn-quiet" disabled={a.busy} onClick={() => void a.run(() => api.addCard()).then((r) => { if (r?.redirectUrl) location.href = r.redirectUrl; else if (r?.message) toast(r.message); })}>{c.card ? "Use a different card" : "Add a card"}</button>}
      <Problem text={a.error} />
    </div>
  );
}

export function NewsPrefs() {
  const { api, toast } = useStore();
  const [n, setN] = useState<Notifications | null>(null);
  useEffect(() => void api.notifications().then(setN), [api]);
  if (!n) return <div><SubHead title="News and offers" /><Loading /></div>;
  const set = (k: keyof Notifications) => async (on: boolean) => { setN(await api.setNotifications({ [k]: on })); toast(on ? "Turned on." : "Turned off."); };
  const rows: [keyof Notifications, string, string][] = [["marketingEmail", "Email", "News, new classes and offers"], ["marketingPush", "App notifications", "Offers and reminders on your phone"], ["marketingWhatsapp", "WhatsApp", "Messages from the studio"]];
  return (
    <div className="prefs">
      <SubHead title="News and offers" sub="Booking confirmations and changes to your classes always reach you. These are for everything else." />
      <ul className="list plain">
        {rows.map(([k, label, detail]) => (
          <li key={k} className="line">
            <label className="toggle-row" htmlFor={`t-${k}`}><span>{label}<small>{detail}</small></span></label>
            <input id={`t-${k}`} type="checkbox" role="switch" className="switch" checked={n[k]} onChange={(e) => void set(k)(e.target.checked)} />
          </li>
        ))}
      </ul>
    </div>
  );
}
