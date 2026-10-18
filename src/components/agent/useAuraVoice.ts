"use client";

import { useCallback, useEffect, useRef, useState } from "react";

/**
 * Voix d'AURA — deux moteurs :
 *
 *  - `neural`  : synthèse OpenAI (`/api/agent/voice`, gpt-4o-mini-tts) — timbre
 *    naturel de qualité studio. Lecture Web Audio sans trou entre les phrases,
 *    niveau mesuré par un Analyseur pour animer l'hologramme (vraie amplitude).
 *  - `browser` : voix système du navigateur (Web Speech API). Repli sans clé,
 *    hors ligne, budget épuisé, ou si le service neural échoue en cours de route.
 *
 * Le texte est découpé en segments (phrases) et téléchargé en avance pendant la
 * lecture : la voix démarre dès la première phrase reçue, sans attendre la fin
 * de la réponse.
 */

export type VoiceEngine = "neural" | "browser";
export type RemoteVoice = { id: string; label: string; note: string };

/** Segment en file d'attente ; `done` débloque les appelants qui attendent la lecture. */
type SpeechQueueItem = { text: string; done: () => void };

const ENGINE_KEY = "orbital.aura.voice.engine.v6";
const NEURAL_KEY = "orbital.aura.voice.neural.v6";
const BROWSER_KEY = "orbital.aura.voice.browser.v6";
const SPEECH_URL = "/api/agent/voice";
const MAX_CHUNK_CHARS = 900;
const NEURAL_TURN_BUDGET = 4500;

const FEMALE_HINTS =
  /vivienne|denise|eloise|celeste|charline|brigitte|audrey|aur[eé]lie|am[eé]lie|marie|c[eé]line|julie|hortense|virginie|chantal|sylvie|l[eé]a|google fran[cç]ais|samantha|female|femme|aria|jenny|sonia|natasha|clara/i;
const MALE_HINTS =
  /thomas|jacques|daniel|nicolas|henri|paul|r[eé]my|claude|alain|antoine|jean|male\b|homme|william|christophe|guillaume/i;
const NOVELTY_HINTS = /sandy|grandpa|grandma|bad news|bahh|bells|boing|bubbles|cellos|deranged|good news|hysterical|pipe organ|trinoids|whisper|zarvox/i;
const QUALITY_HINTS = /google|natural|neural|online|premium|enhanced|am[eé]lior[eé]e|multilingual|siri|denise|vivienne|eloise|audrey|am[eé]lie/i;
const POOR_HINTS = /compact|eloquence|espeak|pico|festival|albert|junior|ralph|fred|novelty/i;

function rank(voice: SpeechSynthesisVoice, lang: string) {
  let score = 0;
  const name = voice.name.toLowerCase();
  const vLang = voice.lang.toLowerCase();

  if (vLang.startsWith(lang)) score += 100;
  if (vLang === `${lang}-fr` || vLang === "en-us") score += 10;
  if (FEMALE_HINTS.test(name)) score += 60;
  if (MALE_HINTS.test(name)) score -= 100;
  if (NOVELTY_HINTS.test(name)) score -= 250;
  if (POOR_HINTS.test(name)) score -= 80;
  if (QUALITY_HINTS.test(name)) score += 45;
  if (/premium|enhanced|am[eé]lior[eé]e|natural|neural|online/i.test(name)) score += 30;
  return score;
}

/**
 * Texte prononçable : la voix ne lit jamais le markdown, les marqueurs de
 * citation [n], les URL ni les noms de domaine.
 */
export function speakable(text: string) {
  return text
    .replace(/```[\s\S]*?```/g, " ")
    .replace(/\(\s*\[[^\]]*\]\([^)]*\)\s*\)/g, "")
    .replace(/!?\[([^\]]+)\]\([^)]*\)/g, "$1")
    .replace(/\[\s*\d+(?:\s*[,;–-]\s*\d+)*\s*\]/g, "")
    .replace(/\[\^?\d+\]/g, "")
    .replace(/<?https?:\/\/[^\s>)\]]+>?/g, "")
    .replace(/\bwww\.[^\s)\]]+/g, "")
    .replace(/^\s{0,3}(?:#{1,6}\s+|> ?|[-*+•]\s+|\d+[.)]\s+)/gm, "")
    .replace(/(\*\*|__|~~|`)/g, "")
    .replace(/(^|\s)[*_](\S[^*_]*\S|\S)[*_](?=\s|[.,;:!?]|$)/g, "$1$2")
    .replace(/^\s*\|?[-:| ]{3,}\|?\s*$/gm, "")
    .replace(/\|/g, ", ")
    .replace(/[*_#>`~]+/g, "")
    .replace(/\(\s*\)/g, "")
    .replace(/\s+([.,])/g, "$1")
    .replace(/\s+/g, " ")
    .trim();
}

/** Découpe en segments lisibles : jamais au milieu d'un mot, d'abord aux phrases. */
export function speechSegments(text: string, max = MAX_CHUNK_CHARS) {
  const segments: string[] = [];
  let rest = text.trim();
  while (rest.length > max) {
    const window = rest.slice(0, max);
    let cut = 0;
    for (const mark of [". ", "! ", "? ", "… ", ": ", "; ", ", ", " "]) {
      const at = window.lastIndexOf(mark);
      if (at > max * 0.3) {
        cut = at + 1;
        break;
      }
    }
    if (cut <= 0) cut = max;
    segments.push(rest.slice(0, cut).trim());
    rest = rest.slice(cut).trim();
  }
  if (rest) segments.push(rest);
  return segments.filter((segment) => segment.length > 1);
}

function readStorage(key: string) {  try {
    return localStorage.getItem(key);
  } catch {
    return null;
  }
}

function writeStorage(key: string, value: string) {
  try {
    localStorage.setItem(key, value);
  } catch {
    /* stockage indisponible */
  }
}

/**
 * Une seule voix à la fois : quand un lecteur (panneau AURA, bilan stratégique)
 * prend la parole, les autres instances se taisent au lieu de se superposer.
 */
const voiceInstances = new Set<{ stop: () => void }>();

export function useAuraVoice(locale: "fr" | "en") {
  const browserSupported = typeof window !== "undefined" && "speechSynthesis" in window;

  const [engine, setEngineState] = useState<VoiceEngine>("neural");
  const [neuralConfigured, setNeuralConfigured] = useState<boolean | null>(null);
  const [remoteVoices, setRemoteVoices] = useState<RemoteVoice[]>([]);
  const [neuralVoice, setNeuralVoice] = useState<string>("nova");
  const [notice, setNotice] = useState<string | null>(null);

  const [voices, setVoices] = useState<SpeechSynthesisVoice[]>([]);
  const [voiceName, setVoiceName] = useState<string | null>(null);

  const [enabled, setEnabled] = useState(true);
  const [speaking, setSpeaking] = useState(false);
  const levelRef = useRef(0);

  const engineRef = useRef<VoiceEngine>("neural");
  const neuralReadyRef = useRef(false);
  const neuralVoiceRef = useRef(neuralVoice);
  const enabledRef = useRef(true);
  const localeRef = useRef(locale);
  const browserVoiceRef = useRef<SpeechSynthesisVoice | null>(null);
  const budgetRef = useRef(NEURAL_TURN_BUDGET);

  const queueRef = useRef<SpeechQueueItem[]>([]);
  const runningRef = useRef(false);
  const generationRef = useRef(0);
  const abortsRef = useRef<Set<AbortController>>(new Set());
  const activityRef = useRef(0);
  const resolvePlayRef = useRef<(() => void) | null>(null);
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const acRef = useRef<AudioContext | null>(null);
  const analyserRef = useRef<AnalyserNode | null>(null);
  const dataRef = useRef<Uint8Array<ArrayBuffer> | null>(null);
  const urlRef = useRef<string | null>(null);
  const selfRef = useRef<{ stop: () => void }>({ stop: () => undefined });

  useEffect(() => {
    engineRef.current = engine;
  }, [engine]);
  useEffect(() => {
    neuralVoiceRef.current = neuralVoice;
  }, [neuralVoice]);
  useEffect(() => {
    enabledRef.current = enabled;
  }, [enabled]);
  useEffect(() => {
    localeRef.current = locale;
  }, [locale]);
  useEffect(() => {
    neuralReadyRef.current = engine === "neural" && neuralConfigured === true;
  }, [engine, neuralConfigured]);

  // Préférences mémorisées + voix disponibles (neurales et navigateur).
  useEffect(() => {
    const storedEngine = readStorage(ENGINE_KEY);
    if (storedEngine === "browser" || storedEngine === "neural") setEngineState(storedEngine);
    const storedNeural = readStorage(NEURAL_KEY);
    if (storedNeural) setNeuralVoice(storedNeural);
    const storedBrowser = readStorage(BROWSER_KEY);
    if (storedBrowser && !NOVELTY_HINTS.test(storedBrowser)) setVoiceName(storedBrowser);

    fetch(SPEECH_URL)
      .then((response) => response.json())
      .then((data: { configured?: boolean; voices?: RemoteVoice[]; defaultVoice?: string }) => {
        setNeuralConfigured(Boolean(data.configured));
        if (data.voices?.length) setRemoteVoices(data.voices);
        if (storedNeural && data.voices?.some((voice) => voice.id === storedNeural)) setNeuralVoice(storedNeural);
        else if (data.defaultVoice) setNeuralVoice(data.defaultVoice);
      })
      .catch(() => setNeuralConfigured(false));
  }, []);

  useEffect(() => {
    if (!browserSupported) return;
    const load = () => setVoices(window.speechSynthesis.getVoices());
    load();
    window.speechSynthesis.addEventListener("voiceschanged", load);
    return () => {
      window.speechSynthesis.removeEventListener("voiceschanged", load);
      window.speechSynthesis.cancel();
    };
  }, [browserSupported]);

  const lang = locale === "en" ? "en" : "fr";
  const candidates = voices.filter((voice) => voice.lang.toLowerCase().startsWith(lang)).sort((a, b) => rank(b, lang) - rank(a, lang));
  const browserVoice = candidates.find((voice) => voice.name === voiceName) ?? candidates[0] ?? null;
  useEffect(() => {
    browserVoiceRef.current = browserVoice;
  }, [browserVoice]);

  const bumpActivity = useCallback((delta: number) => {
    activityRef.current = Math.max(0, activityRef.current + delta);
    setSpeaking(activityRef.current > 0);
  }, []);

  /** À appeler depuis un geste utilisateur : débloque la sortie audio. */
  const primeAudio = useCallback(() => {
    if (typeof window === "undefined") return;
    if (!audioRef.current) {
      const element = new Audio();
      element.preload = "auto";
      audioRef.current = element;
    }
    if (!acRef.current) {
      const Ctor = window.AudioContext ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
      if (Ctor) {
        const context = new Ctor();
        const analyser = context.createAnalyser();
        analyser.fftSize = 512;
        try {
          context.createMediaElementSource(audioRef.current).connect(analyser);
        } catch {
          /* déjà branché */
        }
        analyser.connect(context.destination);
        acRef.current = context;
        analyserRef.current = analyser;
        dataRef.current = new Uint8Array(analyser.fftSize);
      }
    }
    void acRef.current?.resume().catch(() => undefined);
  }, []);

  // Niveau vocal : amplitude réelle mesurée sur la sortie audio, décroissance sinon.
  useEffect(() => {
    const id = window.setInterval(() => {
      const element = audioRef.current;
      const analyser = analyserRef.current;
      const data = dataRef.current;
      if (element && analyser && data && !element.paused && !element.ended && element.currentTime > 0) {
        analyser.getByteTimeDomainData(data);
        let sum = 0;
        for (let index = 0; index < data.length; index++) {
          const value = (data[index] - 128) / 128;
          sum += value * value;
        }
        const rms = Math.sqrt(sum / data.length);
        levelRef.current = Math.min(1, 0.5 + rms * 6);
      } else {
        levelRef.current = Math.max(0.35, levelRef.current * 0.86);
      }
    }, 60);
    return () => window.clearInterval(id);
  }, []);

  const speakWithBrowser = useCallback(
    (segment: string) => {
      if (!browserSupported) return Promise.resolve();
      return new Promise<void>((resolve) => {
        const utterance = new SpeechSynthesisUtterance(segment);
        const selected = browserVoiceRef.current;
        if (selected) utterance.voice = selected;
        utterance.lang = selected?.lang ?? (localeRef.current === "fr" ? "fr-FR" : "en-US");
        utterance.rate = 0.98;
        utterance.pitch = 1.04;
        utterance.volume = 1;
        let active = false;
        utterance.onstart = () => {
          active = true;
          bumpActivity(+1);
        };
        utterance.onboundary = () => {
          levelRef.current = 1;
        };
        const finish = () => {
          if (active) bumpActivity(-1);
          resolve();
        };
        utterance.onend = finish;
        utterance.onerror = finish;
        window.speechSynthesis.speak(utterance);
      });
    },
    [browserSupported, bumpActivity],
  );

  const fetchSpeech = useCallback(async (segment: string, signal: AbortSignal): Promise<Blob | null> => {
    try {
      const response = await fetch(SPEECH_URL, {
        method: "POST",
        headers: { "Content-Type": "application/json", "X-Orbital-Client": "aura" },
        signal,
        body: JSON.stringify({ text: segment, voice: neuralVoiceRef.current, locale: localeRef.current }),
      });
      if (!response.ok) {
        const data = (await response.json().catch(() => ({}))) as { error?: string; code?: string };
        if (data.code === "daily_budget") setNotice(data.error ?? null);
        return null;
      }
      return await response.blob();
    } catch {
      return null;
    }
  }, []);

  const playBlob = useCallback(async (url: string) => {
    const element = audioRef.current;
    if (!element) return;
    await new Promise<void>((resolve) => {
      resolvePlayRef.current = resolve;
      element.onended = () => resolve();
      element.onerror = () => resolve();
      element.src = url;
      void element.play().catch(() => resolve());
    });
    resolvePlayRef.current = null;
  }, []);

  const runNeuralQueue = useCallback(async () => {
    if (runningRef.current || !neuralReadyRef.current) return;
    const generation = generationRef.current;
    runningRef.current = true;
    bumpActivity(+1);
    try {
      const fetchNext = () => {
        const item = queueRef.current.shift();
        if (item === undefined) return null;
        const abort = new AbortController();
        abortsRef.current.add(abort);
        return { item, promise: fetchSpeech(item.text, abort.signal).finally(() => abortsRef.current.delete(abort)) };
      };

      let pending = fetchNext();
      while (pending) {
        const { item, promise } = pending;
        try {
          const blob = await promise;
          if (generation !== generationRef.current) break;
          pending = fetchNext(); // téléchargement du segment suivant pendant la lecture
          if (blob && blob.size > 256 && blob.type.startsWith("audio")) {
            const url = URL.createObjectURL(blob);
            urlRef.current = url;
            await playBlob(url);
            URL.revokeObjectURL(url);
            if (urlRef.current === url) urlRef.current = null;
          } else if (generation === generationRef.current) {
            // Service neural indisponible pour ce segment : repli ponctuel navigateur.
            await speakWithBrowser(item.text);
          }
        } finally {
          item.done();
        }
        if (generation !== generationRef.current) break;
      }
    } finally {
      runningRef.current = false;
      bumpActivity(-1);
    }
  }, [bumpActivity, fetchSpeech, playBlob, speakWithBrowser]);

  /**
   * Envoie du texte à la voix. `wait` renvoie une promesse résolue à la fin de
   * la lecture : le lecteur de bilan l'utilise pour avancer phrase par phrase.
   * Retourne `null` si rien n'est prononçable ou si la voix est désactivée.
   */
  const enqueue = useCallback(
    (text: string, wait: boolean): Promise<void> | null => {
      if (!enabledRef.current) return null;
      const clean = speakable(text);
      if (!clean || clean.length < 2) return null;

      const segments = speechSegments(clean);
      if (!segments.length) return null;

      // Un seul lecteur à la fois : les autres instances vocales se taisent.
      for (const instance of voiceInstances) if (instance !== selfRef.current) instance.stop();

      if (engineRef.current === "neural" && neuralReadyRef.current) {
        const allowed: string[] = [];
        for (const segment of segments) {
          if (budgetRef.current <= 0) break;
          budgetRef.current -= segment.length;
          allowed.push(segment);
        }
        if (!allowed.length) {
          setNotice(localeRef.current === "fr" ? "Lecture vocale limitée pour cette réponse (réponse très longue)." : "Voice playback capped for this answer (very long answer).");
          return null;
        }
        let resolveDone: (() => void) | null = null;
        const completion = wait ? new Promise<void>((resolve) => { resolveDone = resolve; }) : null;
        allowed.forEach((segment, index) => {
          const last = index === allowed.length - 1;
          queueRef.current.push({ text: segment, done: last && resolveDone ? resolveDone : () => undefined });
        });
        void runNeuralQueue();
        return completion;
      }

      if (!wait) {
        for (const segment of segments) void speakWithBrowser(segment);
        return null;
      }
      return (async () => {
        for (const segment of segments) await speakWithBrowser(segment);
      })();
    },
    [runNeuralQueue, speakWithBrowser],
  );

  const speak = useCallback((text: string) => void enqueue(text, false), [enqueue]);
  const speakAsync = useCallback((text: string) => enqueue(text, true) ?? Promise.resolve(), [enqueue]);

  const stop = useCallback(() => {
    generationRef.current += 1;
    for (const item of queueRef.current) item.done();
    queueRef.current = [];
    for (const abort of abortsRef.current) abort.abort();
    abortsRef.current.clear();
    resolvePlayRef.current?.();
    resolvePlayRef.current = null;
    const element = audioRef.current;
    if (element) {
      element.pause();
      element.removeAttribute("src");
      element.load();
    }
    if (urlRef.current) {
      URL.revokeObjectURL(urlRef.current);
      urlRef.current = null;
    }
    if (browserSupported) window.speechSynthesis.cancel();
    budgetRef.current = NEURAL_TURN_BUDGET;
    activityRef.current = 0;
    levelRef.current = 0;
    setSpeaking(false);
  }, [browserSupported]);

  // Enregistre l'instance pour l'arbitrage « une seule voix à la fois ».
  useEffect(() => {
    selfRef.current.stop = stop;
    const self = selfRef.current;
    voiceInstances.add(self);
    return () => {
      voiceInstances.delete(self);
    };
  }, [stop]);

  const toggle = useCallback(() => {
    setEnabled((value) => {
      if (value) stop();
      return !value;
    });
  }, [stop]);

  /** Pause la lecture en cours (neural : élément audio ; navigateur : file système). */
  const pause = useCallback(() => {
    const element = audioRef.current;
    if (element && !element.paused && !element.ended) {
      element.pause();
      return;
    }
    if (browserSupported) window.speechSynthesis.pause();
  }, [browserSupported]);

  const resume = useCallback(() => {
    const element = audioRef.current;
    if (element && element.paused && element.src) {
      void element.play().catch(() => undefined);
      return;
    }
    if (browserSupported) window.speechSynthesis.resume();
  }, [browserSupported]);

  const setEngine = useCallback((next: VoiceEngine) => {
    stop();
    setEngineState(next);
    writeStorage(ENGINE_KEY, next);
    setNotice(null);
  }, [stop]);

  const chooseNeuralVoice = useCallback((id: string) => {
    stop();
    setNeuralVoice(id);
    writeStorage(NEURAL_KEY, id);
  }, [stop]);

  const chooseVoice = useCallback((name: string) => {
    stop();
    setVoiceName(name);
    writeStorage(BROWSER_KEY, name);
  }, [stop]);

  return {
    browserSupported,
    enabled,
    toggle,
    speaking,
    speak,
    speakAsync,
    pause,
    resume,
    stop,
    levelRef,
    primeAudio,
    engine,
    setEngine,
    neuralConfigured,
    neuralVoice,
    remoteVoices,
    chooseNeuralVoice,
    notice,
    clearNotice: useCallback(() => setNotice(null), []),
    browserVoice,
    candidates,
    chooseVoice,
  };
}
