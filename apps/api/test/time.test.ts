import { describe, expect, it } from "vitest";
import { calendarRange, localToUtc, minutesBetweenTimes, recurrenceDates, zoneFor } from "../src/lib/time.js";

describe("recurrence", () => {
  it("weekly on chosen days", () => {
    const d = recurrenceDates({ daysOfWeek: [1, 3], everyNWeeks: 1, startDate: "2026-11-02" }, "2026-11-02", "2026-11-15");
    expect(d).toEqual(["2026-11-02", "2026-11-04", "2026-11-09", "2026-11-11"]);
  });
  it("every other week", () => {
    const d = recurrenceDates({ daysOfWeek: [5], everyNWeeks: 2, startDate: "2026-11-06" }, "2026-11-06", "2026-12-04");
    expect(d).toEqual(["2026-11-06", "2026-11-20", "2026-12-04"]);
  });
  it("stops after N classes, continuing the count across top-ups", () => {
    const rule = { daysOfWeek: [1, 2, 3, 4, 5], everyNWeeks: 1, startDate: "2026-11-02", occurrences: 7 };
    expect(recurrenceDates(rule, "2026-11-02", "2026-11-06")).toHaveLength(5);
    expect(recurrenceDates(rule, "2026-11-07", "2026-11-30", 5)).toEqual(["2026-11-09", "2026-11-10"]);
  });
  it("respects an end date", () => {
    expect(recurrenceDates({ daysOfWeek: [1], everyNWeeks: 1, startDate: "2026-11-02", endDate: "2026-11-10" }, "2026-11-02", "2027-01-01")).toEqual(["2026-11-02", "2026-11-09"]);
  });
});

describe("time zones", () => {
  it("keeps a 07:00 class at 07:00 local time across a daylight-saving change", () => {
    expect(localToUtc("2026-10-23", "07:00", "Europe/London").toISOString()).toBe("2026-10-23T06:00:00.000Z"); // BST
    expect(localToUtc("2026-10-26", "07:00", "Europe/London").toISOString()).toBe("2026-10-26T07:00:00.000Z"); // GMT
  });
  it("week view runs Monday to Monday in local time", () => {
    const r = calendarRange("week", "2026-11-11", "Asia/Singapore");
    expect(r.from.toISOString()).toBe("2026-11-08T16:00:00.000Z");
    expect(r.to.toISOString()).toBe("2026-11-15T16:00:00.000Z");
  });
});

describe("daylight-saving setting", () => {
  it("off (default): uses the standard offset all year", () => {
    const z = zoneFor("Europe/London", false);
    expect(localToUtc("2026-07-01", "07:00", z).toISOString()).toBe("2026-07-01T07:00:00.000Z");
    expect(localToUtc("2026-12-01", "07:00", z).toISOString()).toBe("2026-12-01T07:00:00.000Z");
  });
  it("on: follows the clock change", () => {
    const z = zoneFor("Europe/London", true);
    expect(localToUtc("2026-07-01", "07:00", z).toISOString()).toBe("2026-07-01T06:00:00.000Z");
  });
  it("makes no difference in Southeast Asia", () => {
    for (const dst of [true, false]) {
      expect(localToUtc("2026-07-01", "07:00", zoneFor("Asia/Singapore", dst)).toISOString()).toBe("2026-06-30T23:00:00.000Z");
      expect(localToUtc("2026-07-01", "07:00", zoneFor("Asia/Bangkok", dst)).toISOString()).toBe("2026-07-01T00:00:00.000Z");
    }
  });
});

describe("end times", () => {
  it("an end time before the start means it runs past midnight", () => {
    expect(minutesBetweenTimes("11:00", "12:00")).toBe(60);
    expect(minutesBetweenTimes("11:00", "00:00")).toBe(13 * 60);
  });
});
