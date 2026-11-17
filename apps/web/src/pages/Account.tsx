import { useCallback, useEffect, useState } from "react";
import { Link, Navigate, useParams } from "react-router-dom";
import { api, ApiError } from "../lib/api";
import { dayOf, timeOf } from "../lib/format";
import { useStudio } from "../lib/session";
import { ConfirmFlags, Notice, Shell, Spinner } from "../components/ui";

type Tab = "bookings" | "packages" | "payment";
interface Booking { booking: { id: string }; session: { id: string; startsAt: string; endsAt: string }; classType: { name: string; color: string } }
interface ClientPkg { id: string; name: string; stateLabel: string; state: string; creditsLeft: number | null; yourCreditsLeft?: number | null; kind: string; validUntil: string | null; paymentHold: string | null; terms: string[]; renewal?: { renewsOn: string | null; endsOn: string | null; stopped: boolean } }

export function Account({ tab }: { tab: Tab }) {
  const { slug = "" } = useParams();
  const { me, studio, loading, signOut } = useStudio();
  if (loading && !me) return <Shell><Spinner /></Shell>;
  if (!me) return <Navigate to={`/s/${slug}/sign-in?next=${encodeURIComponent(`/s/${slug}/me`)}`} replace />;
  if (!me.member) return <Navigate to={`/s/${slug}/join?next=${encodeURIComponent(`/s/${slug}/me`)}`} replace />;
  return (
    <Shell>
      <div className="acct-head"><h1>Hi{me.firstName ? `, ${me.firstName}` : ""}</h1><button type="button" className="link" onClick={() => void signOut()}>Sign out</button></div>
      <div className="tabs" role="tablist" aria-label="My account">
        <Link role="tab" aria-selected={tab === "bookings"} to={`/s/${slug}/me`}>My bookings</Link>
        <Link role="tab" aria-selected={tab === "packages"} to={`/s/${slug}/me/packages`}>My packages</Link>
        <Link role="tab" aria-selected={tab === "payment"} to={`/s/${slug}/me/payment`}>Payment method</Link>
      </div>
      {tab === "bookings" ? <Bookings tz={studio?.timezone ?? "Asia/Singapore"} /> : tab === "packages" ? <Packages /> : <PaymentMethod />}
    </Shell>
  );
}

function Bookings({ tz }: { tz: string }) {
  const { slug = "" } = useParams();
  const [list, setList] = useState<Booking[] | null>(null);
  const [ask, setAsk] = useState<{ id: string; error: ApiError } | null>(null);
  const [msg, setMsg] = useState<{ kind: "ok" | "error"; text: string } | null>(null);
  const load = useCallback(() => api<{ classes?: Booking[]; appointments?: Booking[] }>("GET", "/me/bookings").then((r) => setList([...(r.classes ?? []), ...(r.appointments ?? [])].sort((a, b) => a.session.startsAt.localeCompare(b.session.startsAt)))), []);
  useEffect(() => { void load(); }, [load]);
  async function cancel(id: string, acknowledge: string[] = []) {
    setMsg(null);
    try {
      const r = await api<{ lateCancel: boolean; classReturnedToPackage: boolean }>("POST", `/bookings/${id}/cancel`, { acknowledge });
      setAsk(null);
      setMsg({ kind: "ok", text: r.lateCancel ? "Cancelled. It was a late cancellation, so the class isn't given back." : r.classReturnedToPackage ? "Cancelled, and the class is back in your package." : "Cancelled." });
      void load();
    } catch (e) {
      const ae = e as ApiError;
      if (ae.needsConfirmation) setAsk({ id, error: ae });
      else setMsg({ kind: "error", text: ae.message });
    }
  }
  if (!list) return <Spinner />;
  return (
    <>
      {msg && <Notice kind={msg.kind}>{msg.text}</Notice>}
      {!list.length ? <p className="empty">Nothing booked. <Link to={`/s/${slug}`}>Book a class</Link></p> : (
        <ul className="list">
          {list.map((b) => (
            <li key={b.booking.id} className="row static">
              <span className="t">{timeOf(b.session.startsAt, tz)}<small>{dayOf(b.session.startsAt, tz)}</small></span>
              <span className="n"><b><i style={{ background: b.classType.color }} />{b.classType.name}</b></span>
              <button type="button" className="btn ghost small" onClick={() => void cancel(b.booking.id)} aria-label={`Cancel ${b.classType.name} on ${dayOf(b.session.startsAt, tz)}`}>Cancel</button>
            </li>
          ))}
        </ul>
      )}
      {ask && <ConfirmFlags error={ask.error} onCancel={() => setAsk(null)} onProceed={(codes) => void cancel(ask.id, codes)} proceedLabel="Cancel the booking" />}
    </>
  );
}

function Packages() {
  const { slug = "" } = useParams();
  const [list, setList] = useState<ClientPkg[] | null>(null);
  useEffect(() => { api<{ packages: ClientPkg[] }>("GET", "/me/packages").then((r) => setList(r.packages)); }, []);
  if (!list) return <Spinner />;
  const now = list.filter((p) => ["active", "not_started"].includes(p.state));
  const old = list.filter((p) => !["active", "not_started"].includes(p.state));
  if (!list.length) return <p className="empty">No packages yet. <Link to={`/s/${slug}/packages`}>See what's on sale</Link></p>;
  const card = (p: ClientPkg) => (
    <article key={p.id} className={`pack mine ${p.state}`}>
      <div className="packtop"><h2>{p.name}</h2><span className="tag">{p.stateLabel}</span></div>
      {p.paymentHold && <Notice kind="warn">{p.paymentHold}. <Link to={`/s/${slug}/me/payment`}>Update your card</Link></Notice>}
      {p.kind === "credits" && <p className="big">{p.yourCreditsLeft ?? p.creditsLeft} <small>classes left</small></p>}
      <p className="muted small">{p.renewal?.renewsOn ? `Renews ${p.renewal.renewsOn}` : p.renewal?.endsOn ? `Ends ${p.renewal.endsOn}` : p.validUntil ? `Valid until ${p.validUntil}` : ""}</p>
      <ul>{p.terms.slice(0, 4).map((t) => <li key={t}>{t}</li>)}</ul>
    </article>
  );
  return (
    <>
      <div className="packs">{now.map(card)}</div>
      {old.length > 0 && <><h2 className="sub">Finished</h2><div className="packs">{old.map(card)}</div></>}
    </>
  );
}

function PaymentMethod() {
  const [v, setV] = useState<{ card: { brand: string; last4: string; expires: string } | null; canSave: boolean; note: string } | null>(null);
  const [msg, setMsg] = useState<{ kind: "ok" | "error" | "warn"; text: string } | null>(null);
  const [busy, setBusy] = useState(false);
  const load = useCallback(() => api<typeof v>("GET", "/me/payment-card").then(setV), []);
  useEffect(() => { void load(); }, [load]);
  if (!v) return <Spinner />;
  if (!v.canSave && !v.card) return <Notice title="Online payments aren't on yet">This studio isn't taking card payments online yet, so you pay at the front desk. Once it is, you can add a card here for your membership.</Notice>;
  async function save() {
    setBusy(true);
    try { location.assign((await api<{ redirectUrl: string }>("POST", "/me/payment-card")).redirectUrl); } catch (e) { setMsg({ kind: "error", text: (e as Error).message }); setBusy(false); }
  }
  async function remove() {
    setMsg(null);
    try { await api("DELETE", "/me/payment-card", {}); setMsg({ kind: "ok", text: "Card removed." }); void load(); } catch (e) { setMsg({ kind: (e as ApiError).code === "card_needed" ? "warn" : "error", text: (e as Error).message }); }
  }
  return (
    <div className="narrow">
      {v.card ? (
        <div className="cardbox"><span className="brand">{v.card.brand}</span><b>•••• {v.card.last4}</b><span className="muted">Expires {v.card.expires}</span></div>
      ) : (
        <div className="cardbox empty"><b>No card saved</b><span className="muted">Add a card for a membership's renewals. Nothing is charged until a renewal is due.</span></div>
      )}
      <p className="muted small">{v.note}</p>
      <div className="row-actions">
        <button type="button" className="btn" disabled={busy || !v.canSave} onClick={() => void save()}>{v.card ? "Replace card" : "Add a card"}</button>
        {v.card && <button type="button" className="btn ghost" onClick={() => void remove()}>Remove card</button>}
      </div>
      {msg && <Notice kind={msg.kind}>{msg.text}</Notice>}
    </div>
  );
}
