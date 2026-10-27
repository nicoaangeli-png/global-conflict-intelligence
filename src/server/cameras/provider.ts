import type { Camera } from "@/types/cameras";
import type { SourceDescriptor } from "@/server/health/registry";

export interface CameraProvider {
  descriptor: SourceDescriptor;
  id: string;
  ttlMs: number;
  retryMs: number;
  requiredKeyEnv: string | null;
  fetchCatalog(fetcher: typeof fetch, key: string | null): Promise<Camera[]>;
  detail?(camera: Camera, fetcher: typeof fetch): Promise<Camera>;
  frame?(camera: Camera, fetcher: typeof fetch): Promise<Uint8Array>;
}

export const object = (value: unknown): Record<string, unknown> | null => value !== null && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : null;
export const nonempty = (value: unknown): string | null => typeof value === "string" && value.trim() ? value.trim() : null;
export const timestamp = (value: unknown): string | null => {
  const raw = nonempty(value);
  const parsed = raw ? Date.parse(raw) : NaN;
  return Number.isFinite(parsed) ? new Date(parsed).toISOString() : null;
};
export const coordinates = (latitude: unknown, longitude: unknown): latitude is number =>
  typeof latitude === "number" && typeof longitude === "number" && Number.isFinite(latitude) && Number.isFinite(longitude) && latitude >= -90 && latitude <= 90 && longitude >= -180 && longitude <= 180;

const etags = new Map<string, { etag: string; bytes: Uint8Array }>();

/** Exact HTTPS host and path policy. No redirects, private IPs, credentials or arbitrary ports. */
export function approvedUrl(raw: string, hosts: readonly string[], path: RegExp, allow443 = false): URL {
  const url = new URL(raw);
  if (url.protocol !== "https:" || !hosts.includes(url.hostname) || (url.port && !(allow443 && url.port === "443")) || url.username || url.password || url.hash || !path.test(url.pathname)) throw new Error("Camera URL rejected");
  return url;
}

export async function boundedGet(raw: string, hosts: readonly string[], path: RegExp, kind: "json" | "image" | "text", fetcher: typeof fetch = fetch, headers?: HeadersInit): Promise<Uint8Array> {
  approvedUrl(raw, hosts, path);
  const limit = kind === "json" ? 8_000_000 : kind === "text" ? 2_000_000 : 4_000_000;
  const conditional = kind === "image" ? null : etags.get(raw) ?? null;
  const requestHeaders = new Headers(headers);
  if (conditional) requestHeaders.set("If-None-Match", conditional.etag);
  const response = await fetcher(raw, { headers: requestHeaders, redirect: "manual", signal: AbortSignal.timeout(10_000), cache: "no-store" });
  if (response.status === 304 && conditional) return conditional.bytes;
  if (!response.ok) throw new Error(`Camera upstream HTTP ${response.status}`);
  const mime = response.headers.get("content-type")?.split(";")[0].trim().toLowerCase();
  // data.gov.sg serves its documented .jpg objects as octet-stream; JPEG magic is checked below.
  if (kind === "json" ? mime !== "application/json" : kind === "text" ? mime !== "text/csv" && mime !== "text/plain" : mime !== "image/jpeg" && mime !== "application/octet-stream") throw new Error("Camera Content-Type rejected");
  if (Number(response.headers.get("content-length")) > limit) throw new Error("Camera response too large");
  if (!response.body) throw new Error("Camera empty response");
  const reader = response.body.getReader();
  const parts: Uint8Array[] = [];
  let size = 0;
  try {
    while (true) {
      const { value, done } = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > limit) throw new Error("Camera response too large");
      parts.push(value);
    }
  } finally { await reader.cancel().catch(() => undefined); }
  const bytes = new Uint8Array(size);
  let offset = 0;
  for (const part of parts) { bytes.set(part, offset); offset += part.byteLength; }
  if (kind === "image" && (size < 3 || bytes[0] !== 0xff || bytes[1] !== 0xd8 || bytes[2] !== 0xff)) throw new Error("Camera JPEG rejected");
  if (kind !== "image") {
    const etag = response.headers.get("etag");
    if (etag && etag.length <= 200) {
      if (etags.size >= 16) etags.delete(etags.keys().next().value ?? "");
      etags.set(raw, { etag, bytes });
    }
  }
  return bytes;
}

export async function boundedJson(raw: string, hosts: readonly string[], path: RegExp, fetcher: typeof fetch = fetch, headers?: HeadersInit): Promise<unknown> {
  const bytes = await boundedGet(raw, hosts, path, "json", fetcher, headers);
  try { return JSON.parse(new TextDecoder().decode(bytes)) as unknown; }
  catch { throw new Error("Camera JSON rejected"); }
}
