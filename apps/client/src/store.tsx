/**
 * What every screen shares: the studio, who's signed in, their bookings, packages and progress,
 * and a toast. Screens ask the store to refresh after they change something.
 */
import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import type { Backend, Me, MyBooking, Package, Progress, Studio } from "./data/types";
import { applyTheme } from "./lib/theme";

export type Tab = "home" | "book" | "classes" | "me";
interface Toast { id: number; text: string; action?: { label: string; run: () => void } }

interface Store {
  api: Backend;
  studio: Studio;
  me: Me;
  bookings: MyBooking[];
  packages: Package[];
  progress: Progress | null;
  tab: Tab;
  go(tab: Tab, anchor?: string): void;
  refresh(): Promise<void>;
  toast(text: string, action?: Toast["action"]): void;
  toasts: Toast[];
  dismissToast(id: number): void;
}
const Ctx = createContext<Store | null>(null);
export const useStore = () => useContext(Ctx)!;

const tabFromHash = (): Tab => {
  const t = location.hash.replace(/^#\/?/, "").split("/")[0];
  return t === "book" || t === "classes" || t === "me" ? t : "home";
};

export function StoreProvider({ api, studio, me, children }: { api: Backend; studio: Studio; me: Me; children: ReactNode }) {
  const [bookings, setBookings] = useState<MyBooking[]>([]);
  const [packages, setPackages] = useState<Package[]>([]);
  const [progress, setProgress] = useState<Progress | null>(null);
  const [tab, setTab] = useState<Tab>(tabFromHash);
  const [toasts, setToasts] = useState<Toast[]>([]);
  const next = useRef(1);

  useEffect(() => applyTheme(studio.theme), [studio]);
  useEffect(() => {
    const on = () => setTab(tabFromHash());
    addEventListener("hashchange", on);
    return () => removeEventListener("hashchange", on);
  }, []);

  const refresh = useCallback(async () => {
    const [b, p, pr] = await Promise.all([api.myBookings(), api.packages(), api.progress()]);
    setBookings(b);
    setPackages(p);
    setProgress(pr);
  }, [api]);
  useEffect(() => void refresh(), [refresh]);

  const go = useCallback((t: Tab, anchor?: string) => {
    location.hash = `/${t}${anchor ? `/${anchor}` : ""}`;
    setTab(t);
    requestAnimationFrame(() => {
      const el = anchor && document.getElementById(anchor);
      if (el) el.scrollIntoView({ block: "start" });
      else window.scrollTo({ top: 0 });
    });
  }, []);

  const dismissToast = useCallback((id: number) => setToasts((t) => t.filter((x) => x.id !== id)), []);
  const toast = useCallback((text: string, action?: Toast["action"]) => {
    const id = next.current++;
    setToasts((t) => [...t.slice(-1), { id, text, action }]);
    setTimeout(() => dismissToast(id), action ? 7000 : 4000);
  }, [dismissToast]);

  const value = useMemo(() => ({ api, studio, me, bookings, packages, progress, tab, go, refresh, toast, toasts, dismissToast }), [api, studio, me, bookings, packages, progress, tab, go, refresh, toast, toasts, dismissToast]);
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}
