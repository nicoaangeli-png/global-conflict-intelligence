"use client";

import { useCallback, useEffect, useRef, useState, type FormEvent, type KeyboardEvent } from "react";
import { useIntelStore } from "@/store/useIntelStore";
import { AuraCore, type AuraState } from "./AuraCore";
import { speakable, useAuraVoice } from "./useAuraVoice";

/**
 * AURA — analyste géopolitique vocale.
 *
 * Panneau latéral : artefact lumineux, conversation, sources, micro et voix.
 * Le contexte de l'écran (pays ouvert, foyer sélectionné, fenêtre
 * temporelle) accompagne chaque question.
 */

type Source = { title: string; url: string };
type Turn = { role: "user" | "assistant"; content: string; sources?: Source[]; error?: boolean };

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

/** Affichage : retire les citations markdown inline (les sources sont listées à part). */
function displayText(text: string) {
  return text
    .replace(/\(\s*\[[^\]]*\]\([^)]*\)\s*\)/g, "")
    .replace(/\[([^\]]+)\]\([^)]*\)/g, "$1")
    .replace(/\*\*([^*]+)\*\*/g, "$1")
    .replace(/^#+\s*/gm, "")
    .replace(/[ \t]+\n/g, "\n")
    .trim();
}

const cleanUrl = (url: string) => url.replace(/[?&]utm_source=openai$/, "").replace(/utm_source=openai&?/, "");
const host = (url: string) => { try { return new URL(url).hostname.replace(/^www\./, ""); } catch { return url; } };

export function AgentPanel() {
  const locale = useIntelStore((s) => s.locale);
  const country = useIntelStore((s) => s.country);
  const selected = useIntelStore((s) => s.selected);
  const range = useIntelStore((s) => s.filters.range);

  const open = useIntelStore((s) => s.agentOpen);
  const setOpen = useIntelStore((s) => s.setAgentOpen);
  const [configured, setConfigured] = useState<boolean | null>(null);
  const [turns, setTurns] = useState<Turn[]>([]);
  const [draft, setDraft] = useState("");
  const [busy, setBusy] = useState(false);
  const [status, setStatus] = useState<string | null>(null);
  const [listening, setListening] = useState(false);
  const [showVoices, setShowVoices] = useState(false);
  const abortRef = useRef<AbortController | null>(null);
  const recognitionRef = useRef<Recognition | null>(null);
  const scrollRef = useRef<HTMLDivElement>(null);
  const voice = useAuraVoice(locale);
  const fr = locale === "fr";

  useEffect(() => {
    fetch("/api/agent").then((r) => r.json()).then((d: { configured?: boolean }) => setConfigured(Boolean(d.configured))).catch(() => setConfigured(false));
  }, []);

  useEffect(() => {
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight, behavior: "smooth" });
  }, [turns, status]);

  useEffect(() => () => { abortRef.current?.abort(); recognitionRef.current?.stop(); }, []);

  const ask = useCallback(async (question: string) => {
    const q = question.trim();
    if (!q || busy) return;
    voice.stop();
    abortRef.current?.abort();
    const controller = new AbortController();
    abortRef.current = controller;

    const history = [...turns.filter((t) => !t.error), { role: "user" as const, content: q }].slice(-12);
    setTurns((prev) => [...prev, { role: "user", content: q }, { role: "assistant", content: "" }]);
    setDraft("");
    setBusy(true);
    setStatus(fr ? "Analyse en cours…" : "Analysing…");

    let answer = "";
    let spokenUpTo = 0;
    // Lit chaque phrase terminée dès qu'elle arrive.
    const flushSpeech = (final: boolean) => {
      const pending = answer.slice(spokenUpTo);
      const match = final ? pending.length : (() => {
        const re = /[.!?…](?=\s|$)/g;
        let last = -1;
        let m: RegExpExecArray | null;
        while ((m = re.exec(pending))) last = m.index + 1;
        return last;
      })();
      if (match > 0) {
        const chunk = pending.slice(0, match);
        spokenUpTo += match;
        if (speakable(chunk).length > 1) voice.speak(chunk);
      }
    };
    const update = (patch: Partial<Turn>) =>
      setTurns((prev) => {
        const next = prev.slice();
        next[next.length - 1] = { ...next[next.length - 1], ...patch };
        return next;
      });

    try {
      const res = await fetch("/api/agent", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        signal: controller.signal,
        body: JSON.stringify({
          messages: history.map(({ role, content }) => ({ role, content })),
          context: {
            locale,
            range,
            country: country ? { name: country.name, iso: country.iso } : null,
            cluster: selected ? { locality: selected.locality, country: selected.country, eventCount: selected.eventCount } : null,
          },
        }),
      });
      if (!res.ok || !res.body) {
        const data = (await res.json().catch(() => ({}))) as { error?: string };
        throw new Error(data.error ?? (fr ? "Service indisponible." : "Service unavailable."));
      }
      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      let buffer = "";
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });
        let nl: number;
        while ((nl = buffer.indexOf("\n")) >= 0) {
          const line = buffer.slice(0, nl).trim();
          buffer = buffer.slice(nl + 1);
          if (!line) continue;
          const chunk = JSON.parse(line) as { t: string; text?: string; items?: Source[] };
          if (chunk.t === "delta" && chunk.text) {
            answer += chunk.text;
            setStatus(null);
            update({ content: answer });
            flushSpeech(false);
          } else if (chunk.t === "status" && chunk.text) {
            setStatus(chunk.text);
          } else if (chunk.t === "sources" && chunk.items) {
            update({ sources: chunk.items.map((s) => ({ ...s, url: cleanUrl(s.url) })) });
          } else if (chunk.t === "error") {
            throw new Error(chunk.text);
          }
        }
      }
      flushSpeech(true);
      if (!answer) update({ content: fr ? "Aucune réponse obtenue." : "No answer received.", error: true });
    } catch (error) {
      if (controller.signal.aborted) return;
      const message = error instanceof Error ? error.message : fr ? "Erreur." : "Error.";
      update({ content: answer ? `${answer}\n\n⚠ ${message}` : message, error: !answer });
    } finally {
      if (abortRef.current === controller) {
        setBusy(false);
        setStatus(null);
      }
    }
  }, [busy, country, fr, locale, range, selected, turns, voice]);

  const toggleMic = useCallback(() => {
    if (listening) { recognitionRef.current?.stop(); return; }
    const Ctor = (window as unknown as { SpeechRecognition?: new () => Recognition; webkitSpeechRecognition?: new () => Recognition }).SpeechRecognition
      ?? (window as unknown as { webkitSpeechRecognition?: new () => Recognition }).webkitSpeechRecognition;
    if (!Ctor) { setStatus(fr ? "Micro non pris en charge par ce navigateur (utilise Chrome)." : "Microphone not supported (use Chrome)."); return; }
    voice.stop();
    const rec = new Ctor();
    rec.lang = fr ? "fr-FR" : "en-US";
    rec.interimResults = true;
    rec.continuous = false;
    let finalText = "";
    rec.onresult = (event) => {
      let interim = "";
      for (let i = 0; i < event.results.length; i++) {
        const r = event.results[i];
        if (r.isFinal) finalText += r[0].transcript;
        else interim += r[0].transcript;
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
  ].filter((s): s is string => Boolean(s)).slice(0, 4);

  const onSubmit = (e: FormEvent) => { e.preventDefault(); void ask(draft); };
  const onKey = (e: KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); void ask(draft); }
    e.stopPropagation();
  };

  if (!open) {
    return (
      <div className="pointer-events-none absolute bottom-[128px] right-[64px] z-20">
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="panel pointer-events-auto flex items-center gap-2 py-1 pl-1 pr-3 transition hover:border-cyan/40"
        aria-label={fr ? "Ouvrir AURA, analyste IA" : "Open AURA, AI analyst"}
      >
        <AuraCore state={holoState} levelRef={voice.levelRef} width={64} height={64} />
        <span className="flex flex-col items-start">
          <span className="label-strong">AURA</span>
          <span className="text-[9px] text-text-faint">{fr ? "Analyste IA · voix" : "AI analyst · voice"}</span>
        </span>
      </button>
      </div>
    );
  }

  return (
    <div className="pointer-events-none absolute bottom-[128px] right-[62px] top-[86px] z-30 flex w-[340px]">
    <section className="panel corners boot pointer-events-auto flex w-full flex-col bg-[#020b14]/90" aria-label="AURA">
      <span className="corner" />
      <header className="relative border-b border-cyan/15">
        <AuraCore state={holoState} levelRef={voice.levelRef} width={338} height={236} className="mx-auto" />
        <div className="absolute left-3 top-2">
          <div className="label-strong">AURA</div>
          <div className="text-[9px] text-text-faint">{fr ? "Analyste géopolitique · sources ouvertes" : "Geopolitical analyst · open sources"}</div>
          <div className="readout mt-[2px] text-[9px] text-cyan">
            {holoState === "speaking" ? (fr ? "● transmission vocale" : "● speaking") : holoState === "thinking" ? (status ?? (listening ? (fr ? "● écoute…" : "● listening…") : "…")) : (fr ? "● en veille" : "● standby")}
          </div>
        </div>
        <div className="absolute right-2 top-2 flex gap-1">
          <button type="button" className="chip" data-active={voice.enabled} aria-pressed={voice.enabled} onClick={voice.toggle} title={fr ? "Voix" : "Voice"}>
            {voice.enabled ? "🔊" : "🔇"}
          </button>
          <button type="button" className="chip" onClick={() => setShowVoices((v) => !v)} aria-expanded={showVoices} title={fr ? "Choisir la voix" : "Choose voice"}>
            ♀
          </button>
          <button type="button" className="chip" onClick={() => { voice.stop(); setOpen(false); }}>
            esc
          </button>
        </div>
        <div className="absolute bottom-2 right-2">
          {voice.speaking ? (
            <button type="button" className="chip" onClick={voice.stop}>{fr ? "silence" : "mute"}</button>
          ) : null}
        </div>
      </header>

      {showVoices ? (
        <div className="border-b border-cyan/15 px-3 py-2">
          <label className="label block" htmlFor="aura-voice">{fr ? "Voix de synthèse" : "Synthetic voice"}</label>
          {voice.candidates.length ? (
            <select
              id="aura-voice"
              className="mt-1 w-full border border-cyan/20 bg-[#020b14] px-2 py-1 text-[10px] text-text"
              value={voice.voice?.name ?? ""}
              onChange={(e) => voice.chooseVoice(e.target.value)}
            >
              {voice.candidates.map((v) => <option key={v.name} value={v.name}>{v.name} · {v.lang}</option>)}
            </select>
          ) : (
            <p className="mt-1 text-[9px] text-text-faint">{fr ? "Aucune voix française installée sur ce système." : "No matching voice installed."}</p>
          )}
          <p className="mt-1 text-[9px] text-text-faint">
            {fr ? "Astuce Mac : Réglages › Accessibilité › Contenu énoncé › Voix du système › Gérer les voix — télécharge « Audrey (Premium) » ou « Amélie (Premium) » pour une voix bien plus douce." : "Mac tip: install a Premium voice in System Settings › Accessibility › Spoken Content."}
          </p>
        </div>
      ) : null}

      <div ref={scrollRef} className="scroll-thin flex-1 space-y-3 overflow-y-auto px-3 py-3" aria-live="polite">
        {configured === false ? (
          <p className="text-[10px] text-alert-soft">{fr ? "Agente non configurée : ajoute OPENAI_API_KEY dans .env.local puis redémarre le serveur." : "Agent not configured: add OPENAI_API_KEY to .env.local and restart."}</p>
        ) : null}
        {turns.length === 0 ? (
          <div className="space-y-2">
            <p className="text-[10px] leading-relaxed text-text-dim">
              {fr
                ? "Pose une question géopolitique : dirigeants, fronts, cessez-le-feu, acteurs, contexte d'un foyer. AURA vérifie en direct sur le web, Wikidata, la Banque mondiale et la base ORBITAL, et cite ses sources."
                : "Ask a geopolitical question. AURA checks the live web, Wikidata, the World Bank and the ORBITAL database, and cites sources."}
            </p>
            {suggestions.map((s) => (
              <button key={s} type="button" className="row-button block w-full text-left text-[10px] text-text" onClick={() => void ask(s)}>
                › {s}
              </button>
            ))}
          </div>
        ) : null}
        {turns.map((turn, i) => (
          <div key={i} className={turn.role === "user" ? "ml-6 border-r border-cyan/40 pr-2 text-right" : "border-l border-cyan/25 pl-2"}>
            <div className="label mb-1 text-[8px]">{turn.role === "user" ? (fr ? "Vous" : "You") : "AURA"}</div>
            {turn.role === "assistant" && !turn.content && busy && i === turns.length - 1 ? (
              <div className="readout text-[10px] text-cyan">{status ?? "…"}</div>
            ) : (
              <div className={`whitespace-pre-wrap text-[11px] leading-relaxed ${turn.error ? "text-alert-soft" : turn.role === "user" ? "text-ice" : "text-text"}`}>
                {turn.role === "assistant" ? displayText(turn.content) : turn.content}
              </div>
            )}
            {turn.role === "assistant" && i === turns.length - 1 && busy && turn.content && status ? (
              <div className="readout mt-1 text-[9px] text-cyan">{status}</div>
            ) : null}
            {turn.sources?.length ? (
              <div className="mt-2 flex flex-wrap gap-1">
                {turn.sources.map((s) => (
                  <a key={s.url} href={s.url} target="_blank" rel="noopener noreferrer" title={s.title} className="chip max-w-full truncate text-[8px]">
                    {host(s.url)}
                  </a>
                ))}
              </div>
            ) : null}
          </div>
        ))}
      </div>

      <form onSubmit={onSubmit} className="border-t border-cyan/15 p-2">
        <div className="flex items-end gap-1">
          <textarea
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            onKeyDown={onKey}
            rows={2}
            maxLength={2000}
            placeholder={fr ? "Demande à AURA… (Entrée pour envoyer)" : "Ask AURA… (Enter to send)"}
            className="scroll-thin min-h-[38px] flex-1 resize-none border border-cyan/20 bg-[#020b14] px-2 py-1.5 text-[11px] text-text placeholder:text-text-faint focus:border-cyan focus:outline-none"
          />
          <div className="flex flex-col gap-1">
            <button type="button" className="chip" data-active={listening} aria-pressed={listening} onClick={toggleMic} title={fr ? "Parler" : "Speak"}>
              {listening ? "■" : "🎙"}
            </button>
            {busy ? (
              <button type="button" className="chip" onClick={() => { abortRef.current?.abort(); setBusy(false); setStatus(null); voice.stop(); }}>
                ✕
              </button>
            ) : (
              <button type="submit" className="chip" disabled={!draft.trim()}>
                ➤
              </button>
            )}
          </div>
        </div>
        {turns.length ? (
          <button type="button" className="mt-1 text-[9px] text-text-faint hover:text-cyan" onClick={() => { voice.stop(); setTurns([]); }}>
            {fr ? "Nouvelle conversation" : "New conversation"}
          </button>
        ) : null}
      </form>
    </section>
    </div>
  );
}
