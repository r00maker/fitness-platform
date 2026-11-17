# Market review, pricing and launch plan

Written in November 2026, at the MVP milestone. Competitor facts come from public sources (pricing pages, review sites, comparison write-ups), not hands-on use. Most competitor prices are third-party estimates because Mindbody, Glofox and Momence's upper tiers are quote-only. Check before quoting any of them to a customer.

Our goal, as a yardstick for everything below: **remove friction and complexity from client management, be easy to learn, and fit both independent studios and high-scale brands.**

## Where we stand

The product's depth matches or beats the market for an MVP. What stands between it and paying customers is not features or polish but the work to go live: **online payments, a real web and mobile app (the preview stands in for both today), and a way to move a studio's data across.**

### Where we're ahead

These answer the most common complaints about the incumbents: a confusing back end (Mindbody), fees and patchy support (Momence), surprise costs and contracts (Glofox).

- **Home with a to-do list.** "Needs attention" is sorted urgent / soon / when you can, with one button each. Most competitors open on a calendar or a wall of charts.
- **Plain English and soft warnings.** Mistakes are flagged and confirmed, never silently blocked, and every consequence is spelled out ("Attendance locks at midnight tonight; until then, no-show fees follow it").
- **The instructor phone flow.** Waiver gaps in red, health notes, "Mark everyone present", full class names.
- **Fit for Southeast Asia:**
  - the WhatsApp inbox;
  - shared packages (couples, families);
  - payroll with five pay types (Momence has none);
  - ClassPass;
  - closures that cancel and message automatically;
  - late-cancellation and no-show fees with a clear lock;
  - reviews with no Google review gating.

### UX improvements (most important first)

| # | Problem | Principle | Fix |
|---|---|---|---|
| 1 (built) | The admin menu has 24 items in 6 groups. A new owner sees Leads, Agents, Shop, Loyalty and Payroll on day one. | Too many choices (Hick's law); show features as they're needed | Feature switches per studio with a lean default, and merged menu items. Aim for about 12. |
| 2 (built) | Studio rules has 32 settings in 8 sections on one ~3,200px page. | Too much to take in; good defaults (Tesler's law) | A first-run setup ("What kind of studio are you?") that fills sensible defaults, search within settings, and "Changed from default" marks. |
| 3 | Clients on a phone see an announcement, a banner carousel and 5 filter controls before the first class. | Put the main task first; follow what clients already know (Jakob's law) | A horizontal date strip with a class list. Banners shrink to one line, and filters sit behind one "Filter" button. |
| 4 | Instructors on a phone land on "24 people booked". Their next class and check-in are below the fold. | Match how long people spend in the app | "Up next: check in" first, and a Check-in mode with large name rows and search. |
| 5 | Four AI surfaces (Ask, Agents, writers, AI recaps). Agents overlap with marketing journeys. | Consistency | One Ask, plus "Write with AI" next to text boxes. Reminder agents become journeys. |
| 6 | Three ways to message clients (announcements, banners, campaigns). | Organise by what people want to do | One "Tell clients" flow, with channel and placement as options. |

### Feature gaps against competitors

| When | Gap | Who has it / why |
|---|---|---|
| **Before launch** | ~~Online payments: cards, PayNow, GrabPay, cards kept on file for memberships~~ (built, `docs/PAYMENTS.md`) | Everyone |
| | ~~Client booking on the web, plus a booking widget for the studio's own website~~ (built, `docs/WEB_BOOKING.md`) | Everyone |
| | ~~Importing data: clients, remaining credits, memberships, future bookings~~ (built, `docs/MIGRATION_AND_HQ.md`) | Moving data is the main thing stopping studios from switching |
| **Soon after** | Self check-in (QR code or tablet) | Momence, Mindbody |
| | Xero / QuickBooks link | Popular with Singapore SMEs |
| | Card reader at the front desk | |
| | Location managers (an admin for one location only) | Chains need this |
| **Later** | Branded app (the $399 tier) | Mindbody, Glofox, Vibefam, Rezerv |
| | Door access | Vibefam |
| | Calendar sync, translations, open API | |

### What might not be necessary

None of these need deleting. Most should start **switched off**, so independent studios see a simple product.

- **Loyalty points, referrals, credit and gift cards** are four retention tools. Keep gift cards on; switch the others off by default.
- **Leads/ads funnel, Shop and pickups** are niche for small studios. Switch them off by default.
- **Celebration pop-ups:** keep them light.
- **The Gmail/Outlook inbox:** pause it. Google requires a yearly independent security check for apps that read Gmail, which is real cost for little gain. WhatsApp is the channel that matters in Southeast Asia.
- **Video on demand and a marketplace:** skip both. ClassPass already covers discovery.

## Pricing

### The market (about USD a month, one location)

| Product | Price | Branded app | Notes |
|---|---|---|---|
| PunchPass | 59 – 149 | No | Month to month |
| Momence | Free / 60 / 199 | +250 | Platform fee of about 2.5–5%, plus 3.9% + 30¢ card processing |
| Mindbody | ~99–159 / ~259–279 / ~499+ | Paid add-on | 12–36 month contracts common |
| Glofox | From 99; Elite ~250–400+ | Elite tier | Quote only, annual contracts |
| Mariana Tek | ~179+ | Included | Premium boutique, quote only |
| Walla | 320 | | Boutique only |
| Vibefam (SG) | 89 (annual) / 109 monthly, up to ~239 | Available | Says it qualifies for Singapore's 50% grant (EDGE, formerly PSG) |
| Rezerv (SG) | S$55 / 185 / 320 (≈ US$42 / 140 / 245) | In the S$320 tier | |

Studios usually spend about 2–5% of revenue on software. That puts $299 at studios making US$10–15k+ a month: boutique reformer studios, not solo teachers.

### Is USD 299 / 399 right? (before the switch to SGD)

- **For boutique and multi-location studios, yes.** $399 with the app costs less than Momence Custom with its app ($449), before Momence's processing. It also undercuts Mindbody's upper tiers, with no contract. The $100 difference for the app is cheap against the market ($250 at Momence). Lead with total cost: "all-in, no cut of your sales, no lock-in", plus a calculator against Momence and Mindbody.
- **For independent studios, no.** PunchPass, Rezerv and Vibefam start at $42–$109. In Singapore, $399 is about 1.6–3× the local options, and Vibefam advertises a 50% grant on top.

### The plans (agreed November 2026, priced in SGD)

Plans are priced in Singapore dollars: we're based in Singapore and Stripe settles our payouts in SGD, so charging in SGD avoids conversion losses and makes the prices read naturally to our first studios. Earlier drafts were in USD (99 / 299 / 599); the SGD prices are a little lower in real terms (SGD 129 / 399 / 699 is about USD 100 / 310 / 540) and still well below Mindbody and Momence with their apps. GST isn't charged until we pass S$1M a year in sales. Other currencies (MYR, HKD, AUD) can come later with local prices, not conversions.

Signature was lowered from SGD 799 to SGD 699 and the Growth app add-on from SGD 129 to SGD 99 (November 2026): Signature is the plan we want brands on, so its price should be an easy yes, and a cheap app add-on keeps Growth with the app (SGD 498) clearly below Signature.


| | **Essentials** | **Growth** | **Signature** |
|---|---|---|---|
| Who it's for | One independent studio | Studios with a team, up to 3 locations | Brands with several locations |
| Price | SGD 129 a month, 1 location | SGD 399 a month, up to 3 locations | SGD 699 a month, up to 5 locations, +SGD 199 for each extra |
| Your own app | | +SGD 99 a month (flat, not per location) | Included |
| Admin accounts | 1 | 1 per location | No limit |
| Features | Everything to run classes, take bookings and get paid, plus reviews, gift cards and payroll | + marketing (emails, journeys, campaigns, banners, refer a friend, loyalty), the WhatsApp inbox, the shop | + leads and ad tracking, AI workflows (agents, AI writing, AI recaps) |
| Setup, data move, support | Same on every plan | Same on every plan | Same on every plan |

On the pricing page:

> **Essentials: SGD 129/month.** For one independent studio. Everything to run classes, take bookings, pay instructors and get paid.
> **Growth: SGD 399/month.** For studios with a team, up to 3 locations. Adds marketing, WhatsApp and the shop. Want your own app? +SGD 99/month.
> **Signature: SGD 699/month.** For brands with up to 5 locations (+SGD 199 for each extra). Your own app included, plus AI that does the work for you.
> **Every plan:** we set you up and move your data for you, the same support, and no cut of your sales.

Why it's shaped this way:

- **One job per plan:** run your studio, fill your classes, run your brand. Ask (AI chat) and instructor and front desk accounts are on every plan.
- **Simple numbers.** Growth is "up to 3 locations" with no per-location extras; 4 or more locations means Signature. Earlier drafts priced Growth per location, but that made Growth cheaper than Signature for large chains.
- **The steps push in the right direction:** a studio adding a 4th location moves to Signature (SGD 699 with the app included, against SGD 498 for Growth with the app); 10 locations cost SGD 1,694 a month (about USD 1,300) against roughly USD 5,000 or more on Mindbody.
- **Service is the same everywhere.** The done-for-you setup has a standard scope: one move of standard data (clients, packages with classes left, memberships, upcoming bookings), plus setting up classes, rules and the plan's features. Unusual moves (several old systems, custom data) are quoted separately.
- **We recommend the plan** from a short "help me choose" questionnaire (locations, team size, packages or memberships, marketing or WhatsApp from the app, own app) or a first call, so studios rarely have to work it out themselves. Test the pricing page with five studio owners during the pilot: if they can say which plan is theirs, it's clear enough.
- **Still apply:** two months free for paying annually with a no-lock-in monthly option, WhatsApp message costs passed through at cost, a founding price for pilot studios, and the EDGE grant listing in Singapore (it could halve any plan).

How it works in the product: our staff set the plan (`PLAN_INFO` in `packages/shared/src/features.ts`, see "Plans" in `PRODUCT_NOTES.md`); each plan sets which features can be switched on and the rules a new studio starts with.

## Is each plan worth its price? (devil's advocate, November 2026)

Independent evidence on what owners want is thin: most "surveys" are published by software vendors. Treat the points below as direction, and replace them with our own pilot interviews (script below).

### What owners and clients actually ask for

- **Easy to learn, not more features.** Mindbody reviewers complain of "too many menus and reports"; several reviews note small studios pay for far more than they use. Boutiques mostly use booking, payments, scheduling, messages and basic reports.
- **Support that answers.** Capterra rates customer service 3.7/5 (Momence) and 3.8/5 (Mindbody); "slow response times, inconsistent answers".
- **No hidden prices, no lock-in, no cut of sales, keep my data.** Prices behind demos, 3-year contracts and percentage fees are the common complaints, along with fear of losing data when leaving.
- **Time.** Owners are stretched (one vendor-cited survey: about 52 hours a week, 4 on admin).
- **Full classes and fewer lost clients.** ClassPass says the average studio fills only 37% of capacity itself. Follow-up turns trials into members (vendor data: 58% with 5+ touches vs 19% with 1–2), and many people stop coming without cancelling (53% of gym members in one consumer survey).
- **Instructor pay without spreadsheets.** Per-class pay with attendance bonuses is described as one of the most error-prone manual jobs.
- **Clients:** book any time, easy cancelling and quick refunds, clear prices; in Singapore, WhatsApp and PayNow.
- **AI:** owners mostly use ChatGPT or Claude themselves. The concrete jobs they mention are fast replies to enquiries, win-back messages and review replies. No evidence that owners pay extra for "AI workflows" as a category.
- **Branded apps:** the evidence is almost all from vendors selling them; demand is unproven.

### Verdict by plan

- **Essentials (SGD 129): compelling.** It answers the top complaints: easy, payroll included, no cut of sales, free move, same support. It only works once online payments and client web booking exist. Open question: WhatsApp booking reminders (included, or at cost).
- **Growth (SGD 399): worth it if sold as results, not tools.** As a "marketing suite" it adds the complexity owners complain about. Its real value is turning trials into members and winning back lapsed clients, done for them. If a member is worth around SGD 200–330 a month, one extra kept member a month pays for the step up.
- **Signature (SGD 699): the weakest case today.** AI workflows and the branded app have the least evidence of demand; leads and ad tracking suit only studios running ads. What brands would pay for (location managers, comparing locations, rules set once for the brand, shared clients and payroll across locations) is mostly not built yet. The price is fair for real brands (about SGD 160–200 a location) but not compelling for a single premium studio.

### What to change

1. Lead with the promises that answer the top complaints: easy to learn, real support, no cut of sales, we move you for free, no lock-in.
2. Rebuild Growth around results: three journeys switched on at setup (intro-offer follow-up, win-back after 3–4 weeks away, first-class welcome), a results line on Home ("brought back 6 clients this month"), and an at-risk client list.
3. Build the brand-wide tools before selling Signature, and describe its AI as named jobs: instant WhatsApp replies to enquiries day and night, drafted review replies, a monthly "what to do next" report.
4. Don't headline the branded app until pilots show clients use it.
5. Decide WhatsApp booking reminders for Essentials.

### Finding out what users really want (pilot research)

- **Interviews:** 8–10 owners across independent, boutique and multi-location studios, 30 minutes each, about their week rather than features.
- **Ranking:** each owner picks their top 3 of 12 outcomes.
- **Price questions** for each plan: at what price is it too cheap to trust, a bargain, getting expensive, too expensive.
- **Pricing-page test:** show the three plans to pilot studios and note which they choose and why.
- **Usage:** after 3 months, check which features pilot studios use weekly, and move features between plans by real use.

**Interview script (30 minutes):**

1. Tell me about your studio: locations, team, classes a week, how clients pay.
2. Walk me through last Monday, from opening to closing. Where did the time go?
3. What took the most time last week that you wish you didn't have to do?
4. When did you last lose a client? How did you find out, and what did you do?
5. How do new people find you, and what happens after their first class?
6. How do you work out what to pay instructors? How long does it take, and what goes wrong?
7. What does your current software do well? What do you work around?
8. What would make you switch, and what stops you?
9. If you could have one thing done for you every week, what would it be?
10. Show the three plans: which one is you, and what would make it a clear yes?

Write down their words, not our feature names, and note anything they've already paid for (a tool, an assistant, an agency): that's evidence of willingness to pay.

### Sources for this section

[Capterra: Mindbody](https://www.capterra.com/p/40229/MINDBODY/reviews/), [Capterra: Momence](https://www.capterra.com/p/229516/Ribbon/reviews/), [Capterra: Mindbody vs Momence](https://www.capterra.com/compare/40229-229516/MINDBODY-vs-Ribbon), [Paige Maria Creative](https://www.paigemariacreative.com/software-digital-tools/mindbody-reviews-what-studio-owners-are-actually-saying), [Vibefam: Pilates software on Reddit](https://vibefam.com/pilates-studio-software-reddit-2026/), [ClassPass 2026 Industry Impact Report](https://classpass.com/partners/2026-industry-impact-report), [Zenoti: AI for gyms](https://www.zenoti.com/thecheckin/ai-for-gyms-and-fitness-centers), [Studio-deck: intro offers](https://studio-deck.com/guides/convert-intro-offers-to-members), [Buildify: app cost](https://usebuildify.com/post/fitness-studio-app-cost-2026), [AI tools for gyms (25 examples)](https://theaismallbusiness.com/compare/ai-operations-tools-for-gyms-and-studios/), [The Business of Pilates: instructor pay](https://thebusinessofpilates.substack.com/p/your-instructor-pay-structure-is), [Hashmeta: WhatsApp in Singapore](https://hashmeta.com/blog/whatsapp-statistics-singapore-complete-guide-to-messaging-trends-business-opportunities).

## Launch plan

### Phase 0: ready for production (blocking)

- **Real apps:** a staff web app that works on computers and phones, and client booking as a phone-friendly web app plus a website widget. Native branded apps come later, for the $399 tier.
- **Payments with Stripe Connect.** Money goes straight to the studio, and Stripe supports cards, PayNow and GrabPay in Singapore. Studios don't need a separate payment account to sign up with us. Holding clients' money ourselves could need a licence from MAS (Singapore's financial regulator); have a lawyer confirm.
- **Import tools** for CSV files and exports from Mindbody, Momence and Glofox, plus a done-for-you move for pilot studios.
- **Hosting in Singapore** (see `HOSTING_AND_DEPLOYMENT.md`), with backups, error tracking, uptime monitoring and a status page. Get a penetration test before real client data goes in.
- **Data protection under PDPA** (Singapore's data protection law): a privacy policy, a data processing agreement for studios, a named data protection officer, and the 3-day breach notice to the regulator. Health notes need particular care.
- **Studio terms, and support** over WhatsApp, with a help centre built from `help/STUDIO_GUIDE.md`.

### Phase 1: pilot with 3–5 studios (about 8–12 weeks)

- **The mix:** one independent studio, two boutique reformer studios and one multi-location brand. They run free, with a locked founding price afterwards.
- **Run alongside their current system for 2 weeks,** then switch when memberships renew, so nobody is charged twice.
- **Watch 5 people per role** doing real tasks:
  - an owner building a week and selling a package;
  - Front of House checking in a walk-in;
  - an instructor checking in a class on their phone;
  - a client booking and cancelling.
- **Measure:** time to set up (target under a day), how many tasks succeed, support requests per studio per week, no-show rate, and "would you pay $X?".

### Phase 2: paid beta with 10–25 studios

- A founding price of 50% off for 12 months, locked in.
- Studio owners recommending studio owners. Instructors who teach at several studios are a natural way to spread the word.
- Collect written case studies.

### Phase 3: launch

- **Public pricing with the total-cost calculator,** and an offer to move studios across in a weekend.
- **The EDGE grant listing.**
- **Partnerships:** Pilates teacher-training schools, reformer suppliers and ClassPass.
- **Comparison content.** Vibefam publishes a lot of it, and it shows up in searches.
- **Malaysia next.** Its studios are similar, then the rest of the region.

## Sources

- Momence: [StudioStackPro](https://studiostackpro.com/blog/momence-pricing-guide/), [Pembee](https://www.pembee.app/blog/momence-vs-mindbody), [Studio Software Advice](https://studiosoftwareadvice.com/momence-for-pilates-studios-review-and-fit-guide-2026/), [Time2book](https://www.time2book.me/blog/momence-pricing)
- Mindbody: [FitBudd](https://www.fitbudd.com/post/how-much-does-mindbody-cost), [Gymdesk](https://gymdesk.com/blog/mindbody-fees), [Makocrm](https://makocrm.so/blog/mindbody-pricing-2026), [Studio-deck](https://studio-deck.com/pricing/mindbody)
- Glofox: [PushPress](https://www.pushpress.com/blog/glofox-pricing), [Softabase](https://softabase.com/software/fitness-gym-management/glofox), [OfferingTree](https://www.offeringtree.com/blog/mindbody-vs-glofox/)
- PunchPass: [pricing page](https://punchpass.com/pricing), [Software Advice](https://www.softwareadvice.com/product/451226-Punchpass/)
- Vibefam: [pricing page](https://vibefam.com/pricing/), [Singapore page](https://vibefam.com/sg/)
- Rezerv: [GetApp](https://www.getapp.com/recreation-wellness-software/a/rezeve/), [Software Advice](https://www.softwareadvice.com/salon/rezeve-profile/), [Vibefam's review](https://vibefam.com/rezerv-review-pricing-features-pros-cons-2026/)
- Others: [Mariana Tek pricing](https://marianatek.com/pricing), [Arketa (PricingSaaS)](https://pricingsaas.com/companies/arketa), [bsport (Capterra)](https://capterra.com/p/197172/bsport/), [Walla (OfferingTree)](https://www.offeringtree.com/?p=39729)
- EDGE grant: [Innovativehub](https://innovativehub.com.sg/psg-replaced-by-edge-grant/), [FT Synergist](https://www.ftsynergist.com/insights/what-happens-to-psg-after-september-2026), [Papercut](https://papercutsg.com/post/psg-vs-edge-grant-singapore)
- Owner complaints: [switching from Mindbody](https://vibefam.com/switching-from-mindbody-reddit-2026/), [Momence on Reddit](https://vibefam.com/momence-reviews-reddit-2026/)
- Software spend: [StudioGrowth](https://studiogrowth.com/fitness-studio-software-pricing-guide/)
