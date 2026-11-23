/**
 * A package's own screen: classes left, dates and how they work, its history, asking for more
 * time (with a document, like a doctor's note, when the studio asks for one), sharing it, and
 * stopping or restarting a membership. Buying is in the Shop tab.
 */
import { useEffect, useState } from "react";
import { Problem, SubHead, useAction, Loading } from "../../components/ui";
import type { ExtensionPolicy, PackageDetail, StopOptions } from "../../data/types";
import { plural, shortDate } from "../../lib/format";
import { useStore } from "../../store";

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
  const [file, setFile] = useState<File | null>(null);
  const a = useAction();
  const need = policy.attachment === "required";
  async function send() {
    // The document goes up first, then the request points to it.
    const att = file ? (await api.uploadAttachment(file)).id : undefined;
    return api.requestExtension(id, days, reason, att);
  }
  return (
    <form className="panel" onSubmit={(e) => { e.preventDefault(); if (need && !file) { a.setError("The studio needs a document with this, like a doctor's note."); return; } void a.run(send).then((r) => r && onDone(r.message)); }}>
      <p className="muted">{policy.summary}{policy.fee ? ` Fee: ${policy.fee}.` : ""}</p>
      <label className="field"><span>How many days?</span><input type="number" inputMode="numeric" min={1} max={policy.maxDays} value={days} onChange={(e) => setDays(Number(e.target.value))} required /></label>
      <label className="field"><span>Why?</span><textarea rows={3} value={reason} onChange={(e) => setReason(e.target.value)} placeholder="For example: knee injury, physio says 3 weeks off" required minLength={3} /></label>
      {policy.attachment !== "off" && (
        <label className="field file-field">
          <span>{need ? "A document (needed)" : "A document (optional)"}<small className="muted">A photo or PDF, like a doctor's note. Only the studio's admins see it.</small></span>
          <input type="file" accept="image/jpeg,image/png,image/webp,application/pdf" onChange={(e) => setFile(e.target.files?.[0] ?? null)} />
          {file && <small>{file.name} ({Math.max(1, Math.round(file.size / 1024))} KB)</small>}
        </label>
      )}
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
