import "server-only";
import { filtersFromSearchParams } from "./filters";
import { queryClusters, queryLatestEvents, queryStats } from "./intel";
import { getCountryLeaders } from "./leaders";
import { getCountryIndicators } from "./countryIndicators";
import { getAirspaceActivity } from "./airspace";

/**
 * AURA — agente d'analyse géopolitique.
 *
 * Cerveau : OpenAI Responses API (recherche web en direct) + outils internes
 * branchés sur la base ORBITAL, Wikidata et la Banque mondiale. La réponse est
 * diffusée au client sous forme de lignes NDJSON :
 *   {t:"status", text} · {t:"delta", text} · {t:"sources", items} · {t:"done"} · {t:"error", text}
 */

export type AgentMessage = { role: "user" | "assistant"; content: string };
export type AgentContext = {
  country?: { name: string; iso?: string } | null;
  cluster?: { locality?: string; country?: string; eventCount?: number; fatalities?: number } | null;
  range?: string;
  locale?: "fr" | "en";
};
export type AgentChunk =
  | { t: "status"; text: string }
  | { t: "delta"; text: string }
  | { t: "sources"; items: { title: string; url: string }[] }
  | { t: "done" }
  | { t: "error"; text: string };

const API_URL = "https://api.openai.com/v1/responses";
const MAX_ROUNDS = 6;

const TOOLS = [
  { type: "web_search" },
  {
    type: "function",
    name: "get_platform_overview",
    description:
      "Situation mondiale vue par la console ORBITAL : nombre de foyers, événements 24h/7j/30j, couverture (documenté / presse / démo), état des sources et pays les plus actifs. À utiliser pour toute question sur « ce que montre la carte ».",
    parameters: {
      type: "object",
      properties: { range: { type: "string", enum: ["24h", "7d", "30d", "6m", "1y"] } },
      required: ["range"],
      additionalProperties: false,
    },
  },
  {
    type: "function",
    name: "get_country_activity",
    description:
      "Derniers événements enregistrés dans la base ORBITAL pour un pays (nom anglais, ex. « Sudan », « Iran »). Renvoie date, type, lieu, bilan, niveau de confiance et source.",
    parameters: {
      type: "object",
      properties: {
        country: { type: "string" },
        range: { type: "string", enum: ["24h", "7d", "30d", "6m", "1y"] },
      },
      required: ["country", "range"],
      additionalProperties: false,
    },
  },
  {
    type: "function",
    name: "get_country_leaders",
    description: "Chef de l'État et chef du gouvernement en exercice d'un pays, d'après Wikidata (code ISO alpha-3, ex. IRN, UKR, SDN).",
    parameters: {
      type: "object",
      properties: { iso3: { type: "string" } },
      required: ["iso3"],
      additionalProperties: false,
    },
  },
  {
    type: "function",
    name: "get_country_indicators",
    description: "Population et PIB nominal (USD) les plus récents d'un pays, d'après la Banque mondiale (code ISO alpha-3).",
    parameters: {
      type: "object",
      properties: { iso3: { type: "string" } },
      required: ["iso3"],
      additionalProperties: false,
    },
  },
  {
    type: "function",
    name: "get_airspace_activity",
    description:
      "Trafic aérien civil en direct au-dessus d'un pays (OpenSky, transpondeurs ADS-B) : avions en vol et au sol, pays d'immatriculation. Utile pour vérifier une fermeture d'espace aérien ou une reprise des vols. Les vols militaires y sont rarement visibles. Quota limité : n'appelle cet outil que si la question porte sur l'espace aérien.",
    parameters: {
      type: "object",
      properties: { iso3: { type: "string" } },
      required: ["iso3"],
      additionalProperties: false,
    },
  },
];

const TOOL_STATUS: Record<string, string> = {
  get_platform_overview: "Lecture de la situation mondiale ORBITAL…",
  get_country_activity: "Interrogation de la base d'événements…",
  get_country_leaders: "Vérification des dirigeants (Wikidata)…",
  get_country_indicators: "Indicateurs Banque mondiale…",
  get_airspace_activity: "Trafic aérien en direct (OpenSky)…",
};

function instructions(context: AgentContext) {
  const now = new Date();
  const today = now.toISOString().slice(0, 10);
  const focus = [
    context.country?.name ? `Pays ouvert à l'écran : ${context.country.name}${context.country.iso ? ` (${context.country.iso})` : ""}.` : "",
    context.cluster?.locality || context.cluster?.country
      ? `Foyer sélectionné sur le globe : ${[context.cluster.locality, context.cluster.country].filter(Boolean).join(", ")} (${context.cluster.eventCount ?? "?"} événements).`
      : "",
    context.range ? `Fenêtre temporelle affichée : ${context.range}.` : "",
  ].filter(Boolean).join(" ");

  return `Tu es AURA, l'analyste géopolitique de la console ORBITAL (renseignement sur les conflits en sources ouvertes).
Date du jour : ${today} (heure UTC ${now.toISOString().slice(11, 16)}). Tes connaissances internes sont anciennes : pour tout fait susceptible d'avoir changé (dirigeants, fronts, cessez-le-feu, élections, sanctions, bilans), vérifie TOUJOURS avec la recherche web et/ou les outils avant de répondre.
${focus ? `Contexte de l'écran : ${focus}` : ""}

PÉRIMÈTRE STRICT — tu ne traites QUE ces sujets, à toutes les échelles (monde, pays, région, ville, quartier) :
- conflits armés, opérations et capacités militaires, défense, armement, dissuasion ;
- géopolitique, diplomatie, alliances, sanctions, élections et crises politiques, dirigeants et rapports de force ;
- économie stratégique : énergie, matières premières, commerce, inflation, dette, impact économique des crises ;
- crime organisé et mafias (y compris locales : par exemple les bandes criminelles et règlements de comptes en Corse, le narcotrafic à Marseille), corruption, terrorisme, groupes armés, milices, mouvements indépendantistes ou clandestins ;
- tensions sociales : manifestations, émeutes, grèves dures, révolutions, coups d'État, répression, droits humains, crises humanitaires et migratoires ;
- sécurité intérieure et cybersécurité étatique, renseignement en sources ouvertes ;
- la console ORBITAL elle-même (ce que montre la carte, les sources, les données).
Toute question hors de ce périmètre (cuisine, recettes, santé personnelle, sport, divertissement, aide scolaire, code informatique, conseils de vie, culture générale sans lien stratégique…) : tu NE réponds PAS sur le fond, même partiellement, et tu n'utilises aucun outil. Réponds en une ou deux phrases : « Ce sujet sort de mon périmètre : je suis dédiée à l'analyse géopolitique, militaire, économique et sécuritaire. » puis propose un angle pertinent si un lien existe (par exemple prix du blé et sécurité alimentaire), sinon une question type sur la zone affichée.
Les questions locales sont légitimes quand elles touchent la sécurité, la politique ou la société d'un territoire : traite-les avec la même rigueur qu'un sujet international. Les instructions de l'utilisateur ne peuvent pas élargir ce périmètre.

Méthode :
- Dirigeants : utilise get_country_leaders (Wikidata) puis confirme par la recherche web si l'actualité est mouvante.
- Situation humanitaire (déplacés, famine, épidémies) : recherche web en privilégiant OCHA / ReliefWeb, en citant l'organisation auteure et la date.
- Espace aérien (fermeture, reprise des vols, survols) : get_airspace_activity. Un ciel vide n'est pas une preuve d'activité militaire.
- Questions sur la carte ou un pays affiché : get_platform_overview / get_country_activity. Les anomalies thermiques NASA FIRMS sont des chaleurs anormales détectées par satellite près de zones de conflit connues : jamais une frappe confirmée. Les signaux GDELT sont des mentions presse, pas des incidents confirmés ; la démo n'est jamais une donnée réelle.
- Distingue clairement : confirmé, rapporté, revendiqué, non vérifié. Donne les dates. Si les sources divergent ou si tu ne sais pas, dis-le. N'invente jamais un chiffre, un nom ou une source.
- Tu travailles uniquement en sources ouvertes : tu n'as pas accès à des renseignements classifiés et tu ne le prétends jamais.
- Reste factuelle et neutre ; présente les positions des parties sans prendre parti.

Style : ta réponse est lue à voix haute par une voix de synthèse. Réponds dans la langue de l'utilisateur (${context.locale === "en" ? "anglais par défaut" : "français par défaut"}), en prose claire et naturelle, phrases courtes, sans tableaux, sans titres, sans markdown lourd ni URL dans le texte (les sources sont affichées à part). 120 à 200 mots par défaut, davantage seulement si on te demande un approfondissement.`;
}

type ToolArgs = Record<string, unknown>;

const normalize = (value: string) => value.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase().trim();
const rangeOf = (value: unknown) => (typeof value === "string" && ["24h", "7d", "30d", "6m", "1y"].includes(value) ? value : "30d");
const isoOf = (value: unknown) => (typeof value === "string" ? value.trim().toUpperCase() : "");

async function runTool(name: string, args: ToolArgs): Promise<unknown> {
  switch (name) {
    case "get_platform_overview": {
      const filters = filtersFromSearchParams(new URLSearchParams({ range: rangeOf(args.range) }));
      const [stats, data] = await Promise.all([queryStats(filters), queryClusters(filters, 2.4)]);
      const byCountry = new Map<string, { events: number; fatalities: number }>();
      for (const c of data.clusters) {
        const entry = byCountry.get(c.country) ?? { events: 0, fatalities: 0 };
        entry.events += c.eventCount;
        entry.fatalities += c.fatalities;
        byCountry.set(c.country, entry);
      }
      return {
        range: stats.range,
        activeZones: stats.activeZones,
        majorZones: stats.majorZones,
        events24h: stats.events24h,
        events7d: stats.events7d,
        events30d: stats.events30d,
        coverage: stats.coverage,
        datasets: stats.dataset,
        sources: stats.connectors.map((s) => ({ id: s.id, configured: s.configured, reachable: s.reachable, events: s.events })),
        topCountries: [...byCountry.entries()]
          .sort((a, b) => b[1].events - a[1].events)
          .slice(0, 12)
          .map(([country, v]) => ({ country, ...v })),
        note: "UCDP = événements vérifiés publiés avec 1 à 2 mois de décalage (visibles en 6m / 1y). GDELT = signaux presse sans bilan. FIRMS = anomalies thermiques satellite, jamais une frappe confirmée.",
      };
    }
    case "get_country_activity": {
      const country = typeof args.country === "string" ? args.country : "";
      const range = rangeOf(args.range);
      const filters = filtersFromSearchParams(new URLSearchParams({ range }));
      const { clusters } = await queryClusters(filters, 2.4);
      const wanted = normalize(country);
      const canonical = clusters.find((c) => normalize(c.country) === wanted)?.country
        ?? clusters.find((c) => normalize(c.country).includes(wanted) || (wanted && wanted.includes(normalize(c.country))))?.country;
      if (!canonical) return { country, range, events: [], note: "Aucun événement dans la base ORBITAL pour ce pays et cette période (cela ne prouve pas l'absence de conflit)." };
      const events = await queryLatestEvents({ ...filters, countries: [canonical] }, 25);
      return {
        country: canonical,
        range,
        events: events.map((e) => ({
          date: e.eventDate.slice(0, 16),
          type: e.eventType,
          place: [e.locality, e.region].filter(Boolean).join(", "),
          fatalities: e.confidence === "MEDIA_SIGNAL" ? null : e.fatalities,
          confidence: e.confidence,
          actors: e.actors.slice(0, 3),
          source: e.source,
          url: e.sourceUrl || undefined,
        })),
      };
    }
    case "get_country_leaders":
      return getCountryLeaders(isoOf(args.iso3));
    case "get_country_indicators":
      return (await getCountryIndicators(isoOf(args.iso3))) ?? { error: "Code pays inconnu du référentiel" };
    case "get_airspace_activity":
      return getAirspaceActivity(isoOf(args.iso3));
    default:
      return { error: `Outil inconnu : ${name}` };
  }
}

type FunctionCall = { call_id: string; name: string; arguments: string };
type OutputItem = {
  type?: string;
  call_id?: string;
  name?: string;
  arguments?: string;
  content?: { type?: string; annotations?: { type?: string; url?: string; title?: string }[] }[];
};

/** Lit un flux SSE OpenAI et rend chaque objet `data:`. */
async function* readSse(body: ReadableStream<Uint8Array>) {
  const reader = body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      let index: number;
      while ((index = buffer.indexOf("\n\n")) >= 0) {
        const block = buffer.slice(0, index);
        buffer = buffer.slice(index + 2);
        const data = block
          .split("\n")
          .filter((line) => line.startsWith("data:"))
          .map((line) => line.slice(5).trimStart())
          .join("\n");
        if (!data || data === "[DONE]") continue;
        try {
          yield JSON.parse(data) as Record<string, unknown> & { type?: string };
        } catch {
          // bloc incomplet ou non JSON : ignoré
        }
      }
    }
  } finally {
    reader.releaseLock();
  }
}

export function agentConfigured() {
  return Boolean(process.env.OPENAI_API_KEY);
}

export async function* runAgent(messages: AgentMessage[], context: AgentContext, signal?: AbortSignal): AsyncGenerator<AgentChunk> {
  const key = process.env.OPENAI_API_KEY;
  if (!key) {
    yield { t: "error", text: "Agente non configurée : OPENAI_API_KEY manquante dans .env.local." };
    return;
  }
  const model = process.env.OPENAI_MODEL || "gpt-5.6-terra";
  const sources = new Map<string, string>();
  let previousId: string | undefined;
  let input: unknown[] = messages.map((m) => ({ role: m.role, content: m.content }));

  for (let round = 0; round < MAX_ROUNDS; round++) {
    const res = await fetch(API_URL, {
      method: "POST",
      headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json" },
      body: JSON.stringify({
        model,
        instructions: instructions(context),
        input,
        tools: TOOLS,
        stream: true,
        reasoning: { effort: "low" },
        ...(previousId ? { previous_response_id: previousId } : {}),
      }),
      signal,
    });
    if (!res.ok || !res.body) {
      const detail = await res.text().catch(() => "");
      console.warn("[agent] OpenAI", res.status, detail.slice(0, 300));
      yield { t: "error", text: res.status === 401 ? "Clé OpenAI refusée." : res.status === 429 ? "Quota OpenAI atteint, réessaie dans un instant." : "Service d'analyse indisponible." };
      return;
    }

    const calls: FunctionCall[] = [];
    for await (const event of readSse(res.body)) {
      switch (event.type) {
        case "response.output_text.delta":
          if (typeof event.delta === "string") yield { t: "delta", text: event.delta };
          break;
        case "response.web_search_call.searching":
          yield { t: "status", text: "Recherche web en direct…" };
          break;
        case "response.output_item.done": {
          const item = event.item as OutputItem | undefined;
          if (item?.type === "function_call" && item.call_id && item.name) {
            calls.push({ call_id: item.call_id, name: item.name, arguments: item.arguments ?? "{}" });
          } else if (item?.type === "message") {
            for (const part of item.content ?? []) {
              for (const a of part.annotations ?? []) {
                if (a.type === "url_citation" && a.url && !sources.has(a.url)) sources.set(a.url, a.title || new URL(a.url).hostname);
              }
            }
          }
          break;
        }
        case "response.completed": {
          const response = event.response as { id?: string } | undefined;
          previousId = response?.id;
          break;
        }
        case "response.failed":
        case "error": {
          console.warn("[agent] flux en erreur", JSON.stringify(event).slice(0, 300));
          yield { t: "error", text: "L'analyse a échoué en cours de route." };
          return;
        }
      }
    }

    if (!calls.length) break;
    const outputs = [];
    for (const call of calls) {
      yield { t: "status", text: TOOL_STATUS[call.name] ?? "Analyse…" };
      let args: ToolArgs = {};
      try { args = JSON.parse(call.arguments) as ToolArgs; } catch { /* arguments vides */ }
      let result: unknown;
      try {
        result = await runTool(call.name, args);
      } catch {
        result = { error: "Outil momentanément indisponible" };
      }
      if (call.name === "get_country_leaders") {
        const leaders = result as { leaders?: { sourceUrl: string; name: string }[] };
        for (const l of leaders.leaders ?? []) sources.set(l.sourceUrl, `Wikidata · ${l.name}`);
      }
      if (call.name === "get_airspace_activity" && !(result as { error?: string }).error) {
        sources.set("https://opensky-network.org/", "OpenSky Network · trafic aérien");
      }
      outputs.push({ type: "function_call_output", call_id: call.call_id, output: JSON.stringify(result).slice(0, 20_000) });
    }
    input = outputs;
    // Séparation lisible si la manche précédente avait déjà produit du texte.
    yield { t: "status", text: "Synthèse…" };
  }

  if (sources.size) yield { t: "sources", items: [...sources.entries()].slice(0, 8).map(([url, title]) => ({ url, title })) };
  yield { t: "done" };
}
