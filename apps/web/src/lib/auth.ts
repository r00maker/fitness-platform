/**
 * Sign-in. Production uses Supabase Auth (email code, Google, Apple); its user ids are UUIDs and
 * the API uses them as our user ids. Locally, "dev" asks the API for a token for any email
 * (the API only offers this when no real provider is set up), with the code 000000.
 */
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { API_URL } from "./api";

export interface Auth {
  kind: "supabase" | "dev";
  token(): Promise<string | null>;
  email(): Promise<string | null>;
  /** Send a 6-digit code to this email. */
  sendCode(email: string): Promise<void>;
  verifyCode(email: string, code: string): Promise<void>;
  social(provider: "google" | "apple", returnTo: string): Promise<void>;
  signOut(): Promise<void>;
  onChange(f: () => void): () => void;
}

function supabaseAuth(url: string, key: string): Auth {
  const sb: SupabaseClient = createClient(url, key, { auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: true } });
  return {
    kind: "supabase",
    token: async () => (await sb.auth.getSession()).data.session?.access_token ?? null,
    email: async () => (await sb.auth.getSession()).data.session?.user.email ?? null,
    async sendCode(email) {
      const { error } = await sb.auth.signInWithOtp({ email, options: { shouldCreateUser: true } });
      if (error) throw new Error(error.message);
    },
    async verifyCode(email, code) {
      const { error } = await sb.auth.verifyOtp({ email, token: code, type: "email" });
      if (error) throw new Error(error.message.includes("expired") || error.message.includes("invalid") ? "That code didn't work. Check it, or send a new one." : error.message);
    },
    async social(provider, returnTo) {
      const { error } = await sb.auth.signInWithOAuth({ provider, options: { redirectTo: returnTo } });
      if (error) throw new Error(error.message);
    },
    signOut: async () => void (await sb.auth.signOut()),
    onChange(f) {
      const { data } = sb.auth.onAuthStateChange(() => f());
      return () => data.subscription.unsubscribe();
    },
  };
}

function devAuth(): Auth {
  const KEY = "studio.dev.session";
  const listeners = new Set<() => void>();
  const read = (): { token: string; email: string } | null => {
    try { return JSON.parse(localStorage.getItem(KEY) ?? "null"); } catch { return null; }
  };
  const write = (v: { token: string; email: string } | null) => {
    try { v ? localStorage.setItem(KEY, JSON.stringify(v)) : localStorage.removeItem(KEY); } catch { /* private mode: kept in memory only */ }
    mem = v;
    listeners.forEach((f) => f());
  };
  let mem = read();
  return {
    kind: "dev",
    token: async () => (read() ?? mem)?.token ?? null,
    email: async () => (read() ?? mem)?.email ?? null,
    async sendCode() { /* nothing is sent locally: the code is 000000 */ },
    async verifyCode(email, code) {
      if (code !== "000000") throw new Error("That code didn't work. Locally, the code is 000000.");
      const res = await fetch(`${API_URL}/v1/dev/sign-in`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ email }) });
      if (!res.ok) throw new Error("Local sign-in isn't available (is a real sign-in provider set up on the API?).");
      write({ token: (await res.json()).token, email: email.toLowerCase() });
    },
    async social() { throw new Error("Google and Apple sign-in work once Supabase Auth is set up. Use your email locally."); },
    signOut: async () => write(null),
    onChange(f) { listeners.add(f); return () => listeners.delete(f); },
  };
}

export const auth: Auth =
  import.meta.env.VITE_AUTH === "supabase" && import.meta.env.VITE_SUPABASE_URL && import.meta.env.VITE_SUPABASE_ANON_KEY
    ? supabaseAuth(import.meta.env.VITE_SUPABASE_URL, import.meta.env.VITE_SUPABASE_ANON_KEY)
    : devAuth();
