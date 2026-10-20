import { createHash } from "node:crypto";
import type { EventEvidence, Signal } from "@/types/detection";
import { normalized, safeUrl, words } from "./normalize";

export const hash = (value: string) => createHash("sha256").update(value).digest("hex").slice(0, 32);

export function canonicalUrl(value: string | null): string | null {
  const safe = safeUrl(value);
  if (!safe) return null;
  const url = new URL(safe);
  url.hash = "";
  for (const key of [...url.searchParams.keys()]) {
    if (/^(utm_.+|fbclid|gclid|ref|source)$/i.test(key)) url.searchParams.delete(key);
  }
  url.searchParams.sort();
  return `${url.hostname.toLowerCase().replace(/^www\./, "")}${url.port ? `:${url.port}` : ""}${url.pathname.replace(/\/$/, "")}${url.search}`;
}

export function evidence(signal: Signal): EventEvidence {
  const url = safeUrl(signal.url);
  return { signal, canonicalUrl: canonicalUrl(url), domain: url ? new URL(url).hostname.toLowerCase().replace(/^www\./, "") : null,
    fingerprint: hash(normalized(`${signal.title} ${signal.text ?? ""}`)), independenceGroup: signal.id, dependenceReasons: [] };
}

const STOP = new Set("a an and at au aux avec by dans de des du en et for from in la le les near of on par pour pres reported reports said signalee signale signalent strong forte the to un une heard entendu entendue centre center central il est sur a ete plusieurs sources signalement".split(" "));
export function tokens(text: string): Set<string> {
  return new Set(words(text).filter((word) => word.length > 2 && !STOP.has(word)));
}

export function similarity(first: Set<string>, second: Set<string>): number {
  if (!first.size || !second.size) return 0;
  let common = 0;
  for (const word of first) if (second.has(word)) common++;
  return common / (first.size + second.size - common);
}

export function independence(items: EventEvidence[]): EventEvidence[] {
  const parents = items.map((_, index) => index);
  const reasons = items.map(() => new Set<string>());
  const root = (index: number): number => { while (parents[index] !== index) index = parents[index]; return index; };
  for (let first = 0; first < items.length; first++) {
    for (let second = first + 1; second < items.length; second++) {
      const left = items[first];
      const right = items[second];
      const links: string[] = [];
      if (left.signal.provider === right.signal.provider) links.push("same_provider");
      if (left.domain && right.domain && (left.domain === right.domain || left.domain.endsWith(`.${right.domain}`) || right.domain.endsWith(`.${left.domain}`))) links.push("same_domain");
      if (left.canonicalUrl && left.canonicalUrl === right.canonicalUrl) links.push("same_url");
      if (left.fingerprint === right.fingerprint) links.push("same_content");
      if (tokens(left.signal.title).size >= 5 && similarity(tokens(left.signal.title), tokens(right.signal.title)) >= 0.9) links.push("copied_title");
      if (left.signal.text && right.signal.text && tokens(left.signal.text).size >= 15 && similarity(tokens(left.signal.text), tokens(right.signal.text)) >= 0.85) links.push("near_identical_content");
      const leftAgency = left.signal.upstreamAgency ?? (left.domain && /(^|\.)reuters\.com$/.test(left.domain) ? "reuters" : left.domain && /(^|\.)apnews\.com$/.test(left.domain) ? "ap" : null);
      const rightAgency = right.signal.upstreamAgency ?? (right.domain && /(^|\.)reuters\.com$/.test(right.domain) ? "reuters" : right.domain && /(^|\.)apnews\.com$/.test(right.domain) ? "ap" : null);
      if (leftAgency && leftAgency === rightAgency) links.push("syndication");
      if (links.length) {
        parents[root(second)] = root(first);
        links.forEach((reason) => { reasons[first].add(reason); reasons[second].add(reason); });
      }
    }
  }
  return items.map((item, index) => ({ ...item, independenceGroup: items[root(index)].signal.id, dependenceReasons: [...reasons[index]].sort() }));
}
