import { useEffect, useState } from "react";
import { Link, useSearchParams } from "react-router-dom";
import { api, setStudio, pub } from "../lib/api";
import { Notice, Spinner } from "../components/ui";

const lastSlug = () => { try { return localStorage.getItem("studio.last"); } catch { return null; } };

/** Back from Stripe's page. The payment completes when Stripe tells the API, usually within seconds. */
export function PaymentReturn({ kind }: { kind: "done" | "cancelled" | "card-saved" }) {
  const [params] = useSearchParams();
  const order = params.get("order");
  const slug = lastSlug();
  const [state, setState] = useState<"waiting" | "paid" | "slow">("waiting");
  useEffect(() => {
    if (kind !== "done" || !order || !slug) return;
    let tries = 0, stop = false;
    (async () => {
      const s = await pub<{ id: string }>(`/studios/${slug}`).catch(() => null);
      if (!s) return;
      setStudio(s.id);
      while (!stop && tries++ < 15) {
        const r = await api<{ paid: boolean }>("GET", `/orders/${order}/pay-options`).catch(() => null);
        if (r?.paid) return setState("paid");
        await new Promise((res) => setTimeout(res, 2000));
      }
      if (!stop) setState("slow");
    })();
    return () => { stop = true; };
  }, [kind, order, slug]);
  const home = slug ? `/s/${slug}` : "/";
  return (
    <div className="center">
      {kind === "cancelled" ? (
        <><h1>Payment not finished</h1><p className="muted">Nothing was charged. Your order is saved: pay for it from your account, or at the studio.</p></>
      ) : kind === "card-saved" ? (
        <><h1>Card saved</h1><p className="muted">It'll be used for your membership's renewals.</p></>
      ) : state === "paid" ? (
        <><h1>Paid, thank you</h1><p className="muted">It's on your account, and your receipt is on its way by email.</p></>
      ) : state === "slow" ? (
        <><h1>Payment received</h1><Notice>It's taking a little longer than usual to confirm. It'll appear in your account shortly; there's no need to pay again.</Notice></>
      ) : (
        <><h1>Confirming your payment…</h1><Spinner /></>
      )}
      <p><Link className="btn" to={slug ? `${home}/me/${kind === "card-saved" ? "payment" : "packages"}` : "/"}>Go to my account</Link></p>
    </div>
  );
}
