/**
 * Packages: buy one (the list, then a checkout screen with the price, credit and how to pay),
 * and manage one (classes left, dates and how they work, its history, asking for more time,
 * sharing it, and stopping or restarting a membership).
 */
import { useEffect, useState } from "react";
import { PayChoice, Problem, SubHead, useAction, Loading } from "../../components/ui";
import type { ExtensionPolicy, PackageDetail, Placed, Plan, Quote, StopOptions } from "../../data/types";
import { plural, shortDate } from "../../lib/format";
import { useStore } from "../../store";

/** After an order: done, off to the payment page, or pay at the desk. */
export function usePlaced() {
  const { toast, refresh, go } = useStore();
  return async (r: Placed | undefined, then: string) => {
    if (!r) return;
    if (r.redirectUrl) { location.href = r.redirectUrl; return; }
    toast(r.message);
    await refresh();
    go(then);
  };
}

export function Buy() {
  const { api, go } = useStore();
  const [plans, setPlans] = useState<Plan[] | null>(null);
  useEffect(() => void api.plans().then(setPlans), [api]);
  const packs = plans?.filter((p) => p.billing === "one_time") ?? [];
  const members = plans?.filter((p) => p.billing === "recurring") ?? [];
  return (
    <div className="buy">
      <SubHead title="Buy a package" />
      {!plans && <Loading />}
      {[["Class packs", packs], ["Memberships", members]].map(([title, list]) =>
        (list as Plan[]).length ? (
          <section key={title as string} aria-label={title as string}>
            <h2>{title as string}</h2>
            <ul className="plans">
              {(list as Plan[]).map((p) => (
                <li key={p.id}>
                  <button type="button" className="plan" onClick={() => go(`me/buy/${p.id}`)}>
                    <span className="plan-top"><span className="plan-name">{p.name}</span><span className="plan-price">{p.price}{p.billing === "recurring" ? <small> a month</small> : null}</span></span>
                    {p.description && <span className="plan-desc">{p.description}</span>}
                    <span className="plan-terms">{p.terms.slice(0, 3).join(". ")}.</span>
                  </button>
                </li>
              ))}
            </ul>
          </section>
        ) : null,
      )}
    </div>
  );
}

export function Checkout({ planId }: { planId: string }) {
  const { api } = useStore();
  const [useCredit, setUseCredit] = useState(true);
  const [q, setQ] = useState<Quote | null>(null);
  const [payWith, setPayWith] = useState<string | undefined>();
  const a = useAction();
  const placed = usePlaced();
  useEffect(() => {
    void api.quote(planId, useCredit).then((x) => { setQ(x); setPayWith((p) => p ?? x.payments.options[0]?.payWith); }, (e: Error) => a.setError(e.message));
  }, [api, planId, useCredit]);
  if (!q) return <div><SubHead title="Checkout" /><Loading /><Problem text={a.error} /></div>;
  const deskOnly = q.payments.options.length === 1 && q.payments.options[0]!.payWith === "desk";
  return (
    <div className="checkout">
      <SubHead title={q.package.name} sub={q.package.terms.join(". ") + "."} />
      <section className="bill" aria-label="What you'll pay">
        {q.lines.map((l) => <p key={l.label} className="bill-line"><span>{l.label}</span><span>{l.amount}</span></p>)}
        <p className="bill-total"><span>Total</span><span>{q.total}</span></p>
        {q.studioCredit.balanceCents > 0 && (
          <label className="check"><input type="checkbox" checked={useCredit} onChange={(e) => setUseCredit(e.target.checked)} /> Use my studio credit ({q.studioCredit.balance})</label>
        )}
        {q.recurringNote && <p className="muted">{q.recurringNote}</p>}
        {q.startsNote && <p className="muted">{q.startsNote}</p>}
      </section>
      {q.totalCents > 0 && <PayChoice options={q.payments.options} value={payWith} onChange={setPayWith} />}
      {q.payments.message && <p className="muted">{q.payments.message}</p>}
      <Problem text={a.error} />
      <button type="button" className="btn btn-main btn-wide" disabled={a.busy} onClick={() => void a.run(() => api.checkout(planId, { payWith, useCredit })).then((r) => placed(r, "me"))}>
        {a.busy ? "One moment…" : q.totalCents === 0 ? "Get it" : payWith === "desk" || deskOnly ? `Order and pay at the studio` : `Pay ${q.total}`}
      </button>
    </div>
  );
}

export function PackagePage({ id }: { id: string }) {
  const { api, refresh, toast } = useStore();
  const [p, setP] = useState<PackageDetail | null>(null);
  const [policy, setPolicy] = useState<ExtensionPolicy | null>(null);
  const [open, setOpen] = useState<"extend" | "share" | "stop" | null>(null);
  const load = () => void api.packageDetail(id).then(setP);
  useEffect(load, [api, id]);
  useEffect(() => void api.extensionPolicy().then(setPolicy).catch(() => null), [api]);
  if (!p) return <div><SubHead title="Package" /><Loading /></div>;
  const recurring = p.billing === "recurring";
  const frac = p.kind === "credits" && p.creditsTotal ? (p.creditsLeft ?? 0) / p.creditsTotal : null;
  const done = async (message: string) => { toast(message); setOpen(null); load(); await refresh(); };

  return (
    <div className="pkg-page">
      <SubHead title={p.name} sub={p.terms.join(". ") + "."} />
      <section className="pkg-hero" aria-label="Classes left">
        <p className="pkg-big">{p.kind === "credits" ? <><b>{p.creditsLeft}</b> of {p.creditsTotal} classes left</> : <b>Unlimited</b>}</p>
        {frac !== null && <span className="pkg-bar" style={{ "--p": frac } as React.CSSProperties} aria-hidden="true" />}
        <p className="pkg-dates">{p.renewal?.renewsOn ? `Renews ${shortDate(p.renewal.renewsOn)}` : p.renewal?.endsOn ? `Ends ${shortDate(p.renewal.endsOn)}` : p.validUntil ? `Valid until ${shortDate(p.validUntil)}` : p.state === "not_started" ? "Not started yet" : "Never expires"}</p>
        {p.startNote && <p className="pkg-note">{p.startNote}</p>}
        {p.renewal?.bookedAhead.map((a) => <p key={a.period} className="pkg-note is-ahead">{a.note}.</p>)}
      </section>

      <div className="actions">
        {policy?.allowed && !recurring && p.validUntil && <button type="button" className="btn btn-quiet" aria-expanded={open === "extend"} onClick={() => setOpen(open === "extend" ? null : "extend")}>Ask for more time</button>}
        {p.sharing.maxUsers > 1 && <button type="button" className="btn btn-quiet" aria-expanded={open === "share"} onClick={() => setOpen(open === "share" ? null : "share")}>Share it</button>}
        {recurring && (p.renewal?.endsOn
          ? <button type="button" className="btn btn-quiet" onClick={() => void api.resumeRenewing(p.id).then(() => done("Your membership will carry on renewing."))}>Keep it renewing</button>
          : <button type="button" className="btn btn-quiet" aria-expanded={open === "stop"} onClick={() => setOpen(open === "stop" ? null : "stop")}>Stop renewing</button>)}
      </div>
      {open === "extend" && policy && <Extend id={p.id} policy={policy} onDone={done} />}
      {open === "share" && <Share p={p} onDone={done} />}
      {open === "stop" && <Stop id={p.id} onDone={done} />}

      {p.extensionRequests.length > 0 && (
        <section aria-labelledby="extT">
          <h2 id="extT">Requests for more time</h2>
          <ul className="list plain">{p.extensionRequests.map((r) => <li key={r.id} className="line"><span>{plural(r.days, "day")}: {r.reason}</span><span className="tag">{r.statusLabel}</span></li>)}</ul>
        </section>
      )}
      {p.sharing.members.length > 1 && (
        <section aria-labelledby="whoT">
          <h2 id="whoT">Shared with</h2>
          <ul className="list plain">
            {p.sharing.members.filter((m) => !m.isOwner).map((m) => (
              <li key={m.userId} className="line"><span>{m.name}</span><button type="button" className="btn btn-text" onClick={() => void api.unshare(p.id, m.userId).then(() => done(`${m.name} no longer shares it.`))}>Remove</button></li>
            ))}
          </ul>
        </section>
      )}
      <section aria-labelledby="histT">
        <h2 id="histT">Classes with it</h2>
        {p.classes.length ? (
          <ul className="list plain">{p.classes.map((c) => <li key={c.bookingId} className="line"><span>{shortDate(c.date)}, {c.className}<small>{c.status}</small></span><span className="muted">{c.credit}</span></li>)}</ul>
        ) : <p className="muted">No classes yet.</p>}
      </section>
    </div>
  );
}

function Extend({ id, policy, onDone }: { id: string; policy: ExtensionPolicy; onDone(m: string): void }) {
  const { api } = useStore();
  const [days, setDays] = useState(7);
  const [reason, setReason] = useState("");
  const a = useAction();
  return (
    <form className="panel" onSubmit={(e) => { e.preventDefault(); void a.run(() => api.requestExtension(id, days, reason)).then((r) => r && onDone(r.message)); }}>
      <p className="muted">{policy.summary}{policy.fee ? ` Fee: ${policy.fee}.` : ""}</p>
      <label className="field"><span>How many days?</span><input type="number" min={1} max={policy.maxDays} value={days} onChange={(e) => setDays(Number(e.target.value))} required /></label>
      <label className="field"><span>Why?</span><textarea rows={3} value={reason} onChange={(e) => setReason(e.target.value)} placeholder="For example: knee injury, physio says 3 weeks off" required minLength={3} /></label>
      <Problem text={a.error} />
      <button className="btn btn-main" disabled={a.busy}>{a.busy ? "Sending…" : "Send request"}</button>
    </form>
  );
}

function Share({ p, onDone }: { p: PackageDetail; onDone(m: string): void }) {
  const { api } = useStore();
  const [email, setEmail] = useState("");
  const a = useAction();
  if (p.sharing.spacesLeft <= 0) return <p className="panel muted">It's shared with as many people as it allows.</p>;
  return (
    <form className="panel" onSubmit={(e) => { e.preventDefault(); void a.run(() => api.share(p.id, email.trim())).then((r) => r !== undefined && onDone(`Shared with ${email.trim()}.`)); }}>
      <p className="muted">They can book with it from their own account. They need an account with the studio. {plural(p.sharing.spacesLeft, "more person", "more people")} can share it.</p>
      <label className="field"><span>Their email</span><input type="email" value={email} onChange={(e) => setEmail(e.target.value)} required /></label>
      <Problem text={a.error} />
      <button className="btn btn-main" disabled={a.busy}>{a.busy ? "Adding…" : "Share it"}</button>
    </form>
  );
}

function Stop({ id, onDone }: { id: string; onDone(m: string): void }) {
  const { api } = useStore();
  const [o, setO] = useState<StopOptions | null>(null);
  const a = useAction();
  useEffect(() => void api.stopOptions(id).then(setO), [api, id]);
  if (!o) return <Loading />;
  const ahead = o.bookedAheadAfterEnd?.atEndOfTerm ?? 0;
  return (
    <div className="panel">
      <p>It keeps working until <b>{shortDate(o.stopAtEndOfTerm.endsOn)}</b>{o.inMinimumTerm && o.minimumTermEndsOn ? `, the end of your minimum term` : ", the end of this period"}, then stops. Nothing more is charged.</p>
      {ahead > 0 && <p className="confirm-note is-warn">{plural(ahead, "class")} you've booked after that will be cancelled.</p>}
      <Problem text={a.error} />
      <div className="confirm-btns">
        <button type="button" className="btn btn-danger" disabled={a.busy} onClick={() => void a.run(() => api.stopRenewing(id, false)).then((r) => r && onDone(`Stopped. It ends on ${shortDate(r.endsOn)}.`))}>Stop renewing</button>
        {o.endEarly?.allowed && <button type="button" className="btn btn-text" onClick={() => void a.run(() => api.stopRenewing(id, true)).then((r) => r && onDone(`It ends on ${shortDate(r.endsOn)}${r.fee ? `, with a ${r.fee} fee` : ""}.`))}>End sooner{o.endEarly.fee ? ` (${o.endEarly.fee} fee)` : ""}</button>}
      </div>
    </div>
  );
}
