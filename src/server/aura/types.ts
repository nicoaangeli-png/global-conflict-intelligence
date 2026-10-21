import "server-only";

/**
 * Contrats d'AURA : messages, contexte de l'écran et lignes NDJSON envoyées au client.
 * Le flux se termine par EXACTEMENT un état : done, incomplete ou error.
 */

export type AgentMessage = { role: "user" | "assistant"; content: string };
export type AgentCountry = { name: string; iso3?: string };
export type AgentContext = {
  country?: AgentCountry | null;
  cluster?: { locality?: string; country?: string; countryIso3?: string; eventCount?: number } | null;
  range?: string;
  locale?: "fr" | "en";
};
export type CitationSpan = { start: number; end: number; url: string; title: string };
export type ProvenanceItem = {
  kind: "tool" | "web_search";
  label: string;
  source: string;
  status: "ok" | "empty" | "unavailable" | "error";
  retrievedAt: string;
  detail?: string;
  url?: string;
};
export type AgentChunk =
  | { t: "status"; text: string }
  | { t: "delta"; text: string }
  | { t: "citations"; spans: CitationSpan[] }
  | { t: "sources"; items: { title: string; url: string }[] }
  | { t: "provenance"; items: ProvenanceItem[] }
  | { t: "done" }
  | { t: "incomplete"; reason: string; text: string }
  | { t: "error"; text: string; code: string };
