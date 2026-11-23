/** Their gift cards (to give, received, given, kept) and studio credit. Buying them is in the Shop tab. */
import { useEffect, useState } from "react";
import { Problem, SubHead, useAction, Loading } from "../../components/ui";
import type { MyGiftCards } from "../../data/types";
import { useStore } from "../../store";

export function GiftCards() {
  const { api, go, toast } = useStore();
  const [g, setG] = useState<MyGiftCards | null>(null);
  const [giving, setGiving] = useState<string | null>(null);
  const [to, setTo] = useState("");
  const a = useAction();
  const load = () => void api.myGiftCards().then(setG);
  useEffect(load, [api]);
  if (!g) return <div><SubHead title="Gift cards and credit" /><Loading /></div>;
  const all = [...g.toGive, ...g.received, ...g.given, ...g.kept];
  return (
    <div className="gift-cards">
      <SubHead title="Gift cards and credit" />
      <section className="credit-card" aria-label="Studio credit">
        <p className="muted">Studio credit</p>
        <p className="credit-big">{g.credit.balance}</p>
        <p className="muted">Used automatically when you buy a package or something from the shop.</p>
      </section>
      {all.length === 0 && <p className="empty">No gift cards yet.</p>}
      <ul className="cards">
        {all.map((c) => (
          <li key={c.id} className="gcard">
            {c.design && <img src={c.design.imageUrl} alt="" />}
            <div className="gcard-text">
              <p><b>{c.amount}</b> <span className="tag">{c.statusLabel}</span></p>
              <p className="muted">{c.to ? `To ${c.to}` : c.from ? `From ${c.from}` : c.daysLeftToGive !== null ? `Give it within ${c.daysLeftToGive} days` : c.code}</p>
              {c.status === "unsent" && (giving === c.id ? (
                <form className="inline-form" onSubmit={(e) => { e.preventDefault(); void a.run(() => api.giveGiftCard(c.id, to.trim())).then((r) => { if (r !== undefined) { toast(`Sent to ${to.trim()}.`); setGiving(null); load(); } }); }}>
                  <label className="field"><span>Their email</span><input type="email" value={to} onChange={(e) => setTo(e.target.value)} required autoFocus /></label>
                  <Problem text={a.error} />
                  <div className="confirm-btns"><button className="btn btn-main" disabled={a.busy}>Send it</button><button type="button" className="btn btn-text" onClick={() => setGiving(null)}>Not now</button></div>
                </form>
              ) : (
                <div className="confirm-btns">
                  <button type="button" className="btn btn-quiet" onClick={() => { setGiving(c.id); setTo(""); }}>Give it</button>
                  <button type="button" className="btn btn-text" onClick={() => void api.keepGiftCard(c.id).then(() => { toast("Added to your credit."); load(); })}>Keep it as credit</button>
                </div>
              ))}
            </div>
          </li>
        ))}
      </ul>
      <button type="button" className="btn btn-quiet btn-wide" onClick={() => go("shop/gift-card")}>Buy a gift card</button>
    </div>
  );
}
