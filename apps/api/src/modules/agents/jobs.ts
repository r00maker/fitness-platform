/**
 * What each reminder job looks for, and how it says it. Jobs only read through AgentData (so only
 * what the agent may see) and only produce findings; they never change anything.
 */
import { DateTime } from "luxon";
import type { AgentDefinition, AgentJob } from "@studio/shared";
import type { AgentClass, AgentData } from "./data.js";

export interface Finding {
  cls: AgentClass;
  /** One short line about this class, e.g. "Reformer, 7:00am (1 of 10 booked)". */
  line: string;
}
export interface JobResult {
  findings: Finding[];
  /** Words for the period checked, e.g. "tomorrow" or "in the next 7 days". */
  period: string;
  /** For links: the day to open, when it's a single day. */
  date?: string;
}

const MAX_LINES = 4;

/** The time range a daily run looks at. */
function range(job: AgentJob, now: Date, tz: string): { from: Date; to: Date; period: string; date?: string } {
  const local = DateTime.fromJSDate(now, { zone: tz });
  const n = job.daysAhead;
  const singleDay = job.type === "low_bookings" || job.type === "teaching" || (job.type === "cover_classes" && n === 1);
  if (singleDay) {
    const day = local.plus({ days: n }).startOf("day");
    const from = n === 0 ? local : day;
    return { from: from.toJSDate(), to: day.plus({ days: 1 }).toJSDate(), period: n === 0 ? "later today" : n === 1 ? "tomorrow" : `on ${day.toFormat("ccc d LLL")}`, date: day.toISODate()! };
  }
  const to = local.plus({ days: n }).endOf("day");
  const period = job.type === "busy_waitlist" ? (n === 0 ? "today" : n === 1 ? "today and tomorrow" : `in the next ${n} days`) : `in the next ${n} days`;
  return { from: local.toJSDate(), to: to.toJSDate(), period };
}

const where = (c: AgentClass) => [c.roomName, c.locationName].filter(Boolean).join(", ");
const when = (c: AgentClass, sameDay: boolean) => (sameDay ? c.time : `${c.day} ${c.time}`);

/**
 * Run a job. `only` limits it to particular classes (before-class agents check one class at a
 * time, `hoursBefore` its start).
 */
export async function runJob(data: AgentData, def: AgentDefinition, now: Date, tz: string, only?: { sessionIds: string[] }): Promise<JobResult> {
  const job = def.job;
  const r = only ? { from: now, to: new Date(now.getTime() + 73 * 3_600_000), period: "soon" as string, date: undefined as string | undefined } : range(job, now, tz);
  const sameDay = !!r.date || !!only;
  const scope = only ? { sessionIds: only.sessionIds } : {};
  const result = (findings: Finding[]): JobResult => ({ findings, period: r.period, date: r.date });

  switch (job.type) {
    case "cover_classes": {
      const list = (await data.classes(r.from, r.to, scope)).filter((c) => c.isCover && c.instructorId);
      return result(list.map((c) => ({ cls: c, line: `${c.className}, ${when(c, sameDay)} at ${where(c)}${c.coverForName ? ` (covering for ${c.coverForName})` : ""}` })));
    }
    case "low_bookings": {
      const list = (await data.classes(r.from, r.to, { ...scope, classTypeIds: job.classTypeIds, locationIds: job.locationIds, kinds: ["class"] })).filter((c) => {
        const booked = c.booked ?? 0, cap = c.capacity ?? 1;
        return job.below.mode === "count" ? booked < job.below.value : (booked / cap) * 100 < job.below.value;
      });
      return result(list.map((c) => ({ cls: c, line: `${c.className}, ${when(c, sameDay)} (${c.booked} of ${c.capacity} booked)` })));
    }
    case "teaching": {
      const list = (await data.classes(r.from, r.to, scope)).filter((c) => c.instructorId);
      return result(list.map((c) => ({ cls: c, line: `${c.kind === "appointment" ? "Appointment" : c.className}, ${when(c, sameDay)} at ${where(c)}${c.isCover ? " (cover)" : ""}` })));
    }
    case "no_instructor": {
      const list = (await data.classes(r.from, r.to)).filter((c) => !c.instructorId);
      return result(list.map((c) => ({ cls: c, line: `${c.className}, ${when(c, false)} at ${where(c)}` })));
    }
    case "busy_waitlist": {
      const list = (await data.classes(r.from, r.to, { kinds: ["class"] })).filter((c) => (c.waiting ?? 0) >= job.atLeast);
      return result(list.map((c) => ({ cls: c, line: `${c.className}, ${when(c, false)} (full, ${c.waiting} waiting)` })));
    }
    case "open_cover": {
      const open = await data.openCoverRequests(r.from, r.to);
      const list = await data.classes(r.from, r.to, { sessionIds: open.map((o) => o.sessionId) });
      const waiting = new Set(open.filter((o) => o.awaitingApproval).map((o) => o.sessionId));
      return result(list.map((c) => ({ cls: c, line: `${c.className}, ${when(c, false)}${c.instructorName ? ` (${c.instructorName})` : ""}${waiting.has(c.id) ? ": someone offered, waiting for you to approve" : ""}` })));
    }
  }
}

/** The message for one person, from the findings they're allowed to hear about. */
export function compose(def: AgentDefinition, res: JobResult, findings: Finding[], personal: boolean, beforeClass?: { hoursBefore: number }): string {
  const n = findings.length;
  const lines = findings.slice(0, MAX_LINES).map((f) => f.line);
  const more = n > MAX_LINES ? `, and ${n - MAX_LINES} more` : "";
  const list = `${lines.join("; ")}${more}.`;
  const classes = (k: number) => `${k} ${k === 1 ? "class" : "classes"}`;
  const soon = beforeClass ? `in ${beforeClass.hoursBefore} ${beforeClass.hoursBefore === 1 ? "hour" : "hours"}` : res.period;
  switch (def.job.type) {
    case "cover_classes":
      return personal ? `Reminder: you're covering ${n === 1 ? "a class" : classes(n)} ${soon}. ${list}` : `${classes(n)} ${n === 1 ? "is" : "are"} being covered ${soon}: ${list}`;
    case "low_bookings":
      return `${classes(n)} ${soon} ${n === 1 ? "looks" : "look"} quiet: ${list} Open the schedule if you want to cancel or promote ${n === 1 ? "it" : "them"}.`;
    case "teaching":
      return personal ? `You're teaching ${classes(n)} ${soon}: ${list}` : `${classes(n)} being taught ${soon}: ${list}`;
    case "no_instructor":
      return `${classes(n)} ${soon} ${n === 1 ? "has" : "have"} no instructor yet: ${list}`;
    case "busy_waitlist":
      return `${classes(n)} ${soon} ${n === 1 ? "has" : "have"} a busy waitlist: ${list} You could add spots or another class.`;
    case "open_cover":
      return `${n} cover ${n === 1 ? "request hasn't" : "requests haven't"} been taken ${soon}: ${list}`;
  }
}
