// Online payments: Setup, Payments (connect Stripe, how clients pay, passing the fee on), paying
// online at checkout (with the fee shown first), and the card kept for membership renewals.
const { chromium, devices } = require("playwright");
const path = require("path");
const fs = require("fs");
const outDir = path.join(__dirname, "py");
fs.mkdirSync(outDir, { recursive: true });
const src = fs.readFileSync(path.join(__dirname, "..", "studio-calendar-preview.html"), "utf8").replace("  // MKT-JS-END", "  window.__t = (c) => eval(c);\n  // MKT-JS-END");
fs.writeFileSync(path.join(__dirname, "py-test.html"), src);
const file = "file://" + path.join(__dirname, "py-test.html");

(async () => {
  const browser = await chromium.launch();
  const results = [];
  const ok = (name, cond) => results.push([cond ? "PASS" : "FAIL", name]);
  for (const [label, opts] of [
    ["desk", { viewport: { width: 1360, height: 900 }, colorScheme: "light" }],
    ["desk-dark", { viewport: { width: 1360, height: 900 }, colorScheme: "dark" }],
    ["phone", { ...devices["iPhone 13"], colorScheme: "light" }],
  ]) {
    const p = await browser.newPage(opts);
    await p.addInitScript(() => { window.__quiet = true; });
    const errors = [];
    p.on("pageerror", (e) => errors.push(e.message));
    await p.goto(file);
    const ev = (code) => p.evaluate((c) => window.__t(c), code);
    const go = async (id) => { await p.evaluate((x) => { if (location.hash === "#" + x) location.hash = "home"; }, id); await p.waitForTimeout(60); await p.evaluate((x) => (location.hash = x), id); await p.waitForTimeout(150); };
    const role = async (r) => { await p.evaluate((x) => document.querySelector(`#roles [data-role="${x}"]`).click(), r); await p.waitForTimeout(150); };
    const press = async (sel) => { await p.evaluate((s) => document.querySelector(s).click(), sel); await p.waitForTimeout(150); };
    const shot = (n, full = true) => p.screenshot({ path: path.join(outDir, `${label}-${n}.png`), fullPage: full });
    const txt = async (sel) => ((await p.locator(sel).count()) ? p.locator(sel).first().textContent() : "");
    const toast = () => p.locator(".toast").last().textContent().catch(() => "");
    const noHScroll = () => p.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1);
    try {
    const buy0 = 0;
    const buy = async (planId) => { await ev(`state.ordered = null; state.coPay = null; state.buy = "${planId}"; go("checkout")`); await p.waitForTimeout(150); };

    // --- Before Stripe: checkout is pay at the studio, as now ---
    await role("client");
    await buy("p2");
    ok(`${label}: before connecting, no online choice`, (await p.locator('input[name="coPay"]').count()) === 0);
    await buy("p3");
    ok(`${label}: before connecting, a membership can't be bought at checkout`, /Ask at the front desk/.test(await txt('[data-order="place"]')) && (await p.locator('[data-order="place"]').isDisabled()));
    await go("payment-method");
    ok(`${label}: payment method says online payments aren't on yet`, /aren't on yet/.test(await txt("#pgOther")));

    // --- Setup, Payments ---
    await role("admin");
    await go("payments");
    ok(`${label}: Payments is a Setup tab`, /Payments/.test(await txt("#pgOther h2")) && (await p.locator('[data-hubtab="payments"]').count()) === 1);
    ok(`${label}: starts at Connect Stripe`, /Connect Stripe to take cards, PayNow and GrabPay/.test(await txt(".paystatus")) && (await p.locator(".paysteps li.now").count()) === 1);
    ok(`${label}: online can't be switched on yet`, await p.locator("#payOnline").isDisabled());
    await shot("1-connect");
    await press("#payConnect");
    ok(`${label}: Stripe's page (stand-in) opens`, /Stripe's own secure page/.test(await txt(".stripestand")));
    await press("#ssDone");
    ok(`${label}: then Stripe checks the details`, /Stripe is checking your details/.test(await txt(".paystatus")));
    await press("#payCheck");
    ok(`${label}: ready (${await toast()})`, /Ready: clients can pay online/.test(await txt(".paystatus")) && (await p.locator(".paysteps li.done").count()) === 2);
    // Clients always need a way to pay.
    await p.evaluate(() => { const d = document.querySelector("#payDesk"); d.checked = false; d.dispatchEvent(new Event("change")); });
    await p.waitForTimeout(120);
    await p.evaluate(() => { const d = document.querySelector("#payOnline"); d.checked = false; d.dispatchEvent(new Event("change")); });
    await p.waitForTimeout(120);
    ok(`${label}: can't switch off both (${await toast()})`, /Clients need a way to pay/.test(await toast()) && (await ev("STUDIO.pay.online")) === true);
    await p.evaluate(() => { const d = document.querySelector("#payDesk"); d.checked = true; d.dispatchEvent(new Event("change")); });
    await p.waitForTimeout(120);
    // Passing the fee on asks first, and shows an example.
    await p.evaluate(() => { const d = document.querySelector("#payPass"); d.checked = true; d.dispatchEvent(new Event("change")); });
    await p.waitForTimeout(150);
    ok(`${label}: passing the fee on asks first`, /card surcharges/.test(await txt(".warnmodal")));
    await press("#mProceed");
    const exText = await txt(".payex");
    ok(`${label}: example on a 30.00 package (${exText})`, /Card: \+SGD 1\.58/.test(exText) && /PayNow: no fee/.test(exText));
    ok(`${label}: payments page no h-scroll`, await noHScroll());
    await shot("2-ready");

    // --- Checkout: choose how to pay ---
    await role("client");
    await buy("p2");
    const choices = await p.locator('input[name="coPay"]').evaluateAll((xs) => xs.map((x) => x.value));
    ok(`${label}: card, PayNow, GrabPay and the desk (${choices})`, choices.join() === "card,paynow,grabpay,desk");
    ok(`${label}: card fee shown before paying`, /Card fee/.test(await txt(".checkout")) && /Continue to payment/.test(await txt('[data-order="place"]')));
    await p.evaluate(() => { const r = document.querySelector("#coPay_paynow"); r.checked = true; r.dispatchEvent(new Event("change")); });
    await p.waitForTimeout(150);
    ok(`${label}: no fee for PayNow`, !/(Card|GrabPay) fee<\/span><span>\+/.test(await p.locator(".checkout").innerHTML()) && /Continue to payment · SGD 100\.00/.test(await txt('[data-order="place"]')));
    await shot("3-checkout");
    await p.evaluate(() => { const r = document.querySelector("#coPay_card"); r.checked = true; r.dispatchEvent(new Event("change")); });
    await p.waitForTimeout(150);
    await press('[data-order="place"]');
    ok(`${label}: Stripe's page shows the fee and total`, /Card fee/.test(await txt(".stripestand")) && /Pay SGD/.test(await txt("#ssPay")));
    await shot("4-pay", false);
    await press("#ssPay");
    ok(`${label}: paid and on their account`, /is on your account/.test(await txt("#pgOther")) && /Paid with Visa ending 4242/.test(await txt("#pgOther")));
    ok(`${label}: the fee is on the order`, /card fee/.test(await txt(".summary")));

    // A membership is card only (no paying at the studio), and the card is kept.
    await buy("p3");
    const mchoices = await p.locator('input[name="coPay"]').evaluateAll((xs) => xs.map((x) => x.value));
    ok(`${label}: memberships are card only (${mchoices})`, mchoices.join() === "card");
    await press('[data-order="place"]');
    await press("#ssPay");
    await go("my-packages");
    ok(`${label}: card isn't on My packages any more`, (await p.locator(".paycard, #cardReplace").count()) === 0);
    const items = await p.evaluate(() => [...document.querySelectorAll("#side .navitem span:not(.count)")].map((x) => x.textContent));
    ok(`${label}: Payment method is in the client menu`, items.includes("Payment method"));
    await go("payment-method");
    ok(`${label}: card kept for renewals`, /•••• 4242/.test(await txt(".pmcard")) && /Unlimited monthly/.test(await txt(".pmwrap")));
    await press("#cardRemove");
    ok(`${label}: can't remove the card a membership renews on (${await toast()})`, /can't be removed/.test(await toast()) && /•••• 4242/.test(await txt(".pmcard")));
    await press("#cardReplace");
    await press("#ssSave");
    ok(`${label}: replaced with a new card`, /Mastercard/.test(await txt(".pmcard")) && /•••• 5454/.test(await txt(".pmcard")));
    ok(`${label}: payment method no h-scroll`, await noHScroll());
    await shot("5-card");

    // An order left unpaid can be paid later.
    await buy("p1");
    await p.evaluate(() => { const r = document.querySelector("#coPay_desk"); r.checked = true; r.dispatchEvent(new Event("change")); });
    await p.waitForTimeout(120);
    await press('[data-order="place"]');
    ok(`${label}: desk order can still be paid online`, (await p.locator("[data-paynow]").count()) === 1);
    await press("[data-paynow]");
    ok(`${label}: pay now asks how`, (await p.locator("[data-ssk]").count()) === 3);

    // The studio sees the payments.
    await ev("closeModal()");
    await role("admin");
    await go("payments");
    ok(`${label}: recent online payments listed`, (await p.locator(".tbl tbody tr").count()) === 2);
    } catch (err) { ok(`${label}: ran to the end (${err.message.split("\n")[0]})`, false); }
    ok(`${label}: no page errors (${errors.join(" | ")})`, errors.length === 0);
    await p.close();
  }
  await browser.close();
  for (const [r, n] of results) console.log(r, n);
  console.log(results.filter(([r]) => r === "FAIL").length, "failed of", results.length);
})();
