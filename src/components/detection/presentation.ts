import type { Locale } from "@/lib/i18n";
import type { DetectionStatus, OrbitalEvent } from "@/types/detection";

export function sourceHref(value: string | null): string | null {
  if (!value) return null;
  try {
    const url = new URL(value);
    return (url.protocol === "https:" || url.protocol === "http:") && !url.username && !url.password ? url.href : null;
  } catch { return null; }
}

export function canFocusEvent(position: OrbitalEvent["position"]): position is NonNullable<OrbitalEvent["position"]> {
  return Boolean(position && (position.precision === "point" || position.precision === "city") &&
    Number.isFinite(position.lat) && Math.abs(position.lat) <= 90 && Number.isFinite(position.lon) && Math.abs(position.lon) <= 180);
}

export function statusLabel(status: DetectionStatus, locale: Locale): string {
  const labels: Record<DetectionStatus, [string, string]> = {
    signal: ["Signal", "Signal"], watch: ["À surveiller", "Watch"], probable: ["Probable", "Probable"],
    high: ["Confiance élevée", "High confidence"], confirmed: ["Confirmé", "Confirmed"],
  };
  return labels[status]?.[locale === "fr" ? 0 : 1] ?? status;
}

export function utcTime(value: string | null, locale: Locale): string {
  const timestamp = value ? Date.parse(value) : NaN;
  if (!Number.isFinite(timestamp)) return locale === "fr" ? "Date inconnue" : "Unknown time";
  return new Intl.DateTimeFormat(locale === "fr" ? "fr-FR" : "en-GB", {
    dateStyle: "short", timeStyle: "medium", timeZone: "UTC",
  }).format(timestamp) + " UTC";
}
