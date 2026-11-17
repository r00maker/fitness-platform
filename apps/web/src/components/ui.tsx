import { useEffect, useRef, type ReactNode } from "react";
import { Link, useParams } from "react-router-dom";
import type { ApiError, Flag } from "../lib/api";
import { useStudio } from "../lib/session";

/** The studio's header and navigation on every page. */
export function Shell({ children, wide = false }: { children: ReactNode; wide?: boolean }) {
  const { slug = "" } = useParams();
  const { studio, me } = useStudio();
  return (
    <div className="app">
      <a className="skip" href="#main">Skip to content</a>
      <header className="top">
        <div className="wrap topin">
          <Link to={`/s/${slug}`} className="brand">
            {studio?.logoUrl ? <img src={studio.logoUrl} alt="" /> : <span className="mark" aria-hidden="true">{studio?.name.slice(0, 1) ?? "·"}</span>}
            <span>{studio?.name ?? ""}</span>
          </Link>
          <nav aria-label="Main" className="nav">
            <Link to={`/s/${slug}`}>Classes</Link>
            <Link to={`/s/${slug}/packages`}>Packages</Link>
            {me?.member ? <Link to={`/s/${slug}/me`} className="pill">My account</Link> : <Link to={`/s/${slug}/sign-in`} className="pill">Sign in</Link>}
          </nav>
        </div>
      </header>
      <main id="main" className={`wrap main ${wide ? "wide" : ""}`}>{children}</main>
      {studio && (
        <footer className="wrap foot">
          <span>{studio.locations.map((l) => l.name).join(" · ")}</span>
          <span>{studio.rules.bookingOpens} {studio.rules.bookingCloses}. {studio.rules.cancelling}</span>
        </footer>
      )}
    </div>
  );
}

export function Notice({ kind = "info", title, children }: { kind?: "info" | "ok" | "warn" | "error"; title?: string; children?: ReactNode }) {
  return (
    <div className={`notice ${kind}`} role={kind === "error" ? "alert" : "status"}>
      {title && <b>{title}</b>}
      {children && <div>{children}</div>}
    </div>
  );
}

export function Spinner({ label = "Loading" }: { label?: string }) {
  return <div className="spin" role="status" aria-label={label}><span /></div>;
}

/** A dialog that keeps focus inside and closes with Escape. */
export function Dialog({ title, onClose, children, actions }: { title: string; onClose: () => void; children: ReactNode; actions: ReactNode }) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const prev = document.activeElement as HTMLElement | null;
    ref.current?.querySelector<HTMLElement>("button, input, textarea, a")?.focus();
    const key = (e: KeyboardEvent) => { if (e.key === "Escape") onClose(); };
    document.addEventListener("keydown", key);
    return () => { document.removeEventListener("keydown", key); prev?.focus(); };
  }, [onClose]);
  return (
    <div className="scrim" onClick={(e) => e.target === e.currentTarget && onClose()}>
      <div className="dialog" role="dialog" aria-modal="true" aria-labelledby="dlgT" ref={ref}>
        <h2 id="dlgT">{title}</h2>
        <div className="dbody">{children}</div>
        <div className="dact">{actions}</div>
      </div>
    </div>
  );
}

/** The API's "please check" warnings: shown together, with Go ahead (sends them back acknowledged). */
export function ConfirmFlags({ error, onCancel, onProceed, proceedLabel = "Go ahead" }: { error: ApiError; onCancel: () => void; onProceed: (codes: string[]) => void; proceedLabel?: string }) {
  const flags = (error.details.flags ?? []) as Flag[];
  const info = (error.details.info ?? []) as Flag[];
  return (
    <Dialog title={flags.length === 1 ? (flags[0]!.title ?? "Please check") : "Please check"} onClose={onCancel} actions={<><button type="button" className="btn ghost" onClick={onCancel}>Back</button><button type="button" className="btn" onClick={() => onProceed(flags.map((f) => f.code))}>{proceedLabel}</button></>}>
      {flags.map((f) => <p key={f.code + f.message}>{f.message}</p>)}
      {info.map((f) => <p key={f.code} className="muted">{f.message}</p>)}
    </Dialog>
  );
}

export const Price = ({ children }: { children: ReactNode }) => <span className="price">{children}</span>;
