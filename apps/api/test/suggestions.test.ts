import { describe, expect, it } from "vitest";
import { checkTiming, suggestLength } from "../src/modules/checks/session-checks.js";
import { Flags } from "../src/lib/flags.js";
import { localToUtc, minutesBetweenTimes } from "../src/lib/time.js";

const zone = "Asia/Singapore";
function run(start: string, end: string, usual: number | null = 50) {
  const flags = new Flags();
  checkTiming(flags, zone, { startsAt: localToUtc("2026-12-01", start, zone), durationMinutes: minutesBetweenTimes(start, end), usualMinutes: usual, className: "Reformer Pilates", isNew: true, now: new Date("2026-11-11T00:00:00Z") });
  return flags.list.filter((f) => f.severity === "confirm");
}

// Every suggested fix must be a believable class: 15 minutes to 3 hours long, starting 5am–10pm.
describe("suggested fixes always make sense", () => {
  const cases: [string, string, string | undefined][] = [
    ["11:00", "00:00", "12:00"], // 11am–12am meant 11am–12pm
    ["12:00", "11:50", "12:50"], // end typed before start: fall back to the usual 50 minutes, not 11:50pm
    ["09:00", "22:00", "10:00"], // 9am–10pm meant 9am–10am
    ["18:00", "07:00", "19:00"], // 6pm–7am meant 6pm–7pm
    ["07:00", "19:00", "07:50"], // exactly 12h: no AM/PM fix possible, so the usual length
    ["21:00", "09:00", "21:50"],
  ];
  for (const [start, end, expected] of cases) {
    it(`${start}–${end} suggests ending at ${expected}`, () => {
      const [flag] = run(start, end);
      expect(flag?.suggestion?.endTime).toBe(expected);
      const mins = flag!.suggestion!.durationMinutes as number;
      expect(mins).toBeGreaterThanOrEqual(15);
      expect(mins).toBeLessThanOrEqual(180);
    });
  }

  it("explains a time that ends before it starts in plain words", () => {
    const [flag] = run("12:00", "11:50");
    expect(flag!.message).toBe("This class ends at 11:50am, which is before its 12:00pm (noon) start, so it would run overnight for 23h 50m. Reformer Pilates usually runs 50 minutes. Did you mean to end at 12:50pm?");
  });

  it("offers no fix rather than a silly one", () => {
    const [flag] = run("12:00", "11:50", null);
    expect(flag!.suggestion).toBeUndefined();
    expect(flag!.message).not.toMatch(/Did you mean/);
  });

  it("never suggests a length outside 15 minutes to 3 hours", () => {
    for (let d = 1; d <= 1440; d++) {
      const s = suggestLength(d, 50);
      if (s) expect(s.minutes >= 15 && s.minutes <= 180).toBe(true);
    }
  });

  it("only offers an AM/PM flip for the start time when the flipped time is normal", () => {
    const flip = (start: string) => run(start, start.replace(/^(\d\d)/, (h) => String((Number(h) + 1) % 24).padStart(2, "0"))).find((f) => f.code === "unusual_start_time");
    expect(flip("03:00")!.suggestion).toEqual({ startTime: "15:00" });
    expect(flip("23:00")!.suggestion).toEqual({ startTime: "11:00" });
    expect(flip("04:30")!.suggestion).toEqual({ startTime: "16:30" });
  });
});
