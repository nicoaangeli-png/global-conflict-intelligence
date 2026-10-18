"use client";

import { Fragment, useCallback, useEffect, useRef, useState, type FormEvent, type KeyboardEvent, type ReactNode } from "react";
import { useIntelStore } from "@/store/useIntelStore";
import { canonicalCountryIdentity } from "@/lib/geo/country";
import { AuraCore, type AuraState } from "./AuraCore";
import { speakable, useAuraVoice } from "./useAuraVoice";

/**
 * AURA — analyste géopolitique vocale.
 *
 * Panneau latéral : artefact lumineux, conversation, sources, micro et voix.
 * Le contexte de l'écran (pays ouvert, foyer sélectionné, fenêtre
 * temporelle) accompagne chaque question. Une réponse n'est « complète » que si
 * le serveur envoie `done` ; sinon elle est marquée incomplète ou interrompue.
 */

type Source = { title: string; url: string };
type Citation = { start: number; end: number; url: string; title: string };
type Provenance = {
  kind: "tool" | "web_search";
  label: string;
  source: string;
  status: "ok" | "empty" | "unavailable" | "error";
  retrievedAt: string;
  detail?: string;
  url?: string;
};
type TurnStatus = "streaming" | "complete" | "incomplete" | "interrupted" | "error";
type Turn = {
  id: number;
  role: "user" | "assistant";
  content: string;
  status?: TurnStatus;
  notice?: string;
  sources?: Source[];
  citations?: Citation[];
  provenance?: Provenance[];
};
type Limits = { maxMessages: number; maxUserChars: number; maxAssistantChars: number; maxTotalChars: number };
type StreamChunk = {
  t: string;
  text?: string;
  items?: unknown[];
  spans?: Citation[];
};

const DEFAULT_LIMITS: Limits = { maxMessages: 12, maxUserChars: 2000, maxAssistantChars: 12_000, maxTotalChars: 24_000 };

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

function cleanSegment(text: string) {
  return text
    .replace(/\(\s*\[[^\]]*\]\([^)]*\)\s*\)/g, "")
    .replace(/\[([^\]]+)\]\([^)]*\)/g, "$1")
    .replace(/\*\*([^*]+)\*\*/g, "$1")
    .replace(/^#+\s*/gm, "")
    .replace(/[ \t]+\n/g, "\n");
}

function cleanUrl(url: string) {
  try {
    const parsed = new URL(url);
    if (parsed.searchParams.get("utm_source") === "openai") parsed.searchParams.delete("utm_source");
    return parsed.toString();
  } catch {
    return url;
  }
}

function safeHref(url: string) {
  try {
    const parsed = new URL(url);
    return parsed.protocol === "https:" || parsed.protocol === "http:" ? parsed.toString() : null;
  } catch {
    return null;
  }
}

const host = (url: string) => {
  try {
    return new URL(url).hostname.replace(/^www\./, "");
  } catch {
    return url;
  }
};

function citationNumbering(turn: Turn) {
  const numbering = new Map<string, number>();
  const ordered = (turn.citations ?? [])
    .filter((citation) => citation.end <= turn.content.length && citation.end > citation.start)
    .sort((left, right) => left.end - right.end);
  for (const citation of ordered) if (!numbering.has(citation.url)) numbering.set(citation.url, numbering.size + 1);
  return { numbering, ordered };
}

export function AnswerText({ turn, fr }: { turn: Turn; fr: boolean }) {
  const { numbering, ordered } = citationNumbering(turn);
  const nodes: ReactNode[] = [];
  let cursor = 0;
  const ends = [...new Set(ordered.map((citation) => citation.end))];
  ends.forEach((end, endIndex) => {
    const segment = cleanSegment(turn.content.slice(cursor, end));
    nodes.push(<Fragment key={`t${endIndex}`}>{endIndex === 0 ? segment.trimStart() : segment}</Fragment>);
    cursor = end;
    const urls = [...new Set(ordered.filter((citation) => citation.end === end).map((citation) => citation.url))];
    urls.forEach((url) => {
      const href = safeHref(url);
      const number = numbering.get(url);
      if (!href || !number) return;
      nodes.push(
        <a
          key={`c${endIndex}-${number}`}
          href={href}
          target="_blank"
          rel="noopener noreferrer"
          className="ml-[1px] align-super text-[11px] text-cyan hover:underline"
          aria-label={`Source ${number} : ${host(url)}`}
          title={host(url)}
        >
          [{number}]
        </a>,
      );
    });
  });
  const rest = cleanSegment(turn.content.slice(cursor));
  nodes.push(<Fragment key="tail">{ends.length === 0 ? rest.trim() : rest.trimEnd()}</Fragment>);
  return <>{nodes}</>;
}

function formatTime(iso: string) {
  return `${iso.slice(0, 16).replace("T", " ")} UTC`;
}

function ProvenanceList({ items, fr }: { items: Provenance[]; fr: boolean }) {
  const statusLabel: Record<Provenance["status"], string> = {
    ok: "ok",
    empty: fr ? "aucune donnée" : "no data",
    unavailable: fr ? "indisponible" : "unavailable",
    error: fr ? "erreur" : "error",
  };
  return (
    <details className="mt-2 text-[11px] text-text-faint">
      <summary className="cursor-pointer hover:text-cyan">{`Provenance (${items.length})`}</summary>
      <ul className="mt-1 space-y-1">
        {items.map((item, index) => (
          <li key={index} className={item.status === "ok" ? "" : "text-alert-soft"}>
            <span className="text-text-dim">{item.kind === "web_search" ? (fr ? "Recherche web" : "Web search") : item.label}</span>
            {item.kind === "web_search" ? ` « ${item.label} »` : ""} · {item.source} · {statusLabel[item.status]} · {formatTime(item.retrievedAt)}
            {item.detail ? ` · ${item.detail}` : ""}
          </li>
        ))}
      </ul>
    </details>
  );
}

export function buildHistory(turns: Turn[], question: string, limits: Limits) {
  const pairs: { role: "user" | "assistant"; content: string }[][] = [];
  for (let index = 0; index + 1 < turns.length; index += 2) {
    const asked = turns[index];
    const answered = turns[index + 1];
    if (asked.role === "user" && answered.role === "assistant" && answered.status === "complete" && answered.content && answered.content.length <= limits.maxAssistantChars) {
      pairs.push([
        { role: "user", content: asked.content },
        { role: "assistant", content: answered.content },
      ]);
    }
  }
  const current = { role: "user" as const, content: question };
  const size = (list: typeof pairs) => list.reduce((total, pair) => total + pair[0].content.length + pair[1].content.length, 0) + current.content.length;
  while (pairs.length && (pairs.length * 2 + 1 > limits.maxMessages || size(pairs) > limits.maxTotalChars)) pairs.shift();
  return [...pairs.flat(), current];
}

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
  const turnCounter = useRef(0);
  const voice = useAuraVoice(locale);
  const fr = locale === "fr";

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
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight, behavior: "smooth" });
  }, [turns, status]);

  useEffect(() => () => { abortRef.current?.abort(); recognitionRef.current?.stop(); }, []);

  const ask = useCallback(async (question: string) => {
    const trimmed = question.trim().slice(0, limits.maxUserChars);
    if (!trimmed || busy) return;
    voice.stop();
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
      const reader = response.body.getReader();
      const decoder = new TextDecoder();
      let buffer = "";
      const handleLine = (line: string) => {
        let chunk: StreamChunk;
        try {
          chunk = JSON.parse(line) as StreamChunk;
        } catch {
          return;
        }
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
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });
        let newline = buffer.indexOf("\n");
        while (newline >= 0) {
          const line = buffer.slice(0, newline).trim();
          buffer = buffer.slice(newline + 1);
          if (line) handleLine(line);
          newline = buffer.indexOf("\n");
        }
      }
      if (buffer.trim()) handleLine(buffer.trim());

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

  const onSubmit = (event: FormEvent) => { event.preventDefault(); void ask(draft); };
  const onKey = (event: KeyboardEvent<HTMLTextAreaElement>) => {
    if (event.key === "Enter" && !event.shiftKey) { event.preventDefault(); void ask(draft); }
    event.stopPropagation();
  };

  if (!open) {
    return (
      <div className="aura-launcher">
      <button
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
    <section className="panel corners boot pointer-events-auto flex w-full flex-col bg-[#020b14]/90" aria-label="AURA">
      <span className="corner" />
      <header className="relative border-b border-cyan/15">
        <AuraCore state={holoState} levelRef={voice.levelRef} width={330} height={190} className="mx-auto" />
        <div className="absolute left-3 top-2 max-w-[calc(100%-140px)]">
          <div className="label-strong">AURA</div>
          <div className="text-[11px] text-text-faint">{fr ? "Analyste géopolitique · sources ouvertes" : "Geopolitical analyst · open sources"}</div>
          <div className="readout mt-[2px] text-[11px] text-cyan">
            {holoState === "speaking" ? (fr ? "● transmission vocale" : "● speaking") : holoState === "thinking" ? (status ?? (listening ? (fr ? "● écoute…" : "● listening…") : "…")) : (fr ? "● en veille" : "● standby")}
          </div>
        </div>
        <div className="absolute right-2 top-2 flex gap-1">
          <button type="button" className="chip" data-active={voice.enabled} aria-pressed={voice.enabled} onClick={voice.toggle} title={fr ? "Voix" : "Voice"}>
            {voice.enabled ? "🔊" : "🔇"}
          </button>
          <button type="button" className="chip" onClick={() => setShowVoices((visible) => !visible)} aria-expanded={showVoices} title={fr ? "Choisir la voix" : "Choose voice"}>
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
              className="mt-1 w-full border border-cyan/20 bg-[#020b14] px-2 py-1 text-[11px] text-text"
              value={voice.voice?.name ?? ""}
              onChange={(event) => voice.chooseVoice(event.target.value)}
            >
              {voice.candidates.map((candidate) => <option key={candidate.name} value={candidate.name}>{candidate.name} · {candidate.lang}</option>)}
            </select>
          ) : (
            <p className="mt-1 text-[11px] text-text-faint">{fr ? "Aucune voix française installée sur ce système." : "No matching voice installed."}</p>
          )}
          <p className="mt-1 text-[11px] text-text-faint">
            {fr ? "Astuce : Voix féminine naturelle (Denise, Eloise, Vivienne ou Audrey / Amélie). Sur Mac : Réglages › Accessibilité › Contenu énoncé › Voix du système › Gérer les voix — télécharge « Audrey (Premium) » ou « Amélie (Premium) »." : "Tip: Natural female voice (Denise, Eloise, Vivienne or Audrey / Amélie). On Mac: download Audrey (Premium) in Settings › Accessibility › Spoken Content."}
          </p>
        </div>
      ) : null}

      <div ref={scrollRef} className="scroll-thin flex-1 space-y-3 overflow-y-auto px-3 py-3" aria-live="polite">
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
                <div className="mt-2 flex flex-wrap gap-1">
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
              ) : null}
              {turn.provenance?.length ? <ProvenanceList items={turn.provenance} fr={fr} /> : null}
            </div>
          );
        })}
      </div>

      <form onSubmit={onSubmit} className="border-t border-cyan/15 p-2">
        <div className="flex items-end gap-1">
          <textarea
            value={draft}
            onChange={(event) => setDraft(event.target.value)}
            onKeyDown={onKey}
            rows={2}
            maxLength={limits.maxUserChars}
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
          <button type="button" className="mt-1 text-[11px] text-text-faint hover:text-cyan" onClick={() => { abortRef.current?.abort(); setBusy(false); setStatus(null); voice.stop(); setTurns([]); }}>
            {fr ? "Nouvelle conversation" : "New conversation"}
          </button>
        ) : null}
      </form>
    </section>
    </div>
  );
}
