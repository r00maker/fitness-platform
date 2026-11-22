/**
 * The client app for one studio. It loads the studio (its look comes with it), checks who's
 * signed in, then shows four places: Home, Book, My classes and Me. On phones the places are a
 * tab bar at the bottom; on wider screens, a rail on the left.
 */
import { useCallback, useEffect, useState } from "react";
import { Celebration } from "./components/Celebration";
import { demoBackend } from "./data/demo";
import { AppError, type Backend, type Me as MeT, type Studio } from "./data/types";
import { applyTheme } from "./lib/theme";
import { Book } from "./screens/Book";
import { Home } from "./screens/Home";
import { Me } from "./screens/Me";
import { MyClasses } from "./screens/MyClasses";
import { SignIn } from "./screens/SignIn";
import { StoreProvider, useStore, type Tab } from "./store";

/** The demo studios, or the real API (loaded only when needed, with its sign-in). */
async function chooseBackend(): Promise<Backend> {
  const q = new URLSearchParams(location.search);
  if (import.meta.env.VITE_DEMO || q.has("demo")) return demoBackend(q.get("studio") ?? "linden");
  const { httpBackend, studioSlug } = await import("./data/http");
  return httpBackend(studioSlug());
}

export function App() {
  const [api, setApi] = useState<Backend | null>(null);
  const [studio, setStudio] = useState<Studio | null>(null);
  const [me, setMe] = useState<MeT | null | undefined>(undefined);
  const [problem, setProblem] = useState<string | null>(null);

  useEffect(() => void chooseBackend().then(setApi), []);
  const load = useCallback(async () => {
    if (!api) return;
    try {
      const s = await api.studio();
      applyTheme(s.theme);
      document.title = s.name;
      setStudio(s);
      setMe(await api.me());
    } catch (e) {
      const err = e as AppError;
      setProblem(err.code === "not_member" ? `${err.message} Join on the studio's booking page first, then come back.` : err.message);
    }
  }, [api]);
  useEffect(() => void load(), [load]);

  if (problem) return <main className="boot"><p role="alert">{problem}</p></main>;
  if (!api || !studio || me === undefined) return <main className="boot" aria-busy="true"><span className="boot-dot" /></main>;
  if (!me || !api) return <SignIn api={api} studio={studio} onDone={load} />;
  return (
    <StoreProvider api={api} studio={studio} me={me}>
      <Shell />
    </StoreProvider>
  );
}

const TABS: { key: Tab; label: string; icon: JSX.Element }[] = [
  { key: "home", label: "Home", icon: <path d="M4 11.5 12 5l8 6.5V20h-5v-5H9v5H4z" /> },
  { key: "book", label: "Book", icon: <><rect x="4" y="5.5" width="16" height="14.5" rx="2" /><path d="M4 10h16M9 3.5v4M15 3.5v4" /></> },
  { key: "classes", label: "My classes", icon: <><path d="M8 7h11M8 12h11M8 17h11" /><circle cx="4.5" cy="7" r=".8" /><circle cx="4.5" cy="12" r=".8" /><circle cx="4.5" cy="17" r=".8" /></> },
  { key: "me", label: "Me", icon: <><circle cx="12" cy="8.5" r="3.5" /><path d="M5 20c1.2-3.6 3.8-5.5 7-5.5s5.8 1.9 7 5.5" /></> },
];

function Shell() {
  const { studio, tab, go, progress, toasts, dismissToast, bookings } = useStore();
  const [celebrating, setCelebrating] = useState(false);
  const [shownKey, setShownKey] = useState<string | null>(null);
  // The celebration opens once, a moment after Home has drawn.
  useEffect(() => {
    const c = progress?.celebration;
    if (c && c.key !== shownKey) {
      const t = setTimeout(() => { setShownKey(c.key); setCelebrating(true); }, 650);
      return () => clearTimeout(t);
    }
  }, [progress, shownKey]);
  const close = useCallback(() => setCelebrating(false), []);

  return (
    <div className="shell">
      <a className="skip" href="#main">Skip to content</a>
      <header className="topbar">
        {studio.logoUrl ? <img src={studio.logoUrl} alt="" /> : <span className="brand-mark" aria-hidden="true">{studio.name.slice(0, 1)}</span>}
        <span className="brand-name">{studio.name}</span>
      </header>
      <nav className="rail" aria-label="Main">
        <div className="brand">
          {studio.logoUrl ? <img src={studio.logoUrl} alt="" /> : <span className="brand-mark" aria-hidden="true">{studio.name.slice(0, 1)}</span>}
          <span className="brand-name">{studio.name}</span>
        </div>
        <ul>
          {TABS.map((t) => (
            <li key={t.key}>
              <a href={`#/${t.key}`} aria-current={tab === t.key ? "page" : undefined} onClick={(e) => { e.preventDefault(); go(t.key); }}>
                <svg viewBox="0 0 24 24" aria-hidden="true">{t.icon}</svg>
                <span>{t.label}</span>
                {t.key === "classes" && bookings.length > 0 && <span className="count" aria-label={`${bookings.length} booked`}>{bookings.length}</span>}
              </a>
            </li>
          ))}
        </ul>
      </nav>
      <main id="main" className={`screen screen-${tab}`} key={tab}>
        {tab === "home" && <Home />}
        {tab === "book" && <Book />}
        {tab === "classes" && <MyClasses />}
        {tab === "me" && <Me />}
      </main>
      <div className="toasts" aria-live="polite">
        {toasts.map((t) => (
          <div key={t.id} className="toast" role="status">
            <span>{t.text}</span>
            {t.action && <button type="button" onClick={() => { t.action!.run(); dismissToast(t.id); }}>{t.action.label}</button>}
          </div>
        ))}
      </div>
      {celebrating && progress?.celebration && <Celebration c={progress.celebration} onClose={close} />}
    </div>
  );
}
