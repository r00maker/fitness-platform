/**
 * The client app: its look (per studio), and each client's progress, goal and celebrations.
 */
import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { APP_FONTS, APP_THEME_PRESETS, appThemeUpdate, planHasApp, PLAN_INFO, presetKey } from "@studio/shared";
import { organizations } from "../../db/schema.js";
import { eq } from "drizzle-orm";
import { audit } from "../../lib/audit.js";
import { conflict, forbidden } from "../../lib/errors.js";
import { parse } from "../../lib/validate.js";
import { requirePermission } from "../../plugins/auth.js";
import { getOrg } from "../sessions/context.js";
import * as svc from "./service.js";

const goalBody = z.object({ classes: z.number().int().min(1, "Set at least 1 class.").max(60, "Set 60 classes or fewer.").nullable() });
const keyParam = z.object({ key: z.string().regex(/^(milestone|goal|badge):[\w-]{1,40}$/) });

export async function clientAppRoutes(app: FastifyInstance) {
  const { db } = app;
  const clientOnly = (role: string) => {
    if (role !== "client") throw forbidden("This is for clients.");
  };

  app.get("/me/progress", async (req) => {
    clientOnly(req.auth.role);
    return svc.myProgress(db, req.auth);
  });
  app.put("/me/goal", async (req) => {
    clientOnly(req.auth.role);
    return svc.setGoal(db, req.auth, parse(goalBody, req.body).classes);
  });
  app.post("/me/celebrations/:key/seen", async (req, reply) => {
    clientOnly(req.auth.role);
    await svc.markSeen(db, req.auth, parse(keyParam, req.params).key);
    return reply.code(204).send();
  });

  /** The app's look: what it uses now, what's saved, the presets and typefaces to choose from. */
  app.get("/app-theme", async (req) => {
    requirePermission(req, "manageSettings");
    const org = await getOrg(db, req.auth.orgId);
    const hasApp = planHasApp(org.plan, org.brandedApp);
    return {
      hasApp,
      needs: hasApp ? null : `Your own app look comes with the branded app: ${PLAN_INFO[org.plan].app === "add_on" ? "add it to your Growth plan" : "it's included in Signature"}.`,
      theme: await svc.themeFor(db, org),
      saved: org.appTheme ?? null,
      presets: Object.values(APP_THEME_PRESETS).map(({ label, description, ...t }) => ({ key: t.preset, label, description, theme: t })),
      fonts: Object.entries(APP_FONTS).map(([name, f]) => ({ name, kind: f.kind, note: f.note })),
    };
  });
  app.patch("/app-theme", async (req) => {
    requirePermission(req, "manageSettings");
    const input = parse(appThemeUpdate, req.body);
    const org = await getOrg(db, req.auth.orgId);
    if (!planHasApp(org.plan, org.brandedApp)) throw conflict("needs_branded_app", "Your own app look comes with the branded app. Talk to us about adding it.");
    // Choosing a preset starts from it; other changes are kept on top of what's saved.
    if (input.preset) input.preset = presetKey(input.preset);
    const next = input.preset && input.preset !== presetKey(org.appTheme?.preset) ? { ...input } : { ...(org.appTheme ?? {}), ...input };
    if (next.preset && !APP_THEME_PRESETS[next.preset]) throw conflict("unknown_preset", "Choose one of the looks offered.");
    await db.update(organizations).set({ appTheme: next }).where(eq(organizations.id, org.id));
    await audit(db, { orgId: org.id, actorId: req.auth.userId, action: "app_theme.updated", entityType: "organization", entityId: org.id, details: input });
    return svc.themeFor(db, await getOrg(db, org.id));
  });
}
