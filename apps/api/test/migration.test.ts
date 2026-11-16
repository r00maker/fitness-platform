import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { and, eq } from "drizzle-orm";
import ExcelJS from "exceljs";
import { auditLog, bookings, classSessions, clientHistory, clientPackages, clientTagAssignments, clientTags, creditGrants, memberships, migrationFiles, migrationJobs, users } from "../src/db/schema.js";
import { purgeMigrationFiles } from "../src/modules/migration/engine.js";
import { detectKind, findHeaderRow, mapHeaders } from "../src/modules/migration/fields.js";
import { inferDateOrder, readDate, readMoney, readPhone, readYes } from "../src/modules/migration/normalize.js";
import { readFile } from "../src/modules/migration/parse.js";
import { app, dayOffset, db, hqStaff, outbox, pool, reset, studio } from "./helpers.js";

beforeEach(reset);
afterAll(async () => {
  await app.close();
  await pool.end();
});

const b64 = (s: string | Buffer) => (typeof s === "string" ? Buffer.from(s, "utf8") : s).toString("base64");

describe("reading files from old systems", () => {
  it("reads CSV in any common shape: BOM, semicolons, Windows-1252, quoted line breaks", async () => {
    const [a] = await readFile("a.csv", Buffer.from("﻿Name;Email\n\"Tan, Mei\";mei@example.com\n", "utf8"));
    expect(a!.rows).toEqual([["Name", "Email"], ["Tan, Mei", "mei@example.com"]]);
    const [b] = await readFile("b.csv", Buffer.from([...Buffer.from("Name,Notes\nJos"), 0xe9, ...Buffer.from(',"line one\nline two"\n')]));
    expect(b!.rows[1]).toEqual(["José", "line one\nline two"]);
    const [t] = await readFile("c.txt", Buffer.from("Name\tEmail\nAna\tana@example.com\n"));
    expect(t!.format).toBe("tsv");
  });

  it("reads Excel (every sheet, real dates) and 'XLS' downloads that are web pages; refuses old .xls clearly", async () => {
    const wb = new ExcelJS.Workbook();
    const ws = wb.addWorksheet("Clients");
    ws.addRow(["Email", "Expires", "Phone"]);
    ws.addRow(["mei@example.com", new Date(Date.UTC(2027, 11, 31)), "91234567"]);
    wb.addWorksheet("Empty");
    wb.addWorksheet("Prices").addRow(["Pass", "Price"]);
    const sheets = await readFile("x.xlsx", Buffer.from(await wb.xlsx.writeBuffer()));
    expect(sheets.map((s) => s.sheet)).toEqual(["Clients", "Prices"]);
    expect(sheets[0]!.rows[1]).toEqual(["mei@example.com", "2027-12-31", "91234567"]);

    const [h] = await readFile("report.xls", Buffer.from("<html><table><tr><th>Name</th><th>Email</th></tr><tr><td>Ana &amp; Co</td><td>ana@example.com</td></tr></table></html>"));
    expect(h).toMatchObject({ format: "html", rows: [["Name", "Email"], ["Ana & Co", "ana@example.com"]] });

    await expect(readFile("old.xls", Buffer.from([0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1, 0, 0]))).rejects.toThrow(/save it as .xlsx or .csv/);
  });

  it("finds the header row under report titles, recognises the kind and the columns", () => {
    const rows = [["Client List"], ["Printed 16/11/2026"], ["Client ID", "First Name", "Last Name", "E-mail Address", "Mobile Phone", "Email Opt-in"], ["1", "Mei", "Tan", "mei@example.com", "9123 4567", "Yes"]];
    const hr = findHeaderRow(rows);
    expect(hr).toBe(2);
    expect(detectKind(rows[hr]!)).toBe("clients");
    expect(mapHeaders("clients", rows[hr]!)).toMatchObject({ externalId: 0, firstName: 1, lastName: 2, email: 3, phone: 4, marketingEmail: 5 });
    expect(detectKind(["Member", "Pass", "Remaining", "Expiry"])).toBe("packages");
    expect(detectKind(["Member ID", "Contract", "Billing Frequency", "Next Billing Date"])).toBe("memberships");
    expect(detectKind(["Client", "Class", "Date", "Time"], "upcoming-bookings.csv")).toBe("bookings");
    expect(detectKind(["Client", "Class", "Date", "Status"], "attendance-history.csv")).toBe("visits");
  });

  it("cleans values strictly: never guesses", () => {
    expect(inferDateOrder(["03/04/2026", "25/04/2026"])).toBe("dmy");
    expect(inferDateOrder(["04/25/2026"])).toBe("mdy");
    expect(inferDateOrder(["03/04/2026", "05/06/2026"])).toBe("ambiguous");
    expect(readDate("03/04/2026", null).problem).toMatch(/day-first or month-first/);
    expect(readDate("03/04/2026", "dmy").value).toBe("2026-04-03");
    expect(readDate("Apr 3, 2026 7:30 PM", null).value).toBe("2026-04-03 19:30");
    expect(readDate("31/02/2026", "dmy").problem).toMatch(/isn't a real date/);
    expect(readPhone("9123 4567", "SG").value).toBe("+6591234567");
    expect(readPhone("6.59123E+09", "SG").problem).toMatch(/damaged by Excel/);
    expect(readMoney("SGD 1,280.00").value).toBe(128000);
    expect(readMoney("(15.00)").value).toBe(-1500);
    expect(readYes("Subscribed").value).toBe(true);
    expect(readYes("maybe")).toMatchObject({ value: null, problem: expect.stringMatching(/isn't clearly yes or no/) });
  });
});

describe("moving a studio", () => {
  it("the moving form comes before the app: a private link for the owner, or filled in by our team", async () => {
    const hq = await hqStaff("onboarding");
    const made = await hq.call("POST", "/platform/studios", { name: "Core & Flow", plan: "growth", sendMovingForm: true, inviteOwner: false, owner: { email: "mei@example.com", firstName: "Mei", lastName: "Tan" } });
    expect(made.status, JSON.stringify(made.body)).toBe(201);
    expect(made.body.owner).toMatchObject({ invited: false, inviteExpiresAt: null });
    expect(made.body.movingForm).toMatchObject({ emailedOwner: true, url: expect.stringMatching(/\/moving-form\/[a-f0-9]{48}$/) });
    const orgId = made.body.id, jobId = made.body.movingForm.jobId;
    // Only the moving form went out: the app invite waits until the studio is set up.
    expect((await outbox("staff.invite"))).toHaveLength(0);
    const [mail] = await outbox("migration.form");
    expect(mail!.data).toMatchObject({ firstName: "Mei", studioName: "Core & Flow", link: made.body.movingForm.url, days: 21 });
    const token = made.body.movingForm.url.split("/").pop();
    const form = (path = "") => `/v1/public/moving-form/${token}${path}`;

    // No sign-in needed; a wrong link finds nothing; the studio app has no moving page.
    const opened = await app.inject({ method: "GET", url: form() });
    expect(opened.statusCode).toBe(200);
    expect(opened.json()).toMatchObject({ studio: "Core & Flow", job: { status: "intake", sent: false, canEdit: true } });
    expect((await app.inject({ method: "GET", url: `/v1/public/moving-form/${"0".repeat(48)}` })).statusCode).toBe(404);
    const s = await studio();
    expect((await s.owner.call("GET", "/migration")).status).toBe(404);

    const missing = await app.inject({ method: "PUT", url: form(), payload: { oldPlatform: "Mindbody", access: "password", submit: true } });
    expect(missing.statusCode).toBe(400);
    expect(missing.json().error.message).toMatch(/when you'd like to switch, the login to use, the temporary password, your OK/);
    const sent = await app.inject({ method: "PUT", url: form(), payload: { oldPlatform: "Mindbody", switchDate: "2026-12-01", access: "password", accessLogin: "owner@studio.sg", accessPassword: "temp-Pass-123", activeClients: 250, dateFormat: "dmy", consent: true, submit: true } });
    expect(sent.statusCode, sent.body).toBe(200);
    expect(sent.json().job).toMatchObject({ status: "submitted", step: 2, passwordSaved: true, sent: true });
    expect(sent.body).not.toContain("temp-Pass-123");
    expect(sent.json().exportTips[0]).toMatch(/Mailing Lists/);
    const up = await app.inject({ method: "POST", url: form("/files"), payload: { filename: "clients.csv", data: Buffer.from("Name,Email\nAna Lim,ana@example.com\n").toString("base64") } });
    expect(up.statusCode).toBe(201);
    expect(up.json().files[0]).toMatchObject({ kind: "clients", rows: 1 });
    const [job] = await db.select().from(migrationJobs).where(eq(migrationJobs.id, jobId));
    expect(job).toMatchObject({ status: "files", dateOrder: "dmy" });
    expect(job!.accessSecretEnc).toMatch(/^v1:/);
    expect(job!.formOpenedAt).not.toBeNull();

    // Our team sees it in the queue and the move; support can't touch moves.
    const support = await hqStaff("support");
    expect((await support.call("POST", `/platform/studios/${orgId}/migrations/${jobId}/access`, {})).status).toBe(403);
    expect((await hq.call("GET", "/platform/migrations")).body.migrations[0]).toMatchObject({ status: "files", next: "Check the files", access: "password", switchDate: "2026-12-01" });
    expect((await hq.call("GET", `/platform/studios/${orgId}/migrations/${jobId}`)).body.form).toMatchObject({ sentAt: expect.any(String), openedAt: expect.any(String), submittedAt: expect.any(String) });
    const access = await hq.call("POST", `/platform/studios/${orgId}/migrations/${jobId}/access`, {});
    expect(access.body).toMatchObject({ login: "owner@studio.sg", password: "temp-Pass-123" });
    expect((await db.select().from(auditLog).where(and(eq(auditLog.orgId, orgId), eq(auditLog.action, "migration.password_viewed")))).length).toBe(1);

    // A new link replaces the old one.
    const again = (await hq.call("POST", `/platform/studios/${orgId}/migrations/${jobId}/form-link`, {})).body;
    expect(again.url).not.toBe(made.body.movingForm.url);
    expect((await app.inject({ method: "GET", url: form() })).statusCode).toBe(404);

    // Our team can fill it in on a call too.
    const byUs = await hq.call("PUT", `/platform/studios/${orgId}/migrations/${jobId}/intake`, { activeClients: 260, notes: "Owner says ~20 clients have no email." });
    expect(byUs.body.intake).toMatchObject({ activeClients: 260, oldPlatform: "Mindbody" });
    expect(byUs.body.intake).not.toHaveProperty("accessPassword");

    // Once set up, invite the owner to the app.
    const inv = await hq.call("POST", `/platform/studios/${orgId}/invite-owner`, {});
    expect(inv.body.email).toBe("mei@example.com");
    expect(await outbox("staff.invite")).toHaveLength(1);
    expect((await hq.call("GET", `/platform/studios/${orgId}`)).body.team[0]).toMatchObject({ firstName: "Mei", signIn: "invited" });
  });

  it("checks, imports accurately, accounts for every row, and can be undone", async () => {
    const s = await studio();
    const [chloe] = await db.select().from(users).where(eq(users.id, s.c1.id));
    const tomorrow = dayOffset(1);
    const [session] = await db.insert(classSessions).values({ orgId: s.orgId, classTypeId: s.classTypeId, locationId: s.locationId, instructorId: s.ana.id, capacity: 10, startsAt: new Date(`${tomorrow}T07:00:00+08:00`), endsAt: new Date(`${tomorrow}T07:50:00+08:00`) }).returning();
    const hq = await hqStaff("onboarding");
    const { id: jobId } = (await hq.call("POST", `/platform/studios/${s.orgId}/migrations`, {})).body;
    const base = `/platform/studios/${s.orgId}/migrations/${jobId}`;
    await hq.call("PUT", `${base}/intake`, { oldPlatform: "Mindbody", activeClients: 40, dateFormat: "unsure" });

    const clientsCsv = [
      "Client List,,,,,,,,,",
      "Printed today,,,,,,,,,",
      "ID,First Name,Last Name,Email,Mobile Phone,Client Since,Email Opt-in,Account Balance,Tags,Notes",
      `1001,Chloe,Different,${chloe!.email.toUpperCase()},+65 8123 4567,03/04/2024,Yes,,VIP,`,
      "1002,Mei Ling,Tan,mei@example.com,91234567,05/06/2025,Yes,\"SGD 25.00\",\"VIP; Prenatal\",Lower back injury",
      "1003,Raj,Kumar,raj@example.com,6.59123E+09,01/02/2025,No,,,",
      "1004,Siti,,,98765432,02/03/2025,maybe,,,",
      "1005,Mei Ling,Tan,MEI@example.com,,,,,,",
      "Total,5,,,,,,,,",
    ].join("\r\n");
    const up = await hq.call("POST", `${base}/files`, { filename: "clients.csv", data: b64(clientsCsv) });
    expect(up.status, JSON.stringify(up.body)).toBe(201);
    expect(up.body.files[0]).toMatchObject({ kind: "clients", headerRow: 3, rows: 6 });
    expect((await hq.call("POST", `${base}/files`, { filename: "again.csv", data: b64(clientsCsv) })).body.error.code).toBe("same_file");

    const wb = new ExcelJS.Workbook();
    const ws = wb.addWorksheet("Active passes");
    ws.addRow(["Client ID", "Client Name", "Pass Name", "Remaining", "Total Classes", "Expiration Date", "Price"]);
    ws.addRow(["1002", "Mei Ling Tan", "10 Class Pack", 7, 10, new Date(Date.UTC(2027, 11, 31)), 280]);
    ws.addRow(["1004", "Siti", "5 Class Pack", 3, 5, new Date(Date.UTC(2027, 11, 31)), 150]);
    ws.addRow(["1003", "Raj Kumar", "10 Class Pack", 0, 10, new Date(Date.UTC(2027, 11, 31)), 280]);
    ws.addRow(["1001", "Chloe", "Old Pack", 2, 10, new Date(Date.UTC(2025, 0, 1)), 200]);
    wb.addWorksheet("Prices").addRow(["Pass Name", "Price"]).worksheet.addRow(["10 Class Pack", 280]);
    const xl = await hq.call("POST", `${base}/files`, { filename: "passes.xlsx", data: b64(Buffer.from(await wb.xlsx.writeBuffer())) });
    expect(xl.body.files.map((f: { kind: string; sheet: string }) => `${f.sheet}:${f.kind}`)).toEqual(["Active passes:packages", "Prices:packages"]);
    // The price list isn't data to move.
    expect((await hq.call("PATCH", `${base}/files/${xl.body.files[1].id}`, { kind: "ignore" })).body.kind).toBe("ignore");

    await hq.call("POST", `${base}/files`, { filename: "memberships.csv", data: b64("Member ID,Email,Membership,Price,Billing Frequency,Status,Next Billing Date\n1002,mei@example.com,Unlimited Monthly,$199.00,Monthly,Active,15 Dec 2026\n1003,raj@example.com,Unlimited Monthly,199,Monthly,Cancelled,\n") });
    await hq.call("POST", `${base}/files`, { filename: "bookings.csv", data: b64(`Client ID,Client,Class,Date,Time,Location\n1002,Mei Ling Tan,Reformer Pilates,${tomorrow},7:00 AM,Central\n1003,Raj Kumar,Reformer Pilates,${tomorrow},7:00 AM,Central\n1002,Mei Ling Tan,Spin,${tomorrow},9:00 AM,Central\n`) });

    // 1) The check: dates in "Client Since" could be either way round, so it stops and asks.
    let check = (await hq.call("POST", `${base}/check`, {})).body;
    expect(check.ready).toBe(false);
    expect(check.issues.find((i: { level: string }) => i.level === "blocking").message).toMatch(/“Client Since” could be day-first or month-first/);
    expect((await hq.call("POST", `${base}/import`, {})).body.error.code).toBe("not_checked");
    expect(await db.select().from(users).where(eq(users.email, "mei@example.com"))).toHaveLength(0); // the check changed nothing

    // 2) Told day-first: ready, with warnings and the numbers to compare.
    await hq.call("PATCH", base, { dateOrder: "dmy" });
    check = (await hq.call("POST", `${base}/check`, {})).body;
    expect(check.ready, JSON.stringify(check.issues)).toBe(true);
    expect(check.accounted).toEqual({ rows: 14, created: 6, linked: 1, merged: 1, skipped: 6, ok: true });
    const messages = check.issues.map((i: { message: string }) => i.message).join("\n");
    expect(messages).toMatch(/phone “6.59123E\+09” was damaged by Excel/);
    expect(messages).toMatch(/Siti has no email.*a pack or membership/);
    expect(messages).toMatch(/no class on our schedule for Spin/);
    expect(messages).toMatch(/“maybe” isn't clearly yes or no; treated as not agreed/);
    expect(messages).toMatch(/a totals row was left out/);
    expect(check.reconciliation[0]).toMatchObject({ label: "Clients", told: 40, found: 3, ok: false });
    expect(check.totals.packages).toMatchObject({ moved: 1, "classes left": 7, expired: 1, "used up": 1 });

    // 3) Import: asks once to accept the warnings.
    const first = await hq.call("POST", `${base}/import`, {});
    expect(first.status).toBe(409);
    expect(first.body.error.flags[0].code).toBe("migration_warnings");
    expect(await db.select().from(users).where(eq(users.email, "mei@example.com"))).toHaveLength(0);
    const done = await hq.call("POST", `${base}/import`, { acknowledge: ["migration_warnings"] });
    expect(done.status, JSON.stringify(done.body)).toBe(200);
    expect(done.body.report.accounted.ok).toBe(true);

    // Chloe already had an account: linked, her own details untouched, her tag added.
    const [c] = await db.select().from(users).where(eq(users.id, s.c1.id));
    expect(c).toMatchObject({ firstName: "Chloe", lastName: chloe!.lastName, phone: chloe!.phone });
    // Mei: one client (the duplicate merged), name kept as written, phone in international format, consent as stated.
    const mei = (await db.select().from(users).where(eq(users.email, "mei@example.com")))[0]!;
    expect(mei).toMatchObject({ firstName: "Mei Ling", lastName: "Tan", phone: "+6591234567" });
    const [meiM] = await db.select().from(memberships).where(and(eq(memberships.orgId, s.orgId), eq(memberships.userId, mei.id)));
    expect(meiM).toMatchObject({ role: "client", marketingEmail: true });
    expect(meiM!.createdAt.toISOString().slice(0, 10)).toBe("2025-06-05");
    const tags = await db.select({ name: clientTags.name, client: clientTagAssignments.clientId }).from(clientTagAssignments).innerJoin(clientTags, eq(clientTags.id, clientTagAssignments.tagId));
    expect(tags.filter((t) => t.client === mei.id).map((t) => t.name).sort()).toEqual(["Prenatal", "VIP"]);
    expect(tags.filter((t) => t.client === s.c1.id).map((t) => t.name)).toEqual(["VIP"]);
    const packs = await db.select().from(clientPackages).where(eq(clientPackages.ownerId, mei.id));
    expect(packs.map((p) => `${p.name}|${p.billing}|${p.creditsLeft}`).sort()).toEqual(["10 Class Pack|one_time|7", "Unlimited Monthly|recurring|null"]);
    const pack = packs.find((p) => p.billing === "one_time")!;
    expect(pack.expiresAt!.toISOString()).toBe("2027-12-31T15:59:59.999Z"); // end of 31 Dec in Singapore
    expect(packs.find((p) => p.billing === "recurring")!.expiresAt!.toISOString()).toBe("2026-12-14T16:00:00.000Z"); // renews 15 Dec
    expect((await db.select().from(creditGrants).where(eq(creditGrants.clientId, mei.id)))[0]).toMatchObject({ amountCents: 2500, note: "Credit moved from Mindbody" });
    expect((await db.select().from(clientHistory).where(eq(clientHistory.clientId, mei.id)))[0]).toMatchObject({ notes: "Lower back injury", source: "Mindbody" });
    // Bookings on the matching class: Mei's on her pack (no class taken again), Raj's to pay at the studio.
    const raj = (await db.select().from(users).where(eq(users.email, "raj@example.com")))[0]!;
    expect(raj.phone).toBeNull();
    const bk = await db.select().from(bookings).where(eq(bookings.sessionId, session!.id));
    expect(bk.map((b) => `${b.clientId === mei.id ? "mei" : "raj"}:${b.payment}`).sort()).toEqual(["mei:package", "raj:pay_later"]);
    expect(await db.select().from(users).where(eq(users.firstName, "Siti"))).toHaveLength(0);

    // The sample to compare by eye.
    const sample = (await hq.call("GET", `${base}/sample`)).body.sample;
    expect(sample).toHaveLength(3);
    const meiRow = sample.find((x: { now: { email: string } }) => x.now.email === "mei@example.com");
    expect(meiRow.old).toMatchObject({ "First Name": "Mei Ling", "Account Balance": "SGD 25.00" });
    expect(meiRow.now).toMatchObject({ creditCents: 2500, upcomingBookings: 1, agreedToMarketing: true });
    expect(meiRow.now.packs).toEqual(expect.arrayContaining([{ name: "10 Class Pack", recurring: false, classesLeft: 7, until: "2027-12-31" }]));
    // The moving form's page shows the studio a plain summary.
    const link = (await hq.call("POST", `${base}/form-link`, {})).body.url as string;
    expect(link).toBeTruthy();
    expect((await app.inject({ method: "GET", url: `/v1/public/moving-form/${link.split("/").pop()}` })).json().job).toMatchObject({ status: "imported", summary: { clients: 3, packs: 1, classesLeft: 7, memberships: 1, bookings: 2, creditCents: 2500, notMoved: 6 } });

    // 4) Undo: refused once things have happened, then removes exactly what was added.
    await db.update(bookings).set({ attendance: "present" }).where(eq(bookings.clientId, mei.id));
    const refused = await hq.call("POST", `${base}/undo`, {});
    expect(refused.status).toBe(409);
    expect(refused.body.error.message).toMatch(/1 moved booking has been cancelled or checked in/);
    await db.update(bookings).set({ attendance: "unmarked" }).where(eq(bookings.clientId, mei.id));
    const undo = await hq.call("POST", `${base}/undo`, {});
    expect(undo.status, JSON.stringify(undo.body)).toBe(200);
    expect(undo.body.removed).toMatchObject({ bookings: 2, "packs and memberships": 2, credit: 1, clients: 2 });
    expect(await db.select().from(users).where(eq(users.email, "mei@example.com"))).toHaveLength(0);
    expect((await db.select().from(memberships).where(and(eq(memberships.orgId, s.orgId), eq(memberships.userId, s.c1.id))))[0]!.role).toBe("client");
    expect(await db.select().from(bookings).where(eq(bookings.sessionId, session!.id))).toHaveLength(0);
  });

  it("verify, then the old rows are deleted after 30 days", async () => {
    const s = await studio();
    const hq = await hqStaff("owner");
    const { id: jobId } = (await hq.call("POST", `/platform/studios/${s.orgId}/migrations`, {})).body;
    const base = `/platform/studios/${s.orgId}/migrations/${jobId}`;
    await hq.call("POST", `${base}/files`, { filename: "c.csv", data: b64("Name,Email\nAna Lim,ana.lim@example.com\nBo,bo@example.com\n") });
    expect((await hq.call("POST", `${base}/verify`, { checked: 2 })).body.error.code).toBe("not_imported");
    expect((await hq.call("POST", `${base}/check`, {})).body.ready).toBe(true);
    expect((await hq.call("POST", `${base}/import`, {})).status).toBe(200); // nothing to accept
    expect((await hq.call("POST", `${base}/verify`, { checked: 0 })).status).toBe(400);
    expect((await hq.call("POST", `${base}/verify`, { checked: 2 })).body.status).toBe("verified");
    expect((await hq.call("POST", `${base}/undo`, {})).body.error.message).toMatch(/verified move can't be undone/);
    expect((await purgeMigrationFiles(db)).files).toBe(0);
    expect((await purgeMigrationFiles(db, new Date(Date.now() + 31 * 86_400_000))).files).toBe(1);
    expect((await db.select().from(migrationFiles).where(eq(migrationFiles.jobId, jobId)))[0]!.rows).toBeNull();
  });
});
