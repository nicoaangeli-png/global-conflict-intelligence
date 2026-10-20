export type SignalKind = "explosion" | "earthquake" | "protest" | "outage" | "thermal" | "incident" | "weather" | "other";
export type DetectionStatus = "signal" | "watch" | "probable" | "high" | "confirmed";
export type EvidenceNature = "press" | "official" | "sensor" | "structured" | "report";

export interface Signal {
  id: string;
  provider: string;
  sourceName: string;
  url: string | null;
  title: string;
  text: string | null;
  kind: SignalKind;
  nature: EvidenceNature;
  occurredAt: string | null;
  publishedAt: string | null;
  detectedAt?: string | null;
  receivedAt: string;
  position: { lat: number; lon: number; precision: "point" | "city" | "region" | "country" | "unknown" } | null;
  place: string | null;
  countries: string[];
  entities: string[];
  upstreamAgency: string | null;
  confirmsOccurrence: boolean;
  severity: "info" | "minor" | "moderate" | "severe" | "extreme" | null;
  metric: { label: string; value: number; unit: string | null } | null;
  caveat: string | null;
}

export interface EventEvidence {
  signal: Signal;
  canonicalUrl: string | null;
  domain: string | null;
  fingerprint: string;
  independenceGroup: string;
  dependenceReasons: string[];
}

export interface ConfidenceBreakdown {
  score: number;
  status: DetectionStatus;
  factors: { code: string; points: number; detail: string }[];
  confirmationBasis: "official_observation" | "independent_evidence" | null;
  caveats: string[];
  version: 1;
}

export interface DetectionTimelineEntry {
  at: string;
  type: "first_signal" | "evidence_added" | "evidence_updated" | "assessment_changed";
  signalId: string | null;
  confidenceScore: number;
  status: DetectionStatus;
  independentSourceCount: number;
}

export interface EventCandidate {
  id: string;
  title: string;
  kind: SignalKind;
  firstReceivedAt: string;
  lastReceivedAt: string;
  occurredAt: string | null;
  position: Signal["position"];
  place: string | null;
  countries: string[];
  evidence: EventEvidence[];
}

export interface OrbitalEvent extends EventCandidate {
  confidenceScore: number;
  confidence: ConfidenceBreakdown;
  importanceScore: number;
  importanceReasons: string[];
  status: DetectionStatus;
  independentSourceCount: number;
  distinctProviderCount: number;
  evidenceCount: number;
  contradictions: string[];
  timeline: DetectionTimelineEntry[];
  evidenceTruncated: boolean;
}

export interface DetectionResponse {
  generatedAt: string;
  events: OrbitalEvent[];
  live: OrbitalEvent[];
  status: "ok" | "unavailable";
}
