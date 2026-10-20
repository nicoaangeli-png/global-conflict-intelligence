"use client";

import { useEffect, useId, useRef, type ReactNode } from "react";
import { useIntelStore } from "@/store/useIntelStore";
import { tr } from "@/lib/i18n";

export function MobileSheet({ title, children, expanded = true, onExpand, onClose }: {
  title: string; children: ReactNode; expanded?: boolean; onExpand?: () => void; onClose: () => void;
}) {
  const titleId = useId();
  const locale = useIntelStore((state) => state.locale);
  const rootRef = useRef<HTMLElement>(null);
  const startY = useRef<number | null>(null);
  useEffect(() => {
    const previous = document.activeElement as HTMLElement | null;
    rootRef.current?.focus();
    return () => { if (previous?.isConnected) previous.focus(); };
  }, []);
  return <section ref={rootRef} tabIndex={-1} className="mobile-sheet panel" data-expanded={expanded} role="dialog" aria-modal="false" aria-labelledby={titleId}
    onKeyDown={(event) => { if (event.key === "Escape") { event.stopPropagation(); onClose(); } }}>
    <header className="mobile-sheet-heading">
      <button type="button" className="sheet-handle" aria-label={expanded ? tr(locale, "Réduire", "Collapse") : tr(locale, "Développer", "Expand")}
        aria-expanded={expanded} onClick={onExpand} disabled={!onExpand}
        onPointerDown={(event) => { startY.current = event.clientY; event.currentTarget.setPointerCapture(event.pointerId); }}
        onPointerCancel={() => { startY.current = null; }}
        onPointerUp={(event) => { const delta = event.clientY - (startY.current ?? event.clientY); startY.current = null; if (delta > 90 && !expanded) onClose(); else if (Math.abs(delta) > 35 && onExpand && ((delta < 0 && !expanded) || (delta > 0 && expanded))) onExpand(); }}><span /></button>
      <div className="mobile-sheet-title"><h2 id={titleId}>{title}</h2><button type="button" className="chip" onClick={onClose} aria-label={tr(locale, "Fermer le panneau", "Close panel")}>✕</button></div>
      {onExpand && <button type="button" className="sheet-expand" onClick={onExpand}>{expanded ? tr(locale, "Résumé ↓", "Summary ↓") : tr(locale, "Tous les détails ↑", "Full details ↑")}</button>}
    </header>
    <div className="mobile-sheet-content scroll-thin">{children}</div>
  </section>;
}
