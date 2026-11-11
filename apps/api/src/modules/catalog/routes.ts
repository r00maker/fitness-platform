/** Locations, rooms, class types and templates: the building blocks of the schedule. */
import type { FastifyInstance } from "fastify";
import { and, asc, eq, isNull } from "drizzle-orm";
import { schemas } from "@studio/shared";
import { z } from "zod";
import { classTemplates, classTypes, locations, rooms } from "../../db/schema.js";
import { badRequest, notFound } from "../../lib/errors.js";
import { parse } from "../../lib/validate.js";
import { requirePermission } from "../../plugins/auth.js";
import { assertMemberWithRole } from "../sessions/context.js";

const idParam = z.object({ id: schemas.id });

export async function catalogRoutes(app: FastifyInstance) {
  const { db } = app;

  // Anyone signed in can read these (clients need them for filters).
  app.get("/locations", async (req) =>
    db.select().from(locations).where(and(eq(locations.orgId, req.auth.orgId), isNull(locations.archivedAt))).orderBy(asc(locations.name)),
  );
  app.get("/rooms", async (req) =>
    db.select().from(rooms).where(and(eq(rooms.orgId, req.auth.orgId), isNull(rooms.archivedAt))).orderBy(asc(rooms.name)),
  );
  app.get("/class-types", async (req) =>
    db.select().from(classTypes).where(and(eq(classTypes.orgId, req.auth.orgId), isNull(classTypes.archivedAt))).orderBy(asc(classTypes.name)),
  );

  app.register(async (admin) => {
    admin.addHook("preHandler", async (req) => requirePermission(req, "editSchedule"));

    admin.post("/locations", async (req, reply) => {
      const input = parse(schemas.createLocation, req.body);
      reply.code(201);
      return (await db.insert(locations).values({ ...input, orgId: req.auth.orgId }).returning())[0];
    });

    admin.post("/rooms", async (req, reply) => {
      const input = parse(schemas.createRoom, req.body);
      const [loc] = await db.select().from(locations).where(and(eq(locations.id, input.locationId), eq(locations.orgId, req.auth.orgId)));
      if (!loc) throw notFound("location");
      reply.code(201);
      return (await db.insert(rooms).values({ ...input, orgId: req.auth.orgId }).returning())[0];
    });

    admin.post("/class-types", async (req, reply) => {
      const input = parse(schemas.createClassType, req.body);
      reply.code(201);
      return (await db.insert(classTypes).values({ ...input, orgId: req.auth.orgId }).returning())[0];
    });

    admin.patch("/class-types/:id", async (req) => {
      const { id } = parse(idParam, req.params);
      const input = parse(schemas.updateClassType, req.body);
      const [row] = await db.update(classTypes).set(input).where(and(eq(classTypes.id, id), eq(classTypes.orgId, req.auth.orgId))).returning();
      if (!row) throw notFound("class type");
      return row;
    });

    /** Archive rather than delete, so past classes keep their name and colour. */
    admin.delete("/class-types/:id", async (req, reply) => {
      const { id } = parse(idParam, req.params);
      const [row] = await db.update(classTypes).set({ archivedAt: new Date() }).where(and(eq(classTypes.id, id), eq(classTypes.orgId, req.auth.orgId))).returning();
      if (!row) throw notFound("class type");
      return reply.code(204).send();
    });

    admin.get("/templates", async (req) =>
      db.select().from(classTemplates).where(and(eq(classTemplates.orgId, req.auth.orgId), isNull(classTemplates.archivedAt))).orderBy(asc(classTemplates.name)),
    );

    async function checkTemplateRefs(orgId: string, t: Partial<z.infer<typeof schemas.createTemplate>>) {
      if (t.classTypeId) {
        const [c] = await db.select().from(classTypes).where(and(eq(classTypes.id, t.classTypeId), eq(classTypes.orgId, orgId)));
        if (!c) throw notFound("class type");
      }
      if (t.locationId) {
        const [l] = await db.select().from(locations).where(and(eq(locations.id, t.locationId), eq(locations.orgId, orgId)));
        if (!l) throw notFound("location");
      }
      if (t.roomId) {
        const [r] = await db.select().from(rooms).where(and(eq(rooms.id, t.roomId), eq(rooms.orgId, orgId)));
        if (!r) throw notFound("room");
        if (t.locationId && r.locationId !== t.locationId) throw badRequest("room_wrong_location", "That room is at a different location.");
        if (t.capacity && r.capacity != null && t.capacity > r.capacity) throw badRequest("over_room_limit", `${r.name} holds up to ${r.capacity} people.`);
      }
      if (t.instructorId) await assertMemberWithRole(db, orgId, t.instructorId, ["owner", "admin", "instructor"], "instructor");
    }

    admin.post("/templates", async (req, reply) => {
      const input = parse(schemas.createTemplate, req.body);
      await checkTemplateRefs(req.auth.orgId, input);
      reply.code(201);
      return (await db.insert(classTemplates).values({ ...input, orgId: req.auth.orgId }).returning())[0];
    });

    admin.patch("/templates/:id", async (req) => {
      const { id } = parse(idParam, req.params);
      const input = parse(schemas.updateTemplate, req.body);
      await checkTemplateRefs(req.auth.orgId, input);
      const [row] = await db.update(classTemplates).set(input).where(and(eq(classTemplates.id, id), eq(classTemplates.orgId, req.auth.orgId))).returning();
      if (!row) throw notFound("template");
      return row;
    });

    admin.delete("/templates/:id", async (req, reply) => {
      const { id } = parse(idParam, req.params);
      const [row] = await db.update(classTemplates).set({ archivedAt: new Date() }).where(and(eq(classTemplates.id, id), eq(classTemplates.orgId, req.auth.orgId))).returning();
      if (!row) throw notFound("template");
      return reply.code(204).send();
    });
  });
}
