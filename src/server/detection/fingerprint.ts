import { createHash } from "node:crypto";
import type { EventEvidence, Signal } from "@/types/detection";
import { normalized, safeUrl, words } from "./normalize";
import { tokenizeText } from "./language/tokenizer";
import { jaccardSimilarity } from "./similarity/textSimilarity";

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
  return {
    signal,
    canonicalUrl: canonicalUrl(url),
    domain: url ? new URL(url).hostname.toLowerCase().replace(/^www\./, "") : null,
    fingerprint: hash(normalized(`${signal.title} ${signal.text ?? ""}`)),
    independenceGroup: signal.id,
    dependenceReasons: [],
  };
}

export function tokens(text: string): Set<string> {
  return new Set(tokenizeText(words(text).join(" ")));
}

export function similarity(first: Set<string>, second: Set<string>): number {
  return jaccardSimilarity(first, second);
}

export function independence(items: EventEvidence[]): EventEvidence[] {
  const parents = items.map((_, index) => index);
  const reasons = items.map(() => new Set<string>());
  const root = (index: number): number => {
    while (parents[index] !== index) index = parents[index];
    return index;
  };

  // Pre-calculate tokens once per item to avoid O(N^2) repeated tokenization
  const titleTokens = items.map((item) => tokens(item.signal.title));
  const textTokens = items.map((item) => (item.signal.text ? tokens(item.signal.text) : null));

  for (let first = 0; first < items.length; first++) {
    const left = items[first];
    const leftTitle = titleTokens[first];
    const leftText = textTokens[first];

    for (let second = first + 1; second < items.length; second++) {
      const right = items[second];
      const links: string[] = [];
      if (left.signal.provider === right.signal.provider) links.push("same_provider");
      if (left.domain && right.domain && (left.domain === right.domain || left.domain.endsWith(`.${right.domain}`) || right.domain.endsWith(`.${left.domain}`))) {
        links.push("same_domain");
      }
      if (left.canonicalUrl && left.canonicalUrl === right.canonicalUrl) links.push("same_url");
      if (left.fingerprint === right.fingerprint) links.push("same_content");
      const rightTitle = titleTokens[second];
      const rightText = textTokens[second];
      if (leftTitle.size >= 5 && similarity(leftTitle, rightTitle) >= 0.9) {
        links.push("copied_title");
      }
      if (leftText && rightText && leftText.size >= 15 && similarity(leftText, rightText) >= 0.85) {
        links.push("near_identical_content");
      }
      const leftAgency = left.signal.upstreamAgency ?? (left.domain && /(^|\.)reuters\.com$/.test(left.domain) ? "reuters" : left.domain && /(^|\.)apnews\.com$/.test(left.domain) ? "ap" : null);
      const rightAgency = right.signal.upstreamAgency ?? (right.domain && /(^|\.)reuters\.com$/.test(right.domain) ? "reuters" : right.domain && /(^|\.)apnews\.com$/.test(right.domain) ? "ap" : null);
      if (leftAgency && leftAgency === rightAgency) links.push("syndication");
      if (links.length) {
        parents[root(second)] = root(first);
        links.forEach((reason) => {
          reasons[first].add(reason);
          reasons[second].add(reason);
        });
      }
    }
  }
  return items.map((item, index) => ({
    ...item,
    independenceGroup: items[root(index)].signal.id,
    dependenceReasons: [...reasons[index]].sort(),
  }));
}
