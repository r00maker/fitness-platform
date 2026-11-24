/**
 * What every screen shares: the studio, who's signed in, their bookings, packages and progress,
 * a toast, and where they are in the app.
 *
 * Where they are is a path in the address's hash, e.g. #/me/packages/<id>. The first part is the
 * tab. Every screen below a tab has a Back button that returns to where the person came from
 * (Home, if they opened a class from Home), or to the screen above it if they arrived directly.
 */
import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import type { Backend, Me, MyBooking, Package, Progress, Studio } from "./data/types";
import { applyTheme } from "./lib/theme";

export type Tab = "home" | "book" | "shop" | "classes" | "me";
interface Toast { id: number; text: string; action?: { label: string; run: () => void } }

interface Store {
  api: Backend;
  studio: Studio;
  me: Me;
  bookings: MyBooking[];
  packages: Package[];
  progress: Progress | null;
  /** The current path, e.g. ["me", "packages", "p1"]. */
  path: string[];
  tab: Tab;
  go(path: string | string[]): void;
  back(): void;
  refresh(): Promise<void>;
  toast(text: string, action?: Toast["action"]): void;
  toasts: Toast[];
  dismissToast(id: number): void;
}
const Ctx = createContext<Store | null>(null);
export const useStore = () => useContext(Ctx)!;

const TABS: Tab[] = ["home", "book", "shop", "classes", "me"];
const read = (): string[] => {
  const parts = location.hash.replace(/^#\/?/, "").split("/").filter(Boolean).map(decodeURIComponent);
  return parts.length && TABS.includes(parts[0] as Tab) ? parts : ["home"];
};
const write = (p: string[], replace = false) => {
  const h = `#/${p.map(encodeURIComponent).join("/")}`;
  if (replace) history.replaceState(null, "", h);
  else if (location.hash !== h) history.pushState(null, "", h);
};
/** The screen above this one: drops the last part, and skips parts that aren't screens ("class"). */
const parentOf = (p: string[]) => {
  const up = p.slice(0, -1);
  return up.at(-1) === "class" ? up.slice(0, -1) : up.length ? up : ["home"];
};

export function StoreProvider({ api, studio, me, children }: { api: Backend; studio: Studio; me: Me; children: ReactNode }) {
  const [bookings, setBookings] = useState<MyBooking[]>([]);
  const [packages, setPackages] = useState<Package[]>([]);
  const [progress, setProgress] = useState<Progress | null>(null);
  const [path, setPath] = useState<string[]>(read);
  const [toasts, setToasts] = useState<Toast[]>([]);
  const next = useRef(1);
  // Where each screen was opened from, so Back returns there.
  const trail = useRef<string[][]>([]);

  useEffect(() => applyTheme(studio.theme), [studio]);
  useEffect(() => {
    const on = () => setPath(read());
    addEventListener("popstate", on);
    addEventListener("hashchange", on);
    return () => { removeEventListener("popstate", on); removeEventListener("hashchange", on); };
  }, []);

  const refresh = useCallback(async () => {
    const [b, p, pr] = await Promise.all([api.myBookings(), api.packages(), api.progress()]);
    setBookings(b);
    setPackages(p);
    setProgress(pr);
  }, [api]);
  useEffect(() => void refresh(), [refresh]);

  const show = useCallback((p: string[], replace = false) => {
    write(p, replace);
    setPath(p);
    requestAnimationFrame(() => window.scrollTo({ top: 0 }));
  }, []);
  const go = useCallback((to: string | string[]) => {
    const p = typeof to === "string" ? to.split("/").filter(Boolean) : to;
    // Switching tabs starts that tab afresh; going deeper remembers where we were.
    if (p.length === 1) trail.current = [];
    else trail.current.push(read());
    show(p);
  }, [show]);
  const back = useCallback(() => {
    const from = trail.current.pop();
    show(from ?? parentOf(read()), true);
  }, [show]);

  const dismissToast = useCallback((id: number) => setToasts((t) => t.filter((x) => x.id !== id)), []);
  const toast = useCallback((text: string, action?: Toast["action"]) => {
    const id = next.current++;
    setToasts((t) => [...t.slice(-1), { id, text, action }]);
    setTimeout(() => dismissToast(id), action ? 7000 : 4000);
  }, [dismissToast]);

  const tab = path[0] as Tab;
  const value = useMemo(() => ({ api, studio, me, bookings, packages, progress, path, tab, go, back, refresh, toast, toasts, dismissToast }), [api, studio, me, bookings, packages, progress, path, tab, go, back, refresh, toast, toasts, dismissToast]);
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}
