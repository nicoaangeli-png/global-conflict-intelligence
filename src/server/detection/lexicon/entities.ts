/**
 * International press agencies and syndication detection.
 * Identifies upstream press agencies across multiple scripts to prevent
 * false independence when multiple outlets republish the same wire dispatch.
 */

import { cleanUnicode } from "../language/unicode";

export type KnownAgency =
  | "reuters"
  | "ap"
  | "afp"
  | "tass"
  | "xinhua"
  | "anadolu"
  | "ukrinform";

interface AgencyPattern {
  id: KnownAgency;
  patterns: RegExp[];
}

const AGENCIES: AgencyPattern[] = [
  {
    id: "reuters",
    patterns: [
      /\b(reuters|ройтерс|ройтерз)\b/i,
      /(رویترز|رويترز|רויטרס|路透社|ロイター|로이터)/i,
    ],
  },
  {
    id: "ap",
    patterns: [
      /\b(associated\s+press|ap\s+news)\b/i,
      /\b(ассошиэйтед\s+пресс)\b/i,
      /(اسوشيتد\s+برس|איי\.פי|美联社|AP通信|AP통신)/i,
      /(?:\b|\()(AP)(?:\b|\))/i,
    ],
  },
  {
    id: "afp",
    patterns: [
      /\b(agence\s+france[- ]presse)\b/i,
      /(فرانس\s+برس|אפ"?פ|法新社|AFP通信)/i,
      /(?:\b|\()(AFP)(?:\b|\))/i,
    ],
  },
  {
    id: "tass",
    patterns: [
      /\b(tass)\b/i,
      /\b(тасс)\b/i,
      /(تاس|塔斯社)/i,
    ],
  },
  {
    id: "xinhua",
    patterns: [
      /\b(xinhua)\b/i,
      /\b(синьхуа)\b/i,
      /(شينخوا|新华社)/i,
    ],
  },
  {
    id: "anadolu",
    patterns: [
      /\b(anadolu|anadolu\s+agency)\b/i,
      /\b(анадолу)\b/i,
      /(الاناضول|الأناضول)/i,
    ],
  },
  {
    id: "ukrinform",
    patterns: [
      /\b(ukrinform)\b/i,
      /\b(укрінформ|укринформ)\b/i,
    ],
  },
];

const ATTRIBUTION_PREFIX = /(?:via|source|copyright|©|by|par|according to|selon|по данным|сообщает|сводка|نقلا عن|وفقا لـ|据|citat|alıntı)\s*[:—\-]?\s*|\(/i;

/**
 * Detects upstream press agency in title, text, or source description.
 */
export function detectUpstreamAgency(text: string): string | null {
  if (!text) return null;
  const cleaned = cleanUnicode(text);

  // Check attribution context first
  for (const agency of AGENCIES) {
    for (const pat of agency.patterns) {
      if (pat.test(cleaned)) {
        // If agency name appears in attribution context or matches directly
        if (ATTRIBUTION_PREFIX.test(cleaned) || pat.test(text)) {
          return agency.id;
        }
      }
    }
  }

  return null;
}
