/**
 * The studio being used (from the link /s/<slug>) and who's signed in: whether they have an
 * account with us and whether they belong to this studio yet.
 */
import { createContext, useCallback, useContext, useEffect, useState, type ReactNode } from "react";
import { api, pub, setStudio, setTokenSource } from "./api";
import { auth } from "./auth";

export interface PublicStudio {
  id: string;
  slug: string;
  name: string;
  intro: string | null;
  accent: string;
  logoUrl: string | null;
  currency: string;
  timezone: string;
  locations: { id: string; name: string; address: string | null }[];
  classTypes: { id: string; name: string; color: string; description: string | null }[];
  rules: { bookingOpens: string; bookingCloses: string; cancelling: string; needPackage: boolean; payOnline: boolean; waiver: boolean };
  contact: { phone: string | null; website: string | null; instagram: string | null; address: string | null };
}
export interface Me { email: string | null; hasAccount: boolean; firstName: string | null; member: boolean }

interface Ctx {
  studio: PublicStudio | null;
  error: string | null;
  me: Me | null; // null: not signed in
  loading: boolean;
  refresh(): Promise<void>;
  signOut(): Promise<void>;
}
const StudioCtx = createContext<Ctx | null>(null);
setTokenSource(() => auth.token());

export function StudioProvider({ slug, children }: { slug: string; children: ReactNode }) {
  const [studio, setS] = useState<PublicStudio | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [me, setMe] = useState<Me | null>(null);
  const [loading, setLoading] = useState(true);

  const refresh = useCallback(async () => {
    setLoading(true);
    try {
      const s = await pub<PublicStudio>(`/studios/${encodeURIComponent(slug)}`);
      setS(s);
      setStudio(s.id);
      document.documentElement.style.setProperty("--accent", s.accent);
      document.title = `${s.name}: book a class`;
      try { localStorage.setItem("studio.last", slug); } catch { /* ignore */ }
      if (await auth.token()) {
        const mine = await api<{ hasAccount: boolean; firstName: string | null; studios: { id: string }[] }>("GET", "/me/studios", undefined, { studio: null });
        setMe({ email: await auth.email(), hasAccount: mine.hasAccount, firstName: mine.firstName, member: mine.studios.some((x) => x.id === s.id) });
      } else setMe(null);
      setError(null);
    } catch (e) {
      const status = (e as { status?: number }).status;
      if (status === 401) { await auth.signOut(); setMe(null); }
      else setError(status === 404 ? "not_found" : (e as Error).message);
    } finally {
      setLoading(false);
    }
  }, [slug]);

  useEffect(() => { void refresh(); return auth.onChange(() => void refresh()); }, [refresh]);
  const signOut = useCallback(async () => { await auth.signOut(); setMe(null); }, []);
  return <StudioCtx.Provider value={{ studio, error, me, loading, refresh, signOut }}>{children}</StudioCtx.Provider>;
}

export function useStudio() {
  const c = useContext(StudioCtx);
  if (!c) throw new Error("useStudio outside StudioProvider");
  return c;
}
