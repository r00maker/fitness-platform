import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { execFileSync } from "node:child_process";
import path from "node:path";
import { app, person, pool, reset, studio } from "./helpers.js";

// The real help centre, built from docs/help/centre.
beforeAll(() => { execFileSync(process.execPath, [path.resolve(process.cwd(), "../help/build.mjs")], { stdio: "ignore" }); });
beforeEach(reset);
afterAll(async () => {
  await app.close();
  await pool.end();
});

const open = (url: string, cookie?: string) => app.inject({ method: "GET", url, headers: cookie ? { cookie } : {} });
const pathOf = (url: string) => { const u = new URL(url); return u.pathname + u.search; };

describe("the help centre", () => {
  it("gives staff a link that works for 12 hours, and keeps it out of the address", async () => {
    const s = await studio();
    for (const who of [s.owner, s.ana, await person(s.orgId, "front_desk", "Fiona")]) {
      const r = await who.call("GET", "/help/link");
      expect(r.status, JSON.stringify(r.body)).toBe(200);
      expect(r.body.url).toMatch(/\/help\/\?key=/);
      expect(new Date(r.body.expiresAt).getTime() - Date.now()).toBeGreaterThan(11.9 * 3_600_000);
    }
    const { url } = (await s.owner.call("GET", "/help/link")).body;

    // Opening the link keeps it in a cookie for /help only, and redirects to /help/ without the key.
    const first = await open(pathOf(url));
    expect(first.statusCode).toBe(302);
    expect(first.headers.location).toBe("/help/");
    const cookie = String(first.headers["set-cookie"]);
    expect(cookie).toMatch(/^skedoo_help=[^;]+; Path=\/help; Max-Age=43200; HttpOnly; SameSite=Lax/);

    const page = await open("/help/", cookie.split(";")[0]);
    expect(page.statusCode).toBe(200);
    expect(page.body).toContain("Skedoo Help Centre");
    expect(page.body).toContain("Refunds and fees");
    expect(page.headers["x-robots-tag"]).toBe("noindex, nofollow");
    expect(page.headers["cache-control"]).toBe("private, no-store");
    // Only the page's own script may run.
    expect(String(page.headers["content-security-policy"])).toMatch(/default-src 'none'; script-src 'sha256-[A-Za-z0-9+/=]+'/);

    const img = await open("/help/img/closures.webp", cookie.split(";")[0]);
    expect(img.statusCode).toBe(200);
    expect(img.headers["content-type"]).toBe("image/webp");
  });

  it("isn't for clients, and is never public", async () => {
    const s = await studio();
    expect((await s.c1.call("GET", "/help/link")).status).toBe(403);
    // Without a link: "not found", for the page and its screenshots, and never indexed.
    const page = await open("/help/");
    expect(page.statusCode).toBe(404);
    expect(page.body).toMatch(/Open it from <b>Help centre<\/b> in your studio app/);
    expect(page.headers["x-robots-tag"]).toBe("noindex, nofollow");
    expect((await open("/help/img/closures.webp")).statusCode).toBe(404);
    expect((await open("/help")).headers.location).toBe("/help/");
    // A made-up or tampered link doesn't work either.
    expect((await open("/help/?key=not-a-real-key")).statusCode).toBe(404);
    const { url } = (await s.owner.call("GET", "/help/link")).body;
    const key = new URL(url).searchParams.get("key")!;
    expect((await open(`/help/?key=${key.slice(0, -4)}AAAA`)).statusCode).toBe(404);
    expect((await open("/help/", "skedoo_help=forged")).statusCode).toBe(404);
    // Only screenshots, by name: no reading other files.
    const good = String((await open(`/help/?key=${key}`)).headers["set-cookie"]).split(";")[0];
    expect((await open("/help/img/..%2F..%2Fpackage.json", good)).statusCode).toBe(404);
    expect((await open("/help/img/index.html", good)).statusCode).toBe(404);
  });
});
