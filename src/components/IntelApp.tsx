"use client";

import dynamic from "next/dynamic";
import { useEffect, useState } from "react";
import { Header } from "@/components/ui/Header";
import { SettingsPanel } from "@/components/ui/SettingsPanel";
import { BriefingModal } from "@/components/briefing/BriefingModal";
import { BootOverlay, FrameCorners, HoverCountryBadge, HoverFeedReadout, HoverLayerReadout, HoverReadout } from "@/components/ui/Overlays";
import { ThemeBar } from "@/components/feeds/ThemeBar";
import { WorldFeedPanel } from "@/components/feeds/WorldFeedPanel";
import { Inspector, hasInspection } from "@/components/feeds/Inspector";
import { useIntelStore } from "@/store/useIntelStore";
import { AgentPanel } from "@/components/agent/AgentPanel";
import { tr } from "@/lib/i18n";

/** La scène 3D est chargée uniquement côté navigateur (WebGL). */
const GlobeScene = dynamic(() => import("@/components/globe/GlobeScene").then((m) => m.GlobeScene), {
  ssr: false,
  loading: () => null,
});

/** Polling des flux mondiaux (en plus du rafraîchissement manuel). */
const FEEDS_POLL_MS = 2 * 60_000;
/** Positions des mobiles militaires : rafraîchies plus souvent que les autres flux. */
const MILITARY_POLL_MS = 15_000;

/** Détermine si l'utilisateur est en train de saisir dans un champ texte / zone éditable */
function isTypingContext(e: KeyboardEvent): boolean {
  if (e.isComposing) return true;
  const target = e.target as HTMLElement | null;
  if (target && (target.closest?.("input, textarea, select, [contenteditable='true'], [role='textbox']") || target.isContentEditable)) {
    return true;
  }
  const active = typeof document !== "undefined" ? (document.activeElement as HTMLElement | null) : null;
  return Boolean(
    active &&
      (active.tagName === "INPUT" ||
        active.tagName === "TEXTAREA" ||
        active.tagName === "SELECT" ||
        active.isContentEditable ||
        active.getAttribute("role") === "textbox"),
  );
}

type MobilePane = "globe" | "feed" | "inspector";

export function IntelApp() {
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [briefingOpen, setBriefingOpen] = useState(false);
  const [mobilePane, setMobilePane] = useState<MobilePane>("globe");
  const refresh = useIntelStore((s) => s.refresh);
  const refreshFeeds = useIntelStore((s) => s.refreshFeeds);
  const setStreamStatus = useIntelStore((s) => s.setStreamStatus);
  const locale = useIntelStore((s) => s.locale);
  const error = useIntelStore((s) => s.error);
  const agentOpen = useIntelStore((s) => s.agentOpen);
  const inspecting = useIntelStore(hasInspection);
  const theme = useIntelStore((s) => s.theme);
  const refreshFeedCategory = useIntelStore((s) => s.refreshFeedCategory);

  // Langue du document synchronisée (évite la « traduction » automatique de Chrome).
  useEffect(() => {
    document.documentElement.lang = locale;
  }, [locale]);

  // Premier chargement : conflits (store) puis flux mondiaux, et polling des flux.
  useEffect(() => {
    void refresh();
    void refreshFeeds();
    const id = setInterval(() => void refreshFeeds(), FEEDS_POLL_MS);
    return () => clearInterval(id);
  }, [refresh, refreshFeeds]);

  // Mobiles militaires (avions, navires) visibles sur le globe ou onglet Militaire ouvert :
  // positions et trajets rafraîchis toutes les 15 s (le cache serveur borne le rythme réel).
  const mobilesLive = useIntelStore((s) => s.mobilesOn.aircraft || s.mobilesOn.vessel);
  useEffect(() => {
    if (theme !== "military" && !mobilesLive) return;
    const id = setInterval(() => void refreshFeedCategory("military"), MILITARY_POLL_MS);
    return () => clearInterval(id);
  }, [theme, mobilesLive, refreshFeedCategory]);

  // Trafic des détroits (navires civils) : même rythme, seulement s'il est affiché.
  const merchantsLive = useIntelStore((s) => s.mobilesOn.merchant);
  useEffect(() => {
    if (!merchantsLive) return;
    const id = setInterval(() => void refreshFeedCategory("shipping"), MILITARY_POLL_MS);
    return () => clearInterval(id);
  }, [merchantsLive, refreshFeedCategory]);

  // Sur mobile : une inspection ouvre le volet correspondant.
  useEffect(() => {
    if (inspecting) setMobilePane("inspector");
  }, [inspecting]);

  // Flux temps réel : le serveur pousse les ingestions, le client réinterroge l'agrégat filtré.
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

  // Échap : ferme dans l'ordre AURA, bilan, réglages, inspection — sans interférer avec la saisie.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "Escape") return;
      if (isTypingContext(e)) {
        (document.activeElement as HTMLElement)?.blur?.();
        return;
      }
      const s = useIntelStore.getState();
      if (s.agentOpen) {
        window.speechSynthesis?.cancel();
        s.setAgentOpen(false);
        return;
      }
      if (briefingOpen) {
        setBriefingOpen(false);
        return;
      }
      if (settingsOpen) {
        setSettingsOpen(false);
        return;
      }
      if (s.selectedFeedItem) return s.selectFeedItem(null);
      if (s.selectedLayerFeature) return s.selectLayerFeature(null);
      if (s.selected) return void s.select(null);
      if (s.country) return s.setCountry(null);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [briefingOpen, settingsOpen]);

  return (
    <main className="stage" translate="no">
      <GlobeScene />
      <FrameCorners />

      <div className="hud">
        <Header
          settingsOpen={settingsOpen}
          onSettings={() => setSettingsOpen((v) => !v)}
          onBriefing={() => setBriefingOpen(true)}
        />
        <ThemeBar />

        <div className="left-column" data-mobile-open={mobilePane === "feed"}>
          <WorldFeedPanel />
        </div>

        {agentOpen ? null : (
          <div className="right-column" data-mobile-open={mobilePane === "inspector"}>
            <Inspector />
          </div>
        )}

        {settingsOpen ? (
          <div className="settings-anchor">
            <SettingsPanel onClose={() => setSettingsOpen(false)} />
          </div>
        ) : null}

        {briefingOpen ? <BriefingModal onClose={() => setBriefingOpen(false)} /> : null}

        <AgentPanel />
        <HoverCountryBadge />
        <HoverReadout />
        <HoverFeedReadout />
        <HoverLayerReadout />

        {/* Sélecteur de volet (écran étroit uniquement) */}
        <div role="group" aria-label={tr(locale, "Volet affiché", "Visible pane")} className="mobile-switch">
          {(
            [
              ["globe", tr(locale, "Globe", "Globe")],
              ["feed", tr(locale, "Fil", "Feed")],
              ["inspector", tr(locale, "Détail", "Details")],
            ] as const
          ).map(([key, text]) => (
            <button key={key} type="button" className="chip" data-active={mobilePane === key} aria-pressed={mobilePane === key} onClick={() => setMobilePane(key)}>
              {text}
            </button>
          ))}
        </div>
      </div>

      {error ? (
        <div className="absolute left-1/2 top-1/2 z-30 -translate-x-1/2 -translate-y-1/2">
          <div className="panel corners px-4 py-3">
            <span className="corner" />
            <div className="text-[13px] text-[#ff8a70]">{tr(locale, "Données de conflit indisponibles", "Conflict data unavailable")}</div>
            <div className="meta mt-1">{error}</div>
            <button type="button" className="chip mt-3 w-full text-center" onClick={() => void refresh()}>
              {tr(locale, "Réessayer", "Retry")}
            </button>
          </div>
        </div>
      ) : null}

      <BootOverlay />
    </main>
  );
}
