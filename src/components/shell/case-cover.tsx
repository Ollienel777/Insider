"use client";

import { useEffect, useRef } from "react";
import { COVER_KEY } from "./case-cover-script";

// The case file's cover (issue 166): closed over the whole desk when the game
// first opens, then it turns on the spine like a sheet of thin card. It is cut
// into strips that each turn a little more than the one before, so it bends.
// Once per visit: a reload in the same tab finds the file already open.
const STRIPS = 30;
const DELAY_MS = 450;
const TURN_MS = 1700;

const ease = (t: number) => (t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2);

export function CaseCover() {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const cover = ref.current;
    if (!cover || document.documentElement.dataset.coverDone) return;
    const desk = cover.parentElement;
    const W = cover.getBoundingClientRect().width;
    const w = W / STRIPS;
    const art = cover.querySelector<HTMLTemplateElement>("template")?.innerHTML ?? "";
    let html = "";
    for (let i = STRIPS - 1; i >= 0; i--) {
      const clip = `clip-path:inset(0 ${W - (i + 1) * w - 1.5}px 0 ${i * w - 0.5}px)`;
      const face = `<div class="cover-face${i === 0 ? " first" : ""}${i === STRIPS - 1 ? " last" : ""}" style="left:${-i * w}px;width:${W}px;${clip}">${art}</div>`;
      html = `<div class="cover-strip" style="left:${i === 0 ? 0 : w}px;width:${w}px">${face}<div class="cover-back" style="width:${w + 0.5}px"></div>${html}</div>`;
    }
    const sheet = cover.querySelector<HTMLDivElement>("[data-sheet]")!;
    sheet.innerHTML = html;
    sheet.dataset.built = "1";
    const strips = [...sheet.querySelectorAll<HTMLDivElement>(".cover-strip")];
    desk?.setAttribute("data-shaded", "");
    let raf = 0;
    let t0: number | null = null;
    const frame = (p: number) => {
      // The spine leads; the free edge lags behind it and catches up, like thin card.
      const a = -180 * ease(p);
      const bend = 46 * Math.sin(Math.PI * Math.min(1, p * 1.05)) + 6 * Math.sin(p * Math.PI * 5) * (1 - p);
      let total = 0;
      strips.forEach((el, i) => {
        const rel = i === 0 ? a + bend : (-2 * bend) / (STRIPS - 1);
        total += rel;
        el.style.transform = `rotateY(${rel}deg)`;
        el.style.setProperty("--shade", Math.min(0.85, Math.abs(Math.sin((total * Math.PI) / 180)) * 0.7).toFixed(3));
      });
      desk?.style.setProperty("--under", (0.62 + 0.38 * Math.min(1, p * 1.25)).toFixed(3));
      if (p > 0.86) cover.style.opacity = String(1 - (p - 0.86) / 0.14);
    };
    const step = (now: number) => {
      if (t0 === null) t0 = now;
      const p = Math.min(1, Math.max(0, (now - t0 - DELAY_MS) / TURN_MS));
      frame(p);
      if (p < 1) raf = requestAnimationFrame(step);
      else {
        document.documentElement.dataset.coverDone = "1";
        desk?.removeAttribute("data-shaded");
        try {
          sessionStorage.setItem(COVER_KEY, "1");
        } catch {
          // Storage refused: the cover just opens again next load.
        }
      }
    };
    frame(0);
    raf = requestAnimationFrame(step);
    return () => cancelAnimationFrame(raf);
  }, []);
  return (
    // Whether it shows at all is decided before the first paint, by the script the root layout puts in <head>
    // (case-cover-script.ts): this effect then finds <html data-cover-done> already set, on a first load and
    // on every move between screens.
    <div ref={ref} aria-hidden data-case-cover className="case-cover">
      <div data-sheet className="cover-sheet" />
      <template
        dangerouslySetInnerHTML={{
          __html: `<div class="cover-art"><span class="cover-tab">Case files</span><div class="cover-label"><b>Hobbs</b><span>Case files · Los Angeles &amp; Houston</span><i>Open</i></div></div>`,
        }}
      />
    </div>
  );
}
