"use client";

import { useEffect, useState } from "react";

/** Horloge partagée pour les heures relatives (rafraîchie toutes les `ms`). */
export function useNow(ms = 30_000): number {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), ms);
    return () => clearInterval(id);
  }, [ms]);
  return now;
}
