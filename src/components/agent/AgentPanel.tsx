"use client";

import { useCallback, useEffect, useRef, useState, type FormEvent, type KeyboardEvent } from "react";
import { useIntelStore } from "@/store/useIntelStore";
import { canonicalCountryIdentity } from "@/lib/geo/country";
import { AuraCore, type AuraState } from "./AuraCore";
import { speakable, useAuraVoice, type VoiceEngine } from "./useAuraVoice";
import { readNdjson } from "@/lib/ndjson";
import { AnswerText, buildHistory, citationNumbering, cleanUrl, DEFAULT_LIMITS, ProvenanceList, safeHref, host, type Citation, type Limits, type Provenance, type Source, type StreamChunk, type Turn } from "./auraTranscript";

export { AnswerText, buildHistory } from "./auraTranscript";

/**
 * AURA — analyste géopolitique vocale.
 *
 * Panneau latéral : artefact lumineux, conversation, sources, micro et voix.
 * Le contexte de l'écran (pays ouvert, foyer sélectionné, fenêtre
 * temporelle) accompagne chaque question. Une réponse n'est « complète » que si
 * le serveur envoie `done` ; sinon elle est marquée incomplète ou interrompue.
 */

type Recognition = {
  lang: string;
  interimResults: boolean;
  continuous: boolean;
  start: () => void;
  stop: () => void;
  onresult: ((event: { results: ArrayLike<ArrayLike<{ transcript: string }> & { isFinal: boolean }> }) => void) | null;
  onend: (() => void) | null;
  onerror: (() => void) | null;
};

export function AgentPanel() {
  const locale = useIntelStore((state) => state.locale);
  const country = useIntelStore((state) => state.country);
  const selected = useIntelStore((state) => state.selected);
  const range = useIntelStore((state) => state.filters.range);

  const open = useIntelStore((state) => state.agentOpen);
  const setOpen = useIntelStore((state) => state.setAgentOpen);
  const auraPrompt = useIntelStore((state) => state.auraPrompt);
  const consumeAuraPrompt = useIntelStore((state) => state.consumeAuraPrompt);
  const [configured, setConfigured] = useState<boolean | null>(null);
  const [turns, setTurns] = useState<Turn[]>([]);
  const [draft, setDraft] = useState("");
  const [busy, setBusy] = useState(false);
  const [status, setStatus] = useState<string | null>(null);
  const [listening, setListening] = useState(false);
  const [showVoices, setShowVoices] = useState(false);
  const [limits, setLimits] = useState<Limits>(DEFAULT_LIMITS);

  // Question pré-remplie par la fiche pays : placée dans le champ, jamais envoyée sans action (coût, contrôle).
  useEffect(() => {
    if (open && auraPrompt) {
      setDraft(auraPrompt);
      consumeAuraPrompt();
    }
  }, [open, auraPrompt, consumeAuraPrompt]);
  const abortRef = useRef<AbortController | null>(null);
  const recognitionRef = useRef<Recognition | null>(null);
  const scrollRef = useRef<HTMLDivElement>(null);
  const panelRef = useRef<HTMLElement>(null);
  const composerRef = useRef<HTMLTextAreaElement>(null);
  const launcherRef = useRef<HTMLButtonElement>(null);
  const [mobile, setMobile] = useState(false);
  const turnCounter = useRef(0);
  const voice = useAuraVoice(locale);
  const fr = locale === "fr";

  const closePanel = useCallback(() => {
    voice.stop();
    if (recognitionRef.current) {
      recognitionRef.current.onend = null;
      recognitionRef.current.stop();
      recognitionRef.current = null;
      setListening(false);
    }
    setOpen(false);
  }, [setOpen, voice]);

  useEffect(() => {
    const media = window.matchMedia("(max-width: 1023px)");
    const update = () => setMobile(media.matches);
    update();
    media.addEventListener("change", update);
    return () => media.removeEventListener("change", update);
  }, []);

  useEffect(() => {
    if (!open || !mobile) return;
    const previousFocus = document.activeElement;
    const containFocus = (event: FocusEvent) => {
      if (event.target instanceof Node && !panelRef.current?.contains(event.target)) composerRef.current?.focus({ preventScroll: true });
    };
    document.addEventListener("focusin", containFocus);
    composerRef.current?.focus({ preventScroll: true });
    return () => {
      document.removeEventListener("focusin", containFocus);
      if (previousFocus instanceof HTMLElement && previousFocus.isConnected) previousFocus.focus({ preventScroll: true });
      else launcherRef.current?.focus({ preventScroll: true });
    };
  }, [open, mobile]);

  const onPanelKey = (event: KeyboardEvent<HTMLElement>) => {
    if (event.key === "Escape" && !event.nativeEvent.isComposing) {
      event.preventDefault();
      event.stopPropagation();
      closePanel();
    }
    if (!mobile || event.key !== "Tab") return;
    const controls = Array.from(panelRef.current?.querySelectorAll<HTMLElement>("button:not(:disabled), a[href], textarea, select, summary, [tabindex='0']") ?? [])
      .filter((element) => element.getClientRects().length > 0);
    const first = controls[0];
    const last = controls.at(-1);
    if (event.shiftKey && document.activeElement === first) {
      event.preventDefault();
      last?.focus();
    } else if (!event.shiftKey && document.activeElement === last) {
      event.preventDefault();
      first?.focus();
    }
  };

  useEffect(() => {
    fetch("/api/agent")
      .then((response) => response.json())
      .then((data: { configured?: boolean; limits?: Partial<Limits> }) => {
        setConfigured(Boolean(data.configured));
        if (data.limits) setLimits({ ...DEFAULT_LIMITS, ...data.limits });
      })
      .catch(() => setConfigured(false));
  }, []);

  useEffect(() => {
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight, behavior: "auto" });
  }, [turns, status]);

  useEffect(() => () => { abortRef.current?.abort(); recognitionRef.current?.stop(); }, []);

  const ask = useCallback(async (question: string) => {
    const trimmed = question.trim().slice(0, limits.maxUserChars);
    if (!trimmed || busy) return;
    voice.stop();
    voice.primeAudio();
    abortRef.current?.abort();
    const controller = new AbortController();
    abortRef.current = controller;

    const history = buildHistory(turns, trimmed, limits);
    const assistantId = ++turnCounter.current;
    setTurns((previous) => [
      ...previous,
      { id: ++turnCounter.current, role: "user", content: trimmed },
      { id: assistantId, role: "assistant", content: "", status: "streaming" },
    ]);
    setDraft("");
    setBusy(true);
    setStatus(fr ? "Analyse en cours…" : "Analysing…");

    let answer = "";
    let spokenUpTo = 0;
    let terminal: "done" | "incomplete" | "error" | null = null;
    let notice: string | undefined;
    const citations: Citation[] = [];
    const flushSpeech = (final: boolean) => {
      const pending = answer.slice(spokenUpTo);
      const boundary = final ? pending.length : (() => {
        const sentenceEnd = /[.!?…](?=\s|$)/g;
        let last = -1;
        let found: RegExpExecArray | null;
        while ((found = sentenceEnd.exec(pending))) last = found.index + 1;
        return last;
      })();
      if (boundary > 0) {
        const chunk = pending.slice(0, boundary);
        spokenUpTo += boundary;
        if (speakable(chunk).length > 1) voice.speak(chunk);
      }
    };
    const update = (patch: Partial<Turn>) =>
      setTurns((previous) => previous.map((turn) => (turn.id === assistantId ? { ...turn, ...patch } : turn)));

    const identity = country ? canonicalCountryIdentity(country.name, { isoA3: country.iso }) : null;
    const countryContext = country
      ? { name: country.name, iso: country.iso, iso3: identity && /^[A-Z]{3}$/.test(identity.iso3) ? identity.iso3 : null }
      : null;

    try {
      const response = await fetch("/api/agent", {
        method: "POST",
        headers: { "Content-Type": "application/json", "X-Orbital-Client": "aura" },
        signal: controller.signal,
        body: JSON.stringify({
          messages: history,
          context: {
            locale,
            range,
            country: countryContext,
            cluster: selected ? { locality: selected.locality, country: selected.country, eventCount: selected.eventCount } : null,
          },
        }),
      });
      if (!response.ok || !response.body) {
        const data = (await response.json().catch(() => ({}))) as { error?: string };
        throw new Error(data.error ?? (fr ? "Service indisponible." : "Service unavailable."));
      }
      const handleChunk = (value: unknown) => {
        if (!value || typeof value !== "object") return;
        const chunk = value as StreamChunk;
        if (chunk.t === "delta" && chunk.text) {
          answer += chunk.text;
          setStatus(null);
          update({ content: answer });
          flushSpeech(false);
        } else if (chunk.t === "status" && chunk.text) {
          setStatus(chunk.text);
        } else if (chunk.t === "citations" && chunk.spans) {
          citations.push(...chunk.spans.map((span) => ({ ...span, url: cleanUrl(span.url) })));
          update({ citations: [...citations] });
        } else if (chunk.t === "sources" && chunk.items) {
          update({ sources: (chunk.items as Source[]).map((source) => ({ ...source, url: cleanUrl(source.url) })) });
        } else if (chunk.t === "provenance" && chunk.items) {
          update({ provenance: chunk.items as Provenance[] });
        } else if (chunk.t === "done") {
          terminal = "done";
        } else if (chunk.t === "incomplete") {
          terminal = "incomplete";
          notice = chunk.text;
        } else if (chunk.t === "error") {
          terminal = "error";
          notice = chunk.text;
        }
      };
      for await (const value of readNdjson(response.body)) handleChunk(value);

      if (terminal === "done" && answer) {
        flushSpeech(true);
        update({ status: "complete" });
      } else if (terminal === "incomplete") {
        update({ status: "incomplete", notice });
      } else if (terminal === "error") {
        update(answer ? { status: "interrupted", notice } : { status: "error", content: notice ?? (fr ? "Erreur." : "Error."), notice: undefined });
      } else {
        const interrupted = fr
          ? "Flux interrompu avant la fin : réponse incomplète, à ne pas considérer comme terminée."
          : "Stream interrupted before the end: incomplete answer, do not treat it as finished.";
        update(answer ? { status: "interrupted", notice: interrupted } : { status: "error", content: fr ? "Aucune réponse obtenue." : "No answer received." });
      }
    } catch (error) {
      if (controller.signal.aborted) {
        update({ status: answer ? "interrupted" : "error", notice: fr ? "Arrêté avant la fin : réponse incomplète." : "Stopped before the end: incomplete answer.", ...(answer ? {} : { content: fr ? "Analyse arrêtée." : "Analysis stopped." }) });
        return;
      }
      const message = error instanceof Error ? error.message : fr ? "Erreur." : "Error.";
      update(answer ? { status: "interrupted", notice: message } : { status: "error", content: message });
    } finally {
      if (abortRef.current === controller) {
        setBusy(false);
        setStatus(null);
      }
    }
  }, [busy, country, fr, limits, locale, range, selected, turns, voice]);

  const toggleMic = useCallback(() => {
    if (listening) { recognitionRef.current?.stop(); return; }
    const RecognitionCtor = (window as unknown as { SpeechRecognition?: new () => Recognition; webkitSpeechRecognition?: new () => Recognition }).SpeechRecognition
      ?? (window as unknown as { webkitSpeechRecognition?: new () => Recognition }).webkitSpeechRecognition;
    if (!RecognitionCtor) { setStatus(fr ? "Micro non pris en charge par ce navigateur (utilise Chrome)." : "Microphone not supported (use Chrome)."); return; }
    voice.stop();
    voice.primeAudio();
    const rec = new RecognitionCtor();
    rec.lang = fr ? "fr-FR" : "en-US";
    rec.interimResults = true;
    rec.continuous = false;
    let finalText = "";
    rec.onresult = (event) => {
      let interim = "";
      for (let index = 0; index < event.results.length; index++) {
        const result = event.results[index];
        if (result.isFinal) finalText += result[0].transcript;
        else interim += result[0].transcript;
      }
      setDraft((finalText + interim).trim());
    };
    rec.onend = () => {
      setListening(false);
      recognitionRef.current = null;
      if (finalText.trim()) void ask(finalText);
    };
    rec.onerror = () => setListening(false);
    recognitionRef.current = rec;
    setListening(true);
    rec.start();
  }, [ask, fr, listening, voice]);

  const holoState: AuraState = voice.speaking ? "speaking" : busy || listening ? "thinking" : "idle";

  const suggestions = [
    country ? (fr ? `Analyse la situation actuelle de ${country.name}` : `Analyse the current situation in ${country.name}`) : null,
    selected ? (fr ? `Que se passe-t-il à ${selected.locality || selected.country} ?` : `What is happening in ${selected.locality || selected.country}?`) : null,
    fr ? "Point de situation sur le front en Ukraine aujourd'hui" : "Ukraine front-line update today",
    fr ? "Qui dirige l'Iran et où en sont les tensions avec Israël ?" : "Who leads Iran and where do tensions with Israel stand?",
    fr ? "Résume la guerre au Soudan cette semaine" : "Summarise the war in Sudan this week",
    fr ? "Que montre la carte en ce moment ?" : "What does the map show right now?",
  ].filter((suggestion): suggestion is string => Boolean(suggestion)).slice(0, 4);

  /** Phrase d'exemple pour comparer les timbres neuraux (coût négligeable, ~110 caractères). */
  const voiceSample = fr
    ? "AURA en ligne. Voici la situation stratégique : les affrontements se concentrent autour de la ville, et un cessez-le-feu local est signalé ce matin."
    : "AURA online. Here is the strategic picture: fighting is concentrated around the city, and a local ceasefire was reported this morning.";

  const onSubmit = (event: FormEvent) => { event.preventDefault(); void ask(draft); };  const onKey = (event: KeyboardEvent<HTMLTextAreaElement>) => {
    if (event.key === "Enter" && !event.shiftKey && !event.nativeEvent.isComposing && event.nativeEvent.keyCode !== 229) { event.preventDefault(); void ask(draft); }
    if (event.key !== "Tab" && event.key !== "Escape") event.stopPropagation();
  };

  if (!open) {
    return (
      <div className="aura-launcher">
      <button
        ref={launcherRef}
        type="button"
        onClick={() => setOpen(true)}
        className="panel pointer-events-auto flex items-center gap-2 py-1 pl-1 pr-3 transition hover:border-cyan/40"
        aria-label={fr ? "Ouvrir AURA, analyste IA" : "Open AURA, AI analyst"}
      >
        <AuraCore state={holoState} levelRef={voice.levelRef} width={64} height={64} />
        <span className="flex flex-col items-start">
          <span className="label-strong">AURA</span>
          <span className="text-[11px] text-text-faint">{fr ? "Analyste IA · voix" : "AI analyst · voice"}</span>
        </span>
      </button>
      </div>
    );
  }

  return (
    <div className="aura-column">
    <section ref={panelRef} className="aura-panel panel corners boot pointer-events-auto flex min-h-0 w-full flex-col overflow-hidden bg-[#020b14]/90" role={mobile ? "dialog" : undefined} aria-modal={mobile || undefined} aria-label="AURA" onKeyDown={onPanelKey}>
      <span className="corner" />
      <header className="aura-header relative shrink-0 border-b border-cyan/15">
        <AuraCore state={holoState} levelRef={voice.levelRef} width={330} height={190} className="mx-auto" />
        <div className="absolute left-3 top-2 max-w-[calc(100%-140px)]">
          <div className="label-strong">AURA</div>
          <div className="text-[11px] text-text-faint">{fr ? "Analyste géopolitique · sources ouvertes" : "Geopolitical analyst · open sources"}</div>
          <div className="readout mt-[2px] text-[11px] text-cyan">
            {holoState === "speaking" ? (fr ? "● transmission vocale" : "● speaking") : holoState === "thinking" ? (status ?? (listening ? (fr ? "● écoute…" : "● listening…") : "…")) : (fr ? "● en veille" : "● standby")}
          </div>
        </div>
        <div className="absolute right-2 top-2 flex gap-1">
          <button type="button" className="chip min-h-[44px] min-w-[44px]" data-active={voice.enabled} aria-pressed={voice.enabled} aria-label={fr ? "Activer la voix AURA" : "Enable AURA voice"} onClick={voice.toggle} title={fr ? "Voix" : "Voice"}>
            {voice.enabled ? "🔊" : "🔇"}
          </button>
          <button type="button" className="chip min-h-[44px] min-w-[44px]" onClick={() => setShowVoices((visible) => !visible)} aria-expanded={showVoices} aria-controls="aura-voice-settings" aria-label={fr ? "Choisir la voix" : "Choose voice"} title={fr ? "Choisir la voix" : "Choose voice"}>
            ♀
          </button>
          <button type="button" className="chip min-h-[44px] min-w-[44px]" aria-label={fr ? "Fermer AURA" : "Close AURA"} onClick={closePanel}>
            ✕
          </button>
        </div>
        <div className="absolute bottom-2 right-2">
          {voice.speaking ? (
            <button type="button" className="chip min-h-[44px] min-w-[44px]" aria-label={fr ? "Arrêter la lecture vocale" : "Stop speech playback"} onClick={voice.stop}>{fr ? "silence" : "mute"}</button>
          ) : null}
        </div>
      </header>

      {showVoices ? (
        <div id="aura-voice-settings" className="scroll-thin max-h-[40dvh] shrink-0 space-y-2 overflow-y-auto border-b border-cyan/15 px-3 py-2">
          <div>
            <label className="label block" htmlFor="aura-engine">{fr ? "Moteur vocal" : "Voice engine"}</label>
            <select
              id="aura-engine"
              className="mt-1 w-full border border-cyan/20 bg-[#020b14] px-2 py-1 text-[11px] text-text"
              value={voice.engine}
              onChange={(event) => voice.setEngine(event.target.value as VoiceEngine)}
            >
              <option value="neural" disabled={voice.neuralConfigured === false}>
                {fr ? "Neural — voix naturelle (OpenAI)" : "Neural — natural voice (OpenAI)"}
              </option>
              <option value="browser">{fr ? "Navigateur — voix du système" : "Browser — system voice"}</option>
            </select>
          </div>

          {voice.engine === "neural" ? (
            <div>
              <div className="flex items-baseline justify-between">
                <span className="label">{fr ? "Timbre" : "Voice"}</span>
                <span className="text-[10px] text-text-faint">{fr ? "cliquer pour écouter et choisir" : "click to listen and pick"}</span>
              </div>
              {voice.remoteVoices.length ? (
                <div className="scroll-thin mt-1 max-h-[186px] overflow-y-auto border border-cyan/20 bg-[#020b14]">
                  {voice.remoteVoices.map((option) => {
                    const active = voice.neuralVoice === option.id;
                    return (
                      <button
                        key={option.id}
                        type="button"
                        onClick={() => {
                          voice.primeAudio();
                          voice.chooseNeuralVoice(option.id);
                          voice.speak(voiceSample);
                        }}
                        className={`flex w-full items-center gap-2 px-2 py-1 text-left text-[11px] transition hover:bg-cyan/10 ${active ? "bg-cyan/10 text-cyan" : "text-text"}`}
                        aria-pressed={active}
                        title={fr ? "Écouter un exemple et choisir ce timbre" : "Play a sample and pick this voice"}
                      >
                        <span className="w-3 shrink-0 text-text-faint">{active ? "◆" : "▸"}</span>
                        <span className="w-[72px] shrink-0 font-medium">{option.label}</span>
                        <span className="truncate text-text-faint">{option.note}</span>
                      </button>
                    );
                  })}
                </div>
              ) : (
                <p className="mt-1 text-[11px] text-text-faint">
                  {voice.neuralConfigured === false
                    ? fr
                      ? "Synthèse neurale indisponible : ajoute OPENAI_API_KEY dans .env.local puis redémarre le serveur."
                      : "Neural synthesis unavailable: add OPENAI_API_KEY to .env.local and restart the server."
                    : fr
                      ? "Chargement des voix…"
                      : "Loading voices…"}
                </p>
              )}
              <div className="mt-1 flex items-center gap-2">
                <button
                  type="button"
                  className="chip"
                  onClick={() => {
                    voice.primeAudio();
                    voice.speak(voiceSample);
                  }}
                >
                  {fr ? "▶ Écouter un exemple" : "▶ Play sample"}
                </button>
                {voice.speaking ? <button type="button" className="chip" onClick={voice.stop}>{fr ? "silence" : "mute"}</button> : null}
              </div>
              <p className="mt-1 text-[11px] text-text-faint">
                {fr
                  ? "Voix de qualité studio servie par le serveur, avec le ton d'un analyste posé. Repli automatique sur la voix du navigateur si la synthèse est indisponible."
                  : "Studio-grade voice served by the server with a composed analyst tone. Falls back to the browser voice when synthesis is unavailable."}
              </p>
            </div>
          ) : (
            <div>
              <label className="label block" htmlFor="aura-voice">{fr ? "Voix système" : "System voice"}</label>
              {voice.candidates.length ? (
                <select
                  id="aura-voice"
                  className="mt-1 w-full border border-cyan/20 bg-[#020b14] px-2 py-1 text-[11px] text-text"
                  value={voice.browserVoice?.name ?? ""}
                  onChange={(event) => voice.chooseVoice(event.target.value)}
                >
                  {voice.candidates.map((candidate) => (
                    <option key={candidate.name} value={candidate.name}>
                      {candidate.name === voice.candidates[0]?.name ? "★ " : ""}{candidate.name} · {candidate.lang}
                    </option>
                  ))}
                </select>
              ) : (
                <p className="mt-1 text-[11px] text-text-faint">{fr ? "Aucune voix française installée sur ce système." : "No matching voice installed."}</p>
              )}
              <p className="mt-1 text-[11px] text-text-faint">
                {fr ? "Astuce : préférer une voix Google (Chrome) ou une voix « Premium » macOS (Audrey, Amélie) — Réglages › Accessibilité › Contenu énoncé › Voix du système › Gérer les voix." : "Tip: prefer a Google voice (Chrome) or a macOS Premium voice (Audrey, Amélie) — Settings › Accessibility › Spoken Content › System Voice › Manage Voices."}
              </p>
            </div>
          )}

          {voice.notice ? (
            <p className="flex items-start gap-2 text-[11px] text-alert-soft">
              <span>⚠ {voice.notice}</span>
              <button type="button" className="text-text-faint hover:text-cyan" onClick={voice.clearNotice} aria-label={fr ? "Masquer" : "Dismiss"}>×</button>
            </p>
          ) : null}
        </div>
      ) : null}

      <div ref={scrollRef} className="aura-history scroll-thin min-h-0 flex-1 space-y-3 overflow-y-auto overscroll-contain px-3 py-3" role="log" aria-label={fr ? "Conversation avec AURA" : "Conversation with AURA"} aria-live="polite" aria-relevant="additions text" aria-busy={busy}>
        {configured === false ? (
          <p className="text-[11px] text-alert-soft">{fr ? "Agente non configurée : ajoute OPENAI_API_KEY dans .env.local puis redémarre le serveur." : "Agent not configured: add OPENAI_API_KEY to .env.local and restart."}</p>
        ) : null}
        {turns.length === 0 ? (
          <div className="space-y-2">
            <p className="text-[11px] leading-relaxed text-text-dim">
              {fr
                ? "Pose une question géopolitique : dirigeants, fronts, cessez-le-feu, acteurs, contexte d'un foyer. AURA vérifie en direct sur le web, Wikidata, la Banque mondiale et la base ORBITAL, et cite ses sources."
                : "Ask a geopolitical question. AURA checks the live web, Wikidata, the World Bank and the ORBITAL database, and cites sources."}
            </p>
            {suggestions.map((suggestion) => (
              <button key={suggestion} type="button" className="row-button block w-full text-left text-[11px] text-text" onClick={() => void ask(suggestion)}>
                › {suggestion}
              </button>
            ))}
          </div>
        ) : null}
        {turns.map((turn, index) => {
          const last = index === turns.length - 1;
          const { numbering } = citationNumbering(turn);
          const numbered = [...numbering.entries()];
          const others = (turn.sources ?? []).filter((source) => !numbering.has(source.url));
          const failed = turn.status === "error";
          return (
            <div key={turn.id} className={turn.role === "user" ? "ml-6 border-r border-cyan/40 pr-2 text-right" : "border-l border-cyan/25 pl-2"}>
              <div className="label mb-1 text-[11px]">{turn.role === "user" ? (fr ? "Vous" : "You") : "AURA"}</div>
              {turn.role === "assistant" && !turn.content && busy && last ? (
                <div className="readout text-[11px] text-cyan">{status ?? "…"}</div>
              ) : (
                <div className={`whitespace-pre-wrap text-[11px] leading-relaxed ${failed ? "text-alert-soft" : turn.role === "user" ? "text-ice" : "text-text"}`}>
                  {turn.role === "assistant" ? <AnswerText turn={turn} fr={fr} /> : turn.content}
                </div>
              )}
              {turn.role === "assistant" && last && busy && turn.content && status ? (
                <div className="readout mt-1 text-[11px] text-cyan">{status}</div>
              ) : null}
              {turn.notice ? (
                <div className="mt-1 text-[11px] text-alert-soft" role="status">
                  ⚠ {turn.notice}
                </div>
              ) : null}
              {numbered.length || others.length ? (
                <details className="mt-2">
                  <summary className="cursor-pointer text-[11px] text-text-faint">Sources ({numbered.length + others.length})</summary>
                  <div className="mt-1 flex flex-wrap gap-1">
                  {numbered.map(([url, number]) => {
                    const href = safeHref(url);
                    return href ? (
                      <a key={url} href={href} target="_blank" rel="noopener noreferrer" title={turn.sources?.find((source) => source.url === url)?.title ?? url} className="chip max-w-full truncate text-[11px]">
                        [{number}] {host(url)}
                      </a>
                    ) : null;
                  })}
                  {others.map((source) => {
                    const href = safeHref(source.url);
                    return href ? (
                      <a key={source.url} href={href} target="_blank" rel="noopener noreferrer" title={source.title} className="chip max-w-full truncate text-[11px]">
                        {host(source.url)}
                      </a>
                    ) : null;
                  })}
                  </div>
                </details>
              ) : null}
              {turn.provenance?.length ? <ProvenanceList items={turn.provenance} fr={fr} /> : null}
            </div>
          );
        })}
      </div>

      <form onSubmit={onSubmit} className="aura-composer shrink-0 border-t border-cyan/15 p-2">
        <label htmlFor="aura-question" className="sr-only">{fr ? "Votre question à AURA" : "Your question for AURA"}</label>
        <div className="flex items-end gap-1">
          <textarea
            id="aura-question"
            ref={composerRef}
            value={draft}
            onChange={(event) => setDraft(event.target.value)}
            onKeyDown={onKey}
            rows={2}
            maxLength={limits.maxUserChars}
            placeholder={fr ? "Demande à AURA… (Entrée pour envoyer)" : "Ask AURA… (Enter to send)"}
            className="scroll-thin min-h-[44px] min-w-0 flex-1 resize-none border border-cyan/20 bg-[#020b14] px-2 py-1.5 text-base text-text placeholder:text-text-faint focus:border-cyan focus:outline-none md:text-[11px]"
          />
          <div className="flex flex-col gap-1">
            <button type="button" className="chip min-h-[44px] min-w-[44px]" data-active={listening} aria-pressed={listening} aria-label={listening ? (fr ? "Arrêter la dictée" : "Stop dictation") : (fr ? "Dicter une question" : "Dictate a question")} onClick={toggleMic} title={fr ? "Parler" : "Speak"}>
              {listening ? "■" : "🎙"}
            </button>
            {busy ? (
              <button type="button" className="chip min-h-[44px] min-w-[44px]" aria-label={fr ? "Arrêter la réponse" : "Stop response"} onClick={() => { abortRef.current?.abort(); setBusy(false); setStatus(null); voice.stop(); }}>
                ✕
              </button>
            ) : (
              <button type="submit" className="chip min-h-[44px] min-w-[44px]" aria-label={fr ? "Envoyer la question" : "Send question"} disabled={!draft.trim()}>
                ➤
              </button>
            )}
          </div>
        </div>
        {turns.length ? (
          <button type="button" className="mt-1 text-[11px] text-text-faint hover:text-cyan" onClick={() => { abortRef.current?.abort(); setBusy(false); setStatus(null); voice.stop(); setTurns([]); }}>
            {fr ? "Nouvelle conversation" : "New conversation"}
          </button>
        ) : null}
      </form>
    </section>
    </div>
  );
}
