import { useEffect, useMemo, useState } from "react";
import { Link, useParams } from "react-router-dom";
import { pub } from "../lib/api";
import { useStudio } from "../lib/session";
import { Notice, Shell, Spinner } from "../components/ui";

interface Cls { id: string; name: string; color: string; time: string; endTime: string; durationMinutes: number; location: { id: string; name: string }; instructor: { name: string | null } | null; availability: string; label: string; spotsLeft: number }
interface Day { date: string; label: string; closed: { name: string; message: string | null } | null; classes: Cls[] }
interface Pkg { id: string; name: string; description: string | null; billing: string; price: string; terms: string[] }

export function StudioHome({ tab }: { tab: "classes" | "packages" }) {
  const { slug = "" } = useParams();
  const { studio, error, loading } = useStudio();
  if (error === "not_found") return <NotFoundStudio />;
  return (
    <Shell>
      {studio && (
        <section className="hero">
          <h1>{studio.name}</h1>
          {studio.intro && <p>{studio.intro}</p>}
        </section>
      )}
      <div className="tabs" role="tablist" aria-label="What to see">
        <Link role="tab" aria-selected={tab === "classes"} to={`/s/${slug}`}>Classes</Link>
        <Link role="tab" aria-selected={tab === "packages"} to={`/s/${slug}/packages`}>Packages</Link>
      </div>
      {loading && !studio ? <Spinner /> : error ? <Notice kind="error">{error}</Notice> : tab === "classes" ? <Timetable /> : <Packages />}
    </Shell>
  );
}

function Timetable() {
  const { slug = "" } = useParams();
  const { studio } = useStudio();
  const [days, setDays] = useState<Day[] | null>(null);
  const [sel, setSel] = useState(0);
  const [loc, setLoc] = useState("");
  const [type, setType] = useState("");
  const [err, setErr] = useState<string | null>(null);
  useEffect(() => {
    setDays(null);
    pub<{ days: Day[] }>(`/studios/${slug}/schedule?days=7${loc ? `&locationId=${loc}` : ""}${type ? `&classTypeId=${type}` : ""}`)
      .then((r) => { setDays(r.days); setErr(null); })
      .catch((e) => setErr((e as Error).message));
  }, [slug, loc, type]);
  const day = days?.[sel];
  const first = useMemo(() => days?.findIndex((d) => d.classes.length) ?? -1, [days]);
  useEffect(() => { if (first > 0 && sel === 0 && !days?.[0]?.classes.length) setSel(first); }, [first]); // eslint-disable-line react-hooks/exhaustive-deps
  if (err) return <Notice kind="error">{err}</Notice>;
  return (
    <>
      <div className="days" role="group" aria-label="Choose a day">
        {(days ?? Array.from({ length: 7 }, (_, i) => ({ date: String(i), label: "" }) as Day)).map((d, i) => {
          const dt = days ? new Date(`${d.date}T12:00:00`) : null;
          return (
            <button key={d.date} type="button" aria-pressed={i === sel} onClick={() => setSel(i)} disabled={!days}>
              <span>{dt ? (i === 0 && d.label === "Today" ? "Today" : dt.toLocaleDateString("en-GB", { weekday: "short" })) : ""}</span>
              <b>{dt?.getDate() ?? ""}</b>
            </button>
          );
        })}
      </div>
      <div className="filters">
        {studio && studio.locations.length > 1 && (
          <select aria-label="Location" value={loc} onChange={(e) => setLoc(e.target.value)}>
            <option value="">All locations</option>
            {studio.locations.map((l) => <option key={l.id} value={l.id}>{l.name}</option>)}
          </select>
        )}
        {studio && studio.classTypes.length > 1 && (
          <select aria-label="Class" value={type} onChange={(e) => setType(e.target.value)}>
            <option value="">All classes</option>
            {studio.classTypes.map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}
          </select>
        )}
      </div>
      {!days ? <Spinner label="Loading the timetable" /> : day?.closed ? (
        <Notice title={`Closed: ${day.closed.name}`}>{day.closed.message}</Notice>
      ) : !day?.classes.length ? (
        <p className="empty">No classes {sel === 0 ? "left today" : "this day"}{loc || type ? " with these filters" : ""}.</p>
      ) : (
        <ul className="list">
          {day.classes.map((c) => (
            <li key={c.id}>
              <Link className="row" to={`/s/${slug}/classes/${c.id}`}>
                <span className="t">{c.time}<small>{c.durationMinutes} min</small></span>
                <span className="n"><b><i style={{ background: c.color }} />{c.name}</b><small>{[c.instructor?.name, c.location.name].filter(Boolean).join(" · ")}</small></span>
                <span className={`s ${c.availability}`}>{c.label}</span>
              </Link>
            </li>
          ))}
        </ul>
      )}
    </>
  );
}

function Packages() {
  const { slug = "" } = useParams();
  const [pkgs, setPkgs] = useState<Pkg[] | null>(null);
  const [err, setErr] = useState<string | null>(null);
  useEffect(() => { pub<{ packages: Pkg[] }>(`/studios/${slug}/packages`).then((r) => setPkgs(r.packages)).catch((e) => setErr((e as Error).message)); }, [slug]);
  if (err) return <Notice kind="error">{err}</Notice>;
  if (!pkgs) return <Spinner label="Loading packages" />;
  if (!pkgs.length) return <p className="empty">Nothing on sale right now. Ask at the studio.</p>;
  return (
    <div className="packs">
      {pkgs.map((p) => (
        <article key={p.id} className="pack">
          <h2>{p.name}</h2>
          <span className="price">{p.price}{p.billing === "recurring" && <small> each period</small>}</span>
          {p.description && <p>{p.description}</p>}
          <ul>{p.terms.slice(0, 5).map((t) => <li key={t}>{t}</li>)}</ul>
          <Link className="btn" to={`/s/${slug}/packages/${p.id}`}>Buy</Link>
        </article>
      ))}
    </div>
  );
}

export function NotFoundStudio() {
  return (
    <div className="center">
      <h1>Page not found</h1>
      <p className="muted">This booking page doesn't exist, or the studio has switched it off. Check the link with the studio.</p>
    </div>
  );
}
