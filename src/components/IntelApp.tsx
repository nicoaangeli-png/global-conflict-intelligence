"use client";

import dynamic from "next/dynamic";
import { useEffect, useState } from "react";
import { Header, type ViewKey } from "@/components/ui/Header";
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

/** La scène 3D est chargée uniquement côté navigateur (WebGL). */
const GlobeScene = dynamic(() => import("@/components/globe/GlobeScene").then((m) => m.GlobeScene), {
  ssr: false,
  loading: () => null,
});

export function IntelApp() {
  const [view, setView] = useState<ViewKey>("OVERVIEW");
  const refresh = useIntelStore((s) => s.refresh);
  const setStreamStatus = useIntelStore((s) => s.setStreamStatus);
  const setAt = useIntelStore((s) => s.setAt);
  const setCountry = useIntelStore((s) => s.setCountry);
  const select = useIntelStore((s) => s.select);
  const error = useIntelStore((s) => s.error);

  // Premier chargement
  useEffect(() => {
    void refresh();
  }, [refresh]);

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

  // Échap : ferme la vue ou la sélection
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "Escape") return;
      if (useIntelStore.getState().reconTarget) {
        useIntelStore.getState().setReconTarget(null);
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

  // Raccourcis 1–6 : navigation
  useEffect(() => {
    const views: ViewKey[] = ["OVERVIEW", "LIVE EVENTS", "CONFLICTS", "TIMELINE", "REGIONS", "SOURCES"];
    const onKey = (e: KeyboardEvent) => {
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
        <Header view={view} onView={setView} />
        <DataProvenanceBanner />
        <HoverCountryBadge />
        <CountryCard />
        <HoverReadout />
        <SystemReadout />

        {/* Colonne gauche : situation globale puis filtres */}
        <div className="scroll-thin absolute left-5 top-[86px] flex max-h-[calc(100vh-212px)] w-[268px] flex-col gap-3 overflow-y-auto pr-1">
          <GlobalSituationPanel />
          <FiltersPanel />
        </div>

        {/* Vues secondaires */}
        {openView !== "OVERVIEW" ? (
          <div className="scroll-thin absolute left-[305px] top-[86px] max-h-[calc(100vh-212px)] overflow-y-auto">
            {openView === "SETUP" ? (
              <SettingsPanel onClose={() => setView("OVERVIEW")} />
            ) : (
              <ViewPanel view={openView} onClose={() => setView("OVERVIEW")} />
            )}
          </div>
        ) : null}

        {/* Colonne droite : données de conflit */}
        <div className="absolute right-5 top-[86px] flex w-[300px] flex-col gap-3">
          <LiveConflictPanel />
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
