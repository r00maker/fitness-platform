/** Locations, rooms, class types and templates: the building blocks of the schedule. */
import type { FastifyInstance } from "fastify";
import { and, asc, eq, gt, inArray, isNull, sql } from "drizzle-orm";
import { schemas } from "@studio/shared";
import { z } from "zod";
import { bookings, classSeries, classSessions, classTemplates, classTypeInstructors, classTypes, locations, rooms } from "../../db/schema.js";
import type { DbOrTx } from "../../db/client.js";
import { conflict } from "../../lib/errors.js";
import { withFlags } from "../../lib/route.js";
import type { Flags } from "../../lib/flags.js";
import { staffIds } from "../sessions/context.js";
import { badRequest, notFound } from "../../lib/errors.js";
import { parse, parsePatch } from "../../lib/validate.js";
import { requirePermission } from "../../plugins/auth.js";
import { assertMemberWithRole } from "../sessions/context.js";

const idParam = z.object({ id: schemas.id });

async function activeRoom(db: DbOrTx, orgId: string, id: string) {
  const [r] = await db.select().from(rooms).where(and(eq(rooms.id, id), eq(rooms.orgId, orgId)));
  if (!r) throw notFound("room");
  if (r.archivedAt) throw conflict("room_removed", "This room has been removed.");
  return r;
}

/** Upcoming classes (in a room, or given ones) set for more people, or with more bookings, than `capacity`. */
async function warnIfSmaller(db: DbOrTx, flags: Flags, roomId: string | null, capacity: number, roomName: string, sessionIds?: string[]) {
  const rows = await db
    .select({ id: classSessions.id, capacity: classSessions.capacity, booked: sql<number>`(select count(*) from ${bookings} b where b.session_id = ${classSessions.id} and b.status = 'confirmed')` })
    .from(classSessions)
    .where(and(roomId ? eq(classSessions.roomId, roomId) : inArray(classSessions.id, sessionIds ?? []), eq(classSessions.status, "scheduled"), gt(classSessions.startsAt, new Date())));
  const big = rows.filter((r) => r.capacity > capacity);
  if (!big.length) return;
  const overBooked = big.filter((r) => Number(r.booked) > capacity).length;
  flags.confirm({
    code: "room_smaller",
    message: `${big.length} upcoming ${big.length === 1 ? "class is" : "classes are"} set for more than the ${capacity} people ${roomName} will hold${overBooked ? `, and ${overBooked} already ${overBooked === 1 ? "has" : "have"} more bookings than that` : ""}. ${big.length === 1 ? "It keeps its" : "They keep their"} numbers; change ${big.length === 1 ? "it" : "them"} if needed.`,
  });
}

/** Upcoming confirmed bookings whose spot number is beyond the first `keep` spots. */
async function upcomingSpotBookings(db: DbOrTx, roomId: string, keep: number) {
  const rows = await db
    .select({ id: bookings.id })
    .from(bookings)
    .innerJoin(classSessions, eq(classSessions.id, bookings.sessionId))
    .where(and(eq(classSessions.roomId, roomId), eq(bookings.status, "confirmed"), gt(classSessions.startsAt, new Date()), sql`${bookings.spot} > ${keep}`));
  return rows.map((r) => r.id);
}

export async function catalogRoutes(app: FastifyInstance) {
  const { db } = app;

  // Anyone signed in can read these (clients need them for filters).
  app.get("/locations", async (req) =>
    db.select().from(locations).where(and(eq(locations.orgId, req.auth.orgId), isNull(locations.archivedAt))).orderBy(asc(locations.name)),
  );
  app.get("/rooms", async (req) =>
    db.select().from(rooms).where(and(eq(rooms.orgId, req.auth.orgId), isNull(rooms.archivedAt))).orderBy(asc(rooms.name)),
  );
  app.get("/class-types", async (req) => {
    const types = await db.select().from(classTypes).where(and(eq(classTypes.orgId, req.auth.orgId), isNull(classTypes.archivedAt))).orderBy(asc(classTypes.name));
    if (req.auth.role === "client") return types;
    const lists = await db.select().from(classTypeInstructors).where(eq(classTypeInstructors.orgId, req.auth.orgId));
    // instructorIds: who teaches and covers this class type (empty = anyone).
    return types.map((t) => ({ ...t, instructorIds: lists.filter((l) => l.classTypeId === t.id).map((l) => l.instructorId) }));
  });

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
      // A room with named spots holds as many people as it has spots, unless told otherwise.
      const capacity = input.capacity ?? input.spotLabels?.length;
      reply.code(201);
      return (await db.insert(rooms).values({ ...input, capacity, orgId: req.auth.orgId }).returning())[0];
    });

    /**
     * Change a room: its name, how many it holds, its named spots and their layout.
     * Warns (before saving) if upcoming classes are bigger than the room will be, or if booked
     * spots would no longer exist (those bookings stay, without a spot number).
     */
    admin.patch("/rooms/:id", async (req) => {
      const { id } = parse(idParam, req.params);
      const { acknowledge, ...input } = parse(schemas.updateRoom, req.body);
      return withFlags(app, acknowledge, async (tx, flags) => {
        const room = await activeRoom(tx, req.auth.orgId, id);
        const labels = input.spotLabels !== undefined ? input.spotLabels : room.spotLabels;
        const capacity = input.capacity !== undefined ? input.capacity : input.spotLabels ? input.spotLabels.length : room.capacity;
        if (capacity != null && labels?.length && capacity > labels.length) throw badRequest("more_than_spots", `With named spots, the room holds as many people as it has spots (${labels.length}). Add spots or lower the number.`);
        if (capacity != null) await warnIfSmaller(tx, flags, room.id, capacity, room.name);
        if (input.spotLabels !== undefined) {
          const keep = input.spotLabels?.length ?? 0;
          const lost = await upcomingSpotBookings(tx, room.id, keep);
          if (lost.length) {
            flags.confirm({
              code: "spots_removed",
              message: `${lost.length} upcoming ${lost.length === 1 ? "booking has a spot" : "bookings have spots"} that won't exist any more. ${lost.length === 1 ? "It keeps its place" : "They keep their places"} in class, just without a spot number.`,
            });
            await tx.update(bookings).set({ spot: null }).where(inArray(bookings.id, lost));
          }
        }
        const [row] = await tx
          .update(rooms)
          .set({ ...input, ...(capacity !== room.capacity ? { capacity } : {}), ...(input.spotLabels === null ? { spotColumns: null } : {}) })
          .where(eq(rooms.id, id))
          .returning();
        return { room: row! };
      });
    });

    /**
     * Remove a room. Past classes keep it in their history. Upcoming classes (and the templates and
     * repeating classes that use it) move to `moveToRoomId` at the same location, or are left
     * without a room, after a warning either way.
     */
    admin.post("/rooms/:id/remove", async (req) => {
      const { id } = parse(idParam, req.params);
      const { moveToRoomId, acknowledge } = parse(schemas.removeRoom, req.body ?? {});
      return withFlags(app, acknowledge, async (tx, flags) => {
        const room = await activeRoom(tx, req.auth.orgId, id);
        let target: typeof room | null = null;
        if (moveToRoomId) {
          if (moveToRoomId === id) throw badRequest("same_room", "Choose a different room to move the classes to.");
          target = await activeRoom(tx, req.auth.orgId, moveToRoomId);
          if (target.locationId !== room.locationId) throw badRequest("room_wrong_location", "Classes can only move to a room at the same location.");
        }
        const upcoming = await tx
          .select({ id: classSessions.id, capacity: classSessions.capacity })
          .from(classSessions)
          .where(and(eq(classSessions.roomId, id), eq(classSessions.status, "scheduled"), gt(classSessions.startsAt, new Date())));
        if (upcoming.length) {
          if (target) {
            flags.info({ code: "room_has_classes", message: `${upcoming.length} upcoming ${upcoming.length === 1 ? "class moves" : "classes move"} to ${target.name}, with ${upcoming.length === 1 ? "its" : "their"} bookings.` });
            if (target.capacity != null) await warnIfSmaller(tx, flags, null, target.capacity, target.name, upcoming.map((u) => u.id));
          } else {
            flags.confirm({ code: "room_has_classes", message: `${upcoming.length} upcoming ${upcoming.length === 1 ? "class is" : "classes are"} in ${room.name}. ${upcoming.length === 1 ? "It stays" : "They stay"} on the schedule with bookings, but without a room. Choose a room to move ${upcoming.length === 1 ? "it" : "them"} to instead?` });
          }
          const ids = upcoming.map((u) => u.id);
          await tx.update(classSessions).set({ roomId: target?.id ?? null }).where(inArray(classSessions.id, ids));
          // Spot numbers only carry over if the new room has that many named spots.
          const keep = target?.spotLabels?.length ?? 0;
          await tx.update(bookings).set({ spot: null }).where(and(inArray(bookings.sessionId, ids), sql`${bookings.spot} > ${keep}`));
        }
        await tx.update(classTemplates).set({ roomId: target?.id ?? null }).where(and(eq(classTemplates.roomId, id), eq(classTemplates.orgId, req.auth.orgId)));
        await tx.update(classSeries).set({ roomId: target?.id ?? null }).where(and(eq(classSeries.roomId, id), eq(classSeries.orgId, req.auth.orgId)));
        await tx.update(rooms).set({ archivedAt: new Date() }).where(eq(rooms.id, id));
        return { removed: room.name, classesMoved: upcoming.length, movedTo: target?.name ?? null };
      });
    });

    admin.post("/class-types", async (req, reply) => {
      const input = parse(schemas.createClassType, req.body);
      reply.code(201);
      return (await db.insert(classTypes).values({ ...input, orgId: req.auth.orgId }).returning())[0];
    });

    /**
     * Change a class type: name, colour, description, usual length, or whether it's a class or an
     * appointment. Turning it into an appointment switches ClassPass off for its upcoming classes
     * (ClassPass is only for classes) and says how many changed.
     */
    admin.patch("/class-types/:id", async (req) => {
      const { id } = parse(idParam, req.params);
      const input = parsePatch(schemas.updateClassType, req.body);
      return db.transaction(async (tx) => {
        const [row] = await tx.update(classTypes).set(input).where(and(eq(classTypes.id, id), eq(classTypes.orgId, req.auth.orgId))).returning();
        if (!row) throw notFound("class type");
        let classpassSwitchedOff = 0;
        if (input.kind === "appointment") {
          const off = { classpassEnabled: false, classpassSpots: null };
          const changed = await tx
            .update(classSessions)
            .set(off)
            .where(and(eq(classSessions.classTypeId, id), eq(classSessions.classpassEnabled, true), eq(classSessions.status, "scheduled"), gt(classSessions.startsAt, new Date())))
            .returning({ id: classSessions.id });
          classpassSwitchedOff = changed.length;
          await tx.update(classSeries).set({ ...off, waitlistEnabled: false }).where(eq(classSeries.classTypeId, id));
          await tx.update(classTemplates).set({ ...off, waitlistEnabled: false }).where(eq(classTemplates.classTypeId, id));
        }
        return { ...row, classpassSwitchedOff };
      });
    });

    /** Set who teaches (and covers) this class type. An empty list means anyone who teaches. */
    admin.put("/class-types/:id/instructors", async (req) => {
      const { id } = parse(idParam, req.params);
      const { instructorIds } = parse(schemas.setClassTypeInstructors, req.body);
      const [type] = await db.select().from(classTypes).where(and(eq(classTypes.id, id), eq(classTypes.orgId, req.auth.orgId)));
      if (!type) throw notFound("class type");
      const teachers = new Set(await staffIds(db, req.auth.orgId, ["owner", "admin", "instructor"]));
      const unique = [...new Set(instructorIds)];
      if (unique.some((i) => !teachers.has(i))) throw notFound("instructor");
      await db.transaction(async (tx) => {
        await tx.delete(classTypeInstructors).where(eq(classTypeInstructors.classTypeId, id));
        if (unique.length) await tx.insert(classTypeInstructors).values(unique.map((instructorId) => ({ orgId: req.auth.orgId, classTypeId: id, instructorId })));
      });
      return { classTypeId: id, instructorIds: unique };
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
    /** ClassPass on a template: only for classes, with spots that fit. */
    async function checkTemplateClasspass(orgId: string, t: { classTypeId: string; capacity: number; classpassEnabled: boolean; classpassSpots: number | null }) {
      if (!t.classpassEnabled) return;
      const [type] = await db.select({ kind: classTypes.kind }).from(classTypes).where(and(eq(classTypes.id, t.classTypeId), eq(classTypes.orgId, orgId)));
      if (type?.kind === "appointment") throw badRequest("classpass_appointment", "ClassPass is only for classes, not appointments.");
      if (!t.classpassSpots) throw badRequest("invalid_input", "Some details need fixing.", { fields: { classpassSpots: "Choose how many spots to open to ClassPass." } });
      if (t.classpassSpots > t.capacity) throw badRequest("invalid_input", "Some details need fixing.", { fields: { classpassSpots: `ClassPass can have at most all ${t.capacity} spots in the class.` } });
    }

    admin.post("/templates", async (req, reply) => {
      const input = parse(schemas.createTemplate, req.body);
      await checkTemplateRefs(req.auth.orgId, input);
      await checkTemplateClasspass(req.auth.orgId, { ...input, classpassSpots: input.classpassSpots ?? null });
      reply.code(201);
      return (await db.insert(classTemplates).values({ ...input, classpassSpots: input.classpassEnabled ? input.classpassSpots : null, orgId: req.auth.orgId }).returning())[0];
    });

    admin.patch("/templates/:id", async (req) => {
      const { id } = parse(idParam, req.params);
      const input = parsePatch(schemas.updateTemplate, req.body);
      await checkTemplateRefs(req.auth.orgId, input);
      const [cur] = await db.select().from(classTemplates).where(and(eq(classTemplates.id, id), eq(classTemplates.orgId, req.auth.orgId)));
      if (!cur) throw notFound("template");
      const next = { ...cur, ...input };
      await checkTemplateClasspass(req.auth.orgId, next);
      if (!next.classpassEnabled) input.classpassSpots = null;
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
