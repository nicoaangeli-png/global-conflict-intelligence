import type { OrbitalEvent } from "@/types/detection";
import { signalTime } from "./cluster";

export function importance(event: OrbitalEvent): { score: number; reasons: string[] } {
  const base = { earthquake: 40, explosion: 55, incident: 40, outage: 20, weather: 25, protest: 25, thermal: 10, other: 10 }[event.kind];
  const severity = Math.max(0, ...event.evidence.map((item) => ({ info: 0, minor: 0, moderate: 10, severe: 25, extreme: 40 }[item.signal.severity ?? "info"])));
  const magnitude = Math.max(0, ...event.evidence.filter((item) => item.signal.kind === "earthquake" && /magnitude/i.test(item.signal.metric?.label ?? "")).map((item) => item.signal.metric?.value ?? 0));
  const magnitudePoints = magnitude >= 7 ? 40 : magnitude >= 6 ? 30 : magnitude >= 5 ? 10 : 0;
  return { score: Math.min(100, base + Math.max(severity, magnitudePoints)), reasons: [`category:${event.kind}:+${base}`, `observed_severity:+${Math.max(severity, magnitudePoints)}`] };
}

export function isLive(event: OrbitalEvent, now: number): boolean {
  const times = event.evidence.map((item) => signalTime(item.signal)).filter((time): time is number => time !== null);
  if (!times.length) return false;
  const firstSourceTime = Math.min(...times);
  const age = now - firstSourceTime;
  return age >= 0 && age <= 6 * 3_600_000 && event.importanceScore >= 55 && event.confidenceScore >= 25;
}
