/** Client tags the studio creates itself ("Injury: lower back", "VIP", "Prenatal"…). */
import type { FastifyInstance } from "fastify";
import { and, asc, count, eq, inArray } from "drizzle-orm";
import { schemas } from "@studio/shared";
import { z } from "zod";
import { clientTagAssignments, clientTags, memberships } from "../../db/schema.js";
import { audit } from "../../lib/audit.js";
import { conflict, forbidden, notFound } from "../../lib/errors.js";
import { inTx } from "../../lib/route.js";
import { parse } from "../../lib/validate.js";
import { requirePermission } from "../../plugins/auth.js";

const idParam = z.object({ id: schemas.id });

export async function clientTagRoutes(app: FastifyInstance) {
  const { db } = app;

  /** Any staff member can see the studio's tags (they appear on class lists). */
  app.get("/client-tags", async (req) => {
    if (req.auth.role === "client") throw forbidden();
    const tags = await db.select().from(clientTags).where(eq(clientTags.orgId, req.auth.orgId)).orderBy(asc(clientTags.name));
    const counts = await db
      .select({ tagId: clientTagAssignments.tagId, n: count() })
      .from(clientTagAssignments)
      .where(eq(clientTagAssignments.orgId, req.auth.orgId))
      .groupBy(clientTagAssignments.tagId);
    const byTag = new Map(counts.map((c) => [c.tagId, c.n]));
    return tags.map((t) => ({ ...t, clients: byTag.get(t.id) ?? 0 }));
  });

  app.post("/client-tags", async (req, reply) => {
    requirePermission(req, "manageClientTags");
    const input = parse(schemas.createClientTag, req.body);
    const [tag] = await db.insert(clientTags).values({ ...input, orgId: req.auth.orgId }).onConflictDoNothing().returning();
    if (!tag) throw conflict("tag_exists", `There's already a tag called “${input.name}”.`);
    reply.code(201);
    return tag;
  });

  app.patch("/client-tags/:id", async (req) => {
    requirePermission(req, "manageClientTags");
    const { id } = parse(idParam, req.params);
    const input = parse(schemas.updateClientTag, req.body);
    const [tag] = await db.update(clientTags).set(input).where(and(eq(clientTags.id, id), eq(clientTags.orgId, req.auth.orgId))).returning();
    if (!tag) throw notFound("tag");
    return tag;
  });

  /** Deleting a tag removes it from every client who had it. */
  app.delete("/client-tags/:id", async (req, reply) => {
    requirePermission(req, "manageClientTags");
    const { id } = parse(idParam, req.params);
    const [tag] = await db.delete(clientTags).where(and(eq(clientTags.id, id), eq(clientTags.orgId, req.auth.orgId))).returning();
    if (!tag) throw notFound("tag");
    return reply.code(204).send();
  });

  /** Replace a client's tags with exactly this list. */
  app.put("/clients/:id/tags", async (req) => {
    requirePermission(req, "manageClientTags");
    const { id } = parse(idParam, req.params);
    const { tagIds } = parse(schemas.setClientTags, req.body);
    return inTx(app, async (tx) => {
      const [m] = await tx.select().from(memberships).where(and(eq(memberships.orgId, req.auth.orgId), eq(memberships.userId, id), eq(memberships.role, "client")));
      if (!m) throw notFound("client");
      const unique = [...new Set(tagIds)];
      if (unique.length) {
        const found = await tx.select({ id: clientTags.id }).from(clientTags).where(and(eq(clientTags.orgId, req.auth.orgId), inArray(clientTags.id, unique)));
        if (found.length !== unique.length) throw notFound("tag");
      }
      await tx.delete(clientTagAssignments).where(and(eq(clientTagAssignments.orgId, req.auth.orgId), eq(clientTagAssignments.clientId, id)));
      if (unique.length) await tx.insert(clientTagAssignments).values(unique.map((tagId) => ({ orgId: req.auth.orgId, clientId: id, tagId })));
      await audit(tx, { orgId: req.auth.orgId, actorId: req.auth.userId, action: "client.tags_set", entityType: "client", entityId: id, details: { tagIds: unique } });
      return tx
        .select({ id: clientTags.id, name: clientTags.name, color: clientTags.color })
        .from(clientTagAssignments)
        .innerJoin(clientTags, eq(clientTags.id, clientTagAssignments.tagId))
        .where(and(eq(clientTagAssignments.orgId, req.auth.orgId), eq(clientTagAssignments.clientId, id)))
        .orderBy(asc(clientTags.name));
    });
  });
}
