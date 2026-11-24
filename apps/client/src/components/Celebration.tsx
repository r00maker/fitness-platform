/**
 * The one celebration to show when the app opens (a milestone, a goal met, an achievement).
 * It's the app's single orchestrated moment: a badge in the studio's shape arrives (a leaf, a
 * circle with a ripple, a stamped seal, a turning rosette), then the words. Shown once, then marked seen.
 */
import { useEffect, useRef } from "react";
import type { Celebration as C } from "../data/types";
import { useStore } from "../store";

export function Celebration({ c, onClose }: { c: C; onClose(): void }) {
  const { api, go } = useStore();
  const btn = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    btn.current?.focus();
    void api.seen(c.key);
    const esc = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    addEventListener("keydown", esc);
    return () => removeEventListener("keydown", esc);
  }, [api, c.key, onClose]);
  return (
    <div className="celebrate-scrim" onClick={onClose}>
      <div className="celebrate" role="dialog" aria-modal="true" aria-labelledby="celebrateT" aria-describedby="celebrateD" onClick={(e) => e.stopPropagation()}>
        {/* One badge in the studio's shape, with the number on it (or a tick for an achievement). */}
        <div className="celebrate-art" aria-hidden="true">
          <span className="cel-badge">
            {c.number !== null
              ? <span className={`celebrate-num${String(c.number).length > 3 ? " is-long" : ""}`}>{c.number}</span>
              : <svg viewBox="0 0 24 24"><path d="m5 12.5 4.5 4.5L19 7.5" /></svg>}
          </span>
        </div>
        <h2 id="celebrateT">{c.title}</h2>
        <p id="celebrateD">{c.message}</p>
        <div className="celebrate-btns">
          <button ref={btn} type="button" className="btn btn-main" onClick={() => { onClose(); go("book"); }}>Book your next class</button>
          <button type="button" className="btn btn-text" onClick={onClose}>Close</button>
        </div>
      </div>
    </div>
  );
}
