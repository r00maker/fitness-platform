import { useEffect, useState } from "react";
import { Link, Navigate, useParams, useSearchParams } from "react-router-dom";
import { api, ApiError } from "../lib/api";
import { useStudio } from "../lib/session";
import { Notice, Shell, Spinner } from "../components/ui";
import { safeNext } from "./SignIn";

interface Quote {
  package: { id: string; name: string; description: string | null; billing: string; terms: string[] };
  lines: { label: string; amount: string }[];
  total: string; totalCents: number;
  studioCredit: { balanceCents: number; balance: string };
  recurringNote: string | null; startsNote: string | null;
  payments: { online: boolean; message: string | null; options: { payWith: string; label: string; fee: string | null; total: string; note?: string }[] };
}

export function Buy() {
  const { slug = "", planId = "" } = useParams();
  const [params] = useSearchParams();
  const after = safeNext(params.get("next"), slug);
  const here = `/s/${slug}/packages/${planId}${params.get("next") ? `?next=${encodeURIComponent(after)}` : ""}`;
  const { me, loading } = useStudio();
  const [q, setQ] = useState<Quote | null>(null);
  const [useCredit, setUseCredit] = useState(true);
  const [payWith, setPayWith] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [placed, setPlaced] = useState<string | null>(null);

  useEffect(() => {
    if (!me?.member) return;
    api<Quote>("GET", `/checkout/quote?planId=${planId}&useCredit=${useCredit}`).then((r) => { setQ(r); setPayWith((p) => p ?? r.payments.options[0]?.payWith ?? null); }).catch((e) => setErr((e as Error).message));
  }, [me, planId, useCredit]);

  if (loading && !me) return <Shell><Spinner /></Shell>;
  if (!me) return <Navigate to={`/s/${slug}/sign-in?next=${encodeURIComponent(here)}`} replace />;
  if (!me.member) return <Navigate to={`/s/${slug}/join?next=${encodeURIComponent(here)}`} replace />;

  async function buy() {
    setBusy(true); setErr(null);
    try {
      const r = await api<{ order: { status: string }; payment: { online: boolean; redirectUrl?: string; message?: string } }>("POST", "/checkout", { planId, useCredit, ...(payWith ? { payWith } : {}) });
      if (r.payment.online && r.payment.redirectUrl) { location.assign(r.payment.redirectUrl); return; }
      setPlaced(r.payment.message ?? "Order placed.");
    } catch (e) { setErr((e as ApiError).message); } finally { setBusy(false); }
  }

  return (
    <Shell>
      <p><Link to={`/s/${slug}/packages`} className="back">← Packages</Link></p>
      {err && <Notice kind="error">{err}</Notice>}
      {!q ? !err && <Spinner /> : placed ? (
        <div className="narrow">
          <Notice kind="ok" title={q.totalCents === 0 ? "All done" : "Order placed"}>{placed}</Notice>
          <p><Link className="btn" to={after === `/s/${slug}` ? `/s/${slug}/me/packages` : after}>{after === `/s/${slug}` ? "My packages" : "Back to the class"}</Link></p>
        </div>
      ) : (
        <div className="checkout">
          <section>
            <h1>{q.package.name}</h1>
            {q.package.description && <p>{q.package.description}</p>}
            <ul className="terms">{q.package.terms.map((t) => <li key={t}>{t}</li>)}</ul>
            {q.startsNote && <p className="muted">{q.startsNote}</p>}
          </section>
          <section className="sum" aria-label="Summary">
            {q.lines.map((l) => <div key={l.label} className="line"><span>{l.label}</span><span>{l.amount}</span></div>)}
            {q.studioCredit.balanceCents > 0 && <label className="check"><input type="checkbox" checked={useCredit} onChange={(e) => setUseCredit(e.target.checked)} /> Use my studio credit ({q.studioCredit.balance})</label>}
            <div className="line total"><span>Total</span><span>{q.payments.options.find((o) => o.payWith === payWith)?.total ?? q.total}</span></div>
            {q.recurringNote && <p className="muted small">{q.recurringNote}</p>}
            {q.payments.options.length > 0 && (
              <fieldset className="payopts"><legend>Pay with</legend>
                {q.payments.options.map((o) => (
                  <label key={o.payWith} className={`payopt ${payWith === o.payWith ? "on" : ""}`}>
                    <input type="radio" name="payWith" value={o.payWith} checked={payWith === o.payWith} onChange={() => setPayWith(o.payWith)} />
                    <span><b>{o.label}</b><small>{o.fee ?? o.note ?? (o.payWith === "desk" ? "Order now, pay at the front desk" : "")}</small></span>
                    <em>{o.total}</em>
                  </label>
                ))}
              </fieldset>
            )}
            {q.payments.message && <p className="muted small">{q.payments.message}</p>}
            <button type="button" className="btn big" disabled={busy || (q.totalCents > 0 && !q.payments.options.length)} onClick={() => void buy()}>
              {busy ? "One moment…" : q.totalCents === 0 ? "Complete purchase" : payWith && payWith !== "desk" ? `Continue to payment · ${q.payments.options.find((o) => o.payWith === payWith)?.total}` : `Place order · ${q.total}`}
            </button>
            {payWith && payWith !== "desk" && <small className="muted">You'll pay on Stripe's secure page. The studio never sees your card number.</small>}
          </section>
        </div>
      )}
    </Shell>
  );
}
