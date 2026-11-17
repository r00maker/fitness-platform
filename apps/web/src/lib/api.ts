/**
 * Talking to the API. Every call sends the sign-in token and the studio being used
 * (X-Studio-Id); the API reads the person's role from its own records.
 */
export const API_URL = (import.meta.env.VITE_API_URL ?? "http://localhost:3000").replace(/\/$/, "");

export interface Flag {
  code: string;
  message: string;
  title?: string;
  severity: "confirm" | "info";
}

/** An error the API explained: code, plain-English message, and any "please check" flags or field problems. */
export class ApiError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    message: string,
    readonly details: { flags?: Flag[]; info?: Flag[]; fields?: Record<string, string>; [k: string]: unknown } = {},
  ) {
    super(message);
  }
  get needsConfirmation() {
    return this.code === "needs_confirmation";
  }
}

let tokenSource: () => Promise<string | null> = async () => null;
let studioId: string | null = null;
export const setTokenSource = (f: () => Promise<string | null>) => (tokenSource = f);
export const setStudio = (id: string | null) => (studioId = id);

export async function api<T = unknown>(method: "GET" | "POST" | "PUT" | "PATCH" | "DELETE", path: string, body?: unknown, opts: { auth?: boolean; studio?: string | null } = {}): Promise<T> {
  const headers: Record<string, string> = {};
  if (body !== undefined) headers["content-type"] = "application/json";
  if (opts.auth !== false) {
    const t = await tokenSource();
    if (t) headers.authorization = `Bearer ${t}`;
    const s = opts.studio === undefined ? studioId : opts.studio;
    if (s) headers["x-studio-id"] = s;
  }
  let res: Response;
  try {
    res = await fetch(`${API_URL}/v1${path}`, { method, headers, body: body === undefined ? undefined : JSON.stringify(body) });
  } catch {
    throw new ApiError(0, "offline", "We couldn't reach the studio's system. Check your connection and try again.");
  }
  const text = await res.text();
  const json = text ? (JSON.parse(text) as Record<string, unknown>) : {};
  if (!res.ok) {
    const e = (json.error ?? {}) as { code?: string; message?: string } & Record<string, unknown>;
    const { code, message, ...rest } = e;
    throw new ApiError(res.status, code ?? "error", message ?? "Something went wrong. Please try again.", rest as ApiError["details"]);
  }
  return json as T;
}

/** Public, no sign-in. */
export const pub = <T,>(path: string) => api<T>("GET", `/public${path}`, undefined, { auth: false });
