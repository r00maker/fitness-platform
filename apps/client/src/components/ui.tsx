/** Small pieces every screen uses: the header with Back, list rows, how to pay, and a notice. */
import { useState, type ReactNode } from "react";
import type { PayOption } from "../data/types";
import { useStore } from "../store";

/** A screen below a tab: Back (to where they came from), then the title. */
export function SubHead({ title, sub, children }: { title: string; sub?: ReactNode; children?: ReactNode }) {
  const { back } = useStore();
  return (
    <header className="sub-head">
      <button type="button" className="back" onClick={back}>
        <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M15 5l-7 7 7 7" /></svg>
        Back
      </button>
      <h1>{title}</h1>
      {sub && <p className="sub-head-sub">{sub}</p>}
      {children}
    </header>
  );
}

/** A tappable row that opens another screen. */
export function Row({ to, title, detail, badge, icon }: { to: string; title: string; detail?: ReactNode; badge?: ReactNode; icon?: ReactNode }) {
  const { go } = useStore();
  return (
    <li>
      <button type="button" className="row" onClick={() => go(to)}>
        {icon && <span className="row-icon" aria-hidden="true">{icon}</span>}
        <span className="row-text">
          <span className="row-title">{title}</span>
          {detail && <span className="row-detail">{detail}</span>}
        </span>
        {badge && <span className="row-badge">{badge}</span>}
        <svg className="row-go" viewBox="0 0 24 24" aria-hidden="true"><path d="M9 5l7 7-7 7" /></svg>
      </button>
    </li>
  );
}

/** How to pay: one choice per way the studio takes payment, the first picked. */
export function PayChoice({ options, value, onChange }: { options: PayOption[]; value: string | undefined; onChange(v: string): void }) {
  if (options.length < 2) return options[0] ? <p className="pay-one">{options[0].label}{options[0].fee ? ` (${options[0].fee})` : ""}</p> : null;
  return (
    <fieldset className="pay">
      <legend>How to pay</legend>
      {options.map((o) => (
        <label key={o.payWith} className="pay-opt">
          <input type="radio" name="payWith" value={o.payWith} checked={value === o.payWith} onChange={() => onChange(o.payWith)} />
          <span className="pay-label">{o.label}{o.note ? <small>{o.note}</small> : null}</span>
          <span className="pay-total">{o.total}{o.fee ? <small>{o.fee}</small> : null}</span>
        </label>
      ))}
    </fieldset>
  );
}

/**
 * Runs an action, shows "…" while it works and the API's own words if it fails.
 * Resolves to the action's result, `true` for actions that return nothing, or undefined if it failed.
 */
export function useAction() {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const run = async <T,>(f: () => Promise<T>): Promise<(T extends void ? true : T) | undefined> => {
    setBusy(true);
    setError(null);
    try {
      const v = await f();
      return (v === undefined ? true : v) as T extends void ? true : T;
    } catch (e) {
      setError((e as Error).message);
      return undefined;
    } finally {
      setBusy(false);
    }
  };
  return { busy, error, run, setError };
}

export const Loading = () => <p className="loading" aria-busy="true">Loading…</p>;
export const Problem = ({ text }: { text: string | null }) => (text ? <p className="form-error" role="alert">{text}</p> : null);
