/**
 * The one celebration to show when the app opens (a milestone, a goal met, an achievement).
 * It's the app's single orchestrated moment: the studio's mark draws itself (a leaf unfurls,
 * a wave rolls, a seal is stamped, a spark opens), then the words. Shown once, then marked seen.
 */
import { useEffect, useRef } from "react";
import type { Celebration as C } from "../data/types";
import { useStore } from "../store";
import { Mark } from "./Progress";

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
        <div className="celebrate-art" aria-hidden="true">
          <Mark className="celebrate-mark" />
          {c.number !== null && <span className="celebrate-num">{c.number}</span>}
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
