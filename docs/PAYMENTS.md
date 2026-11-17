# Online payments

How clients pay online, how studios connect, and what happens behind the scenes. Code: `apps/api/src/modules/payments/` (and the checkouts in `checkout/`, `shop/`, the refund in `sales/routes.ts`, renewals in `packages/payments.ts`). Preview: Setup, Payments, and the client checkout in the studio preview.

## The decisions

| Question | Choice | Why |
|---|---|---|
| Provider | **Stripe Connect** | Cards, Apple Pay, Google Pay, PayNow and GrabPay in Singapore, and studios each get their own account. |
| How studios connect | **Each studio has its own full Stripe account** (full Stripe dashboard; the studio pays Stripe's fees; Stripe collects what it needs from the studio) | The studio is the seller. Money goes straight to it; we never hold clients' money, which keeps us furthest from needing a licence from MAS (have a lawyer confirm). |
| How charges are made | **Direct charges** in the studio's account | The charge, the customer, refunds and disputes all live in the studio's Stripe account, where the studio can see them. |
| Our cut | **None for now** | Plan price only. Each plan has `paymentFeeBps` (0 today) in `packages/shared/src/features.ts`; above 0 it's taken as Stripe's application fee, with no other code change. |
| Stripe's fees | **Paid by the studio; it can pass them on** | Optional, off by default, for cards and GrabPay only, shown before paying. Never for PayNow: the banks' PayNow rules (ABS) don't allow surcharges. Card networks and studios' Stripe agreements have their own rules on card surcharges; the setting says so. |
| Who refunds | **Owners and admins** | The same people who can see sales (`viewPayments`). |

## For studios

1. **Connect** (Setup, Payments; owners only, as the account is in the business's name). `POST /payments/connect` creates the studio's Stripe account once and returns Stripe's sign-up page. Stripe asks for the business's details, the owner's details and a bank account.
2. **Stripe checks the details.** Stripe tells us as it goes (the `account.updated` webhook): the page shows what's still needed, and the owner and admins are told when payments are ready. `POST /payments/refresh` asks Stripe again.
3. **Choose how clients pay** (`PUT /payments/settings`): online on or off, paying at the studio on or off (at least one stays on, and the desk stays on until online is ready), and passing the fee on with the studio's own rates (Stripe's standard Singapore rates are filled in: 3.4% + S$0.50 for cards, 3.3% for GrabPay; set them to what's on the studio's account).
4. **Which methods clients see** is set in the studio's Stripe dashboard (Settings, Payment methods). Stripe now lists whatever the account has switched on; we no longer pick methods per payment, except to show only the one a client chose when a fee is passed on.

If a studio disconnects us from its Stripe dashboard, online payments stop, clients pay at the studio, memberships renew at the desk, and the owner is told.

## For clients

- **Checkout** (packages, gift cards, shop) offers the ways to pay (`GET /checkout/quote` → `payments.options`): "Pay online" or, when the fee is passed on, Card (with its fee), PayNow (no fee) and GrabPay (with its fee), plus "Pay at the studio" when the studio allows it. `payWith` on the checkout picks one.
- The order is made first, exactly as before (credit and discounts taken off, invoice issued), then Stripe's payment page opens for what's left. Paying completes the order the same way a desk payment does: the package is added, the gift card released, the shop order made ready, the invoice paid with its receipt. A fee passed on is added to the invoice as its own line once paid.
- **Memberships** are paid by card (including Apple Pay and Google Pay), and the card is kept by Stripe for the renewals. PayNow and GrabPay can't be saved for later, so they're offered for one-off purchases only.
- **Pay later:** an order left unpaid (or a renewal due) can be paid online from the app (`POST /orders/:id/pay`).
- **The card on file** (`GET/POST/DELETE /me/payment-card`): replace it on Stripe's page (nothing is charged), or remove it (asks first while a membership renews by card; renewals are then due at the studio).

## Renewals

When a membership renews, its saved card is charged with nobody present (an off-session payment in the studio's account; one attempt per invoice per day). A decline holds the membership with a plain reason ("not enough funds on the card", "the card has expired", "your bank wants you to confirm this payment"), and the existing retry rules apply (days 3 and 7, then it ends with any early termination fee). Saving a new card tries a held renewal straight away. Without a saved card, or a studio not connected, the renewal is due at the studio, as before.

## Refunds and disputes

- A refund "back to how they paid" for a sale paid online goes through Stripe (`POST /sales/invoices/:id/refunds`, which asks first: a sent refund can't be taken back). If Stripe refuses, nothing is recorded. PayNow refunds settle later (and only within 90 days of the payment); if one fails, the sale shows as not refunded again and the owner and admins are told to refund another way.
- Refunds made in the studio's Stripe dashboard are recorded against the sale, so reports agree.
- Refunds as studio credit don't touch Stripe.
- **Disputes** (a client asks their bank to reverse a payment): the owner and admins are told the amount and reason and to answer in their Stripe dashboard before the deadline.
- **Paid twice:** if an order is paid at the desk while its payment page is open, the page is closed; if a payment still arrives, or arrives for a cancelled order, it's refunded in full automatically.

## Webhooks

`POST /v1/public/payments/stripe/webhook`, signed with the endpoint's secret (`STRIPE_WEBHOOK_SECRET`; requests more than 5 minutes old are refused). Each event is handled once (`payment_events`); an error makes Stripe send it again. Events used, from connected accounts:

- `account.updated`, `account.application.deauthorized`
- `checkout.session.completed`, `checkout.session.async_payment_succeeded`, `checkout.session.async_payment_failed`, `checkout.session.expired`
- `refund.created`, `refund.updated`, `refund.failed`
- `charge.dispute.created`

The full payment page is fetched from Stripe rather than trusting the event's copy.

## Setting it up

1. A Stripe account for the platform, registered to the Singapore business, with **Connect** signed up (Dashboard, Connect, Get started, Platform). Test mode needs no activation.
2. `STRIPE_SECRET_KEY` (the platform's secret key; `sk_test_…` while testing, `sk_live_…` in production, which the API checks).
3. A webhook endpoint **for connected accounts** at `<PUBLIC_API_URL>/v1/public/payments/stripe/webhook` with the events above; its signing secret goes in `STRIPE_WEBHOOK_SECRET` (required in production when the key is set).
4. `PUBLIC_APP_URL` is where Stripe sends people back (`/payments/done`, `/payments/cancelled`, `/payments/card-saved`, `/setup/payments`).

The API talks to Stripe over its REST API, pinned to version `2026-10-28.endive` (`modules/payments/stripe.ts`), so Stripe's changes don't reach us until we choose to move.

## Tested

- API: `apps/api/test/payments.test.ts` against a stand-in for Stripe (connecting, signatures and repeats, paying online, fees for cards and GrabPay but not PayNow, the desk, paid twice, gift cards and the shop, memberships and saved cards, declines and retries, removing a card, refunds, failed refunds, dashboard refunds, disputes).
- Against Stripe's test mode (November 2026): reading the account's payment methods, a payment page with a card fee line showing only cards and wallets, fetching it back with its payment details, closing it, saving a customer, and a card-saving page. Creating studio accounts needs Connect signed up on the platform account first.

## Not built yet

- Moving existing cards from a studio's old system (done with Stripe's own data-migration process where the old system allows it).
- A card reader at the front desk (Stripe Terminal) and payouts reporting inside the app (studios see payouts in Stripe).
- Advice on tax for a fee passed on: it's part of the total like any line, so tax shown on invoices includes it. A GST-registered studio should check this with its accountant.
