/**
 * The connection to Claude (Anthropic's API), in one place and swappable in tests.
 *
 * - One platform key (ANTHROPIC_API_KEY), server side only. Studios never see it.
 * - The guide and instructions come first and are cached, so each question costs a fraction of
 *   the full price for them.
 * - If the model declines a request for safety reasons, the API retries once on its default
 *   fallback model (server-side fallback). If that declines too, the person is told politely.
 */
import Anthropic from "@anthropic-ai/sdk";
import type { Config } from "../../config.js";

export type ModelMessage = Anthropic.Beta.BetaMessageParam;
export type ModelTool = Anthropic.Beta.BetaTool;
export type ModelResponse = Pick<Anthropic.Beta.BetaMessage, "content" | "stop_reason" | "usage">;
export interface ModelRequest {
  system: Anthropic.Beta.BetaTextBlockParam[];
  messages: ModelMessage[];
  tools: ModelTool[];
}
export type ModelCall = (req: ModelRequest) => Promise<ModelResponse>;

let override: ModelCall | null = null;
/** Tests: answer with a script instead of calling the real API. */
export const setAssistantModel = (fn: ModelCall | null) => (override = fn);

let client: Anthropic | null = null;
export function modelFor(cfg: Pick<Config, "ANTHROPIC_API_KEY" | "ASSISTANT_MODEL">): ModelCall | null {
  if (override) return override;
  if (!cfg.ANTHROPIC_API_KEY) return null;
  client ??= new Anthropic({ apiKey: cfg.ANTHROPIC_API_KEY, maxRetries: 2, timeout: 60_000 });
  const c = client;
  return async (req) =>
    c.beta.messages.create({
      model: cfg.ASSISTANT_MODEL,
      max_tokens: 4096,
      // Short, practical answers: medium effort is plenty and keeps replies quick.
      output_config: { effort: "medium" },
      // Cache the conversation so far, as well as the guide (marked on the system block).
      cache_control: { type: "ephemeral" },
      betas: ["server-side-fallback-2026-07-01"],
      fallbacks: "default",
      system: req.system,
      messages: req.messages,
      tools: req.tools,
    });
}
