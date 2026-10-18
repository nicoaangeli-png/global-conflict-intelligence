"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import type { Briefing, BriefingChapter, BriefingFact, BriefingSentence } from "@/server/briefing/types";
import { useIntelStore } from "@/store/useIntelStore";
import { speakable } from "@/components/agent/useAuraVoice";
import { tr } from "@/lib/i18n";

const CHAPTER_ICONS: Record<string, string> = {
  conflicts: "⚔️",
  politics: "🏛️",
  disasters: "🌋",
  economy: "📈",
  space: "🚀",
  nuclear: "☢️",
  society: "👥",
  health: "🩺",
};

const SEVERITY_COLORS: Record<string, { bg: string; text: string; border: string }> = {
  extreme: { bg: "rgba(255, 46, 99, 0.18)", text: "#ff2e63", border: "rgba(255, 46, 99, 0.4)" },
  severe: { bg: "rgba(255, 138, 112, 0.16)", text: "#ff8a70", border: "rgba(255, 138, 112, 0.4)" },
  moderate: { bg: "rgba(255, 184, 0, 0.16)", text: "#ffb800", border: "rgba(255, 184, 0, 0.4)" },
  minor: { bg: "rgba(0, 240, 255, 0.12)", text: "#00f0ff", border: "rgba(0, 240, 255, 0.3)" },
  info: { bg: "rgba(56, 189, 248, 0.12)", text: "#38bdf8", border: "rgba(56, 189, 248, 0.3)" },
};

export function BriefingModal({ onClose }: { onClose: () => void }) {
  const locale = useIntelStore((s) => s.locale);
  const focus = useIntelStore((s) => s.focus);

  const [briefing, setBriefing] = useState<Briefing | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [regenerating, setRegenerating] = useState(false);
  const [regenNotice, setRegenNotice] = useState<string | null>(null);

  const [activeChapterKey, setActiveChapterKey] = useState<string>("conflicts");
  const [activeSentenceIdx, setActiveSentenceIdx] = useState<number | null>(null);
  const [isPlaying, setIsPlaying] = useState(false);
  const [isPaused, setIsPaused] = useState(false);

  const modalRef = useRef<HTMLElement | null>(null);
  const closeBtnRef = useRef<HTMLButtonElement | null>(null);
  const speechRef = useRef<SpeechSynthesisUtterance | null>(null);

  // Fetch initial briefing
  const loadBriefing = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch("/api/briefing", { cache: "no-store" });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = (await res.json()) as Briefing;
      setBriefing(data);
      if (data.chapters?.[0]) {
        setActiveChapterKey(data.chapters[0].key);
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "Erreur de chargement");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void loadBriefing();
  }, [loadBriefing]);

  // Regeneration request (POST /api/briefing)
  const handleRegenerate = async () => {
    if (regenerating) return;
    setRegenerating(true);
    setRegenNotice(null);
    try {
      const res = await fetch("/api/briefing", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "X-Orbital-Client": "aura",
        },
        body: JSON.stringify({ force: true }),
      });
      if (res.status === 429) {
        const retryAfter = res.headers.get("Retry-After") ?? "10 min";
        setRegenNotice(
          locale === "fr"
            ? `Régénération limitée (prochaine dans ~${retryAfter}s).`
            : `Regeneration rate-limited (next in ~${retryAfter}s).`,
        );
        return;
      }
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = (await res.json()) as Briefing;
      setBriefing(data);
      setRegenNotice(locale === "fr" ? "Bilan actualisé avec succès." : "Briefing refreshed successfully.");
    } catch (err) {
      setRegenNotice(err instanceof Error ? err.message : "Échec de régénération");
    } finally {
      setRegenerating(false);
    }
  };

  // Keyboard accessibility
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.preventDefault();
        e.stopPropagation();
        onClose();
      }
    };
    window.addEventListener("keydown", onKey, true);
    return () => window.removeEventListener("keydown", onKey, true);
  }, [onClose]);

  // Trap focus
  const handleKeyDown = (e: React.KeyboardEvent<HTMLElement>) => {
    if (e.key !== "Tab" || !modalRef.current) return;
    const focusables = modalRef.current.querySelectorAll<HTMLElement>(
      'button:not([disabled]), [href], input:not([disabled]), [tabindex]:not([tabindex="-1"])',
    );
    if (!focusables.length) return;
    const first = focusables[0];
    const last = focusables[focusables.length - 1];
    if (e.shiftKey && document.activeElement === first) {
      e.preventDefault();
      last.focus();
    } else if (!e.shiftKey && document.activeElement === last) {
      e.preventDefault();
      first.focus();
    }
  };

  // Voice player cleanup on unmount
  const stopVoice = useCallback(() => {
    if (typeof window !== "undefined" && "speechSynthesis" in window) {
      window.speechSynthesis.cancel();
    }
    setIsPlaying(false);
    setIsPaused(false);
    setActiveSentenceIdx(null);
  }, []);

  useEffect(() => {
    return () => {
      stopVoice();
    };
  }, [stopVoice]);

  // Play a specific chapter and sentence index
  const playFrom = useCallback(
    (chapterIdx: number, sentenceIdx: number) => {
      if (!briefing || typeof window === "undefined" || !("speechSynthesis" in window)) return;
      window.speechSynthesis.cancel();

      const chapters = briefing.chapters;
      if (chapterIdx >= chapters.length) {
        stopVoice();
        return;
      }

      const chapter = chapters[chapterIdx];
      setActiveChapterKey(chapter.key);

      // Rotate 3D globe to chapter focus if present
      if (chapter.focus) {
        focus(chapter.focus.lat, chapter.focus.lon);
      }

      const sentences = chapter.sentences;
      if (sentenceIdx >= sentences.length) {
        // Next chapter
        playFrom(chapterIdx + 1, 0);
        return;
      }

      const currentSentence = sentences[sentenceIdx];
      setActiveSentenceIdx(sentenceIdx);
      setIsPlaying(true);
      setIsPaused(false);

      const textToSpeak = speakable(currentSentence.text);
      if (!textToSpeak) {
        playFrom(chapterIdx, sentenceIdx + 1);
        return;
      }

      const utterance = new SpeechSynthesisUtterance(textToSpeak);
      const voices = window.speechSynthesis.getVoices();
      const targetLang = locale === "fr" ? "fr" : "en";
      const jarvisVoice = voices.find(
        (v) =>
          (v.lang.toLowerCase().startsWith(targetLang) || v.lang.toLowerCase().startsWith("en-gb")) &&
          /daniel|ryan|george|arthur|oliver|henri|thomas|r[eé]my|nicolas/i.test(v.name) &&
          !/sandy|grandpa|zarvox/i.test(v.name)
      );
      if (jarvisVoice) utterance.voice = jarvisVoice;
      utterance.lang = jarvisVoice?.lang ?? (locale === "fr" ? "fr-FR" : "en-US");
      utterance.rate = 0.96;
      utterance.pitch = 0.94;

      utterance.onend = () => {
        playFrom(chapterIdx, sentenceIdx + 1);
      };

      utterance.onerror = () => {
        stopVoice();
      };

      speechRef.current = utterance;
      window.speechSynthesis.speak(utterance);
    },
    [briefing, focus, locale, stopVoice],
  );

  const togglePlayPause = () => {
    if (!briefing) return;
    if (isPlaying) {
      if (isPaused) {
        window.speechSynthesis.resume();
        setIsPaused(false);
      } else {
        window.speechSynthesis.pause();
        setIsPaused(true);
      }
    } else {
      const curChapterIdx = briefing.chapters.findIndex((c) => c.key === activeChapterKey);
      playFrom(Math.max(0, curChapterIdx), activeSentenceIdx ?? 0);
    }
  };

  const activeChapter = briefing?.chapters.find((c) => c.key === activeChapterKey) ?? briefing?.chapters[0];

  return (
    <section
      ref={modalRef}
      id="briefing-dialog"
      role="dialog"
      aria-modal="true"
      aria-labelledby="briefing-dialog-title"
      onKeyDown={handleKeyDown}
      className="panel corners boot fixed left-1/2 top-1/2 z-50 flex max-h-[calc(100vh-64px)] w-[min(780px,calc(100vw-32px))] -translate-x-1/2 -translate-y-1/2 flex-col overflow-hidden bg-[#06090e]/95 shadow-[0_0_50px_rgba(0,240,255,0.18)] backdrop-blur-xl"
    >
      <span className="corner" />

      {/* Header bar */}
      <div className="flex items-center justify-between border-b border-[rgba(0,240,255,0.2)] px-4 py-3">
        <div className="flex items-center gap-3">
          <span className="text-lg">🎙️</span>
          <div>
            <h2 id="briefing-dialog-title" className="text-[13px] font-bold tracking-wider text-[#00f0ff] uppercase">
              {locale === "fr" ? "Bilan Stratégique du Jour" : "Daily Strategic Intelligence Briefing"}
            </h2>
            <div className="text-[10px] text-[#7f9fb5]">
              {briefing ? `${briefing.date} UTC · 8 chapitres vérifiés` : tr(locale, "Chargement...", "Loading...")}
            </div>
          </div>
        </div>

        <div className="flex items-center gap-2">
          {briefing && (
            <button
              type="button"
              className="chip text-[11px]"
              disabled={regenerating}
              onClick={() => void handleRegenerate()}
              title={tr(locale, "Forcer une régénération", "Force regenerate")}
            >
              {regenerating ? "⟳ ..." : "⟳ Actualiser"}
            </button>
          )}
          <button
            ref={closeBtnRef}
            type="button"
            className="chip px-2 text-[13px]"
            onClick={onClose}
            aria-label={tr(locale, "Fermer", "Close")}
          >
            ✕
          </button>
        </div>
      </div>

      {regenNotice && (
        <div className="border-b border-[#00f0ff]/20 bg-[#00f0ff]/10 px-4 py-1.5 text-[11px] text-[#00f0ff]">
          {regenNotice}
        </div>
      )}

      {/* Body */}
      {loading ? (
        <div className="flex flex-1 flex-col items-center justify-center py-20 text-[#00f0ff]">
          <div className="status-dot animate-pulse text-xl" />
          <p className="mt-3 text-[12px] tracking-widest uppercase">
            {locale === "fr" ? "Compilation du bilan mondial..." : "Compiling global intelligence briefing..."}
          </p>
        </div>
      ) : error ? (
        <div className="flex flex-1 flex-col items-center justify-center p-8 text-center">
          <p className="text-[13px] text-[#ff8a70]">
            {locale === "fr" ? "Impossible de charger le bilan." : "Unable to load briefing."} ({error})
          </p>
          <button type="button" className="chip mt-3" onClick={() => void loadBriefing()}>
            {tr(locale, "Réessayer", "Retry")}
          </button>
        </div>
      ) : briefing ? (
        <div className="flex flex-1 min-h-0 flex-col">
          {/* Audio Player Bar */}
          <div className="flex flex-wrap items-center justify-between gap-3 border-b border-white/10 bg-[#0a101a]/80 px-4 py-2.5">
            <div className="flex items-center gap-2">
              <button
                type="button"
                className="chip flex items-center gap-1.5 border-[#00f0ff]/40 bg-[#00f0ff]/15 px-3 py-1 font-semibold text-[#00f0ff]"
                onClick={togglePlayPause}
              >
                <span>{isPlaying ? (isPaused ? "▶️" : "⏸️") : "▶️"}</span>
                <span>
                  {isPlaying
                    ? isPaused
                      ? tr(locale, "Reprendre", "Resume")
                      : tr(locale, "Pause", "Pause")
                    : tr(locale, "Écouter la synthèse vocale", "Listen to Voice Briefing")}
                </span>
              </button>
              {isPlaying && (
                <button
                  type="button"
                  className="chip text-[11px] text-[#ff8a70]"
                  onClick={stopVoice}
                  title={tr(locale, "Arrêter", "Stop")}
                >
                  ⏹️
                </button>
              )}
            </div>

            <div className="flex items-center gap-2 text-[11px] text-[#7f9fb5]">
              <span className="font-mono">
                {activeChapter ? `${CHAPTER_ICONS[activeChapter.key] ?? ""} ${activeChapter.title}` : ""}
              </span>
              {activeChapter && (
                <span className="rounded bg-white/5 px-2 py-0.5 text-[10px] text-[#00f0ff]">
                  {activeChapter.windowHours} h
                </span>
              )}
            </div>
          </div>

          {/* Chapters Tabs */}
          <div className="flex overflow-x-auto border-b border-white/10 bg-black/40 px-2 py-1.5 no-scrollbar">
            {briefing.chapters.map((chap) => {
              const active = chap.key === activeChapterKey;
              const hasFacts = chap.facts.length > 0;
              return (
                <button
                  key={chap.key}
                  type="button"
                  onClick={() => {
                    setActiveChapterKey(chap.key);
                    setActiveSentenceIdx(null);
                    if (chap.focus) focus(chap.focus.lat, chap.focus.lon);
                  }}
                  className={`flex shrink-0 items-center gap-1.5 rounded px-2.5 py-1 text-[11px] font-mono transition-all ${
                    active
                      ? "border border-[#00f0ff]/40 bg-[#00f0ff]/20 font-bold text-[#00f0ff]"
                      : "text-[#94a3b8] hover:bg-white/5 hover:text-white"
                  }`}
                >
                  <span>{CHAPTER_ICONS[chap.key] ?? "•"}</span>
                  <span>{chap.title}</span>
                  {hasFacts && <span className="h-1.5 w-1.5 rounded-full bg-[#00f0ff]" />}
                </button>
              );
            })}
          </div>

          {/* Active Chapter Details */}
          {activeChapter && (
            <div className="flex-1 overflow-y-auto p-4 space-y-4">
              {/* Spoken Text Block with clickable sentences */}
              <div className="rounded-lg border border-white/10 bg-[#0a121d]/90 p-3.5">
                <div className="mb-2 flex items-center justify-between border-b border-white/10 pb-1.5 text-[11px] text-[#7f9fb5]">
                  <span className="font-mono uppercase tracking-wider text-[#00f0ff]">
                    {locale === "fr" ? "Synthèse d'état-major" : "Executive Intelligence"}
                  </span>
                  <span className="text-[10px]">
                    {activeChapter.writer === "ai"
                      ? "🤖 Rédaction modèle"
                      : activeChapter.writer === "template"
                        ? "📝 Gabarit factuel"
                        : "ℹ️ Aucun fait sur la période"}
                  </span>
                </div>

                <div className="space-y-1.5 leading-relaxed text-[13px] text-[#e2e8f0]">
                  {activeChapter.sentences.map((sentence, sIdx) => {
                    const isSentenceActive = isPlaying && activeSentenceIdx === sIdx;
                    return (
                      <span
                        key={sIdx}
                        onClick={() => {
                          const chapIdx = briefing.chapters.findIndex((c) => c.key === activeChapter.key);
                          playFrom(chapIdx, sIdx);
                        }}
                        className={`cursor-pointer rounded px-1 transition-colors ${
                          isSentenceActive
                            ? "bg-[#00f0ff]/25 font-medium text-[#00f0ff] underline decoration-[#00f0ff]"
                            : "hover:bg-white/5"
                        }`}
                        title={tr(locale, "Cliquer pour écouter à partir d'ici", "Click to listen from here")}
                      >
                        {sentence.text}{" "}
                      </span>
                    );
                  })}
                </div>
              </div>

              {/* Verified Facts List */}
              {activeChapter.facts.length > 0 && (
                <div className="space-y-2">
                  <div className="text-[11px] font-mono uppercase tracking-wider text-[#7f9fb5]">
                    {locale === "fr" ? "Faits & Sources recoupées" : "Corroborated Facts & Sources"} (
                    {activeChapter.facts.length})
                  </div>

                  {activeChapter.facts.map((fact: BriefingFact) => {
                    const severity = fact.severity ? SEVERITY_COLORS[fact.severity] : SEVERITY_COLORS.info;
                    return (
                      <div
                        key={fact.id}
                        className="rounded border border-white/10 bg-[#080d14]/70 p-3 transition-colors hover:border-[#00f0ff]/30"
                      >
                        <div className="flex flex-wrap items-center justify-between gap-2">
                          <div className="flex items-center gap-2">
                            {fact.severity && (
                              <span
                                className="rounded px-1.5 py-0.5 text-[9px] font-mono font-bold uppercase"
                                style={{
                                  backgroundColor: severity.bg,
                                  color: severity.text,
                                  border: `1px solid ${severity.border}`,
                                }}
                              >
                                {fact.severity}
                              </span>
                            )}
                            <h4 className="text-[12px] font-semibold text-white">{fact.title}</h4>
                          </div>

                          {fact.metric && (
                            <span className="rounded bg-white/5 px-2 py-0.5 font-mono text-[11px] text-[#38bdf8]">
                              {fact.metric.label}: {fact.metric.value} {fact.metric.unit ?? ""}
                            </span>
                          )}
                        </div>

                        {fact.summary && <p className="mt-1.5 text-[11px] text-[#94a3b8]">{fact.summary}</p>}

                        {/* Fatalities if verified official */}
                        {fact.casualtiesAllowed && fact.fatalities !== null && (
                          <div className="mt-1 text-[11px] font-mono text-[#ff8a70]">
                            Bilan vérifié (source officielle) : {fact.fatalities} victime(s)
                          </div>
                        )}

                        {/* Sources */}
                        <div className="mt-2.5 flex flex-wrap items-center gap-2 border-t border-white/5 pt-2">
                          <span className="text-[10px] text-[#7f9fb5]">
                            {fact.independentSources > 1
                              ? `Recoupé par ${fact.independentSources} médias indépendants :`
                              : "Source :"}
                          </span>
                          {fact.sources.map((s, idx) => (
                            <span key={idx} className="flex items-center gap-1">
                              {s.url ? (
                                <a
                                  href={s.url}
                                  target="_blank"
                                  rel="noopener noreferrer"
                                  className="chip text-[10px] text-[#38bdf8] hover:text-[#00f0ff]"
                                >
                                  {s.official ? "🏛️ " : "📰 "}
                                  {s.name} ↗
                                </a>
                              ) : (
                                <span className="chip text-[10px] text-[#94a3b8]">
                                  {s.official ? "🏛️ " : "📰 "}
                                  {s.name}
                                </span>
                              )}
                            </span>
                          ))}
                        </div>
                      </div>
                    );
                  })}
                </div>
              )}
            </div>
          )}
        </div>
      ) : null}
    </section>
  );
}
