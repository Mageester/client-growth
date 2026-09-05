import { useEffect, useState } from "react";

/**
 * Which of a page's sections the reader is currently in.
 *
 * Two navigations depend on this — the tab strip on an opportunity and the
 * secondary navigation in Settings — and both exist to answer "where am I".
 * An indicator pinned to the first item would answer that wrongly, so this
 * reads the real scroll position instead.
 *
 * The measurement is a plain rect read behind requestAnimationFrame rather
 * than an IntersectionObserver: the sections here are tall and often overlap
 * the reading line, which makes "the last section whose top has passed the
 * line" both simpler and more stable than intersection ratios.
 */
export function useCurrentSection(ids: readonly string[], enabled = true): string | null {
  const key = ids.join("|");
  const [active, setActive] = useState<string | null>(ids[0] ?? null);

  useEffect(() => {
    const sectionIds = key ? key.split("|") : [];
    if (!enabled || sectionIds.length === 0) return;

    let frame = 0;

    function pick() {
      frame = 0;
      // Roughly where a reader's eye sits, below the page's sticky top. The
      // winner is the section closest above that line — chosen by position,
      // not by list order, because one section can be nested inside another.
      const line = 140;
      let current = sectionIds[0] ?? null;
      let best = -Infinity;
      for (const id of sectionIds) {
        const node = document.getElementById(id);
        if (!node) continue;
        const top = node.getBoundingClientRect().top;
        if (top <= line && top > best) {
          best = top;
          current = id;
        }
      }
      // A short final section can never reach the line, so the end of the page
      // always belongs to the last one.
      const atBottom =
        window.scrollY + window.innerHeight >= document.documentElement.scrollHeight - 4;
      if (atBottom) current = sectionIds[sectionIds.length - 1] ?? current;
      setActive(current);
    }

    function schedule() {
      if (!frame) frame = requestAnimationFrame(pick);
    }

    pick();
    window.addEventListener("scroll", schedule, { passive: true });
    window.addEventListener("resize", schedule);
    return () => {
      if (frame) cancelAnimationFrame(frame);
      window.removeEventListener("scroll", schedule);
      window.removeEventListener("resize", schedule);
    };
  }, [enabled, key]);

  return active;
}
