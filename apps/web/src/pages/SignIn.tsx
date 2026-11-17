import { useEffect, useState, type FormEvent } from "react";
import { Navigate, useParams, useSearchParams } from "react-router-dom";
import { auth } from "../lib/auth";
import { useStudio } from "../lib/session";
import { Notice, Shell } from "../components/ui";

/** Sign in with a 6-digit code sent by email (or Google / Apple). New people get an account. */
export function SignIn() {
  const { slug = "" } = useParams();
  const [params] = useSearchParams();
  const next = safeNext(params.get("next"), slug);
  const { studio, me, refresh } = useStudio();
  const [email, setEmail] = useState("");
  const [code, setCode] = useState("");
  const [sent, setSent] = useState(false);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  useEffect(() => { if (sent) document.getElementById("code")?.focus(); }, [sent]);
  if (me) return <Navigate to={me.member ? next : `/s/${slug}/join?next=${encodeURIComponent(next)}`} replace />;

  async function send(e: FormEvent) {
    e.preventDefault();
    if (!/^\S+@\S+\.\S+$/.test(email.trim())) return setErr("Enter your email address.");
    setBusy(true); setErr(null);
    try { await auth.sendCode(email.trim(), `${location.origin}/s/${slug}/sign-in?next=${encodeURIComponent(next)}`); setSent(true); } catch (x) { setErr((x as Error).message); } finally { setBusy(false); }
  }
  async function verify(e: FormEvent) {
    e.preventDefault();
    setBusy(true); setErr(null);
    try { await auth.verifyCode(email.trim(), code.trim()); await refresh(); } catch (x) { setErr((x as Error).message); } finally { setBusy(false); }
  }
  return (
    <Shell>
      <div className="narrow">
        <h1>Sign in{studio ? ` to ${studio.name}` : ""}</h1>
        <p className="muted">New here? Use your email and we'll set up your account.</p>
        {!sent ? (
          <form onSubmit={send} className="form" noValidate>
            <label className="field">Email<input type="email" autoComplete="email" inputMode="email" value={email} onChange={(e) => setEmail(e.target.value)} aria-invalid={!!err} aria-describedby={err ? "siErr" : undefined} /></label>
            <button className="btn big" disabled={busy}>{busy ? "Sending…" : "Send me a code"}</button>
          </form>
        ) : (
          <form onSubmit={verify} className="form" noValidate>
            <p>We've emailed <b>{email}</b>. Tap the link in the email, or enter the 6-digit code. {auth.kind === "dev" && <span className="muted">(Locally, the code is 000000.)</span>}</p>
            <label className="field">Code<input id="code" inputMode="numeric" autoComplete="one-time-code" maxLength={6} value={code} onChange={(e) => setCode(e.target.value.replace(/\D/g, ""))} aria-invalid={!!err} aria-describedby={err ? "siErr" : undefined} /></label>
            <button className="btn big" disabled={busy || code.length !== 6}>{busy ? "Checking…" : "Continue"}</button>
            <button type="button" className="link" onClick={() => { setSent(false); setCode(""); }}>Use a different email</button>
          </form>
        )}
        {err && <div id="siErr"><Notice kind="error">{err}</Notice></div>}
        <div className="or"><span>or</span></div>
        <div className="social">
          <button type="button" className="btn ghost big" onClick={() => auth.social("google", `${location.origin}/s/${slug}/sign-in?next=${encodeURIComponent(next)}`).catch((x) => setErr((x as Error).message))}>Continue with Google</button>
          <button type="button" className="btn ghost big" onClick={() => auth.social("apple", `${location.origin}/s/${slug}/sign-in?next=${encodeURIComponent(next)}`).catch((x) => setErr((x as Error).message))}>Continue with Apple</button>
        </div>
      </div>
    </Shell>
  );
}

/** Only follow links back into this studio's pages. */
export function safeNext(n: string | null, slug: string) {
  return n && n.startsWith(`/s/${slug}`) && !n.startsWith("//") ? n : `/s/${slug}`;
}
