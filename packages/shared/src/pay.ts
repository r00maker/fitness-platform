/**
 * Instructor pay: what a class pays under each rate type, and a plain-English
 * description of the rate. The API, web and mobile all use these, so the number
 * an instructor sees is always worked out the same way.
 */
import type { PayRateType } from "./enums.js";

export interface PayTier {
  /** This amount applies from this many clients upwards (the first tier starts at 0). */
  fromClients: number;
  amountCents: number;
}

export interface PayRateTerms {
  type: PayRateType;
  /** per_class: the amount. per_client: the base per class. hourly: per hour. salary: per pay period. */
  amountCents?: number | null;
  perClientCents?: number | null;
  /** per_client: clients covered by the base before per-client pay starts. */
  clientsIncluded?: number | null;
  minimumCents?: number | null;
  tiers?: PayTier[] | null;
}

/** Pay for one class. Salaries aren't paid per class (they return 0 here). */
export function classPay(rate: PayRateTerms, c: { headcount: number; minutes: number }): number {
  switch (rate.type) {
    case "per_class":
      return rate.amountCents ?? 0;
    case "per_client": {
      const extra = Math.max(0, c.headcount - (rate.clientsIncluded ?? 0)) * (rate.perClientCents ?? 0);
      return Math.max((rate.amountCents ?? 0) + extra, rate.minimumCents ?? 0);
    }
    case "tiered": {
      const tier = [...(rate.tiers ?? [])].sort((a, b) => b.fromClients - a.fromClients).find((t) => c.headcount >= t.fromClients);
      return tier?.amountCents ?? 0;
    }
    case "hourly":
      return Math.round(((rate.amountCents ?? 0) * c.minutes) / 60);
    case "salary":
      return 0;
  }
}

/** e.g. "SGD 20.00 per class + SGD 3.00 per client after the first 5 (at least SGD 40.00)". */
export function describePayRate(rate: PayRateTerms, money: (cents: number) => string, periodLabel = "pay period"): string {
  switch (rate.type) {
    case "per_class":
      return `${money(rate.amountCents ?? 0)} per class`;
    case "per_client": {
      const parts: string[] = [];
      if (rate.amountCents) parts.push(`${money(rate.amountCents)} per class`);
      const after = rate.clientsIncluded ? ` after the first ${rate.clientsIncluded}` : "";
      parts.push(`${money(rate.perClientCents ?? 0)} per client${after}`);
      return `${parts.join(" + ")}${rate.minimumCents ? ` (at least ${money(rate.minimumCents)})` : ""}`;
    }
    case "tiered": {
      const tiers = [...(rate.tiers ?? [])].sort((a, b) => a.fromClients - b.fromClients);
      return tiers
        .map((t, i) => {
          const next = tiers[i + 1];
          const range = next ? (next.fromClients - 1 === t.fromClients ? `${t.fromClients}` : `${t.fromClients}–${next.fromClients - 1}`) : `${t.fromClients}+`;
          return `${range} clients: ${money(t.amountCents)}`;
        })
        .join(" · ");
    }
    case "hourly":
      return `${money(rate.amountCents ?? 0)} an hour of class`;
    case "salary":
      return `${money(rate.amountCents ?? 0)} per ${periodLabel}`;
  }
}
