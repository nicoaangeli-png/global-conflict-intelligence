import "server-only";
import { CASUALTY_WORDS } from "./collect";
import {
  CHAPTER_KEYS,
  CHAPTER_TITLES,
  emptyChapterText,
  type BriefingChapter,
  type BriefingFact,
  type BriefingSentence,
  type ChapterKey,
} from "./types";

const API_URL = "https://api.openai.com/v1/responses";
const DEFAULT_MODEL = "gpt-5.6-terra"; // même défaut qu'AURA (src/server/agent.ts)
const TIMEOUT_MS = 90_000;
const MAX_SENTENCES_PER_CHAPTER = 12;

export interface WriteDeps {
  fetch?: typeof fetch;
  apiKey?: string | undefined;
  model?: string | undefined;
}

export type WindowHours = Record<ChapterKey, number>;

export interface Written {
  chapters: BriefingChapter[];
  status: "ok" | "degraded";
  reason: string | null;
}

export const focusOf = (facts: BriefingFact[]): { lat: number; lon: number } | null => {
  const f = facts.find((x) => x.lat !== null && x.lon !== null && Math.abs(x.lat) <= 90 && Math.abs(x.lon) <= 180);
  return f ? { lat: f.lat as number, lon: f.lon as number } : null;
};

/** Texte lisible à voix haute : ni URL, ni markdown, espaces normalisés. null = phrase à retirer (URL résiduelle). */
export function cleanSentence(raw: string): string | null {
  if (/https?:\/\/|www\.|\b[a-z0-9-]+\.(?:com|org|net|int|gov|fr|io)\b/i.test(raw)) return null;
  const text = raw
    .replace(/[*_`#>~|[\]]/g, "")
    .replace(/\s+/g, " ")
    .trim();
  return text.length >= 3 ? text : null;
}

const upperFirst = (t: string) => t.charAt(0).toUpperCase() + t.slice(1);
/** Minuscule initiale sauf sigle ou nom propre en capitales (« ONU », « USGS »). */
const lowerFirst = (t: string) => (/^[A-ZÀ-Ý][a-zà-ÿ]/.test(t) ? t.charAt(0).toLowerCase() + t.slice(1) : t);

/** La phrase date-t-elle explicitement le fait (jour de la semaine ou « 16 octobre ») ? */
function mentionsDate(text: string, dateLabel: string): boolean {
  const [weekday, day, month] = dateLabel.toLowerCase().split(" ");
  const lower = text.toLowerCase();
  return lower.includes(weekday) || lower.includes(`${day} ${month}`) || (day === "1" && lower.includes(`1er ${month}`));
}

/** Au-delà de cette variation (en %), une cotation non officielle est signalée comme non recoupée. */
export const EXTREME_MARKET_MOVE_PCT = 7;

/**
 * Impose les mentions obligatoires : date explicite quand la fenêtre est élargie,
 * source non officielle nommée (« selon Yahoo Finance, source non officielle »).
 */
export function enforceMentions(text: string, cited: BriefingFact[], windowHours: number): string {
  let out = text;
  const unofficial = cited.find((f) => f.unofficialSource);
  if (unofficial && !/non officielle/i.test(out)) {
    const name = unofficial.unofficialSource as string;
    out = new RegExp(name, "i").test(out) ? `${out.replace(/[.!?]+$/, "")} (source non officielle).` : `${out.replace(/[.!?]+$/, "")}, selon ${name}, source non officielle.`;
  }
  // Variation de marché exceptionnelle tirée d'une source non officielle : le dire, car elle n'est pas recoupée.
  const extreme = cited.find((f) => f.unofficialSource && f.metric && Math.abs(f.metric.value) >= EXTREME_MARKET_MOVE_PCT);
  if (extreme && !/non recoup/i.test(out)) out = `${out.replace(/[.!?]+$/, "")}. Variation exceptionnelle, non recoupée par une seconde source.`;
  // Fenêtre élargie ou événement planifié (lancement) : la phrase doit donner le jour.
  const dated = cited.find((f) => f.dateLabel && (windowHours > 24 || f.nature === "scheduled_event"));
  if (dated?.dateLabel && !mentionsDate(out, dated.dateLabel)) out = `${upperFirst(dated.dateLabel)}, ${lowerFirst(out)}`;
  return out;
}

/** Retire toute phrase sans factId valide, avec URL/markdown, ou portant un bilan humain tiré d'un fait non structuré. */
export function validateSentences(raw: unknown, facts: BriefingFact[], windowHours = 24): BriefingSentence[] {
  if (!Array.isArray(raw)) return [];
  const byId = new Map(facts.map((f) => [f.id, f]));
  const out: BriefingSentence[] = [];
  for (const s of raw as { text?: unknown; factIds?: unknown }[]) {
    if (typeof s?.text !== "string" || !Array.isArray(s.factIds)) continue;
    const ids = [...new Set(s.factIds.filter((id): id is string => typeof id === "string" && byId.has(id)))];
    if (!ids.length) continue;
    const text = cleanSentence(s.text);
    if (!text) continue;
    // Les nombres sont souvent écrits en lettres à l'oral : tout vocabulaire de victimes est refusé hors source structurée.
    if (CASUALTY_WORDS.test(text) && ids.some((id) => !byId.get(id)?.casualtiesAllowed)) continue;
    out.push({ text: enforceMentions(text, ids.map((id) => byId.get(id) as BriefingFact), windowHours), factIds: ids });
    if (out.length >= MAX_SENTENCES_PER_CHAPTER) break;
  }
  return out;
}

const NATURE_FR: Record<string, string> = {
  press_article: "d'après la presse, non confirmé",
  scheduled_event: "événement prévu",
};

/** Gabarit factuel sans IA : un fait = une phrase, source nommée, date si la fenêtre est élargie. */
export function templateSentences(facts: BriefingFact[], windowHours = 24, limit = 4): BriefingSentence[] {
  const out: BriefingSentence[] = [];
  for (const f of facts.slice(0, limit)) {
    const src = f.sources.find((x) => x.official) ?? f.sources[0];
    const press = f.nature === "press_article";
    const base = cleanSentence(f.title.replace(/[.!?]+$/, ""));
    if (!base || (!f.casualtiesAllowed && CASUALTY_WORDS.test(base))) continue; // pas de bilan humain hors source structurée
    const metric = f.metric ? ` (${f.metric.label} : ${f.metric.value}${f.metric.unit ? ` ${f.metric.unit}` : ""})` : "";
    const toll = f.casualtiesAllowed && f.fatalities ? `, ${f.fatalities} morts selon la source` : "";
    const lead = press ? `Selon ${f.independentSources} médias, non confirmé : ` : "";
    const who = press ? "" : f.unofficialSource ? ` Source : ${f.unofficialSource}, source non officielle.` : ` Source : ${src?.name ?? "inconnue"}${f.nature === "scheduled_event" ? ", événement prévu" : ""}.`;
    const text = cleanSentence(`${lead}${base}${metric}${toll}.${who}`);
    if (text) out.push({ text: enforceMentions(text, [f], windowHours), factIds: [f.id] });
  }
  return out;
}

function buildChapter(key: ChapterKey, facts: BriefingFact[], sentences: BriefingSentence[], writer: "ai" | "template", windowHours: number): BriefingChapter {
  if (!facts.length) {
    return { key, title: CHAPTER_TITLES[key], spokenText: emptyChapterText(windowHours), sentences: [], facts: [], windowHours, focus: null, writer: "empty" };
  }
  return { key, title: CHAPTER_TITLES[key], spokenText: sentences.map((x) => x.text).join(" "), sentences, facts, windowHours, focus: focusOf(facts), writer };
}

/** Repli complet sans IA. */
export function templateChapters(facts: Record<ChapterKey, BriefingFact[]>, windows: WindowHours): BriefingChapter[] {
  return CHAPTER_KEYS.map((k) => buildChapter(k, facts[k], templateSentences(facts[k], windows[k]), "template", windows[k]));
}

const SCHEMA = {
  type: "object",
  additionalProperties: false,
  required: ["chapters"],
  properties: {
    chapters: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        required: ["key", "sentences"],
        properties: {
          key: { type: "string", enum: [...CHAPTER_KEYS] },
          sentences: {
            type: "array",
            items: {
              type: "object",
              additionalProperties: false,
              required: ["text", "factIds"],
              properties: { text: { type: "string" }, factIds: { type: "array", items: { type: "string" } } },
            },
          },
        },
      },
    },
  },
} as const;

const INSTRUCTIONS = `Tu rédiges le bilan vocal quotidien de l'actualité mondiale, lu à voix haute par l'assistant AURA.
Tu disposes UNIQUEMENT des faits fournis en JSON (par chapitre). Tu n'utilises aucune autre connaissance, aucune recherche, aucune supposition.
Règles :
- Français, phrases courtes (20 mots maximum), naturelles à l'oral. Sois précis : lieu, acteurs, objet, tels qu'ils figurent dans les faits.
- Aucune URL, aucun markdown, aucun symbole, aucune liste. Écris les nombres et unités de façon lisible.
- Chaque phrase décrit un ou plusieurs faits et porte leurs identifiants dans factIds (ids exacts fournis).
- Nomme la source oralement quand elle compte (« selon l'ONU », « d'après l'USGS »).
- Fait de nature press_article (champ headlines) : c'est une histoire rapportée par plusieurs médias. Écris « Selon plusieurs médias, … » et n'affirme pas comme confirmé. Tu peux traduire fidèlement les titres mais n'ajoute RIEN qui ne soit dans les titres : ni cause, ni chiffre, ni contexte, ni nom. Si les titres sont trop vagues pour une phrase précise, n'écris pas de phrase pour ce fait.
- Si casualtiesAllowed est faux, n'écris aucun chiffre de morts, blessés, disparus ou victimes, même si le texte du fait en contient.
- Fait de nature scheduled_event (lancement) : c'est un événement prévu, dis-le au futur ou « prévu » et donne le jour (dateLabel).
- Si windowHours du chapitre dépasse 24, le fait n'est pas d'aujourd'hui : commence la phrase par sa date en toutes lettres (champ dateLabel, par exemple « Vendredi 16 octobre, … »).
- Si unofficialSource est renseigné (cotation de bourse), dis « selon Yahoo Finance, source non officielle » (ou équivalent) et date la séance : « à la clôture de vendredi » si la date est passée. Donne le nom de l'indice et la variation en pourcentage, rien d'autre. Ne répète pas deux fois la date dans la même phrase.
- N'invente rien : ni cause, ni date, ni lieu absents des faits.
- Un chapitre sans fait reste avec une liste de phrases vide.
- Ne dépasse pas 6 phrases par chapitre ; privilégie les faits les plus graves, puis ceux rapportés par le plus de sources (independentSources).`;

function factsForModel(facts: Record<ChapterKey, BriefingFact[]>, windows: WindowHours) {
  return CHAPTER_KEYS.map((key) => ({
    key,
    title: CHAPTER_TITLES[key],
    windowHours: windows[key],
    facts: facts[key].map((f) => ({
      id: f.id,
      title: f.title,
      headlines: f.headlines,
      summary: f.nature === "press_article" ? null : f.summary,
      severity: f.severity,
      nature: f.nature,
      occurredAt: f.occurredAt,
      dateLabel: f.dateLabel,
      countries: f.countries,
      metric: f.metric,
      fatalities: f.casualtiesAllowed ? f.fatalities : null,
      casualtiesAllowed: f.casualtiesAllowed,
      independentSources: f.independentSources,
      unofficialSource: f.unofficialSource,
      sources: f.sources.map((x) => x.name),
    })),
  }));
}

function extractText(body: unknown): string | null {
  const b = body as { status?: string; output_text?: unknown; output?: { type?: string; content?: { type?: string; text?: string }[] }[] };
  if (b?.status && b.status !== "completed") throw new Error(`réponse ${b.status}`);
  if (typeof b?.output_text === "string") return b.output_text;
  for (const item of b?.output ?? []) {
    if (item.type !== "message") continue;
    for (const part of item.content ?? []) if (part.type === "output_text" && typeof part.text === "string") return part.text;
  }
  return null;
}

/** Rédige les 8 chapitres. Ne lève jamais : retombe sur le gabarit factuel avec status "degraded". */
export async function writeChapters(facts: Record<ChapterKey, BriefingFact[]>, windows: WindowHours, deps: WriteDeps = {}): Promise<Written> {
  const apiKey = "apiKey" in deps ? deps.apiKey : process.env.OPENAI_API_KEY;
  if (!CHAPTER_KEYS.some((k) => facts[k].length)) {
    return { chapters: templateChapters(facts, windows), status: "ok", reason: null };
  }
  if (!apiKey) return { chapters: templateChapters(facts, windows), status: "degraded", reason: "Clé OpenAI absente : texte de repli sans IA." };

  const requested = "model" in deps ? deps.model : process.env.OPENAI_MODEL;
  const model = requested && /^[\w.:-]{1,64}$/.test(requested) ? requested : DEFAULT_MODEL;
  try {
    const response = await (deps.fetch ?? fetch)(API_URL, {
      method: "POST",
      headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
      body: JSON.stringify({
        model,
        instructions: INSTRUCTIONS,
        input: JSON.stringify({ chapters: factsForModel(facts, windows) }),
        max_output_tokens: 6000,
        reasoning: { effort: "low" },
        store: false,
        text: { format: { type: "json_schema", name: "bilan_du_jour", strict: true, schema: SCHEMA } },
      }),
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    const text = extractText(await response.json());
    if (!text) throw new Error("réponse vide");
    const parsed = JSON.parse(text) as { chapters?: { key?: string; sentences?: unknown }[] };
    if (!Array.isArray(parsed.chapters)) throw new Error("schéma invalide");

    let fallbacks = 0;
    const chapters = CHAPTER_KEYS.map((key) => {
      if (!facts[key].length) return buildChapter(key, [], [], "ai", windows[key]);
      const entry = parsed.chapters?.find((c) => c.key === key);
      const sentences = validateSentences(entry?.sentences, facts[key], windows[key]);
      if (!sentences.length) {
        fallbacks++;
        return buildChapter(key, facts[key], templateSentences(facts[key], windows[key]), "template", windows[key]);
      }
      return buildChapter(key, facts[key], sentences, "ai", windows[key]);
    });
    return {
      chapters,
      status: fallbacks ? "degraded" : "ok",
      reason: fallbacks ? `${fallbacks} chapitre(s) sans phrase sourcée valide : gabarit factuel utilisé.` : null,
    };
  } catch (error) {
    const why = error instanceof Error ? error.message.replace(/[^\w .:%()-]/g, "").slice(0, 80) : "erreur";
    return { chapters: templateChapters(facts, windows), status: "degraded", reason: `Rédaction IA indisponible (${why}) : texte de repli sans IA.` };
  }
}
