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
