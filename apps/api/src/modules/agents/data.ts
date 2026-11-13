/**
 * The only way an agent reads studio data. It's built for one studio and one agent, from what
 * the owner or admin let that agent see, and every reader checks that permission before it runs.
 * There is no reader for client names, contact details, health notes, payments, packages or pay,
 * so an agent can't see them however it's set up.
 */
import { and, asc, eq, gt, gte, inArray, lt, sql } from "drizzle-orm";
import { DateTime } from "luxon";
import type { AgentSees } from "@studio/shared";
import type { DbOrTx } from "../../db/client.js";
import { classSessions, classTypes, locations, rooms, substituteRequests, users } from "../../db/schema.js";

export class AgentAccessError extends Error {
  constructor(readonly needs: AgentSees) {
    super(`This agent isn't allowed to see ${needs}.`);
  }
}

/** One class as an agent sees it. Fields it isn't allowed to see are left out. */
export interface AgentClass {
  id: string;
  kind: "class" | "appointment";
  className: string;
  startsAt: Date;
  /** Local date (YYYY-MM-DD), e.g. for links to that day. */
  date: string;
  /** e.g. "Sat 15 Nov" and "7:00am". */
  day: string;
  time: string;
  locationName: string;
  roomName: string | null;
  /** Used to decide who hears about the class; only shown as a name with "instructors". */
  instructorId: string | null;
  instructorName?: string | null;
  /** With "cover": whether the instructor is covering, and (with "instructors" too) for whom. */
  isCover?: boolean;
  coverForName?: string | null;
  capacity?: number;
  booked?: number;
  waiting?: number;
}

const clock = (d: DateTime) => d.toFormat("h:mma").toLowerCase();

export class AgentData {
  constructor(
    private readonly db: DbOrTx,
    readonly orgId: string,
    private readonly sees: ReadonlySet<AgentSees>,
  ) {}

  can(c: AgentSees) {
    return this.sees.has(c);
  }
  private need(c: AgentSees) {
    if (!this.sees.has(c)) throw new AgentAccessError(c);
  }

  /** Upcoming, not cancelled classes (and appointments, without who they're with) in a time range. */
  async classes(from: Date, to: Date, opts: { sessionIds?: string[]; classTypeIds?: string[]; locationIds?: string[]; kinds?: ("class" | "appointment")[] } = {}): Promise<AgentClass[]> {
    this.need("schedule");
    if (opts.sessionIds && opts.sessionIds.length === 0) return [];
    const cover = this.can("cover");
    const names = this.can("instructors");
    const counts = this.can("booking_counts");
    const rows = await this.db
      .select({
        id: classSessions.id,
        kind: classTypes.kind,
        className: classTypes.name,
        startsAt: classSessions.startsAt,
        timezone: locations.timezone,
        locationName: locations.name,
        roomName: rooms.name,
        instructorId: classSessions.instructorId,
        coverFor: classSessions.coverForInstructorId,
        capacity: classSessions.capacity,
        booked: sql<number>`(select count(*)::int from bookings b where b.session_id = ${classSessions.id} and b.status = 'confirmed')`,
        waiting: sql<number>`(select count(*)::int from waitlist_entries w where w.session_id = ${classSessions.id} and w.status in ('waiting', 'offered'))`,
      })
      .from(classSessions)
      .innerJoin(classTypes, eq(classTypes.id, classSessions.classTypeId))
      .innerJoin(locations, eq(locations.id, classSessions.locationId))
      .leftJoin(rooms, eq(rooms.id, classSessions.roomId))
      .where(
        and(
          eq(classSessions.orgId, this.orgId),
          eq(classSessions.status, "scheduled"),
          gte(classSessions.startsAt, from),
          lt(classSessions.startsAt, to),
          opts.sessionIds ? inArray(classSessions.id, opts.sessionIds) : undefined,
          opts.classTypeIds?.length ? inArray(classSessions.classTypeId, opts.classTypeIds) : undefined,
          opts.locationIds?.length ? inArray(classSessions.locationId, opts.locationIds) : undefined,
          opts.kinds ? inArray(classTypes.kind, opts.kinds) : undefined,
        ),
      )
      .orderBy(asc(classSessions.startsAt))
      .limit(500);
    const people = names ? await this.staffNames(rows.flatMap((r) => [r.instructorId, r.coverFor])) : new Map<string, string>();
    return rows.map((r) => {
      const local = DateTime.fromJSDate(r.startsAt, { zone: r.timezone });
      return {
        id: r.id,
        kind: r.kind,
        className: r.className,
        startsAt: r.startsAt,
        date: local.toISODate()!,
        day: local.toFormat("ccc d LLL"),
        time: clock(local),
        locationName: r.locationName,
        roomName: r.roomName,
        instructorId: r.instructorId,
        ...(names ? { instructorName: r.instructorId ? (people.get(r.instructorId) ?? null) : null } : {}),
        ...(cover ? { isCover: !!r.coverFor, ...(names ? { coverForName: r.coverFor ? (people.get(r.coverFor) ?? null) : null } : {}) } : {}),
        ...(counts ? { capacity: r.capacity, booked: Number(r.booked), waiting: Number(r.waiting) } : {}),
      };
    });
  }

  /** Cover requests nobody has taken yet, for classes in a time range. */
  async openCoverRequests(from: Date, to: Date): Promise<{ sessionId: string; awaitingApproval: boolean }[]> {
    this.need("cover");
    const rows = await this.db
      .select({ sessionId: substituteRequests.sessionId, status: substituteRequests.status })
      .from(substituteRequests)
      .innerJoin(classSessions, eq(classSessions.id, substituteRequests.sessionId))
      .where(and(eq(substituteRequests.orgId, this.orgId), inArray(substituteRequests.status, ["open", "awaiting_approval"]), gt(classSessions.startsAt, from), lt(classSessions.startsAt, to), eq(classSessions.status, "scheduled")));
    return rows.map((r) => ({ sessionId: r.sessionId, awaitingApproval: r.status === "awaiting_approval" }));
  }

  /** First names and initials of staff only (never clients). */
  private async staffNames(ids: (string | null)[]) {
    const list = [...new Set(ids.filter((x): x is string => !!x))];
    if (!list.length) return new Map<string, string>();
    const rows = await this.db.execute<{ id: string; first_name: string; last_name: string }>(sql`
      select u.id, u.first_name, u.last_name from ${users} u join memberships m on m.user_id = u.id and m.org_id = ${this.orgId}
      where u.id in (${sql.join(list.map((i) => sql`${i}`), sql`, `)}) and m.role <> 'client'`);
    return new Map(rows.rows.map((u) => [u.id, `${u.first_name} ${u.last_name.charAt(0)}.`.trim()]));
  }
}
