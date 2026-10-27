"use client";

import dynamic from "next/dynamic";
import { useEffect, useState } from "react";
import { Header } from "@/components/ui/Header";
import { SettingsPanel } from "@/components/ui/SettingsPanel";
import { BriefingModal } from "@/components/briefing/BriefingModal";
import { BootOverlay, FrameCorners, HoverCountryBadge, HoverFeedReadout, HoverLayerReadout, HoverReadout } from "@/components/ui/Overlays";
import { ThemeBar } from "@/components/feeds/ThemeBar";
import { Inspector, hasInspection } from "@/components/feeds/Inspector";
import { useIntelStore } from "@/store/useIntelStore";
import { tr } from "@/lib/i18n";
import { CountrySearch } from "@/components/feeds/CountrySearch";
import { MobileSheet } from "@/components/mobile/MobileSheet";
import { DetectionPanel } from "@/components/detection/DetectionPanel";
import { useMobileViewport } from "@/components/mobile/useMobileViewport";
import { Globe2, List, Search, Layers, Sparkles } from "lucide-react";

const WorldFeedPanel = dynamic(() => import("@/components/feeds/WorldFeedPanel").then((module) => module.WorldFeedPanel));
const AgentPanel = dynamic(() => import("@/components/agent/AgentPanel").then((module) => module.AgentPanel));
const LayersMenu = dynamic(() => import("@/components/layers/LayersMenu").then((module) => module.LayersMenu));

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

type MobilePane = "globe" | "feed" | "search" | "layers" | "aura" | "inspector";

export function IntelApp() {
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [briefingOpen, setBriefingOpen] = useState(false);
  const [mobilePane, setMobilePane] = useState<MobilePane>("globe");
  const [expanded, setExpanded] = useState(false);
  const [auraLoaded, setAuraLoaded] = useState(false);
  const mobile = useMobileViewport();
  const refresh = useIntelStore((s) => s.refresh);
  const refreshFeeds = useIntelStore((s) => s.refreshFeeds);
  const setStreamStatus = useIntelStore((s) => s.setStreamStatus);
  const locale = useIntelStore((s) => s.locale);
  const error = useIntelStore((s) => s.error);
  const agentOpen = useIntelStore((s) => s.agentOpen);
  const inspecting = useIntelStore(hasInspection);
  const theme = useIntelStore((s) => s.theme);
  const refreshFeedCategory = useIntelStore((s) => s.refreshFeedCategory);
  const camerasOn = useIntelStore((s) => s.camerasOn);
  const loadCameras = useIntelStore((s) => s.loadCameras);

  // Langue du document synchronisée (évite la « traduction » automatique de Chrome).
  useEffect(() => {
    document.documentElement.lang = locale;
  }, [locale]);

  // Premier chargement : conflits (store) puis flux mondiaux, et polling des flux.
  useEffect(() => {
    void refresh();
    void refreshFeeds();
    const id = setInterval(() => { if (!document.hidden) void refreshFeeds(); }, FEEDS_POLL_MS);
    return () => clearInterval(id);
  }, [refresh, refreshFeeds]);

  // Mobiles militaires (avions, navires) visibles sur le globe ou onglet Militaire ouvert :
  // positions et trajets rafraîchis toutes les 15 s (le cache serveur borne le rythme réel).
  const mobilesLive = useIntelStore((s) => s.mobilesOn.aircraft || s.mobilesOn.vessel);
  useEffect(() => {
    if (theme !== "military" && !mobilesLive) return;
    const id = setInterval(() => { if (!document.hidden) void refreshFeedCategory("military"); }, MILITARY_POLL_MS);
    return () => clearInterval(id);
  }, [theme, mobilesLive, refreshFeedCategory]);

  // Trafic des détroits (navires civils) : même rythme, seulement s'il est affiché.
  const merchantsLive = useIntelStore((s) => s.mobilesOn.merchant);
  useEffect(() => {
    if (!merchantsLive) return;
    const id = setInterval(() => { if (!document.hidden) void refreshFeedCategory("shipping"); }, MILITARY_POLL_MS);
    return () => clearInterval(id);
  }, [merchantsLive, refreshFeedCategory]);

  // La source la plus rapide recommande une requête par minute ; rien n'est interrogé couche éteinte.
  useEffect(() => {
    if (!camerasOn) return;
    const id = setInterval(() => { if (!document.hidden) void loadCameras(true); }, 60_000);
    return () => clearInterval(id);
  }, [camerasOn, loadCameras]);

  // Sur mobile : une inspection ouvre le volet correspondant.
  useEffect(() => {
    if (inspecting) { setMobilePane("inspector"); setExpanded(false); }
    else setMobilePane((pane) => pane === "inspector" ? "globe" : pane);
  }, [inspecting]);

  useEffect(() => {
    if (agentOpen) setAuraLoaded(true);
    if (mobile && agentOpen) { setMobilePane("aura"); setSettingsOpen(false); setBriefingOpen(false); }
    else if (!agentOpen) setMobilePane((pane) => pane === "aura" ? "globe" : pane);
  }, [mobile, agentOpen]);

  const closePane = () => {
    setMobilePane("globe");
    const state = useIntelStore.getState();
    state.setAgentOpen(false);
    state.setCountry(null);
    void state.select(null);
    state.selectFeedItem(null);
    state.selectLayerFeature(null);
    state.selectCamera(null);
  };

  const openPane = (pane: MobilePane) => {
    if (pane !== "aura") closePane();
    setSettingsOpen(false); setBriefingOpen(false);
    setMobilePane(pane);
    if (pane === "aura") useIntelStore.getState().setAgentOpen(true);
  };

  // Flux temps réel : le serveur pousse les ingestions, le client réinterroge l'agrégat filtré.
  useEffect(() => {
    let source: EventSource | null = null;
    let retry: ReturnType<typeof setTimeout> | null = null;
    let failures = 0;
    let stopped = false;
    const connect = () => {
      if (stopped || document.hidden) return;
      setStreamStatus("connecting");
      source = new EventSource("/api/stream");
      source.addEventListener("ready", () => { failures = 0; setStreamStatus("open"); });
      source.addEventListener("heartbeat", () => { failures = 0; setStreamStatus("open"); });
      source.addEventListener("ingest", () => {
        failures = 0;
        setStreamStatus("open");
        void refresh();
      });
      source.onerror = () => {
        setStreamStatus("closed");
        source?.close();
        source = null;
        if (stopped || document.hidden) return;
        // Les refus 429/503 ne sont pas lisibles par EventSource : temporisation bornée.
        const delay = Math.min(60_000, 6000 * 2 ** Math.min(failures++, 4));
        retry = setTimeout(() => { retry = null; connect(); }, delay);
      };
    };
    const onVisibility = () => {
      if (document.hidden) {
        if (retry) clearTimeout(retry);
        retry = null;
        source?.close();
        source = null;
        setStreamStatus("closed");
      } else if (!source && !retry) connect();
    };
    document.addEventListener("visibilitychange", onVisibility);
    connect();
    return () => {
      stopped = true;
      document.removeEventListener("visibilitychange", onVisibility);
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
      if (s.selectedCamera) return s.selectCamera(null);
      if (s.selected) return void s.select(null);
      if (s.country) return s.setCountry(null);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [briefingOpen, settingsOpen]);

  return (
    <main className="stage" translate="no" data-mobile-pane={mobilePane} data-overlay-open={settingsOpen || briefingOpen ? "true" : undefined}>
      <GlobeScene />
      <FrameCorners />

      <div className="hud">
        <Header
          compact={mobile === true}
          settingsOpen={settingsOpen}
          onSettings={() => { if (mobile) { closePane(); setBriefingOpen(false); } setSettingsOpen((value) => !value); }}
          onBriefing={() => { if (mobile) { closePane(); setSettingsOpen(false); } setBriefingOpen(true); }}
        />
        {mobile === false && <ThemeBar />}
        <DetectionPanel visible={mobile !== null && !settingsOpen && !briefingOpen && !agentOpen && (mobile === false || mobilePane === "globe")} />

        {mobile === false && <div className="left-column">
          <WorldFeedPanel />
        </div>}

        {mobile === false && !agentOpen ? (
          <div className="right-column">
            <Inspector />
          </div>
        ) : null}

        {mobile && mobilePane !== "globe" && mobilePane !== "aura" && <MobileSheet
          key={mobilePane} title={mobilePane === "feed" ? tr(locale, "Flux", "Feed") : mobilePane === "search" ? tr(locale, "Recherche pays", "Country search") : mobilePane === "layers" ? tr(locale, "Calques", "Layers") : tr(locale, "Sélection", "Selection")}
          expanded={mobilePane !== "inspector" || expanded} onExpand={mobilePane === "inspector" ? () => setExpanded((value) => !value) : undefined} onClose={closePane}>
          {mobilePane === "feed" && <><ThemeBar /><WorldFeedPanel /></>}
          {mobilePane === "search" && <CountrySearch embedded onSelect={() => { setMobilePane("inspector"); setExpanded(false); }} />}
          {mobilePane === "layers" && <LayersMenu embedded />}
          {mobilePane === "inspector" && <Inspector />}
        </MobileSheet>}

        {settingsOpen ? (
          <div className="settings-anchor">
            <SettingsPanel onClose={() => setSettingsOpen(false)} />
          </div>
        ) : null}

        {briefingOpen ? <BriefingModal onClose={() => setBriefingOpen(false)} /> : null}

        {(mobile === false || (mobile && (mobilePane === "globe" || agentOpen || auraLoaded))) && <AgentPanel />}
        {mobile === false && <><HoverCountryBadge />
        <HoverReadout />
        <HoverFeedReadout />
        <HoverLayerReadout /></>}

        {/* Sélecteur de volet (écran étroit uniquement) */}
        <nav aria-label={tr(locale, "Navigation principale", "Main navigation")} className="mobile-nav">
          {(
            [
              ["globe", tr(locale, "Monde", "World"), Globe2],
              ["feed", tr(locale, "Flux", "Feed"), List],
              ["search", tr(locale, "Recherche", "Search"), Search],
              ["layers", tr(locale, "Calques", "Layers"), Layers],
              ["aura", "AURA", Sparkles],
            ] as const
          ).map(([key, text, Icon]) => (
            <button key={key} type="button" data-active={mobilePane === key} aria-label={text} aria-pressed={mobilePane === key} onClick={() => openPane(key)}>
              <Icon size={21} aria-hidden="true" /><span>{text}</span>
            </button>
          ))}
        </nav>
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
