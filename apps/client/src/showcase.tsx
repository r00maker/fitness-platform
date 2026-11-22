/**
 * The showcase: one client app, three studios. Each phone runs the real app in demo mode with
 * that studio's look, so everything in it can be tapped. The descriptions are the presets' own.
 */
import { StrictMode, useState } from "react";
import { createRoot } from "react-dom/client";
import { APP_THEME_PRESETS } from "@studio/shared";
import "./showcase.css";

const LOOKS = [
  { key: "linden", studio: "Linden Reformer Studio", member: "Rachel, 47 classes, 3 to her 50th" },
  { key: "tidal", studio: "Tidal Barre", member: "Jasmine, 4 weeks in a row (opens with a celebration)" },
  { key: "aizome", studio: "Aizome Yoga", member: "Kenji, who just reached 108 classes (opens with a celebration)" },
];

function Showcase() {
  const [one, setOne] = useState(0);
  return (
    <main>
      <header className="sc-head">
        <h1>One app, three studios</h1>
        <p>The same client app, set up by three different studios. Each picks a starting look and changes what it likes: colours, a pair of typefaces, corners, how celebrations look, a welcome line and the milestones it counts. Every phone is live, so tap around: book a class, set a goal, cancel.</p>
      </header>
      <div className="sc-tabs" role="tablist" aria-label="Studio">
        {LOOKS.map((l, i) => <button key={l.key} role="tab" aria-selected={one === i} onClick={() => setOne(i)}>{l.studio}</button>)}
      </div>
      <div className="sc-phones">
        {LOOKS.map((l, i) => {
          const p = APP_THEME_PRESETS[l.key]!;
          return (
            <figure key={l.key} className={`sc-phone${one === i ? " is-on" : ""}`}>
              <div className="sc-frame"><iframe title={`${l.studio} client app`} src={`index.html?demo&studio=${l.key}`} loading={i ? "lazy" : "eager"} /></div>
              <figcaption>
                <h2>{l.studio}</h2>
                <p>{p.description}</p>
                <dl>
                  <div><dt>Typefaces</dt><dd>{p.displayFont}{p.bodyFont !== p.displayFont ? ` and ${p.bodyFont}` : ""}</dd></div>
                  <div><dt>Colours</dt><dd className="sc-swatches">{[p.background, p.surface, p.accent, p.highlight, p.ink].map((c) => <span key={c} style={{ background: c }} title={c} />)}</dd></div>
                  <div><dt>Milestones</dt><dd>{p.milestones.join(", ")}</dd></div>
                  <div><dt>Member</dt><dd>{l.member}</dd></div>
                </dl>
                <a href={`index.html?demo&studio=${l.key}`} target="_blank" rel="noopener">Open full screen</a>
              </figcaption>
            </figure>
          );
        })}
      </div>
    </main>
  );
}

createRoot(document.getElementById("root")!).render(<StrictMode><Showcase /></StrictMode>);
