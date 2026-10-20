"use client";

import { useEffect, useState } from "react";

export function useMobileViewport() {
  const [mobile, setMobile] = useState<boolean | null>(null);
  useEffect(() => {
    const query = window.matchMedia("(max-width: 1023px)");
    const sync = () => setMobile(query.matches);
    const viewport = window.visualViewport;
    const resize = () => {
      if (viewport && viewport.scale === 1) {
        document.documentElement.style.setProperty("--visual-height", `${viewport.height}px`);
        document.documentElement.style.setProperty("--visual-top", `${viewport.offsetTop}px`);
      }
    };
    sync(); resize();
    query.addEventListener("change", sync);
    viewport?.addEventListener("resize", resize);
    viewport?.addEventListener("scroll", resize);
    window.addEventListener("resize", resize);
    return () => {
      query.removeEventListener("change", sync);
      viewport?.removeEventListener("resize", resize);
      viewport?.removeEventListener("scroll", resize);
      window.removeEventListener("resize", resize);
      document.documentElement.style.removeProperty("--visual-height");
      document.documentElement.style.removeProperty("--visual-top");
    };
  }, []);
  return mobile;
}
