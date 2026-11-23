/**
 * Paying online. In the real app the person goes to Stripe's own payment page and comes back.
 * The demo studios have no Stripe, so this sheet stands in for that page: it shows what's being
 * paid and a Pay button, and never asks for card details.
 */
import { useEffect, useRef, useState } from "react";
import type { Placed } from "../data/types";

type Ask = NonNullable<Placed["demoPay"]> & { resolve(r: Placed | null): void };
const EVENT = "demo-pay";

/** Opens the sheet; resolves with the finished order, or null if they closed it without paying. */
export function payInDemo(d: NonNullable<Placed["demoPay"]>): Promise<Placed | null> {
  return new Promise((resolve) => dispatchEvent(new CustomEvent<Ask>(EVENT, { detail: { ...d, resolve } })));
}

export function PaySheet() {
  const [ask, setAsk] = useState<Ask | null>(null);
  const [busy, setBusy] = useState(false);
  const btn = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    const on = (e: Event) => { setAsk((e as CustomEvent<Ask>).detail); setBusy(false); };
    addEventListener(EVENT, on);
    return () => removeEventListener(EVENT, on);
  }, []);
  useEffect(() => {
    if (!ask) return;
    btn.current?.focus();
    const esc = (e: KeyboardEvent) => { if (e.key === "Escape") close(); };
    addEventListener("keydown", esc);
    return () => removeEventListener("keydown", esc);
  });
  if (!ask) return null;
  function close() { ask!.resolve(null); setAsk(null); }
  async function pay() {
    setBusy(true);
    const r = await ask!.confirm();
    ask!.resolve(r);
    setAsk(null);
  }
  return (
    <div className="celebrate-scrim" onClick={close}>
      <div className="pay-sheet" role="dialog" aria-modal="true" aria-labelledby="payT" onClick={(e) => e.stopPropagation()}>
        <p className="pay-sheet-tag">Demo payment page</p>
        <h2 id="payT">{ask.amount}</h2>
        <p className="muted">{ask.description}</p>
        <p className="pay-sheet-note">In the real app, Stripe's secure page opens here for the card, Apple Pay, Google Pay or PayNow. This demo doesn't take any payment details.</p>
        <button ref={btn} type="button" className="btn btn-main btn-wide" disabled={busy} onClick={() => void pay()}>{busy ? "Paying…" : `Pay ${ask.amount}`}</button>
        <button type="button" className="btn btn-text" onClick={close}>Cancel</button>
      </div>
    </div>
  );
}
