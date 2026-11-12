import type { FastifyInstance } from "fastify";
import { and, asc, eq } from "drizzle-orm";
import { can, schemas } from "@studio/shared";
import { DateTime } from "luxon";
import { z } from "zod";
import { classTypes, memberships, payAdjustments, payRates, payRuns } from "../../db/schema.js";
import { audit } from "../../lib/audit.js";
import { badRequest, conflict, forbidden, notFound } from "../../lib/errors.js";
import { withFlags } from "../../lib/route.js";
import { parse } from "../../lib/validate.js";
import { requirePermission } from "../../plugins/auth.js";
import { getOrg } from "../sessions/context.js";
import { describeRate, orgZone, payReport, toCsv } from "./service.js";

const idParam = z.object({ id: schemas.id });

export async function payrollRoutes(app: FastifyInstance) {
  const { db } = app;
  const today = (org: Awaited<ReturnType<typeof getOrg>>) => DateTime.now().setZone(orgZone(org)).toISODate()!;

  async function assertStaff(orgId: string, staffId: string) {
    const [m] = await db.select({ role: memberships.role }).from(memberships).where(and(eq(memberships.orgId, orgId), eq(memberships.userId, staffId)));
    if (!m || m.role === "client") throw notFound("staff member");
  }

  // --- Pay rates -------------------------------------------------------------------
  /** Every rate, newest first, described in plain English. */
  app.get("/pay-rates", async (req) => {
    requirePermission(req, "managePayroll");
    const org = await getOrg(db, req.auth.orgId);
    const types = new Map((await db.select({ id: classTypes.id, name: classTypes.name }).from(classTypes).where(eq(classTypes.orgId, org.id))).map((t) => [t.id, t.name]));
    const rows = await db.select().from(payRates).where(eq(payRates.orgId, org.id)).orderBy(asc(payRates.staffId), asc(payRates.effectiveFrom));
    return rows.map((r) => ({ ...r, ...describeRate(r, org, r.classTypeId ? types.get(r.classTypeId) : undefined) }));
  });

  app.post("/pay-rates", async (req, reply) => {
    requirePermission(req, "managePayroll");
    const input = parse(schemas.payRate, req.body);
    const org = await getOrg(db, req.auth.orgId);
    await assertStaff(org.id, input.staffId);
    if (input.classTypeId) {
      const [t] = await db.select({ id: classTypes.id }).from(classTypes).where(and(eq(classTypes.id, input.classTypeId), eq(classTypes.orgId, org.id)));
      if (!t) throw notFound("class type");
    }
    // Only the fields the chosen pay type uses are kept, so old values can't leak into the maths.
    const keep = {
      per_class: { amountCents: input.amountCents },
      per_client: { amountCents: input.amountCents ?? 0, perClientCents: input.perClientCents, clientsIncluded: input.clientsIncluded ?? 0, minimumCents: input.minimumCents ?? null },
      tiered: { tiers: input.tiers },
      hourly: { amountCents: input.amountCents },
      salary: { amountCents: input.amountCents },
    }[input.type];
    const [rate] = await db
      .insert(payRates)
      .values({ orgId: org.id, staffId: input.staffId, classTypeId: input.classTypeId ?? null, type: input.type, ...keep, effectiveFrom: input.effectiveFrom ?? today(org), createdBy: req.auth.userId })
      .returning();
    await audit(db, { orgId: org.id, actorId: req.auth.userId, action: "pay_rate.added", entityType: "pay_rate", entityId: rate!.id, details: { staffId: input.staffId } });
    reply.code(201);
    return { ...rate, ...describeRate(rate!, org) };
  });

  /** Remove a rate (e.g. one added by mistake). Periods already marked as paid keep their figures. */
  app.delete("/pay-rates/:id", async (req, reply) => {
    requirePermission(req, "managePayroll");
    const { id } = parse(idParam, req.params);
    const [r] = await db.delete(payRates).where(and(eq(payRates.id, id), eq(payRates.orgId, req.auth.orgId))).returning();
    if (!r) throw notFound("pay rate");
    await audit(db, { orgId: req.auth.orgId, actorId: req.auth.userId, action: "pay_rate.removed", entityType: "pay_rate", entityId: id, details: { staffId: r.staffId } });
    return reply.code(204).send();
  });

  // --- One-off adjustments -------------------------------------------------------
  app.post("/pay-adjustments", async (req, reply) => {
    requirePermission(req, "managePayroll");
    const input = parse(schemas.payAdjustment, req.body);
    await assertStaff(req.auth.orgId, input.staffId);
    const [a] = await db.insert(payAdjustments).values({ ...input, orgId: req.auth.orgId, createdBy: req.auth.userId }).returning();
    reply.code(201);
    return a;
  });

  app.delete("/pay-adjustments/:id", async (req, reply) => {
    requirePermission(req, "managePayroll");
    const { id } = parse(idParam, req.params);
    const [a] = await db.delete(payAdjustments).where(and(eq(payAdjustments.id, id), eq(payAdjustments.orgId, req.auth.orgId))).returning();
    if (!a) throw notFound("adjustment");
    return reply.code(204).send();
  });

  // --- Reports -----------------------------------------------------------------------
  /** The pay period containing `date` (default today), for everyone. */
  app.get("/payroll", async (req) => {
    requirePermission(req, "managePayroll");
    const { date } = parse(schemas.payrollQuery, req.query);
    const org = await getOrg(db, req.auth.orgId);
    return payReport(db, org, date ?? today(org));
  });

  app.get("/payroll/export.csv", async (req, reply) => {
    requirePermission(req, "managePayroll");
    const { date } = parse(schemas.payrollQuery, req.query);
    const org = await getOrg(db, req.auth.orgId);
    const report = await payReport(db, org, date ?? today(org));
    reply.header("content-type", "text/csv; charset=utf-8").header("content-disposition", `attachment; filename="pay-${report.period.start}.csv"`);
    return toCsv(report);
  });

  /** Lock in the figures once everyone's been paid. */
  app.post("/payroll/mark-paid", async (req, reply) => {
    requirePermission(req, "managePayroll");
    const input = parse(schemas.markPaid, req.body);
    const org = await getOrg(db, req.auth.orgId);
    const run = await withFlags(app, input.acknowledge, async (tx, flags) => {
      const report = await payReport(tx, org, input.date);
      if (report.paid) throw conflict("already_paid", `${report.period.label} was already marked as paid.`);
      if (!report.staff.some((x) => x.totalCents !== 0 || x.classes.length)) throw badRequest("nothing_to_pay", "There's no pay to mark as paid for this period.");
      if (!report.periodOver) flags.confirm({ code: "period_not_over", message: `${report.period.label} hasn't finished yet, so classes still to come won't be included. Mark it as paid anyway?` });
      const snapshot = { staff: report.staff.map((s) => ({ staffId: s.staffId, name: s.name, totalCents: s.totalCents, classes: s.classes.length })), headcountRule: report.headcountRule };
      const [r] = await tx.insert(payRuns).values({ orgId: org.id, periodStart: report.period.start, periodEnd: report.period.end, totalCents: report.totalCents, snapshot, paidBy: req.auth.userId }).returning();
      await audit(tx, { orgId: org.id, actorId: req.auth.userId, action: "payroll.marked_paid", entityType: "pay_run", entityId: r!.id, details: { period: report.period.start, totalCents: report.totalCents } });
      return { id: r!.id, period: report.period, total: report.total, paidAt: r!.paidAt };
    });
    reply.code(201);
    return run;
  });

  /**
   * One person's pay details for the Staff & pay page: their current rates, every rate they've
   * had (and any starting later), recent adjustments, and this period so far.
   */
  app.get("/staff/:id/pay", async (req) => {
    requirePermission(req, "managePayroll");
    const { id } = parse(idParam, req.params);
    await assertStaff(req.auth.orgId, id);
    const org = await getOrg(db, req.auth.orgId);
    const types = new Map((await db.select({ id: classTypes.id, name: classTypes.name }).from(classTypes).where(eq(classTypes.orgId, org.id))).map((t) => [t.id, t.name]));
    const now = today(org);
    const rates = await db.select().from(payRates).where(and(eq(payRates.orgId, org.id), eq(payRates.staffId, id))).orderBy(asc(payRates.effectiveFrom));
    const shown = rates.map((r) => ({ ...describeRate(r, org, r.classTypeId ? types.get(r.classTypeId) : undefined), startsLater: r.effectiveFrom > now }));
    // Current = the latest started rate for each scope (usual, each class type, salary).
    const started = shown.filter((r) => !r.startsLater).reverse();
    const current = started.filter((r, i) => started.findIndex((x) => x.classTypeId === r.classTypeId && (x.type === "salary") === (r.type === "salary")) === i);
    const report = await payReport(db, org, now, { staffId: id });
    const adjustments = await db.select().from(payAdjustments).where(and(eq(payAdjustments.orgId, org.id), eq(payAdjustments.staffId, id))).orderBy(asc(payAdjustments.date));
    return {
      current,
      history: shown,
      upcoming: shown.filter((r) => r.startsLater),
      thisPeriod: { period: report.period, total: report.staff[0]?.total ?? null, classes: report.staff[0]?.classes.length ?? 0, warnings: report.staff[0]?.warnings ?? [] },
      adjustments: adjustments.slice(-20).reverse(),
    };
  });

  /** An instructor's own classes and pay (if the studio allows it). */
  app.get("/me/pay", async (req) => {
    const org = await getOrg(db, req.auth.orgId);
    if (req.auth.role === "client") throw forbidden();
    if (!org.instructorsSeeOwnPay && !can(req.auth.role, "managePayroll")) throw forbidden("Your studio doesn't show pay in the app. Ask an admin.");
    const { date } = parse(schemas.payrollQuery, req.query);
    const report = await payReport(db, org, date ?? today(org), { staffId: req.auth.userId });
    return { period: report.period, currency: report.currency, headcountRule: report.headcountRule, you: report.staff[0] ?? null };
  });

}
