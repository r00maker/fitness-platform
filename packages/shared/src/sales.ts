/**
 * Sales: invoices, receipts, refunds, the studio's invoice design, and the shop.
 *
 * Every sale gets an invoice (packages, memberships and their renewals, gift cards, shop items,
 * fees). Once it's paid it also gets a receipt, with its own number, that can be emailed to the
 * client in one click. Refunds are made from the sale itself, so the invoice, receipt and
 * reports always agree.
 */
import { z } from "zod";

const id = z.uuid();
const money = z.number().int().min(0).max(100_000_000);

/** How a sale was paid. QR covers the region's instant payments (PayNow, DuitNow, PromptPay, QRIS). */
export const PAYMENT_METHODS = {
  card: "Card",
  cash: "Cash",
  qr: "QR payment (PayNow, DuitNow, PromptPay)",
  bank_transfer: "Bank transfer",
  online: "Paid online",
  credit: "Studio credit or discount",
  other: "Other",
} as const;
export type PaymentMethod = keyof typeof PAYMENT_METHODS;
const paymentMethod = z.enum(Object.keys(PAYMENT_METHODS) as [PaymentMethod, ...PaymentMethod[]]);

export const INVOICE_SOURCES = { package: "Package", renewal: "Membership renewal", gift_card: "Gift card", product: "Shop", fee: "Fee", desk_sale: "Package (sold at the desk)" } as const;
export type InvoiceSource = keyof typeof INVOICE_SOURCES;
export const INVOICE_STATUSES = { open: "Not paid yet", paid: "Paid", partly_refunded: "Partly refunded", refunded: "Refunded", void: "Cancelled" } as const;
export type InvoiceStatus = keyof typeof INVOICE_STATUSES;

const hex = z.string().regex(/^#[0-9a-fA-F]{6}$/, "Use a colour like #0C6156.");
/** Text colour on white must be readable (WCAG 3:1 for headings and lines). */
function contrastOnWhite(c: string) {
  const v = [1, 3, 5].map((i) => parseInt(c.slice(i, i + 2), 16) / 255).map((x) => (x <= 0.03928 ? x / 12.92 : ((x + 0.055) / 1.055) ** 2.4));
  const L = 0.2126 * v[0]! + 0.7152 * v[1]! + 0.0722 * v[2]!;
  return 1.05 / (L + 0.05);
}
const prefix = z.string().trim().regex(/^[A-Z0-9-]{1,8}$/, "Use up to 8 capital letters, numbers or dashes, like INV-.");

/** The studio's invoice and receipt design. Everything has a sensible default. */
export const invoiceSettings = z
  .object({
    /** The name that appears on invoices (often the registered business name). */
    businessName: z.string().trim().max(120),
    address: z.string().trim().max(300),
    /** e.g. "UEN", "GST Reg. No.", "SST No.", "Tax ID". Leave empty to hide. */
    registrationLabel: z.string().trim().max(30),
    registrationNumber: z.string().trim().max(40),
    email: z.union([z.email().max(200), z.literal("")]),
    phone: z.string().trim().max(40),
    website: z.union([z.string().trim().max(200).regex(/^https?:\/\//i, "Start the web address with https://"), z.literal("")]),
    logoFileId: id.nullable(),
    accentColor: hex.refine((c) => contrastOnWhite(c) >= 3, "That colour is too light to read on white paper. Pick a darker one."),
    invoicePrefix: prefix,
    receiptPrefix: prefix,
    /** e.g. "Payment is due at your first class." */
    paymentTerms: z.string().trim().max(300),
    /** e.g. "Thank you for training with us! Refunds follow our studio policy." */
    footerNote: z.string().trim().max(500),
    tax: z.object({
      enabled: z.boolean(),
      label: z.string().trim().min(1).max(20),
      /** Prices already include tax (usual in Southeast Asia); the invoice shows how much of it is tax. */
      ratePercent: z.number().min(0).max(30),
    }).partial(),
    /** Send the receipt by email as soon as a sale is paid (it can always be sent by hand too). */
    autoEmailReceipts: z.boolean(),
  })
  .partial();
export type InvoiceSettingsInput = z.infer<typeof invoiceSettings>;
export type InvoiceSettings = Required<Omit<z.infer<typeof invoiceSettings>, "tax">> & { tax: { enabled: boolean; label: string; ratePercent: number } };
export const DEFAULT_INVOICE_SETTINGS: Omit<InvoiceSettings, "businessName"> = {
  address: "",
  registrationLabel: "",
  registrationNumber: "",
  email: "",
  phone: "",
  website: "",
  logoFileId: null,
  accentColor: "#0C6156",
  invoicePrefix: "INV-",
  receiptPrefix: "RCT-",
  paymentTerms: "",
  footerNote: "Thank you for training with us!",
  tax: { enabled: false, label: "GST", ratePercent: 9 },
  autoEmailReceipts: false,
};

export const transactionsQuery = z.object({
  status: z.enum(["all", "open", "paid", "refunded"]).default("all"),
  source: z.enum(["all", ...(Object.keys(INVOICE_SOURCES) as InvoiceSource[])]).default("all"),
  q: z.string().trim().max(100).optional(),
  from: z.iso.date().optional(),
  to: z.iso.date().optional(),
  limit: z.coerce.number().int().min(1).max(500).default(100),
});
export const markInvoicePaid = z.object({ method: paymentMethod.default("card") });
export const refundInvoice = z.object({
  amountCents: money.refine((n) => n > 0, "Enter how much to refund."),
  reason: z.string().trim().min(1, "Add a short reason (it's kept with the sale).").max(300),
  /** Back to how they paid, or as studio credit they can spend later. */
  method: z.enum(["original_payment", "credit"]).default("original_payment"),
  /** Packages: also end it (unused classes are removed). Shop: put the items back in stock. */
  undoSale: z.boolean().default(false),
  acknowledge: z.array(z.string()).max(20).default([]),
});
export const documentQuery = z.object({ kind: z.enum(["invoice", "receipt"]).default("invoice") });

// ---------------------------------------------------------------------------
// Shop
// ---------------------------------------------------------------------------
const option = z.object({ name: z.string().trim().min(1).max(40), stock: z.number().int().min(0).max(100_000).nullable() });
export const productInput = z.object({
  name: z.string().trim().min(1, "Give it a name.").max(80),
  description: z.string().trim().max(1000).default(""),
  priceCents: money.refine((n) => n > 0, "Set a price."),
  photoFileId: id.nullable().default(null),
  /** Sizes or colours, each with its own stock. Leave empty for a single item. */
  options: z.array(option).max(20).default([]),
  /** Stock when there are no options. Null = don't track. */
  stock: z.number().int().min(0).max(100_000).nullable().default(null),
  onSale: z.boolean().default(true),
  category: z.string().trim().max(40).default(""),
});
export const updateProduct = productInput.partial().refine((u) => Object.keys(u).length > 0, "Nothing to change.");
export const shopCheckout = z.object({
  items: z.array(z.object({ productId: id, option: z.string().trim().max(40).optional(), quantity: z.number().int().min(1).max(20) })).min(1, "Your basket is empty.").max(20),
  useCredit: z.boolean().default(true),
});
export const SHOP_ORDER_STATUSES = { awaiting_payment: "Waiting for payment", ready: "Ready to collect", collected: "Collected", cancelled: "Cancelled" } as const;
