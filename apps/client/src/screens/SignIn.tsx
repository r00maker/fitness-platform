/** Sign in with an email code, in the studio's own look. */
import { useState } from "react";
import type { Backend, Studio } from "../data/types";

export function SignIn({ api, studio, onDone }: { api: Backend; studio: Studio; onDone(): void }) {
  const [email, setEmail] = useState("");
  const [code, setCode] = useState("");
  const [sent, setSent] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const r = await api.signIn!(email.trim(), sent ? code.trim() : undefined);
      if (r === "code_sent") setSent(true);
      else onDone();
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  }
  return (
    <main className="signin">
      <div className="signin-card">
        <span className="brand-mark" aria-hidden="true">{studio.name.slice(0, 1)}</span>
        <h1>{studio.name}</h1>
        {studio.theme.welcome && <p className="signin-welcome">{studio.theme.welcome}</p>}
        <form onSubmit={submit}>
          <label>
            <span>Email</span>
            <input type="email" autoComplete="email" required value={email} onChange={(e) => setEmail(e.target.value)} disabled={sent} />
          </label>
          {sent && (
            <label>
              <span>The 6-digit code we emailed you</span>
              <input inputMode="numeric" autoComplete="one-time-code" pattern="[0-9]{6}" required value={code} onChange={(e) => setCode(e.target.value)} autoFocus />
            </label>
          )}
          {error && <p className="form-error" role="alert">{error}</p>}
          <button className="btn btn-main" disabled={busy}>{busy ? "One moment…" : sent ? "Sign in" : "Email me a code"}</button>
        </form>
      </div>
    </main>
  );
}
