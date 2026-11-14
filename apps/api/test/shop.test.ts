import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import { invoices, organizations, products } from "../src/db/schema.js";
import { app, db, person, pool, reset, studio } from "./helpers.js";

beforeEach(reset);
afterAll(async () => {
  await app.close();
  await pool.end();
});

describe("shop", () => {
  it("only appears for clients when there's something to buy", async () => {
    const s = await studio();
    expect((await s.c1.call("GET", "/shop")).body).toEqual({ visible: false, giftCards: false, products: [] });
    await db.update(organizations).set({ giftCardsEnabled: true }).where(eq(organizations.id, s.orgId));
    expect((await s.c1.call("GET", "/shop")).body.visible).toBe(true);
  });

  it("sells sized merch with stock, invoices it, and the front desk hands it over", async () => {
    const s = await studio();
    const fd = await person(s.orgId, "front_desk", "Faye");
    expect((await fd.call("POST", "/shop/products", { name: "Tee", priceCents: 3500 })).status).toBe(403);
    const tee = await s.owner.call("POST", "/shop/products", { name: "Studio tee", priceCents: 3500, options: [{ name: "S", stock: 2 }, { name: "M", stock: 0 }], category: "Apparel" });
    expect(tee.status, JSON.stringify(tee.body)).toBe(201);
    const socks = (await s.owner.call("POST", "/shop/products", { name: "Grip socks", priceCents: 1800, stock: 10 })).body;
    const shop = (await s.c1.call("GET", "/shop")).body;
    expect(shop.products.map((p: { name: string; price: string }) => `${p.name} ${p.price}`)).toEqual(["Grip socks SGD 18.00", "Studio tee SGD 35.00"]);
    expect(shop.products[1].options).toEqual([{ name: "S", soldOut: false }, { name: "M", soldOut: true }]);
    expect(shop.products[1]).not.toHaveProperty("stock"); // clients don't see stock numbers

    // Sold out and "pick a size" are explained.
    expect((await s.c1.call("POST", "/shop/checkout", { items: [{ productId: tee.body.id, option: "M", quantity: 1 }] })).body.error.message).toBe("Studio tee (M) is sold out.");
    expect((await s.c1.call("POST", "/shop/checkout", { items: [{ productId: tee.body.id, quantity: 1 }] })).body.error.code).toBe("choose_option");
    expect((await s.c1.call("POST", "/shop/checkout", { items: [{ productId: tee.body.id, option: "S", quantity: 3 }] })).body.error.message).toBe("Only 2 Studio tee (S) left.");

    const order = await s.c1.call("POST", "/shop/checkout", { items: [{ productId: tee.body.id, option: "S", quantity: 1 }, { productId: socks.id, quantity: 2 }] });
    expect(order.status, JSON.stringify(order.body)).toBe(201);
    expect(order.body.order).toMatchObject({ status: "awaiting_payment", total: "SGD 71.00" });
    const [p1] = await db.select().from(products).where(eq(products.id, tee.body.id));
    expect(p1!.options).toEqual([{ name: "S", stock: 1 }, { name: "M", stock: 0 }]);
    const [inv] = await db.select().from(invoices);
    expect(inv).toMatchObject({ source: "product", status: "open", totalCents: 7100 });
    expect(inv!.lines.map((l) => `${l.description}/${l.detail ?? ""}x${l.quantity}`)).toEqual(["Studio tee/Sx1", "Grip socks/x2"]);

    // At the desk: payment first, then hand over.
    const due = await fd.call("GET", "/shop/orders");
    expect(due.body.orders).toEqual([expect.objectContaining({ id: order.body.order.id, toPay: "SGD 71.00", statusLabel: "Waiting for payment" })]);
    expect((await fd.call("POST", `/shop/orders/${order.body.order.id}/collected`, {})).body.error.code).toBe("payment_due");
    const handed = await fd.call("POST", `/shop/orders/${order.body.order.id}/collected`, { method: "qr" });
    expect(handed.status, JSON.stringify(handed.body)).toBe(200);
    const [paid] = await db.select().from(invoices);
    expect(paid).toMatchObject({ status: "paid", paymentMethod: "qr" });
    expect(paid!.receiptNumber).toBeTruthy();
    expect((await s.c1.call("GET", "/me/shop-orders")).body.orders[0].statusLabel).toBe("Collected");

    // A refund that undoes the sale puts the stock back.
    const r = await s.owner.call("POST", `/sales/invoices/${paid!.id}/refunds`, { amountCents: 7100, reason: "Wrong size", undoSale: true });
    expect(r.status, JSON.stringify(r.body)).toBe(200);
    const [p2] = await db.select().from(products).where(eq(products.id, tee.body.id));
    expect(p2!.options[0]).toEqual({ name: "S", stock: 2 });
  });

  it("cancelling an unpaid order puts the stock back and cancels the invoice", async () => {
    const s = await studio();
    const socks = (await s.owner.call("POST", "/shop/products", { name: "Grip socks", priceCents: 1800, stock: 3 })).body;
    const o = (await s.c2.call("POST", "/shop/checkout", { items: [{ productId: socks.id, quantity: 3 }] })).body.order;
    expect((await s.c1.call("GET", "/shop")).body.products[0].soldOut).toBe(true);
    await s.c2.call("POST", `/orders/${o.id}/cancel`);
    const [p] = await db.select().from(products);
    expect(p!.stock).toBe(3);
    expect((await db.select().from(invoices))[0]!.status).toBe("void");
  });
});
