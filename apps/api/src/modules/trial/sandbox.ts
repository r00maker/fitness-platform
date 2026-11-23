/**
 * The test studio for studios already on another system: two weeks of classes, sample
 * instructors and clients with bookings, and packages, so there's something real-looking to try.
 * Every person here is made up (example.com addresses), and nothing is sent to anyone.
 */
import { randomUUID } from "node:crypto";
import type { DbOrTx } from "../../db/client.js";
import { bookings, classSessions, classTypes, memberships, packagePlans, users } from "../../db/schema.js";

const INSTRUCTORS = [["Ana", "Lim"], ["Ben", "Tan"], ["Mei", "Wong"]];
const CLIENTS = [["Chloe", "Ng"], ["Dev", "Rao"], ["Eve", "Koh"], ["Farah", "Ali"], ["Grace", "Teo"], ["Hana", "Sato"], ["Ivan", "Goh"], ["Jas", "Lee"], ["Kiran", "Das"], ["Lena", "Ong"], ["Maya", "Chua"], ["Noor", "Aziz"]];
const TYPES: [string, string][] = [["Reformer Flow", "#4F46E5"], ["Mat Pilates", "#0E7490"], ["Barre", "#DB2777"]];
const SLOTS: [number, number, number, number][] = [[7, 0, 0, 0], [12, 30, 1, 1], [18, 30, 0, 2], [19, 45, 2, 0]]; // hour, minute, type, instructor

export async function seedSandbox(tx: DbOrTx, org: { id: string; timezone: string }, locationId: string, now = new Date()) {
  const tag = randomUUID().slice(0, 8);
  const person = async (first: string, last: string, role: "instructor" | "client") => {
    const [u] = await tx.insert(users).values({ email: `${first.toLowerCase()}.${tag}@example.com`, firstName: first, lastName: last }).returning({ id: users.id });
    await tx.insert(memberships).values({ orgId: org.id, userId: u!.id, role });
    return u!.id;
  };
  const instructors = [];
  for (const [f, l] of INSTRUCTORS) instructors.push(await person(f!, l!, "instructor"));
  const clients = [];
  for (const [f, l] of CLIENTS) clients.push(await person(f!, l!, "client"));
  const types = [];
  for (const [name, color] of TYPES) types.push((await tx.insert(classTypes).values({ orgId: org.id, name, color }).returning({ id: classTypes.id }))[0]!.id);
  await tx.insert(packagePlans).values([
    { orgId: org.id, name: "5-class pack", kind: "credits", credits: 5, priceCents: 15000, validityValue: 2, validityUnit: "months", startsOn: "first_booking" },
    { orgId: org.id, name: "10-class pack", kind: "credits", credits: 10, priceCents: 28000, validityValue: 3, validityUnit: "months", startsOn: "first_booking" },
    { orgId: org.id, name: "Unlimited monthly", kind: "unlimited", billing: "recurring", priceCents: 32000, validityValue: 1, validityUnit: "months" },
  ]);
  // A week before and two weeks after today, in Singapore-style local time (UTC+8 by default).
  const offset = org.timezone === "Asia/Singapore" ? 8 : 0;
  let k = 0;
  for (let d = -7; d < 14; d++) {
    const day = new Date(now.getTime() + d * 86_400_000);
    for (const [h, m, t, i] of SLOTS) {
      const starts = new Date(Date.UTC(day.getUTCFullYear(), day.getUTCMonth(), day.getUTCDate(), h - offset, m));
      const [s] = await tx.insert(classSessions).values({ orgId: org.id, classTypeId: types[t]!, locationId, instructorId: instructors[i]!, startsAt: starts, endsAt: new Date(starts.getTime() + 50 * 60_000), capacity: 10 }).returning({ id: classSessions.id });
      // A few people in each class; past ones were attended.
      const who = clients.slice(k % 6, (k % 6) + 3 + (k % 4));
      k++;
      if (who.length) await tx.insert(bookings).values(who.map((c) => ({ orgId: org.id, sessionId: s!.id, clientId: c, source: "staff" as const, payment: "pay_later" as const, attendance: starts < now ? ("present" as const) : ("unmarked" as const) })));
    }
  }
}
