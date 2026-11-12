/**
 * Package terms in plain English, so the admin setting one up, the client buying
 * one and staff selling one all read exactly the same description.
 */
import type { PackageBilling, PackageKind, PackageStart, SharingMode, ValidityUnit } from "./enums.js";

export interface PackageTerms {
  kind: PackageKind;
  credits?: number | null;
  validityValue?: number | null;
  validityUnit?: ValidityUnit | null;
  startsOn: PackageStart;
  activateWithinDays?: number | null;
  maxUsers: number;
  sharingMode?: SharingMode | null;
  weeklyLimit?: number | null;
  billing?: PackageBilling;
  /** Recurring: unused classes carried into the next period, at most this many. */
  rolloverCap?: number | null;
  /** Recurring: the fewest periods before it can be cancelled. */
  commitmentCycles?: number | null;
}

const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;
const UNIT: Record<ValidityUnit, string> = { days: "day", weeks: "week", months: "month" };

/** e.g. "3 months". */
export const validityText = (value: number, unit: ValidityUnit) => plural(value, UNIT[unit]);

/**
 * One short line per term, e.g.
 *   10 classes
 *   Valid for 3 months from the first booking
 *   Book the first class within 30 days of buying, or it expires
 *   Up to 3 people can share it, using one pool of credits
 *   Reformer Pilates and Barre only
 */
export function describePackage(t: PackageTerms, classTypeNames: string[] = []): string[] {
  const lines: string[] = [];
  const recurring = t.billing === "recurring" && t.validityValue && t.validityUnit;
  const period = recurring ? (t.validityValue === 1 ? UNIT[t.validityUnit!] : validityText(t.validityValue!, t.validityUnit!)) : "";
  if (recurring) {
    lines.push(t.kind === "credits" ? `${plural(t.credits ?? 0, "class", "classes")} every ${period}` : "Unlimited classes");
    if (t.weeklyLimit) lines.push(`Up to ${plural(t.weeklyLimit, "class", "classes")} a week`);
    lines.push(`Renews every ${period} until it's cancelled`);
    if (t.kind === "credits" && t.rolloverCap) lines.push(`Up to ${plural(t.rolloverCap, "unused class", "unused classes")} carry over to the next ${period}`);
    if (t.commitmentCycles && t.commitmentCycles > 1) lines.push(`Minimum ${t.commitmentCycles} ${t.validityValue === 1 ? `${UNIT[t.validityUnit!]}s` : "renewals"}`);
  } else {
    lines.push(t.kind === "credits" ? plural(t.credits ?? 0, "class", "classes") : "Unlimited classes");
    if (t.weeklyLimit) lines.push(`Up to ${plural(t.weeklyLimit, "class", "classes")} a week`);
  }
  if (recurring) {
    // Covered above.
  } else if (t.validityValue && t.validityUnit) {
    lines.push(`Valid for ${validityText(t.validityValue, t.validityUnit)} from ${t.startsOn === "purchase" ? "the day it's bought" : "the first booking"}`);
  } else {
    lines.push("Never expires");
  }
  if (t.startsOn === "first_booking" && t.activateWithinDays) {
    lines.push(`Book the first class within ${plural(t.activateWithinDays, "day")} of buying, or it expires`);
  }
  if (t.maxUsers > 1) {
    const how = t.kind === "unlimited" ? "each with unlimited classes" : t.sharingMode === "allocated" ? "each with their own share of the credits" : "using one pool of credits";
    lines.push(`Up to ${t.maxUsers} people can share it, ${how}`);
  }
  if (classTypeNames.length) {
    const list = classTypeNames.length === 1 ? classTypeNames[0] : `${classTypeNames.slice(0, -1).join(", ")} and ${classTypeNames.at(-1)}`;
    lines.push(`${list} only`);
  }
  return lines;
}
