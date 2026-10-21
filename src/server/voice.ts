import "server-only";

/**
 * Voix d'AURA — synthèse neurale OpenAI (`/v1/audio/speech`).
 *
 * Même clé que l'analyse (OPENAI_API_KEY). Modèle par défaut : gpt-4o-mini-tts,
 * qui accepte des consignes de style (`instructions`) pour un débit posé
 * d'analyste. Repli côté client sur la voix du navigateur si ce service est
 * indisponible : aucune réponse n'est jamais bloquée par la voix.
 */

const SPEECH_URL = "https://api.openai.com/v1/audio/speech";
const DEFAULT_MODEL = "gpt-4o-mini-tts";
const DEFAULT_VOICE = "nova";

export type VoiceOption = { id: string; label: string; note: string };

/** Voix proposées, du timbre le plus « analyste posé » au plus grave. */
export const VOICE_OPTIONS: VoiceOption[] = [
  { id: "nova", label: "Nova", note: "féminine, chaleureuse et posée" },
  { id: "shimmer", label: "Shimmer", note: "féminine, douce et aérée" },
  { id: "coral", label: "Coral", note: "féminine, claire et dynamique" },
  { id: "sage", label: "Sage", note: "féminine, neutre, analytique" },
  { id: "alloy", label: "Alloy", note: "neutre, sobre" },
  { id: "ballad", label: "Ballad", note: "expressive, narrative" },
  { id: "ash", label: "Ash", note: "assurée, légèrement grave" },
  { id: "marin", label: "Marin", note: "naturelle, moderne" },
  { id: "echo", label: "Echo", note: "masculine, posée" },
  { id: "verse", label: "Verse", note: "masculine, claire" },
  { id: "onyx", label: "Onyx", note: "masculine, grave" },
  { id: "cedar", label: "Cedar", note: "masculine, naturelle" },
];

const KNOWN_VOICES = new Set(VOICE_OPTIONS.map((option) => option.id));

function boundedNumber(name: string, fallback: number, min: number, max: number) {
  const parsed = Number(process.env[name]);
  return Number.isFinite(parsed) && parsed >= min && parsed <= max ? Math.floor(parsed) : fallback;
}

export function voiceModel() {
  return (process.env.AURA_TTS_MODEL ?? "").trim() || DEFAULT_MODEL;
}

export function voiceConfigured() {
  return Boolean((process.env.OPENAI_API_KEY ?? "").trim()) && process.env.AURA_TTS_DISABLED !== "1";
}

export function defaultVoice() {
  const configured = (process.env.AURA_TTS_VOICE ?? "").trim().toLowerCase();
  return KNOWN_VOICES.has(configured) ? configured : DEFAULT_VOICE;
}

export function voiceLimits() {
  return {
    maxChars: boundedNumber("AURA_TTS_MAX_CHARS", 1200, 80, 4000),
    maxCharsPerDay: boundedNumber("AURA_TTS_MAX_CHARS_PER_DAY", 60_000, 1000, 500_000),
    perMinute: boundedNumber("AURA_TTS_REQUESTS_PER_MINUTE", 30, 1, 240),
    bodyBytes: 16_000,
  };
}

export type SpeechFailure = { code: string; status: number; message: string };

function instructionsFor(locale: "fr" | "en") {
  return locale === "fr"
    ? "Voix d'analyste géopolitique professionnelle : ton posé, calme et sûr, débit régulier légèrement ralenti, articulation nette, prononciation française soignée des noms propres et des sigles. Aucune emphase théâtrale, aucune exagération émotionnelle."
    : "Professional geopolitical analyst voice: calm, composed and confident, steady measured pace, crisp articulation, careful pronunciation of proper nouns and acronyms. No theatrical emphasis, no emotional exaggeration.";
}

/** Texte nettoyé pour la synthèse : espaces normalisés, borné. */
export function cleanSpeechText(text: string, maxChars: number) {
  return text.replace(/\s+/g, " ").trim().slice(0, maxChars);
}

export async function synthesizeSpeech({
  text,
  voice,
  locale,
  signal,
}: {
  text: string;
  voice?: string;
  locale: "fr" | "en";
  /** Annulation par le client : l'appel OpenAI est interrompu. */
  signal?: AbortSignal;
}): Promise<{ body: ReadableStream<Uint8Array>; contentType: string } | { error: SpeechFailure }> {
  const key = (process.env.OPENAI_API_KEY ?? "").trim();
  if (!key || process.env.AURA_TTS_DISABLED === "1") {
    return { error: { code: "unconfigured", status: 503, message: "Synthèse vocale neurale non configurée (OPENAI_API_KEY)." } };
  }

  const limits = voiceLimits();
  const input = cleanSpeechText(text, limits.maxChars);
  if (input.length < 2) {
    return { error: { code: "empty", status: 400, message: "Texte à prononcer vide." } };
  }

  const model = voiceModel();
  const requested = (voice ?? "").trim().toLowerCase();
  const selected = KNOWN_VOICES.has(requested) ? requested : defaultVoice();
  const neural = model.startsWith("gpt-4o");

  const payload: Record<string, unknown> = {
    model,
    voice: selected,
    input,
    response_format: "mp3",
  };
  if (neural) payload.instructions = instructionsFor(locale);
  else payload.speed = 0.98;

  let response: Response;
  try {
    response = await fetch(SPEECH_URL, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${key}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(payload),
      signal: signal ? AbortSignal.any([signal, AbortSignal.timeout(45_000)]) : AbortSignal.timeout(45_000),
    });
  } catch {
    return { error: { code: "network", status: 502, message: "Service vocal OpenAI injoignable." } };
  }

  if (!response.ok || !response.body) {
    // Le détail d'OpenAI reste dans le journal serveur, jamais renvoyé au navigateur.
    const detail = (await response.text().catch(() => "")).slice(0, 200);
    console.warn("[voice] OpenAI", response.status, detail.replace(/\s+/g, " "));
    if (response.status === 401) {
      return { error: { code: "http_401", status: 502, message: "Clé OpenAI refusée pour la synthèse vocale." } };
    }
    if (response.status === 429) {
      return { error: { code: "http_429", status: 429, message: "Limite ou crédit OpenAI atteint pour la voix." } };
    }
    if (response.status === 400) {
      return { error: { code: "http_400", status: 502, message: "Requête vocale refusée (vérifier AURA_TTS_MODEL / AURA_TTS_VOICE)." } };
    }
    return { error: { code: `http_${response.status}`, status: 502, message: "Service vocal OpenAI indisponible." } };
  }

  return { body: response.body, contentType: "audio/mpeg" };
}
