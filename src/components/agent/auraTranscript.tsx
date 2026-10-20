import { Fragment, type ReactNode } from "react";

/**
 * Conversation AURA côté client : types des tours, rendu d'une réponse (citations
 * numérotées, liens nettoyés, provenance) et historique renvoyé au serveur.
 * Sans état React : testable par rendu statique.
 */

export type Source = { title: string; url: string };
export type Citation = { start: number; end: number; url: string; title: string };
export type Provenance = {
  kind: "tool" | "web_search";
  label: string;
  source: string;
  status: "ok" | "empty" | "unavailable" | "error";
  retrievedAt: string;
  detail?: string;
  url?: string;
};
export type TurnStatus = "streaming" | "complete" | "incomplete" | "interrupted" | "error";
export type Turn = {
  id: number;
  role: "user" | "assistant";
  content: string;
  status?: TurnStatus;
  notice?: string;
  sources?: Source[];
  citations?: Citation[];
  provenance?: Provenance[];
};
export type Limits = { maxMessages: number; maxUserChars: number; maxAssistantChars: number; maxTotalChars: number };
export type StreamChunk = {
  t: string;
  text?: string;
  items?: unknown[];
  spans?: Citation[];
};

export const DEFAULT_LIMITS: Limits = { maxMessages: 12, maxUserChars: 2000, maxAssistantChars: 12_000, maxTotalChars: 24_000 };

function cleanSegment(text: string) {
  return text
    .replace(/\(\s*\[[^\]]*\]\([^)]*\)\s*\)/g, "")
    .replace(/\[([^\]]+)\]\([^)]*\)/g, "$1")
    .replace(/\*\*([^*]+)\*\*/g, "$1")
    .replace(/^#+\s*/gm, "")
    .replace(/[ \t]+\n/g, "\n");
}

export function cleanUrl(url: string) {
  try {
    const parsed = new URL(url);
    if (parsed.searchParams.get("utm_source") === "openai") parsed.searchParams.delete("utm_source");
    return parsed.toString();
  } catch {
    return url;
  }
}

export function safeHref(url: string) {
  try {
    const parsed = new URL(url);
    return parsed.protocol === "https:" || parsed.protocol === "http:" ? parsed.toString() : null;
  } catch {
    return null;
  }
}

export const host = (url: string) => {
  try {
    return new URL(url).hostname.replace(/^www\./, "");
  } catch {
    return url;
  }
};

export function citationNumbering(turn: Turn) {
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

export function ProvenanceList({ items, fr }: { items: Provenance[]; fr: boolean }) {
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
