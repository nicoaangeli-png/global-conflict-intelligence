import type { LiveItem } from "@/types/feeds";
import { countryFromCoords, num, plainText, str, type FeedContext, type FeedSourceDef } from "./util";

interface AisEnvelope {
  MessageType?: string;
  MetaData?: { MMSI?: number | string; ShipName?: string; Latitude?: number; Longitude?: number };
  Message?: {
    PositionReport?: { UserID?: number | string; Sog?: number; Cog?: number; Valid?: boolean };
    ShipStaticData?: { UserID?: number | string; CallSign?: string; Name?: string; Type?: number; Valid?: boolean };
  };
}

interface VesselRecord {
  mmsi: string;
  name: string | null;
  callSign: string | null;
  shipType: number | null;
  lastSeenAt: number;
  position: { lat: number; lon: number; at: string; speed: number | null; course: number | null } | null;
  track: NonNullable<LiveItem["track"]>;
}

interface AisSocket {
  readyState: number;
  send(data: string): void;
  close(): void;
  addEventListener(type: "open" | "message" | "error" | "close", listener: (event: { data?: unknown }) => void): void;
}

type AisSocketConstructor = new (url: string) => AisSocket;
type TimerHandle = ReturnType<typeof setTimeout>;

interface MaritimeState {
  vessels: Map<string, VesselRecord>;
  socket: AisSocket | null;
  reconnectTimer: TimerHandle | null;
  reconnectAttempt: number;
  stopped: boolean;
  apiKey: string | null;
  socketConstructor: AisSocketConstructor | null;
  random: () => number;
  setTimer: (callback: () => void, delay: number) => TimerHandle;
  lastError: string | null;
}

export interface AisConnectionOptions {
  WebSocketCtor?: AisSocketConstructor;
  random?: () => number;
  setTimer?: (callback: () => void, delay: number) => TimerHandle;
}

export const AIS_TRACK_WINDOW_MS = 6 * 60 * 60_000;
export const AIS_CURRENT_MAX_AGE_MS = 30 * 60_000;
export const AIS_MAX_TRACK_POINTS = 120;
/** Seuls les candidats explicites sont mémorisés ; cette borne évite toute croissance sans limite. */
export const AIS_MAX_TRACKED_VESSELS = 2_000;
export const AISSTREAM_URL = "wss://stream.aisstream.io/v0/stream";
const AIS_GLOBAL_KEY = "__orbitalAisStreamV1";
const AIS_CAVEAT =
  "Position AIS émise volontairement : la plupart des navires de guerre n’émettent pas ou masquent leur identité ; l’absence d’un navire ne prouve rien.";

/**
 * Préfixes institutionnels explicites et bornés. Ils ne sont acceptés qu'au
 * début du nom/indicatif, comme un mot complet : aucune recherche floue.
 */
export const NAVAL_PREFIXES = [
  "USS", "USNS", "HMS", "RFA", "FS", "HNLMS", "ITS", "FGS", "HMAS", "HMCS",
  "JS", "ROKS", "INS", "TCG", "HS", "HDMS", "HSWMS", "NRP",
] as const;

/**
 * Sous-ensemble explicite des allocations MID officielles de l'UIT, couvrant
 * les principaux pavillons militaires observables. Les trois premiers chiffres
 * du MMSI sont les seuls consultés ; un MID absent reste inconnu.
 * Source : https://www.itu.int/en/ITU-R/terrestrial/fmd/Pages/mid.aspx
 */
export const MID_TO_ISO3: Readonly<Record<string, string>> = {
  "204": "PRT", "205": "BEL", "211": "DEU", "218": "DEU", "219": "DNK", "220": "DNK",
  "224": "ESP", "225": "ESP", "226": "FRA", "227": "FRA", "228": "FRA", "230": "FIN",
  "232": "GBR", "233": "GBR", "234": "GBR", "235": "GBR", "237": "GRC", "238": "HRV",
  "239": "GRC", "240": "GRC", "241": "GRC", "242": "MAR", "244": "NLD", "245": "NLD",
  "246": "NLD", "247": "ITA", "257": "NOR", "258": "NOR", "259": "NOR", "261": "POL",
  "263": "PRT", "264": "ROU", "265": "SWE", "266": "SWE", "271": "TUR", "272": "UKR",
  "273": "RUS", "316": "CAN", "345": "MEX", "366": "USA", "367": "USA", "368": "USA",
  "369": "USA", "403": "SAU", "412": "CHN", "413": "CHN", "416": "TWN", "419": "IND",
  "422": "IRN", "428": "ISR", "431": "JPN", "432": "JPN", "440": "KOR", "441": "KOR",
  "463": "PAK", "470": "ARE", "503": "AUS", "512": "NZL", "525": "IDN", "533": "MYS",
  "548": "PHL", "563": "SGP", "564": "SGP", "565": "SGP", "566": "SGP", "567": "THA",
  "574": "VNM", "601": "ZAF", "605": "DZA", "622": "EGY", "672": "TUN", "701": "ARG",
  "710": "BRA", "725": "CHL", "730": "COL",
};

function newState(): MaritimeState {
  return {
    vessels: new Map(), socket: null, reconnectTimer: null, reconnectAttempt: 0,
    stopped: false, apiKey: null, socketConstructor: null, random: Math.random,
    setTimer: setTimeout, lastError: null,
  };
}

function maritimeState(): MaritimeState {
  const global = globalThis as unknown as Record<string, MaritimeState | undefined>;
  return (global[AIS_GLOBAL_KEY] ??= newState());
}

function cleanAisText(value: unknown): string | null {
  const clean = plainText(typeof value === "string" ? value : undefined).replace(/^@+|@+$/g, "").trim();
  return clean || null;
}

function mmsiFrom(...values: unknown[]): string | null {
  for (const value of values) {
    const candidate = typeof value === "number" && Number.isInteger(value) ? String(value) : str(value);
    if (candidate && /^\d{9}$/.test(candidate)) return candidate;
  }
  return null;
}

export function flagFromMmsi(mmsi: string): string | null {
  return /^\d{9}$/.test(mmsi) ? MID_TO_ISO3[mmsi.slice(0, 3)] ?? null : null;
}

export function matchesNavalPrefix(value: string | null | undefined): boolean {
  if (!value) return false;
  const normalized = value.toUpperCase().replace(/[.]/g, "").replace(/\s+/g, " ").trim();
  return NAVAL_PREFIXES.some((prefix) => normalized === prefix || normalized.startsWith(`${prefix} `) || normalized.startsWith(`${prefix}-`));
}

function isExplicitCandidate(shipType: number | null, name: string | null, callSign: string | null): boolean {
  return shipType === 35 || shipType === 55 || matchesNavalPrefix(name) || matchesNavalPrefix(callSign);
}

function compactTrack(points: NonNullable<LiveItem["track"]>): NonNullable<LiveItem["track"]> {
  let compacted = points;
  while (compacted.length > AIS_MAX_TRACK_POINTS) {
    const last = compacted.at(-1)!;
    compacted = compacted.filter((_point, index) => index % 2 === 0);
    if (compacted.at(-1) !== last) compacted.push(last);
  }
  return compacted;
}

function purgeVessels(state: MaritimeState, nowMs: number): void {
  const cutoff = nowMs - AIS_TRACK_WINDOW_MS;
  for (const [mmsi, vessel] of state.vessels) {
    vessel.track = vessel.track.filter((point) => Date.parse(point.at) >= cutoff);
    if (vessel.lastSeenAt < cutoff) state.vessels.delete(mmsi);
  }
  if (state.vessels.size <= AIS_MAX_TRACKED_VESSELS) return;
  const oldest = [...state.vessels.entries()].sort((a, b) => a[1].lastSeenAt - b[1].lastSeenAt);
  for (let i = 0; i < oldest.length - AIS_MAX_TRACKED_VESSELS; i++) state.vessels.delete(oldest[i][0]);
}

/** Ingère un message officiel AISStream déjà décodé, sans aucun appel réseau. */
export function ingestAisMessage(raw: unknown, receivedAt = Date.now()): void {
  if (!raw || typeof raw !== "object" || !Number.isFinite(receivedAt)) return;
  const envelope = raw as AisEnvelope;
  const state = maritimeState();

  if (envelope.MessageType === "ShipStaticData") {
    const message = envelope.Message?.ShipStaticData;
    if (!message || message.Valid === false) return;
    const mmsi = mmsiFrom(envelope.MetaData?.MMSI, message.UserID);
    if (!mmsi) return;
    const previous = state.vessels.get(mmsi);
    const name = cleanAisText(message.Name) ?? cleanAisText(envelope.MetaData?.ShipName) ?? previous?.name ?? null;
    const callSign = cleanAisText(message.CallSign) ?? previous?.callSign ?? null;
    const parsedType = num(message.Type);
    const shipType = parsedType !== null && Number.isInteger(parsedType) && parsedType >= 0 && parsedType <= 99 ? parsedType : null;
    if (!isExplicitCandidate(shipType, name, callSign)) {
      if (previous) state.vessels.delete(mmsi);
      return;
    }
    state.vessels.set(mmsi, {
      mmsi, name, callSign, shipType, lastSeenAt: receivedAt,
      position: previous?.position ?? null, track: previous?.track ?? [],
    });
    purgeVessels(state, receivedAt);
    return;
  }

  if (envelope.MessageType !== "PositionReport") return;
  const message = envelope.Message?.PositionReport;
  if (!message || message.Valid === false) return;
  const mmsi = mmsiFrom(envelope.MetaData?.MMSI, message.UserID);
  const lat = num(envelope.MetaData?.Latitude);
  const lon = num(envelope.MetaData?.Longitude);
  if (!mmsi || lat === null || lon === null || Math.abs(lat) > 90 || Math.abs(lon) > 180) return;
  const previous = state.vessels.get(mmsi);
  const name = cleanAisText(envelope.MetaData?.ShipName) ?? previous?.name ?? null;
  if (!isExplicitCandidate(previous?.shipType ?? null, name, previous?.callSign ?? null)) return;
  const speedValue = num(message.Sog);
  const courseValue = num(message.Cog);
  // 102,3 kt et 360° sont les sentinelles AIS « non disponibles ».
  const speed = speedValue !== null && speedValue >= 0 && speedValue < 102.3 ? speedValue : null;
  const course = courseValue !== null && courseValue >= 0 && courseValue < 360 ? courseValue : null;
  const at = new Date(receivedAt).toISOString();
  const track = previous?.track ?? [];
  const last = track.at(-1);
  if (!last || last.lat !== lat || last.lon !== lon) track.push({ lat, lon, at });
  state.vessels.set(mmsi, {
    mmsi, name, callSign: previous?.callSign ?? null, shipType: previous?.shipType ?? null,
    lastSeenAt: receivedAt, position: { lat, lon, at, speed, course }, track: compactTrack(track),
  });
  purgeVessels(state, receivedAt);
}

function vesselTypeLabel(vessel: VesselRecord): string {
  if (vessel.shipType === 35) return "opérations militaires (AIS 35)";
  if (vessel.shipType === 55) return "forces de l’ordre (AIS 55)";
  return "navire militaire (préfixe explicite)";
}

/** Photographie instantanée de la mémoire : aucune attente du WebSocket. */
export function currentAisItems(ctx: FeedContext, nowMs = Date.now()): LiveItem[] {
  const state = maritimeState();
  purgeVessels(state, nowMs);
  const items: LiveItem[] = [];
  for (const vessel of state.vessels.values()) {
    const position = vessel.position;
    if (!position || nowMs - Date.parse(position.at) > AIS_CURRENT_MAX_AGE_MS) continue;
    const flag = flagFromMmsi(vessel.mmsi);
    const label = vesselTypeLabel(vessel);
    const summary = [
      `MMSI ${vessel.mmsi}`,
      flag ? `pavillon ${flag} (MID ${vessel.mmsi.slice(0, 3)})` : `pavillon inconnu (MID ${vessel.mmsi.slice(0, 3)})`,
      position.speed !== null ? `vitesse ${position.speed.toLocaleString("fr-FR", { maximumFractionDigits: 1 })} kt` : null,
      position.course !== null ? `cap ${Math.round(position.course)}°` : null,
    ].filter(Boolean).join(" ; ");
    items.push({
      id: `aisstream-military:${vessel.mmsi}`,
      category: "military",
      nature: "sensor_measurement",
      title: `${vessel.name ?? `MMSI ${vessel.mmsi}`} — ${label}`,
      summary,
      url: "https://aisstream.io/",
      sourceId: "aisstream-military",
      sourceName: "AISStream.io",
      publishedAt: null,
      occurredAt: position.at,
      fetchedAt: ctx.fetchedAt,
      countries: countryFromCoords(ctx.index, position.lat, position.lon),
      lat: position.lat,
      lon: position.lon,
      severity: null,
      metric: position.speed !== null
        ? { label: "Vitesse", value: position.speed, unit: "kt" }
        : position.course !== null ? { label: "Cap", value: position.course, unit: "°" } : null,
      caveat: AIS_CAVEAT,
      vehicle: "vessel",
      track: [...vessel.track],
    });
  }
  return items;
}

async function messageText(data: unknown): Promise<string | null> {
  if (typeof data === "string") return data;
  if (data instanceof ArrayBuffer) return new TextDecoder().decode(data);
  if (ArrayBuffer.isView(data)) return new TextDecoder().decode(new Uint8Array(data.buffer, data.byteOffset, data.byteLength));
  if (typeof Blob !== "undefined" && data instanceof Blob) return await data.text();
  if (data && typeof data === "object" && "arrayBuffer" in data && typeof data.arrayBuffer === "function") {
    return new TextDecoder().decode(await data.arrayBuffer());
  }
  return null;
}

function scheduleReconnect(state: MaritimeState): void {
  if (state.stopped || state.reconnectTimer || !state.apiKey || !state.socketConstructor) return;
  const base = Math.min(60_000, 1_000 * 2 ** Math.min(state.reconnectAttempt, 6));
  const delay = Math.round(base * (1 + state.random() * 0.25));
  state.reconnectAttempt++;
  state.reconnectTimer = state.setTimer(() => {
    state.reconnectTimer = null;
    connect(state);
  }, delay);
  (state.reconnectTimer as unknown as { unref?: () => void }).unref?.();
}

function connect(state: MaritimeState): void {
  if (state.stopped || state.socket || !state.apiKey || !state.socketConstructor) return;
  let socket: AisSocket;
  try {
    socket = new state.socketConstructor(AISSTREAM_URL);
  } catch {
    state.lastError = "Connexion AISStream impossible ; nouvelle tentative planifiée.";
    scheduleReconnect(state);
    return;
  }
  state.socket = socket;
  socket.addEventListener("open", () => {
    if (state.socket !== socket || state.stopped) return;
    state.reconnectAttempt = 0;
    state.lastError = null;
    socket.send(JSON.stringify({
      APIKey: state.apiKey,
      BoundingBoxes: [[[-90, -180], [90, 180]]],
      FilterMessageTypes: ["PositionReport", "ShipStaticData"],
    }));
  });
  socket.addEventListener("message", (event) => {
    void messageText(event.data).then((text) => {
      if (!text) return;
      try { ingestAisMessage(JSON.parse(text)); } catch { /* message isolé invalide : le flux continue */ }
    });
  });
  socket.addEventListener("error", () => {
    state.lastError = "Connexion AISStream interrompue ; reconnexion automatique.";
  });
  socket.addEventListener("close", () => {
    if (state.socket === socket) state.socket = null;
    if (!state.stopped) scheduleReconnect(state);
  });
}

/** Démarre au plus une connexion globale et retourne immédiatement. */
export function ensureAisConnection(apiKey: string, options: AisConnectionOptions = {}): void {
  const key = apiKey.trim();
  if (!key) return;
  const state = maritimeState();
  state.stopped = false;
  state.apiKey = key;
  state.socketConstructor = options.WebSocketCtor ?? (globalThis.WebSocket as unknown as AisSocketConstructor | undefined) ?? null;
  state.random = options.random ?? Math.random;
  state.setTimer = options.setTimer ?? setTimeout;
  if (!state.socket && !state.reconnectTimer) connect(state);
}

/** Réservé aux tests : ferme la connexion et oublie la mémoire AIS globale. */
export function clearMaritimeState(): void {
  const state = maritimeState();
  state.stopped = true;
  if (state.reconnectTimer) clearTimeout(state.reconnectTimer);
  state.reconnectTimer = null;
  state.socket?.close();
  state.socket = null;
  state.vessels.clear();
  state.apiKey = null;
}

export function maritimeMemoryStats(): { vessels: number; points: number } {
  const vessels = [...maritimeState().vessels.values()];
  return { vessels: vessels.length, points: vessels.reduce((total, vessel) => total + vessel.track.length, 0) };
}

export function createMaritimeSource(apiKey = process.env.AISSTREAM_API_KEY ?? "", options: AisConnectionOptions = {}): FeedSourceDef {
  const configured = Boolean(apiKey.trim());
  return {
    sourceId: "aisstream-military",
    sourceName: "AISStream.io",
    category: "military",
    homepage: "https://aisstream.io/",
    license: "Conditions AISStream.io ; aucune licence ouverte n’est affirmée",
    // La lecture est locale et non bloquante ; ce TTL ne crée aucune requête WebSocket supplémentaire.
    ttlMs: 5_000,
    unavailable: configured ? undefined : {
      status: "not_configured",
      message: "Clé AISStream absente (gratuite sur aisstream.io)",
    },
    async load(ctx) {
      ensureAisConnection(apiKey, options);
      const items = currentAisItems(ctx, Date.parse(ctx.fetchedAt));
      const state = maritimeState();
      return {
        items,
        message: state.lastError ?? (state.socket?.readyState === 1 ? null : "Connexion AISStream en cours ; état mémoire retourné sans attente."),
      };
    },
  };
}

export const maritimeSources: FeedSourceDef[] = [createMaritimeSource()];
