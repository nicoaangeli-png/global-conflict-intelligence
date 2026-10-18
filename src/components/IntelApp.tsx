"use client";

import dynamic from "next/dynamic";
import { useEffect, useState } from "react";
import { Header, type ViewKey, type MobileDrawerKey } from "@/components/ui/Header";
import { GlobalSituationPanel } from "@/components/ui/GlobalSituationPanel";
import { LiveConflictPanel } from "@/components/ui/LiveConflictPanel";
import { FiltersPanel } from "@/components/ui/FiltersPanel";
import { Timeline } from "@/components/ui/Timeline";
import { ViewPanel } from "@/components/ui/ViewPanel";
import { SettingsPanel } from "@/components/ui/SettingsPanel";
import { TacticalReconModal } from "@/components/ui/TacticalReconModal";
import {
  BootOverlay,
  CountryCard,
  DataProvenanceBanner,
  FrameCorners,
  HoverCountryBadge,
  HoverReadout,
  SystemReadout,
} from "@/components/ui/Overlays";
import { useIntelStore } from "@/store/useIntelStore";
import { AgentPanel } from "@/components/agent/AgentPanel";

/** La scène 3D est chargée uniquement côté navigateur (WebGL). */
const GlobeScene = dynamic(() => import("@/components/globe/GlobeScene").then((m) => m.GlobeScene), {
  ssr: false,
  loading: () => null,
});

/** Détermine si l'utilisateur est en train de saisir dans un champ texte / zone éditable */
function isTypingContext(e: KeyboardEvent): boolean {
  if (e.isComposing) return true;
  const target = e.target as HTMLElement | null;
  if (
    target &&
    (target.closest?.("input, textarea, select, [contenteditable='true'], [role='textbox']") ||
      target.isContentEditable)
  ) {
    return true;
  }
  const active = typeof document !== "undefined" ? (document.activeElement as HTMLElement | null) : null;
  if (
    active &&
    (active.tagName === "INPUT" ||
      active.tagName === "TEXTAREA" ||
      active.tagName === "SELECT" ||
      active.isContentEditable ||
      active.getAttribute("role") === "textbox")
  ) {
    return true;
  }
  return false;
}

export function IntelApp() {
  const [view, setView] = useState<ViewKey>("OVERVIEW");
  const [mobileDrawer, setMobileDrawer] = useState<MobileDrawerKey>("globe");
  const refresh = useIntelStore((s) => s.refresh);
  const setStreamStatus = useIntelStore((s) => s.setStreamStatus);
  const setAt = useIntelStore((s) => s.setAt);
  const setCountry = useIntelStore((s) => s.setCountry);
  const select = useIntelStore((s) => s.select);
  const selected = useIntelStore((s) => s.selected);
  const country = useIntelStore((s) => s.country);
  const error = useIntelStore((s) => s.error);
  const agentOpen = useIntelStore((s) => s.agentOpen);

  // Premier chargement
  useEffect(() => {
    void refresh();
  }, [refresh]);

  // Sur mobile : basculer automatiquement sur le tiroir conflit lors d'une sélection
  useEffect(() => {
    if (selected || country) {
      setMobileDrawer("conflict");
    }
  }, [selected, country]);

  // Flux temps réel : le serveur pousse les changements, le client réinterroge
  // uniquement l'agrégat filtré (jamais de rechargement complet).
  useEffect(() => {
    let source: EventSource | null = null;
    let retry: ReturnType<typeof setTimeout> | null = null;

    const connect = () => {
      setStreamStatus("connecting");
      source = new EventSource("/api/stream");

      source.addEventListener("ready", () => setStreamStatus("open"));
      source.addEventListener("heartbeat", () => setStreamStatus("open"));
      source.addEventListener("ingest", () => {
        setStreamStatus("open");
        void refresh();
      });
      source.onerror = () => {
        setStreamStatus("closed");
        source?.close();
        retry = setTimeout(connect, 6000);
      };
    };

    connect();
    return () => {
      source?.close();
      if (retry) clearTimeout(retry);
    };
  }, [refresh, setStreamStatus]);

  // Échap : ferme la vue ou la sélection sans interférer avec la saisie active
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "Escape") return;
      if (isTypingContext(e)) {
        (document.activeElement as HTMLElement)?.blur?.();
        return;
      }
      if (useIntelStore.getState().reconTarget) {
        useIntelStore.getState().setReconTarget(null);
        return;
      }
      if (useIntelStore.getState().agentOpen) {
        window.speechSynthesis?.cancel();
        useIntelStore.getState().setAgentOpen(false);
        return;
      }
      if (view !== "OVERVIEW") {
        setView("OVERVIEW");
        return;
      }
      if (useIntelStore.getState().country) {
        setCountry(null);
        return;
      }
      void select(null);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [select, setCountry, view]);

  // Raccourcis 1–6 : navigation (strictement ignorés pendant la saisie)
  useEffect(() => {
    const views: ViewKey[] = ["OVERVIEW", "LIVE EVENTS", "CONFLICTS", "TIMELINE", "REGIONS", "SOURCES"];
    const onKey = (e: KeyboardEvent) => {
      if (isTypingContext(e)) return;
      const n = Number(e.key);
      if (!n || n < 1 || n > views.length) return;
      if (e.metaKey || e.ctrlKey || e.altKey) return;
      setView(views[n - 1]);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  const openView = view === "TIMELINE" ? "OVERVIEW" : view;
  void setAt;

  return (
    <main className="stage">
      <GlobeScene />
      <FrameCorners />

      <div className="hud">
        <Header
          view={view}
          onView={setView}
          mobileDrawer={mobileDrawer}
          onMobileDrawer={setMobileDrawer}
        />
        <DataProvenanceBanner />
        <HoverCountryBadge />
        <CountryCard />
        <HoverReadout />
        <SystemReadout />

        {/* Colonne gauche : situation globale puis filtres (tiroir unique sur mobile) */}
        <div
          className={`scroll-thin absolute top-[86px] flex max-h-[calc(100vh-212px)] flex-col gap-3 overflow-y-auto pr-1 ${
            mobileDrawer === "situation"
              ? "left-3 right-3 sm:left-5 sm:right-auto w-[min(300px,calc(100vw-24px))] z-20"
              : "hidden md:flex left-5 w-[268px]"
          }`}
        >
          <GlobalSituationPanel />
          <FiltersPanel />
        </div>

        {/* Vues secondaires : adaptées à la largeur mobile sans débordement */}
        {openView !== "OVERVIEW" ? (
          <div
            className="scroll-thin absolute top-[86px] z-30 max-h-[calc(100vh-212px)] overflow-y-auto left-3 right-3 max-w-[340px] mx-auto md:left-[305px] md:right-auto md:mx-0"
          >
            {openView === "SETUP" ? (
              <SettingsPanel onClose={() => setView("OVERVIEW")} />
            ) : (
              <ViewPanel view={openView} onClose={() => setView("OVERVIEW")} />
            )}
          </div>
        ) : null}

        {/* Colonne droite : données de conflit (tiroir unique sur mobile) */}
        {agentOpen ? null : (
          <div
            className={`absolute top-[86px] flex flex-col gap-3 ${
              mobileDrawer === "conflict"
                ? "left-3 right-3 sm:right-5 sm:left-auto w-[min(320px,calc(100vw-24px))] z-20"
                : "hidden md:flex right-5 w-[300px]"
            }`}
          >
            <LiveConflictPanel />
          </div>
        )}

        {/* AURA : analyste IA vocale */}
        <AgentPanel />

        {/* Sélecteur de tiroir mobile au-dessus de la timeline (écran étroit uniquement) */}
        <div
          role="group"
          aria-label="Affichage des panneaux mobiles"
          className="pointer-events-auto absolute bottom-[72px] left-1/2 z-20 flex -translate-x-1/2 items-center gap-1 border border-cyan/30 bg-[#020b18]/90 px-2 py-1 backdrop-blur md:hidden"
        >
          <button
            type="button"
            className={`px-2 py-0.5 text-[9px] font-mono tracking-wider transition-colors ${
              mobileDrawer === "globe"
                ? "bg-cyan/25 text-ice font-bold border border-cyan/50"
                : "text-text-faint hover:text-text border border-transparent"
            }`}
            onClick={() => setMobileDrawer("globe")}
            aria-label="Afficher le globe 3D plein écran"
            aria-pressed={mobileDrawer === "globe"}
          >
            🌐 GLOBE
          </button>
          <span className="text-[8px] text-cyan/30">|</span>
          <button
            type="button"
            className={`px-2 py-0.5 text-[9px] font-mono tracking-wider transition-colors ${
              mobileDrawer === "situation"
                ? "bg-cyan/25 text-ice font-bold border border-cyan/50"
                : "text-text-faint hover:text-text border border-transparent"
            }`}
            onClick={() => setMobileDrawer("situation")}
            aria-label="Afficher le panneau de situation et filtres"
            aria-pressed={mobileDrawer === "situation"}
          >
            📊 SITUATION
          </button>
          <span className="text-[8px] text-cyan/30">|</span>
          <button
            type="button"
            className={`px-2 py-0.5 text-[9px] font-mono tracking-wider transition-colors ${
              mobileDrawer === "conflict"
                ? "bg-cyan/25 text-ice font-bold border border-cyan/50"
                : "text-text-faint hover:text-text border border-transparent"
            }`}
            onClick={() => setMobileDrawer("conflict")}
            aria-label="Afficher le flux des conflits et événements"
            aria-pressed={mobileDrawer === "conflict"}
          >
            ⚡ CONFLITS
          </button>
        </div>

        {/* Timeline */}
        <div className="absolute bottom-4 left-5 right-5">
          <Timeline />
        </div>
      </div>

      <TacticalReconModal />

      {error ? (
        <div className="absolute left-1/2 top-1/2 z-30 -translate-x-1/2 -translate-y-1/2">
          <div className="panel corners px-4 py-3">
            <span className="corner" />
            <div className="text-[11px] uppercase tracking-wide text-[#ff4d3b]">Anomalie flux</div>
            <div className="mt-1 text-[9px] text-text-faint">{error}</div>
            <button
              type="button"
              className="chip mt-3 w-full text-center"
              onClick={() => void refresh()}
            >
              Réessayer
            </button>
          </div>
        </div>
      ) : null}

      <BootOverlay />
    </main>
  );
}
