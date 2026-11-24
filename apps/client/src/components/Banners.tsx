/**
 * The studio's banners: swipe or use the dots; they move on by themselves every few seconds
 * (the studio's setting), except while someone is reading one (hover, focus) or prefers less motion.
 */
import { useEffect, useRef, useState } from "react";
import type { Banner } from "../data/types";
import { useStore } from "../store";

export function Banners() {
  const { api } = useStore();
  const [data, setData] = useState<{ rotateSeconds: number; banners: Banner[] } | null>(null);
  const [at, setAt] = useState(0);
  const strip = useRef<HTMLDivElement>(null);
  const paused = useRef(false);

  useEffect(() => void api.banners().then(setData).catch(() => setData({ rotateSeconds: 6, banners: [] })), [api]);

  const show = (i: number) => {
    const el = strip.current;
    if (!el) return;
    el.scrollTo({ left: i * el.clientWidth, behavior: matchMedia("(prefers-reduced-motion: reduce)").matches ? "auto" : "smooth" });
  };

  useEffect(() => {
    if (!data || data.banners.length < 2 || matchMedia("(prefers-reduced-motion: reduce)").matches) return;
    const t = setInterval(() => { if (!paused.current && !document.hidden) show((at + 1) % data.banners.length); }, data.rotateSeconds * 1000);
    return () => clearInterval(t);
  }, [data, at]);

  if (!data?.banners.length) return null;
  return (
    <section className="banners" aria-label="From the studio" aria-roledescription="carousel"
      onMouseEnter={() => (paused.current = true)} onMouseLeave={() => (paused.current = false)}
      onFocus={() => (paused.current = true)} onBlur={() => (paused.current = false)}>
      <div className="banner-strip" ref={strip} onScroll={(e) => { const el = e.currentTarget; setAt(Math.round(el.scrollLeft / el.clientWidth)); }}>
        {data.banners.map((b, i) => (
          <article className="banner" key={b.id} aria-roledescription="slide" aria-label={`${i + 1} of ${data.banners.length}`}>
            <img src={b.imageUrl} alt="" loading={i ? "lazy" : "eager"} />
            <div className="banner-text">
              <h2>{b.title}</h2>
              {b.subtitle && <p>{b.subtitle}</p>}
            </div>
          </article>
        ))}
      </div>
      {data.banners.length > 1 && (
        <div className="banner-dots">
          {data.banners.map((b, i) => <button key={b.id} type="button" aria-label={`Show banner ${i + 1}: ${b.title}`} aria-current={i === at} onClick={() => show(i)} />)}
        </div>
      )}
    </section>
  );
}
