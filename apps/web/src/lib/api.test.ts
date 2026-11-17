import { afterEach, describe, expect, it, vi } from "vitest";
import { api, ApiError, setStudio, setTokenSource } from "./api";
import { safeNext } from "../pages/SignIn";

afterEach(() => vi.unstubAllGlobals());

describe("api", () => {
  it("sends the token and the studio, and explains the API's errors", async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response(JSON.stringify({ error: { code: "needs_confirmation", message: "Please check", flags: [{ code: "no_free_cancel", message: "No free cancellation", severity: "confirm" }] } }), { status: 409 }));
    vi.stubGlobal("fetch", fetchMock);
    setTokenSource(async () => "tok");
    setStudio("4f6f8a8e-0000-4000-8000-000000000001");
    const err = (await api("POST", "/bookings", { sessionId: "x" }).catch((e: unknown) => e)) as ApiError;
    expect(err).toBeInstanceOf(ApiError);
    expect(err.needsConfirmation).toBe(true);
    expect(err.details.flags![0]!.code).toBe("no_free_cancel");
    const [, init] = fetchMock.mock.calls[0]!;
    expect(init.headers).toMatchObject({ authorization: "Bearer tok", "x-studio-id": "4f6f8a8e-0000-4000-8000-000000000001", "content-type": "application/json" });
  });

  it("says so plainly when the API can't be reached", async () => {
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new TypeError("Failed to fetch")));
    const err = (await api("GET", "/me").catch((e: unknown) => e)) as ApiError;
    expect(err.code).toBe("offline");
    expect(err.message).toMatch(/couldn't reach/);
  });
});

describe("after signing in", () => {
  it("only goes back to this studio's own pages", () => {
    expect(safeNext("/s/harbour/classes/1?book=1", "harbour")).toBe("/s/harbour/classes/1?book=1");
    expect(safeNext("https://evil.example/s/harbour", "harbour")).toBe("/s/harbour");
    expect(safeNext("//evil.example", "harbour")).toBe("/s/harbour");
    expect(safeNext("/s/other-studio", "harbour")).toBe("/s/harbour");
    expect(safeNext(null, "harbour")).toBe("/s/harbour");
  });
});
