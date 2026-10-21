import type { ConfidenceBreakdown, DetectionStatus, EventEvidence } from "@/types/detection";
import { distanceKm, reliablePosition, signalTime } from "./cluster";
import { normalized } from "./normalize";
import { similarity, tokens } from "./fingerprint";

export function contradictions(evidence: EventEvidence[]): string[] {
  const texts = evidence.map((item) => normalized(`${item.signal.title} ${item.signal.text ?? ""}`));
  const missile = texts.some((text) => /\b(missile|airstrike|bombardement)\b/.test(text));
  const industrial = texts.some((text) => /\b(industrial|industrielle?|factory|usine|gas leak|fuite de gaz)\b/.test(text));
  const denied = texts.some((text) => /\b(denies|denied|dement|dementi|false report|fausse alerte|no explosion|pas d explosion)\b/.test(text));
  return [...(missile && industrial ? ["Nature exacte incertaine : les descriptions mentionnent une arme et une origine industrielle."] : []),
    ...(denied ? ["Un démenti ou une négation figure dans les preuves ; clarification nécessaire."] : [])];
}

export function confidence(evidence: EventEvidence[], now: number, conflicts: string[], truncated: boolean): ConfidenceBreakdown {
  const groups = new Map<string, EventEvidence[]>();
  evidence.forEach((item) => groups.set(item.independenceGroup, [...(groups.get(item.independenceGroup) ?? []), item]));
  const representatives = [...groups.values()].map((items) => items.reduce((best, item) => quality(item) > quality(best) ? item : best));
  const independent = groups.size;
  const official = evidence.some((item) => item.signal.confirmsOccurrence && ["official", "sensor"].includes(item.signal.nature));
  const structured = representatives.some((item) => item.signal.nature === "structured");
  const sensor = representatives.some((item) => item.signal.nature === "sensor");
  const knownTimes = representatives.map((item) => signalTime(item.signal)).filter((time): time is number => time !== null);
  const sourceTime = knownTimes.length ? Math.max(...knownTimes) : null;
  const age = sourceTime === null ? Infinity : Math.max(0, now - sourceTime);
  const coherentTime = knownTimes.length === representatives.length && Math.max(...knownTimes) - Math.min(...knownTimes) <= 45 * 60_000;
  const positioned = representatives.filter((item) => reliablePosition(item.signal.position));
  const coherentGeo = positioned.length === representatives.length && positioned.every((item) => distanceKm(positioned[0].signal.position!, item.signal.position!) <= 25);
  const agreement = representatives.length > 1 && representatives.every((item) => similarity(tokens(item.signal.title), tokens(representatives[0].signal.title)) >= 0.28);
  const factors: ConfidenceBreakdown["factors"] = [];
  const add = (code: string, points: number, detail: string) => factors.push({ code, points, detail });
  add("independence", Math.min(48, independent * 12), `${independent} groupe(s) de provenance distincte après déduplication prudente.`);
  add("quality", official ? 18 : structured ? 12 : representatives.some((item) => item.signal.nature === "official") ? 10 : 6, "Qualité liée à la nature documentée de la source, pas à sa popularité.");
  if (sensor) add("sensor", 12, "Mesure instrumentale ; confirme uniquement la grandeur observée.");
  if (structured) add("structured", 8, "Incident codé dans un jeu structuré ; pas une nouvelle confirmation indépendante.");
  add("time", coherentTime ? 8 : -8, coherentTime ? "Dates de source compatibles dans une fenêtre de 45 minutes." : "Date de source inconnue ou incohérente.");
  add("geography", coherentGeo ? 8 : -8, coherentGeo ? "Positions point/ville cohérentes ; précision limitée à celle des sources." : "Géolocalisation précise non établie pour toutes les preuves.");
  add("description", official || agreement ? 8 : 0, "Concordance lexicale des descriptions ; aucune causalité déduite.");
  add("recency", age <= 30 * 60_000 ? 6 : age <= 2 * 3_600_000 ? 2 : age <= 6 * 3_600_000 ? -4 : -12, "Récence fondée sur les dates de source, jamais sur un nouveau téléchargement.");
  if (!official) add("no_official_confirmation", -6, "Aucune confirmation officielle explicite de l'occurrence dans les preuves.");
  if (conflicts.length) add("contradictions", -Math.min(40, conflicts.length * 20), conflicts.join(" "));
  const raw = Math.max(0, Math.min(100, factors.reduce((sum, item) => sum + item.points, 0)));
  let cap = 100;
  const caveats = ["Indice heuristique explicable, non une probabilité statistique. L'indépendance des rédactions ne peut pas être prouvée par ces métadonnées."];
  if (!official && independent < 2) cap = Math.min(cap, 49);
  if (!official && independent < 3) cap = Math.min(cap, 74);
  const occurrenceKnown = representatives.every((item) => item.signal.occurredAt !== null);
  if (!occurrenceKnown || !coherentGeo) { cap = Math.min(cap, 74); caveats.push("Date réelle ou géolocalisation précise insuffisante : statut plafonné à probable."); }
  if (conflicts.length || truncated) cap = Math.min(cap, 74);
  if (!official && !(independent >= 4 && structured)) cap = Math.min(cap, 89);
  const score = Math.min(raw, cap);
  if (score < raw) add("safety_cap", score - raw, `Plafond de prudence ${cap}/100 (incertitude, dépendance ou contradictions).`);
  const status: DetectionStatus = score < 25 ? "signal" : score < 50 ? "watch" : score < 75 ? "probable" : score < 90 ? "high" : "confirmed";
  return { score, status, factors, confirmationBasis: status === "confirmed" ? official ? "official_observation" : "independent_evidence" : null, caveats, version: 1 };
}

function quality(item: EventEvidence): number {
  return (item.signal.confirmsOccurrence ? 10 : 0) + ({ official: 4, structured: 3, sensor: 2, press: 1, report: 0 }[item.signal.nature]);
}
