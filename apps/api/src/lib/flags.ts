/**
 * "Please check" warnings. Instead of refusing things that are unusual but
 * sometimes intended (a double-booked instructor, a 3-hour class), the API
 * collects warnings while it works. If any need confirming and the user hasn't
 * acknowledged them yet, the whole change is rolled back and the warnings are
 * returned so the app can ask "Go ahead anyway?". Re-sending the same request
 * with `acknowledge: [codes]` completes it.
 */
import type { FlagCode, FlagSeverity } from "@studio/shared";
import { FLAG_TITLES } from "@studio/shared";
import { AppError } from "./errors.js";

export interface Flag {
  code: FlagCode;
  severity: FlagSeverity;
  title: string;
  message: string;
  sessionId?: string;
  /** A suggested fix the app can offer as a one-tap button, e.g. { endTime: "12:00" }. */
  suggestion?: Record<string, unknown>;
  details?: Record<string, unknown>;
}

type FlagInput = Omit<Flag, "severity" | "title">;

export class Flags {
  readonly list: Flag[] = [];
  private readonly acknowledged: ReadonlySet<string>;

  constructor(acknowledged: readonly string[] = []) {
    this.acknowledged = new Set(acknowledged);
  }

  confirm(f: FlagInput) {
    this.add({ ...f, severity: "confirm", title: FLAG_TITLES[f.code] });
  }

  info(f: FlagInput) {
    this.add({ ...f, severity: "info", title: FLAG_TITLES[f.code] });
  }

  private add(f: Flag) {
    if (!this.list.some((x) => x.code === f.code && x.sessionId === f.sessionId && x.message === f.message)) this.list.push(f);
  }

  /** Remove warnings, e.g. clashes worked out from a time that is itself probably a mistake. */
  drop(codes: readonly string[], sessionId?: string) {
    for (let i = this.list.length - 1; i >= 0; i--) {
      const f = this.list[i]!;
      if (codes.includes(f.code) && f.sessionId === sessionId) this.list.splice(i, 1);
    }
  }

  /** Throw (rolling back the transaction) if anything still needs the user's OK. */
  enforce(): void {
    const pending = this.list.filter((f) => f.severity === "confirm" && !this.acknowledged.has(f.code));
    if (pending.length) {
      throw new AppError(409, "needs_confirmation", pending.length === 1 ? pending[0]!.message : "Please check these before continuing.", {
        flags: pending,
        info: this.list.filter((f) => f.severity === "info"),
      });
    }
  }
}
