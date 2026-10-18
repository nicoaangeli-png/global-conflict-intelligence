/** Formatage commun à toute l'interface (français, unités courtes). */

const NF = new Intl.NumberFormat("fr-FR");
const NF1 = new Intl.NumberFormat("fr-FR", { maximumFractionDigits: 1 });

export const int = (n: number | undefined | null) => (n == null ? "—" : NF.format(n));
export const dec = (n: number | undefined | null) => (n == null ? "—" : NF1.format(n));

/** 12 480 → « 12,5 k » */
export function compact(n: number | undefined | null): string {
  if (n == null) return "—";
  if (Math.abs(n) >= 1_000_000) return `${NF1.format(n / 1_000_000)} M`;
  if (Math.abs(n) >= 10_000) return `${NF1.format(n / 1000)} k`;
  return NF.format(n);
}

export function timeUTC(iso: string | undefined | null): string {
  if (!iso) return "—";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "—";
  return `${String(d.getUTCHours()).padStart(2, "0")}:${String(d.getUTCMinutes()).padStart(2, "0")}Z`;
}

export function dateUTC(iso: string | undefined | null): string {
  if (!iso) return "—";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "—";
  return d.toISOString().slice(0, 10);
}

export function dateTimeUTC(iso: string | undefined | null): string {
  return `${dateUTC(iso)} · ${timeUTC(iso)}`;
}

export function relative(iso: string | undefined | null): string {
  if (!iso) return "—";
  const t = Date.parse(iso);
  if (Number.isNaN(t)) return "—";
  const s = Math.max(0, (Date.now() - t) / 1000);
  if (s < 60) return "à l'instant";
  if (s < 3600) return `il y a ${Math.floor(s / 60)} min`;
  if (s < 86400) return `il y a ${Math.floor(s / 3600)} h`;
  const d = Math.floor(s / 86400);
  if (d < 31) return `il y a ${d} j`;
  if (d < 365) return `il y a ${Math.floor(d / 30)} mois`;
  return `il y a ${Math.floor(d / 365)} an${d >= 730 ? "s" : ""}`;
}

/** Coordonnées lisibles : 48.02°N 37.80°E */
export function coords(lat: number, lon: number): string {
  const la = `${Math.abs(lat).toFixed(2)}°${lat >= 0 ? "N" : "S"}`;
  const lo = `${Math.abs(lon).toFixed(2)}°${lon >= 0 ? "E" : "O"}`;
  return `${la} ${lo}`;
}

/**
 * Heure relative bilingue, passé ET futur (lancement planifié : « dans 3 h »).
 * `now` est injectable pour les tests.
 */
export function relativeTime(iso: string | undefined | null, locale: "fr" | "en" = "fr", now = Date.now()): string {
  if (!iso) return "—";
  const t = Date.parse(iso);
  if (Number.isNaN(t)) return "—";
  const diff = (now - t) / 1000;
  const s = Math.abs(diff);
  const fr = locale === "fr";
  let span: string;
  if (s < 60) return fr ? "à l'instant" : "just now";
  if (s < 3600) span = `${Math.floor(s / 60)} min`;
  else if (s < 86400) span = `${Math.floor(s / 3600)} h`;
  else if (s < 86400 * 31) span = fr ? `${Math.floor(s / 86400)} j` : `${Math.floor(s / 86400)} d`;
  else if (s < 86400 * 365) span = fr ? `${Math.floor(s / (86400 * 30))} mois` : `${Math.floor(s / (86400 * 30))} mo`;
  else {
    const y = Math.floor(s / (86400 * 365));
    span = fr ? `${y} an${y > 1 ? "s" : ""}` : `${y} yr`;
  }
  if (diff >= 0) return fr ? `il y a ${span}` : `${span} ago`;
  return fr ? `dans ${span}` : `in ${span}`;
}

/** Date et heure absolues lisibles, en UTC explicite : « 18/10/2026 10:31 UTC ». */
export function absoluteDateTime(iso: string | undefined | null, locale: "fr" | "en" = "fr"): string {
  if (!iso) return "—";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "—";
  return `${d.toLocaleString(locale === "fr" ? "fr-FR" : "en-GB", {
    timeZone: "UTC",
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  })} UTC`;
}

/** Date seule lisible (UTC) : « 31/08/2026 ». */
export function shortDate(iso: string | undefined | null, locale: "fr" | "en" = "fr"): string {
  if (!iso) return "—";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "—";
  return d.toLocaleDateString(locale === "fr" ? "fr-FR" : "en-GB", { timeZone: "UTC", day: "2-digit", month: "2-digit", year: "numeric" });
}
