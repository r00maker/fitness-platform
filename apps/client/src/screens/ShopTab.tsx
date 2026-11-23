/**
 * The Shop tab: everything to buy in one place. Packages (class packs and memberships), gift
 * cards, and the studio's merchandise with a basket. Checkout is its own screen with the bill,
 * a start date (packages that start when bought), unused classes to bring across, a discount,
 * studio credit, and how to pay.
 */
import { useEffect, useState } from "react";
import { payInDemo } from "../components/PaySheet";
import { Loading, PayChoice, Problem, SubHead, useAction } from "../components/ui";
import type { CheckoutChoices, GiftCardShop, Placed, Plan, Product, Quote } from "../data/types";
import { money, shortDate } from "../lib/format";
import { useStore } from "../store";

/** After an order: done, off to the payment page (or the demo's stand-in), or pay at the desk. */
export function usePlaced() {
  const { toast, refresh, go } = useStore();
  return async (r: Placed | undefined, then: string) => {
    if (!r) return;
    if (r.redirectUrl) { location.href = r.redirectUrl; return; }
    let final: Placed | null = r;
    if (r.demoPay) {
      final = await payInDemo(r.demoPay);
      if (!final) { toast("Not paid. Nothing was charged."); return; }
    }
    toast(final.message);
    await refresh();
    go(then);
  };
}

/** The studio's ways to pay for a one-off order (online, or at the desk). */
const PAY = [{ payWith: "online", label: "Pay online", fee: null, total: "" }, { payWith: "desk", label: "Pay at the studio", fee: null, total: "" }];

export function ShopTab() {
  const { api, go, studio } = useStore();
  const [plans, setPlans] = useState<Plan[] | null>(null);
  const [shop, setShop] = useState<{ giftCards: boolean; products: Product[] } | null>(null);
  const [basket, setBasket] = useState<{ p: Product; option?: string; qty: number }[]>([]);
  const [opts, setOpts] = useState<Record<string, string>>({});
  const [payWith, setPayWith] = useState("online");
  const a = useAction();
  const placed = usePlaced();
  useEffect(() => { void api.plans().then(setPlans); void api.shop().then(setShop).catch(() => setShop({ giftCards: false, products: [] })); }, [api]);
  const fmt = (c: number) => money(c, studio.currency);
  const packs = plans?.filter((p) => p.billing === "one_time") ?? [];
  const members = plans?.filter((p) => p.billing === "recurring") ?? [];
  const add = (p: Product) => {
    const option = p.options.length ? opts[p.id] ?? p.options.find((o) => !o.soldOut)?.name : undefined;
    setBasket((b) => {
      const same = b.find((x) => x.p.id === p.id && x.option === option);
      return same ? b.map((x) => (x === same ? { ...x, qty: Math.min(20, x.qty + 1) } : x)) : [...b, { p, option, qty: 1 }];
    });
  };
  const total = basket.reduce((t, x) => t + x.p.priceCents * x.qty, 0);
  const planList = (list: Plan[]) => (
    <ul className="plans">
      {list.map((p) => (
        <li key={p.id}>
          <button type="button" className="plan" onClick={() => go(`shop/package/${p.id}`)}>
            <span className="plan-top"><span className="plan-name">{p.name}</span><span className="plan-price">{p.price}{p.billing === "recurring" ? <small> a month</small> : null}</span></span>
            {p.description && <span className="plan-desc">{p.description}</span>}
            <span className="plan-terms">{p.terms.slice(0, 3).join(". ")}.</span>
          </button>
        </li>
      ))}
    </ul>
  );

  return (
    <div className="shop-tab">
      <header className="screen-head"><h1>Shop</h1></header>
      {!plans && <Loading />}
      {packs.length > 0 && <section aria-labelledby="packsT"><h2 id="packsT">Class packs</h2>{planList(packs)}</section>}
      {members.length > 0 && <section aria-labelledby="memT"><h2 id="memT">Memberships</h2>{planList(members)}</section>}
      {shop?.giftCards && (
        <button type="button" className="gift-promo" onClick={() => go("shop/gift-card")}>
          <span><b>Gift cards</b><small>For a friend, or to keep as credit</small></span>
          <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M9 5l7 7-7 7" /></svg>
        </button>
      )}
      {!!shop?.products.length && (
        <section aria-labelledby="goodsT">
          <h2 id="goodsT">From the studio</h2>
          <p className="muted section-sub">Pay here, then collect it at the front desk.</p>
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
        </section>
      )}
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

export function Checkout({ planId }: { planId: string }) {
  const { api } = useStore();
  const [c, setC] = useState<CheckoutChoices>({ useCredit: true });
  const [q, setQ] = useState<Quote | null>(null);
  const a = useAction();
  const placed = usePlaced();
  // The quote follows their choices (a discount, classes brought across, credit).
  useEffect(() => {
    void api.quote(planId, c).then((x) => { setQ(x); setC((v) => ({ ...v, payWith: v.payWith ?? x.payments.options[0]?.payWith, startDate: v.startDate ?? x.startDate?.default })); }, (e: Error) => a.setError(e.message));
  }, [api, planId, c.useCredit, c.voucherId, c.rolloverFromPackageId]);
  if (!q) return <div><SubHead title="Checkout" /><Loading /><Problem text={a.error} /></div>;
  const deskOnly = q.payments.options.length === 1 && q.payments.options[0]!.payWith === "desk";
  const set = (x: Partial<CheckoutChoices>) => setC((v) => ({ ...v, ...x }));
  return (
    <div className="checkout">
      <SubHead title={q.package.name} sub={q.package.terms.join(". ") + "."} />

      {q.startDate && (
        <label className="field">
          <span>Starts on</span>
          <input type="date" min={q.startDate.earliest} max={q.startDate.latest} value={c.startDate ?? q.startDate.default} onChange={(e) => set({ startDate: e.target.value })} />
          <small className="muted">Any day up to {shortDate(q.startDate.latest)}.</small>
        </label>
      )}
      {q.rolloverOptions.length > 0 && (
        <fieldset className="pay">
          <legend>Bring unused classes across</legend>
          <label className="pay-opt"><input type="radio" name="roll" checked={!c.rolloverFromPackageId} onChange={() => set({ rolloverFromPackageId: undefined })} /><span className="pay-label">No, thanks</span></label>
          {q.rolloverOptions.map((r) => (
            <label key={r.packageId} className="pay-opt">
              <input type="radio" name="roll" checked={c.rolloverFromPackageId === r.packageId} onChange={() => set({ rolloverFromPackageId: r.packageId })} />
              <span className="pay-label">{r.classes} {r.classes === 1 ? "class" : "classes"} from {r.name}{r.validUntil ? <small>It ends {shortDate(r.validUntil)}</small> : null}</span>
            </label>
          ))}
        </fieldset>
      )}
      {q.vouchers.length > 0 && (
        <fieldset className="pay">
          <legend>A discount</legend>
          <label className="pay-opt"><input type="radio" name="voucher" checked={!c.voucherId} onChange={() => set({ voucherId: undefined })} /><span className="pay-label">None</span></label>
          {q.vouchers.map((v) => (
            <label key={v.id} className="pay-opt">
              <input type="radio" name="voucher" checked={c.voucherId === v.id} onChange={() => set({ voucherId: v.id })} />
              <span className="pay-label">{v.label}{v.note ? <small>{v.note}</small> : null}</span>
            </label>
          ))}
        </fieldset>
      )}

      <section className="bill" aria-label="What you'll pay">
        {q.lines.map((l) => <p key={l.label} className="bill-line"><span>{l.label}</span><span>{l.amount}</span></p>)}
        <p className="bill-total"><span>Total</span><span>{q.total}</span></p>
        {q.studioCredit.balanceCents > 0 && (
          <label className="check"><input type="checkbox" checked={c.useCredit} onChange={(e) => set({ useCredit: e.target.checked })} /> Use my studio credit ({q.studioCredit.balance})</label>
        )}
        {q.recurringNote && <p className="muted">{q.recurringNote}</p>}
        {q.startsNote && <p className="muted">{q.startsNote}</p>}
      </section>
      {q.totalCents > 0 && <PayChoice options={q.payments.options} value={c.payWith} onChange={(v) => set({ payWith: v })} />}
      {q.payments.message && <p className="muted">{q.payments.message}</p>}
      <Problem text={a.error} />
      <button type="button" className="btn btn-main btn-wide" disabled={a.busy} onClick={() => void a.run(() => api.checkout(planId, c)).then((r) => placed(r, "me"))}>
        {a.busy ? "One moment…" : q.totalCents === 0 ? "Get it" : c.payWith === "desk" || deskOnly ? "Order and pay at the studio" : `Pay ${q.total}`}
      </button>
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
          <label className="field"><span>Their email</span><input type="email" inputMode="email" autoCapitalize="none" value={to} onChange={(e) => setTo(e.target.value)} required /></label>
          <label className="field"><span>A message (optional)</span><textarea rows={2} value={message} onChange={(e) => setMessage(e.target.value)} maxLength={300} /></label>
        </>
      ) : <p className="muted">It waits under My gift cards until you send it, or you can keep it as credit.</p>}
      <PayChoice options={PAY.map((o) => ({ ...o, total: label }))} value={payWith} onChange={setPayWith} />
      <Problem text={a.error} />
      <button className="btn btn-main btn-wide" disabled={a.busy || !amount}>{a.busy ? "One moment…" : payWith === "desk" ? "Order and pay at the studio" : `Pay ${label}`}</button>
    </form>
  );
}
