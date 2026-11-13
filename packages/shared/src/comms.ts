/**
 * Communication: one inbox for every way clients get in touch. WhatsApp first (using the studio's
 * existing WhatsApp Business app number, "coexistence"), email next.
 *
 * Meta charges for WhatsApp messages, and the platform doesn't pay for studios' messages, so a
 * studio chooses how to pay before it can use WhatsApp here:
 *  - "meta_direct": the studio adds a card in Meta (WhatsApp Manager → Billing) and Meta bills it.
 *  - "credits": the studio buys message credits from us and we pay Meta. Only offered once the
 *    platform is set up to pay Meta on studios' behalf.
 */
import { z } from "zod";

export const COMMS_CHANNELS = ["whatsapp", "email"] as const;
export type CommsChannel = (typeof COMMS_CHANNELS)[number];
export const COMMS_BILLING_MODES = { none: "Not set up", meta_direct: "Pay Meta directly", credits: "Buy message credits" } as const;
export type CommsBillingMode = keyof typeof COMMS_BILLING_MODES;
/** Credit packs, in US cents (Meta prices WhatsApp messages in US dollars). */
export const CREDIT_PACKS = [2000, 5000, 10000, 25000] as const;
/** What Meta charges for: marketing templates always; utility templates outside the 24-hour window; replies inside it are free. */
export const WA_CATEGORIES = { marketing: "Marketing", utility: "Service update", authentication: "Sign-in code" } as const;
export type WaCategory = keyof typeof WA_CATEGORIES;

const id = z.uuid();
export const commsBilling = z.discriminatedUnion("mode", [
  z.object({
    mode: z.literal("meta_direct"),
    /** The studio confirms it has added a payment method in Meta for its WhatsApp account. */
    paymentMethodAdded: z.literal(true, { message: "Add a payment method in WhatsApp Manager first, then tick the box." }),
  }),
  z.object({ mode: z.literal("credits") }),
]);
export const buyCredits = z.object({ amountCents: z.number().int().refine((n) => (CREDIT_PACKS as readonly number[]).includes(n), "Choose one of the credit packs.") });

/** After Meta's sign-up window (Embedded Signup) finishes, the app sends what Meta returned. */
export const connectWhatsapp = z.object({
  code: z.string().min(10).max(2000),
  businessAccountId: z.string().regex(/^\d{5,25}$/),
  phoneNumberId: z.string().regex(/^\d{5,25}$/),
  /** Keep using the WhatsApp Business app on the phone as well (coexistence). */
  coexistence: z.boolean().default(true),
});

export const replyText = z.object({ text: z.string().trim().min(1, "Write a message.").max(4096, "WhatsApp messages can be up to 4,096 characters.") });
export const sendTemplate = z.object({
  template: z.string().regex(/^[a-z0-9_]{1,512}$/),
  language: z.string().regex(/^[a-z]{2,3}(_[A-Z]{2})?$/),
  variables: z.array(z.string().trim().min(1).max(200)).max(10).default([]),
  acknowledge: z.array(z.string()).default([]),
});
export const startConversation = sendTemplate.extend({ clientId: id });
export const updateConversation = z
  .object({ status: z.enum(["open", "closed"]), assignedTo: id.nullable() })
  .partial()
  .refine((u) => Object.keys(u).length > 0, "Nothing to change.");
export const conversationsQuery = z.object({
  status: z.enum(["open", "closed", "all"]).default("open"),
  q: z.string().trim().max(100).optional(),
  mine: z.stringbool().default(false),
});
