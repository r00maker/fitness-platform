import { useCallback, useEffect, useRef, useState } from "react";
import { Link, useNavigate, useParams, useSearchParams } from "react-router-dom";
import { api, ApiError, pub } from "../lib/api";
import { useStudio } from "../lib/session";
import { ConfirmFlags, Dialog, Notice, Shell, Spinner } from "../components/ui";
import { NotFoundStudio } from "./StudioHome";

interface PublicClass {
  id: string; name: string; description: string | null; color: string; date: string; time: string;
  location: { name: string; address: string | null }; room: string | null; instructor: { name: string | null } | null;
  spotsLeft: number; isFull: boolean; waitlist: boolean; bookingWindow: "open" | "not_open_yet" | "closed"; bookingOpensAt: string;
  toBook: { needPackage: boolean; text: string; packages: { id: string; name: string; price: string; terms: string[] }[] };
  cancelling: string;
}
type Step = { kind: "idle" } | { kind: "busy" } | { kind: "confirm"; error: ApiError } | { kind: "waiver"; text: string } | { kind: "needPackage"; message: string } | { kind: "done"; message: string } | { kind: "error"; message: string };

export function ClassPage() {
  const { slug = "", id = "" } = useParams();
  const [params, setParams] = useSearchParams();
  const nav = useNavigate();
  const { studio, me, error: studioError } = useStudio();
  const [c, setC] = useState<PublicClass | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [booked, setBooked] = useState(false);
  const [step, setStep] = useState<Step>({ kind: "idle" });
  const [acks, setAcks] = useState<string[]>([]);
  const here = `/s/${slug}/classes/${id}`;

  const load = useCallback(() => pub<PublicClass>(`/studios/${slug}/classes/${id}`).then(setC).catch((e) => setErr((e as ApiError).status === 404 ? "This class isn't available any more. It may have started, finished or been cancelled." : (e as Error).message)), [slug, id]);
  useEffect(() => { void load(); }, [load]);
  // Already booked into it?
  useEffect(() => {
    if (!me?.member) return;
    api<{ classes?: { session: { id: string } }[] }>("GET", "/me/bookings?show=classes").then((r) => setBooked(!!r.classes?.some((b) => b.session.id === id))).catch(() => {});
  }, [me, id]);

  const book = useCallback(async (extra: { acknowledge?: string[] } = {}) => {
    if (!me) return nav(`/s/${slug}/sign-in?next=${encodeURIComponent(`${here}?book=1`)}`);
    if (!me.member) return nav(`/s/${slug}/join?next=${encodeURIComponent(`${here}?book=1`)}`);
    const acknowledge = extra.acknowledge ?? acks;
    setStep({ kind: "busy" });
    const waitlist = c?.isFull && c.waitlist;
    try {
      if (waitlist) {
        await api("POST", "/waitlist", { sessionId: id, acknowledge });
        setStep({ kind: "done", message: "You're on the waitlist. We'll let you know as soon as a spot opens." });
      } else {
        const r = await api<{ packageName: string | null }>("POST", "/bookings", { sessionId: id, acknowledge });
        setBooked(true);
        setStep({ kind: "done", message: `You're booked${r.packageName ? `, using your ${r.packageName}` : ""}. We've emailed you the details.` });
        void load();
      }
    } catch (e) {
      const ae = e as ApiError;
      if (ae.needsConfirmation) return setStep({ kind: "confirm", error: ae });
      if (ae.code === "waiver_required") return setStep({ kind: "waiver", text: String((ae.details.waiver as { text?: string } | undefined)?.text ?? "") });
      if (ae.code === "package_needed") return setStep({ kind: "needPackage", message: ae.message });
      setStep({ kind: "error", message: ae.message });
    }
  }, [me, acks, c, id, slug, here, nav, load]);

  // Back from signing in, joining or buying with ?book=1: carry on booking (once).
  const carriedOn = useRef(false);
  useEffect(() => {
    if (carriedOn.current || params.get("book") !== "1" || !me?.member || !c || booked) return;
    carriedOn.current = true;
    const rest = new URLSearchParams(params);
    rest.delete("book");
    setParams(rest, { replace: true });
    void book();
  }, [params, me, c]); // eslint-disable-line react-hooks/exhaustive-deps

  if (studioError === "not_found") return <NotFoundStudio />;
  if (err) return <Shell><Notice kind="error">{err}</Notice><p><Link to={`/s/${slug}`}>See the timetable</Link></p></Shell>;
  if (!c || !studio) return <Shell><Spinner /></Shell>;
  const canBook = c.bookingWindow === "open" && (!c.isFull || c.waitlist);
  return (
    <Shell>
      <p><Link to={`/s/${slug}`} className="back">← Timetable</Link></p>
      <article className="cls">
        <span className="chip"><i style={{ background: c.color }} />{c.location.name}</span>
        <h1>{c.name}</h1>
        <p className="when">{c.date} · {c.time}</p>
        {c.description && <p>{c.description}</p>}
        <dl className="facts">
          {c.instructor?.name && <><dt>Instructor</dt><dd>{c.instructor.name}</dd></>}
          <dt>Where</dt><dd>{[c.room, c.location.name].filter(Boolean).join(", ")}{c.location.address && <small>{c.location.address}</small>}</dd>
          <dt>Spots</dt><dd className={c.isFull ? "s full" : c.spotsLeft <= 3 ? "s few_left" : ""}>{c.isFull ? (c.waitlist ? "Full: join the waitlist" : "Full") : `${c.spotsLeft} ${c.spotsLeft === 1 ? "spot" : "spots"} left`}</dd>
        </dl>
        {c.toBook.needPackage && !booked && (
          <div className="need">
            <b>To book</b>
            <span>{c.toBook.text}</span>
            {c.toBook.packages.map((p) => (
              <Link key={p.id} className="plan" to={`/s/${slug}/packages/${p.id}?next=${encodeURIComponent(`${here}?book=1`)}`}>
                <span><b>{p.name}</b><small>{p.terms[0]}</small></span><span>{p.price}</span>
              </Link>
            ))}
          </div>
        )}
        <p className="muted small">{c.cancelling}</p>
        {booked ? (
          <Notice kind="ok" title="You're booked">See you there. <Link to={`/s/${slug}/me`}>My bookings</Link></Notice>
        ) : (
          <button type="button" className="btn big" disabled={!canBook || step.kind === "busy"} onClick={() => void book()}>
            {step.kind === "busy" ? "Booking…" : c.bookingWindow === "not_open_yet" ? `Booking opens ${new Date(c.bookingOpensAt).toLocaleDateString("en-GB", { day: "numeric", month: "short" })}` : c.bookingWindow === "closed" ? "Booking closed" : c.isFull ? (c.waitlist ? "Join the waitlist" : "Full") : me?.member ? "Book this class" : "Sign in to book"}
          </button>
        )}
        {step.kind === "done" && <Notice kind="ok">{step.message}</Notice>}
        {step.kind === "error" && <Notice kind="error">{step.message}</Notice>}
        {step.kind === "needPackage" && (
          <Notice kind="warn" title="You'll need a package">{step.message} Choose one above to buy it, then come back to book.</Notice>
        )}
      </article>
      {step.kind === "confirm" && (
        <ConfirmFlags error={step.error} onCancel={() => setStep({ kind: "idle" })} onProceed={(codes) => { const all = [...new Set([...acks, ...codes])]; setAcks(all); void book({ acknowledge: all }); }} proceedLabel="Book it" />
      )}
      {step.kind === "waiver" && (
        <WaiverDialog
          text={step.text}
          onCancel={() => setStep({ kind: "idle" })}
          onSign={async (name) => {
            // Saved on its own first, so it isn't lost if the booking then needs something else (a package).
            try { await api("POST", "/me/waiver", { agree: true, signedName: name }); } catch (e) { if ((e as ApiError).code !== "waiver_already_done") return setStep({ kind: "error", message: (e as Error).message }); }
            void book();
          }}
        />
      )}
    </Shell>
  );
}

function WaiverDialog({ text, onCancel, onSign }: { text: string; onCancel: () => void; onSign: (name: string) => void | Promise<void> }) {
  const [name, setName] = useState("");
  const [agree, setAgree] = useState(false);
  const ok = agree && name.trim().length >= 2;
  return (
    <Dialog title="Sign the studio's waiver" onClose={onCancel} actions={<><button type="button" className="btn ghost" onClick={onCancel}>Back</button><button type="button" className="btn" disabled={!ok} onClick={() => void onSign(name.trim())}>Sign and continue</button></>}>
      <p className="muted">You only need to do this once, before your first class.</p>
      <div className="waiver" tabIndex={0} aria-label="Waiver text">{text}</div>
      <label className="check"><input type="checkbox" checked={agree} onChange={(e) => setAgree(e.target.checked)} /> I've read it and I agree</label>
      <label className="field">Type your full name to sign<input value={name} onChange={(e) => setName(e.target.value)} autoComplete="name" /></label>
    </Dialog>
  );
}
