/** Shop stock: taken when an order is placed, put back when it's cancelled or refunded. */
import { eq } from "drizzle-orm";
import type { DbOrTx } from "../../db/client.js";
import { products } from "../../db/schema.js";

export async function restock(tx: DbOrTx, productId: string, option: string | null, quantity: number) {
  const [p] = await tx.select().from(products).where(eq(products.id, productId)).for("update");
  if (!p) return;
  if (option) {
    const opts = p.options.map((o) => (o.name === option && o.stock !== null ? { ...o, stock: o.stock + quantity } : o));
    await tx.update(products).set({ options: opts }).where(eq(products.id, p.id));
  } else if (p.stock !== null) {
    await tx.update(products).set({ stock: p.stock + quantity }).where(eq(products.id, p.id));
  }
}

type Product = typeof products.$inferSelect;
/** How many are left (null = not tracked). */
export function available(p: Product, option: string | null): number | null {
  if (option) return p.options.find((o) => o.name === option)?.stock ?? null;
  return p.stock;
}
/** Take stock for an order line (already locked). */
export async function takeStock(tx: DbOrTx, p: Product, option: string | null, quantity: number) {
  if (option) {
    await tx.update(products).set({ options: p.options.map((o) => (o.name === option && o.stock !== null ? { ...o, stock: o.stock - quantity } : o)) }).where(eq(products.id, p.id));
  } else if (p.stock !== null) {
    await tx.update(products).set({ stock: p.stock - quantity }).where(eq(products.id, p.id));
  }
}
