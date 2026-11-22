/**
 * The shop: merchandise with a simple basket, and gift cards (give now, or keep to give later).
 * Collected at the front desk. Plus their own gift cards and studio credit.
 */
import { useEffect, useState } from "react";
import { PayChoice, Problem, SubHead, useAction, Loading } from "../../components/ui";
import type { GiftCardShop, MyGiftCards, Product } from "../../data/types";
import { money } from "../../lib/format";
import { useStore } from "../../store";
import { usePlaced } from "./Packages";

/** The studio's ways to pay for a one-off order (online, or at the desk). */
const PAY = [{ payWith: "online", label: "Pay online", fee: null, total: "" }, { payWith: "desk", label: "Pay at the studio", fee: null, total: "" }];

export function Shop() {
  const { api, go, studio } = useStore();
  const [shop, setShop] = useState<{ giftCards: boolean; products: Product[] } | null>(null);
  const [basket, setBasket] = useState<{ p: Product; option?: string; qty: number }[]>([]);
  const [opts, setOpts] = useState<Record<string, string>>({});
  const [payWith, setPayWith] = useState("online");
  const a = useAction();
  const placed = usePlaced();
  useEffect(() => void api.shop().then(setShop), [api]);
  if (!shop) return <div><SubHead title="Shop" /><Loading /></div>;
  const add = (p: Product) => {
    const option = p.options.length ? opts[p.id] ?? p.options.find((o) => !o.soldOut)?.name : undefined;
    setBasket((b) => {
      const same = b.find((x) => x.p.id === p.id && x.option === option);
      return same ? b.map((x) => (x === same ? { ...x, qty: Math.min(20, x.qty + 1) } : x)) : [...b, { p, option, qty: 1 }];
    });
  };
  const total = basket.reduce((t, x) => t + x.p.priceCents * x.qty, 0);
  const fmt = (c: number) => money(c, studio.currency);

  return (
    <div className="shop">
      <SubHead title="Shop" sub="Pay here, then collect it at the front desk." />
      {shop.giftCards && (
        <button type="button" className="gift-promo" onClick={() => go("me/shop/gift-card")}>
          <span><b>Gift cards</b><small>For a friend, or to keep as credit</small></span>
          <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M9 5l7 7-7 7" /></svg>
        </button>
      )}
      <ul className="products">
        {shop.products.map((p) => (
          <li key={p.id} className={`product${p.soldOut ? " is-out" : ""}`}>
            <div className="product-text">
              <h3>{p.name}</h3>
              {p.description && <p>{p.description}</p>}
              <p className="product-price">{p.price}</p>
            </div>
            <div className="product-act">
              {p.options.length > 0 && (
                <label className="select"><span className="sr-only">Size or colour for {p.name}</span>
                  <select value={opts[p.id] ?? p.options.find((o) => !o.soldOut)?.name} onChange={(e) => setOpts((o) => ({ ...o, [p.id]: e.target.value }))}>
                    {p.options.map((o) => <option key={o.name} value={o.name} disabled={o.soldOut}>{o.name}{o.soldOut ? " (sold out)" : ""}</option>)}
                  </select>
                </label>
              )}
              <button type="button" className="btn btn-quiet" disabled={p.soldOut} onClick={() => add(p)} aria-label={`Add ${p.name}`}>{p.soldOut ? "Sold out" : "Add"}</button>
            </div>
          </li>
        ))}
      </ul>
      {basket.length > 0 && (
        <section className="basket" aria-labelledby="basketT">
          <h2 id="basketT">Your basket</h2>
          {basket.map((x, i) => (
            <p key={i} className="bill-line">
              <span>{x.p.name}{x.option ? ` (${x.option})` : ""}{x.qty > 1 ? ` ×${x.qty}` : ""}</span>
              <span>{fmt(x.p.priceCents * x.qty)} <button type="button" className="btn btn-text" aria-label={`Remove ${x.p.name}`} onClick={() => setBasket((b) => b.filter((_, k) => k !== i))}>Remove</button></span>
            </p>
          ))}
          <p className="bill-total"><span>Total</span><span>{fmt(total)}</span></p>
          <PayChoice options={PAY.map((o) => ({ ...o, total: fmt(total) }))} value={payWith} onChange={setPayWith} />
          <Problem text={a.error} />
          <button type="button" className="btn btn-main btn-wide" disabled={a.busy} onClick={() => void a.run(() => api.buyProducts(basket.map((x) => ({ productId: x.p.id, option: x.option, quantity: x.qty })), payWith)).then((r) => placed(r, "me"))}>
            {a.busy ? "One moment…" : payWith === "desk" ? "Order and pay at the studio" : `Pay ${fmt(total)}`}
          </button>
        </section>
      )}
    </div>
  );
}

export function BuyGiftCard() {
  const { api } = useStore();
  const [g, setG] = useState<GiftCardShop | null>(null);
  const [design, setDesign] = useState<string>("");
  const [amount, setAmount] = useState<number>(0);
  const [when, setWhen] = useState<"now" | "later">("now");
  const [to, setTo] = useState("");
  const [message, setMessage] = useState("");
  const [payWith, setPayWith] = useState("online");
  const a = useAction();
  const placed = usePlaced();
  useEffect(() => void api.giftCardShop().then((x) => { setG(x); setDesign(x.designs?.[0]?.id ?? ""); setAmount(x.amounts?.[1]?.cents ?? x.amounts?.[0]?.cents ?? 0); }), [api]);
  if (!g) return <div><SubHead title="Gift card" /><Loading /></div>;
  if (!g.enabled) return <div><SubHead title="Gift card" /><p className="empty">The studio isn't selling gift cards right now.</p></div>;
  const label = g.amounts?.find((x) => x.cents === amount)?.label ?? "";
  return (
    <form className="gift" onSubmit={(e) => { e.preventDefault(); void a.run(() => api.buyGiftCard({ designId: design, amountCents: amount, payWith, ...(when === "now" ? { give: { to: to.trim(), message: message.trim() || undefined } } : {}) })).then((r) => placed(r, "me/gift-cards")); }}>
      <SubHead title="Gift card" sub="Spent on classes and packages at the studio." />
      <fieldset className="designs"><legend>Design</legend>
        {g.designs!.map((d) => (
          <label key={d.id} className={`design${design === d.id ? " is-on" : ""}`}>
            <input type="radio" name="design" value={d.id} checked={design === d.id} onChange={() => setDesign(d.id)} className="sr-only" />
            <img src={d.imageUrl} alt="" /><span>{d.name}</span>
          </label>
        ))}
      </fieldset>
      <fieldset className="amounts"><legend>Amount</legend>
        {g.amounts!.map((x) => <button key={x.cents} type="button" className="chip" aria-pressed={amount === x.cents} onClick={() => setAmount(x.cents)}>{x.label}</button>)}
      </fieldset>
      <div className="seg" role="radiogroup" aria-label="When to give it">
        <button type="button" role="radio" aria-checked={when === "now"} onClick={() => setWhen("now")}>Give it now</button>
        <button type="button" role="radio" aria-checked={when === "later"} onClick={() => setWhen("later")}>Give it later</button>
      </div>
      {when === "now" ? (
        <>
          <label className="field"><span>Their email</span><input type="email" value={to} onChange={(e) => setTo(e.target.value)} required /></label>
          <label className="field"><span>A message (optional)</span><textarea rows={2} value={message} onChange={(e) => setMessage(e.target.value)} maxLength={300} /></label>
        </>
      ) : <p className="muted">It waits under My gift cards until you send it, or you can keep it as credit.</p>}
      <PayChoice options={PAY.map((o) => ({ ...o, total: label }))} value={payWith} onChange={setPayWith} />
      <Problem text={a.error} />
      <button className="btn btn-main btn-wide" disabled={a.busy || !amount}>{a.busy ? "One moment…" : payWith === "desk" ? "Order and pay at the studio" : `Pay ${label}`}</button>
    </form>
  );
}

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
      <button type="button" className="btn btn-quiet btn-wide" onClick={() => go("me/shop/gift-card")}>Buy a gift card</button>
    </div>
  );
}
