import { useState, type FormEvent } from "react";
import { Navigate, useParams, useSearchParams } from "react-router-dom";
import { api, ApiError } from "../lib/api";
import { useStudio } from "../lib/session";
import { Notice, Shell, Spinner } from "../components/ui";
import { safeNext } from "./SignIn";

/** Signed in but not with this studio yet: a few details, and their choices about messages. */
export function Join() {
  const { slug = "" } = useParams();
  const [params] = useSearchParams();
  const next = safeNext(params.get("next"), slug);
  const { studio, me, refresh, loading } = useStudio();
  const [f, setF] = useState({ firstName: "", lastName: "", phone: "", referralCode: params.get("ref") ?? "", marketingEmail: false, marketingWhatsapp: false });
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<ApiError | null>(null);
  if (loading && !me) return <Shell><Spinner /></Shell>;
  if (!me) return <Navigate to={`/s/${slug}/sign-in?next=${encodeURIComponent(next)}`} replace />;
  if (me.member) return <Navigate to={next} replace />;

  async function join(e: FormEvent) {
    e.preventDefault();
    setBusy(true); setErr(null);
    try {
      const attribution = Object.fromEntries([...params.entries()].filter(([k]) => /^(utm_[a-z]+|gclid|fbclid)$/.test(k)));
      await api("POST", "/join", { ...(me!.hasAccount ? {} : { firstName: f.firstName.trim(), lastName: f.lastName.trim() }), phone: f.phone.trim() || null, referralCode: f.referralCode.trim() || null, marketingEmail: f.marketingEmail, marketingPush: false, marketingWhatsapp: f.marketingWhatsapp, ...(Object.keys(attribution).length ? { attribution } : {}) });
      await refresh();
    } catch (x) { setErr(x as ApiError); } finally { setBusy(false); }
  }
  const fieldErr = (k: string) => (err?.details.fields as Record<string, string> | undefined)?.[k];
  return (
    <Shell>
      <div className="narrow">
        <h1>{me.hasAccount ? `Join ${studio?.name ?? "the studio"}` : "A few details"}</h1>
        <p className="muted">{me.hasAccount ? `Welcome back${me.firstName ? `, ${me.firstName}` : ""}. You'll use the same account here.` : `So ${studio?.name ?? "the studio"} knows who's coming.`}</p>
        <form onSubmit={join} className="form" noValidate>
          {!me.hasAccount && (
            <div className="two">
              <label className="field">First name<input autoComplete="given-name" value={f.firstName} onChange={(e) => setF({ ...f, firstName: e.target.value })} required aria-invalid={!!fieldErr("firstName")} /></label>
              <label className="field">Last name<input autoComplete="family-name" value={f.lastName} onChange={(e) => setF({ ...f, lastName: e.target.value })} required aria-invalid={!!fieldErr("lastName")} /></label>
            </div>
          )}
          <label className="field">Mobile <span className="muted">(optional, for class reminders)</span><input type="tel" autoComplete="tel" value={f.phone} onChange={(e) => setF({ ...f, phone: e.target.value })} /></label>
          <label className="field">Referral code <span className="muted">(optional)</span><input value={f.referralCode} onChange={(e) => setF({ ...f, referralCode: e.target.value.toUpperCase() })} /></label>
          <fieldset className="choices"><legend>News and offers from {studio?.name ?? "the studio"}</legend>
            <label className="check"><input type="checkbox" checked={f.marketingEmail} onChange={(e) => setF({ ...f, marketingEmail: e.target.checked })} /> By email</label>
            <label className="check"><input type="checkbox" checked={f.marketingWhatsapp} onChange={(e) => setF({ ...f, marketingWhatsapp: e.target.checked })} /> By WhatsApp</label>
            <small className="muted">Booking confirmations and reminders come either way. You can change this any time.</small>
          </fieldset>
          <button className="btn big" disabled={busy}>{busy ? "Joining…" : "Continue"}</button>
        </form>
        {err && <Notice kind="error">{err.message}</Notice>}
      </div>
    </Shell>
  );
}
