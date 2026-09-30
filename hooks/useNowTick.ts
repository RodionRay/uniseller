"use client";

import { useEffect, useState } from "react";

/** Тик раз в секунду — живые часы и обратный отсчёт паузы. */
export function useNowTick(enabled = true, ms = 1000) {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (!enabled) return;
    const tick = () => setNow(Date.now());
    // Immediate refresh after (re)enable, scheduled so the effect itself does not set state.
    const first = window.setTimeout(tick, 0);
    const id = window.setInterval(tick, ms);
    return () => {
      window.clearTimeout(first);
      window.clearInterval(id);
    };
  }, [enabled, ms]);
  return now;
}
