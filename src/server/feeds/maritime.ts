import type { LiveItem } from "@/types/feeds";
import { countryFromCoords, num, plainText, str, type FeedContext, type FeedSourceDef } from "./util";

interface AisEnvelope {
  MessageType?: string;
  /** AISStream publie `latitude`/`longitude` en minuscules dans MetaData. */
  MetaData?: { MMSI?: number | string; ShipName?: string; latitude?: number; longitude?: number; Latitude?: number; Longitude?: number };
  Message?: {
    PositionReport?: {
      UserID?: number | string; Sog?: number; Cog?: number; TrueHeading?: number;
      Latitude?: number; Longitude?: number; Valid?: boolean;
    };
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

interface StraitRecord {
  mmsi: string;
  name: string | null;
  shipType: number | null;
  strait: Strait;
  lastSeenAt: number;
  position: { lat: number; lon: number; at: string; speed: number | null; course: number | null };
  track: NonNullable<LiveItem["track"]>;
}

interface MaritimeState {
  vessels: Map<string, VesselRecord>;
  /** Trafic civil observé dans les détroits stratégiques (tous types de navires). */
  straits: Map<string, StraitRecord>;
  /** MMSI à préfixe naval mais type civil déclaré : écartés même avant leur prochaine fiche. */
  civilPrefixed: Set<string>;
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
  "JS", "ROKS", "INS", "TCG", "HS", "HDMS", "HSWMS", "NRP", "ORP", "ESPS", "HNOMS", "KNM",
] as const;

/**
 * Pavillons (ISO3, d'après le MID) compatibles avec chaque préfixe : un préfixe
 * naval n'est retenu que porté par un navire de la marine correspondante
 * (« JS MOUCHE » sous pavillon français est un bateau-mouche, pas un navire japonais).
 */
export const PREFIX_FLAGS: Readonly<Record<(typeof NAVAL_PREFIXES)[number], readonly string[]>> = {
  USS: ["USA"], USNS: ["USA"], HMS: ["GBR", "SWE"], RFA: ["GBR"], FS: ["FRA"], HNLMS: ["NLD"],
  ITS: ["ITA"], FGS: ["DEU"], HMAS: ["AUS"], HMCS: ["CAN"], JS: ["JPN"], ROKS: ["KOR"],
  INS: ["IND", "ISR"], TCG: ["TUR"], HS: ["GRC"], HDMS: ["DNK"], HSWMS: ["SWE"], NRP: ["PRT"],
  ORP: ["POL"], ESPS: ["ESP"], HNOMS: ["NOR"], KNM: ["NOR"],
};

/**
 * Types AIS déclarés incompatibles avec un bâtiment militaire (pêche, remorquage,
 * pilote, plaisance, passagers, cargo, citerne…) : un préfixe seul ne suffit pas.
 */
function civilianShipType(shipType: number | null): boolean {
  if (shipType === null || shipType === 0) return false;
  return (shipType >= 30 && shipType <= 34) || (shipType >= 36 && shipType <= 54) || (shipType >= 56 && shipType <= 89);
}

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

export interface Strait {
  id: string;
  name: string;
  /** [latMin, lonMin, latMax, lonMax] */
  box: [number, number, number, number];
}

/** Détroits et canaux stratégiques suivis (emprises larges, en degrés). */
export const STRAITS: readonly Strait[] = [
  { id: "hormuz", name: "Détroit d’Ormuz", box: [24.5, 54.5, 27.6, 58.2] },
  { id: "bab-el-mandeb", name: "Bab-el-Mandeb", box: [11.3, 42.4, 14.2, 44.8] },
  { id: "suez", name: "Canal de Suez", box: [29.7, 32.1, 31.6, 32.8] },
  { id: "malacca", name: "Détroit de Malacca et Singapour", box: [0.8, 98.0, 6.5, 104.6] },
  { id: "bosporus", name: "Bosphore et Dardanelles", box: [39.9, 26.0, 41.4, 29.4] },
  { id: "taiwan", name: "Détroit de Taïwan", box: [22.0, 117.8, 26.2, 121.2] },
  { id: "gibraltar", name: "Détroit de Gibraltar", box: [35.6, -6.3, 36.4, -5.0] },
  { id: "dover", name: "Pas-de-Calais", box: [50.5, 0.9, 51.4, 2.2] },
  { id: "panama", name: "Canal de Panama", box: [8.7, -80.1, 9.5, -79.4] },
  { id: "kerch", name: "Détroit de Kertch", box: [44.9, 36.2, 45.6, 36.9] },
];

export function straitAt(lat: number, lon: number): Strait | null {
  return STRAITS.find(({ box: [a, b, c, d] }) => lat >= a && lat <= c && lon >= b && lon <= d) ?? null;
}

export const STRAIT_TRACK_WINDOW_MS = 2 * 60 * 60_000;
export const STRAIT_CURRENT_MAX_AGE_MS = 20 * 60_000;
export const STRAIT_MAX_VESSELS = 3_000;
const STRAIT_MAX_TRACK_POINTS = 40;

function straitTypeLabel(shipType: number | null): string {
  if (shipType === null || shipType === 0) return "type non déclaré";
  if (shipType >= 80 && shipType <= 89) return "pétrolier / citerne";
  if (shipType >= 70 && shipType <= 79) return "cargo";
  if (shipType >= 60 && shipType <= 69) return "passagers";
  if (shipType === 30) return "pêche";
  if (shipType === 31 || shipType === 32 || shipType === 52) return "remorqueur";
  if (shipType === 36 || shipType === 37) return "plaisance";
  if (shipType >= 40 && shipType <= 49) return "grande vitesse";
  return `type AIS ${shipType}`;
}

function purgeStraits(state: MaritimeState, nowMs: number): void {
  const cutoff = nowMs - STRAIT_TRACK_WINDOW_MS;
  for (const [mmsi, ship] of state.straits) {
    if (ship.lastSeenAt < cutoff) state.straits.delete(mmsi);
  }
  if (state.straits.size <= STRAIT_MAX_VESSELS) return;
  const oldest = [...state.straits.entries()].sort((a, b) => a[1].lastSeenAt - b[1].lastSeenAt);
  for (let i = 0; i < oldest.length - STRAIT_MAX_VESSELS; i++) state.straits.delete(oldest[i][0]);
}

/** Données statiques d'un navire déjà vu dans un détroit (nom, type déclaré). */
function noteStraitStatic(state: MaritimeState, mmsi: string, name: string | null, shipType: number | null): void {
  const ship = state.straits.get(mmsi);
  if (!ship) return;
  ship.name = name ?? ship.name;
  ship.shipType = shipType ?? ship.shipType;
}

function ingestStraitPosition(
  state: MaritimeState, mmsi: string, name: string | null, lat: number, lon: number,
  sog: number | null, cog: number | null, receivedAt: number,
): void {
  const strait = straitAt(lat, lon);
  const previous = state.straits.get(mmsi);
  if (!strait) {
    if (previous) state.straits.delete(mmsi);
    return;
  }
  const speed = sog !== null && sog >= 0 && sog < 102.3 ? sog : null;
  const course = cog !== null && cog >= 0 && cog < 360 ? cog : null;
  const at = new Date(receivedAt).toISOString();
  const cutoff = receivedAt - STRAIT_TRACK_WINDOW_MS;
  const track = (previous?.track ?? []).filter((point) => Date.parse(point.at) >= cutoff);
  const last = track.at(-1);
  if (!last || last.lat !== lat || last.lon !== lon) track.push({ lat, lon, at });
  while (track.length > STRAIT_MAX_TRACK_POINTS) track.splice(1, 1);
  state.straits.set(mmsi, {
    mmsi, name: name ?? previous?.name ?? null, shipType: previous?.shipType ?? null, strait,
    lastSeenAt: receivedAt, position: { lat, lon, at, speed, course }, track,
  });
  if (state.straits.size > STRAIT_MAX_VESSELS) purgeStraits(state, receivedAt);
}

const STRAIT_CAVEAT =
  "Position AIS émise volontairement par le navire et captée par des récepteurs terrestres bénévoles : couverture incomplète, certains navires coupent leur AIS.";

/** Trafic courant des détroits (positions de moins de 20 min). */
export function currentStraitItems(ctx: FeedContext, nowMs = Date.now()): LiveItem[] {
  const state = maritimeState();
  purgeStraits(state, nowMs);
  const items: LiveItem[] = [];
  for (const ship of state.straits.values()) {
    const position = ship.position;
    if (nowMs - Date.parse(position.at) > STRAIT_CURRENT_MAX_AGE_MS) continue;
    const flag = flagFromMmsi(ship.mmsi);
    const summary = [
      `${ship.strait.name}`,
      straitTypeLabel(ship.shipType),
      `MMSI ${ship.mmsi}`,
      flag ? `pavillon ${flag} (MID ${ship.mmsi.slice(0, 3)})` : `MID ${ship.mmsi.slice(0, 3)}`,
      position.speed !== null ? `vitesse ${position.speed.toLocaleString("fr-FR", { maximumFractionDigits: 1 })} kt` : null,
      position.course !== null ? `cap ${Math.round(position.course)}°` : null,
    ].filter(Boolean).join(" ; ");
    items.push({
      id: `aisstream-straits:${ship.mmsi}`,
      category: "shipping",
      nature: "sensor_measurement",
      title: `${ship.name ?? `MMSI ${ship.mmsi}`} — ${straitTypeLabel(ship.shipType)}`,
      summary,
      url: "https://aisstream.io/",
      sourceId: "aisstream-straits",
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
      caveat: STRAIT_CAVEAT,
      vehicle: "vessel",
      track: [...ship.track],
    });
  }
  return items;
}

function newState(): MaritimeState {
  return {
    vessels: new Map(), straits: new Map(), civilPrefixed: new Set(), socket: null, reconnectTimer: null, reconnectAttempt: 0,
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

function navalPrefixOf(value: string | null | undefined): (typeof NAVAL_PREFIXES)[number] | null {
  if (!value) return null;
  const normalized = value.toUpperCase().replace(/[.]/g, "").replace(/\s+/g, " ").trim();
  return NAVAL_PREFIXES.find((prefix) => normalized === prefix || normalized.startsWith(`${prefix} `) || normalized.startsWith(`${prefix}-`)) ?? null;
}

export function matchesNavalPrefix(value: string | null | undefined, mmsi?: string): boolean {
  const prefix = navalPrefixOf(value);
  if (!prefix) return false;
  if (mmsi === undefined) return true;
  const flag = flagFromMmsi(mmsi);
  return flag !== null && PREFIX_FLAGS[prefix].includes(flag);
}

function isExplicitCandidate(mmsi: string, shipType: number | null, name: string | null, callSign: string | null): boolean {
  if (shipType === 35 || shipType === 55) return true;
  if (civilianShipType(shipType)) return false;
  return matchesNavalPrefix(name, mmsi) || matchesNavalPrefix(callSign, mmsi);
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
    if (!isExplicitCandidate(mmsi, shipType, name, callSign)) {
      if (previous) state.vessels.delete(mmsi);
      if (civilianShipType(shipType) && (navalPrefixOf(name) || navalPrefixOf(callSign))) {
        if (state.civilPrefixed.size >= 20_000) state.civilPrefixed.clear();
        state.civilPrefixed.add(mmsi);
      }
      noteStraitStatic(state, mmsi, name, shipType);
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
  const meta = envelope.MetaData;
  const lat = num(meta?.latitude ?? meta?.Latitude ?? message.Latitude);
  const lon = num(meta?.longitude ?? meta?.Longitude ?? message.Longitude);
  if (!mmsi || lat === null || lon === null || Math.abs(lat) > 90 || Math.abs(lon) > 180) return;
  const previous = state.vessels.get(mmsi);
  const name = cleanAisText(envelope.MetaData?.ShipName) ?? previous?.name ?? null;
  if (state.civilPrefixed.has(mmsi) || !isExplicitCandidate(mmsi, previous?.shipType ?? null, name, previous?.callSign ?? null)) {
    ingestStraitPosition(state, mmsi, name, lat, lon, num(message.Sog), num(message.Cog), receivedAt);
    return;
  }
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
  state.straits.clear();
  state.civilPrefixed.clear();
  state.apiKey = null;
}

export interface MaritimeSnapshot {
  vessels: [string, VesselRecord][];
  straits: [string, Omit<StraitRecord, "strait"> & { straitId: string }][];
}

/** Instantané sérialisable de la mémoire AIS (sauvegarde entre redémarrages). */
export function exportMaritime(): MaritimeSnapshot {
  const state = maritimeState();
  return {
    vessels: [...state.vessels.entries()],
    straits: [...state.straits.entries()].map(([mmsi, { strait, ...rest }]) => [mmsi, { ...rest, straitId: strait.id }]),
  };
}

/** Restaure une mémoire sauvegardée sans écraser ce qui a été reçu depuis le démarrage. */
export function importMaritime(snapshot: Partial<MaritimeSnapshot>, nowMs = Date.now()): void {
  const state = maritimeState();
  for (const [mmsi, vessel] of snapshot.vessels ?? []) {
    if (!state.vessels.has(mmsi) && Array.isArray(vessel?.track)) state.vessels.set(mmsi, vessel);
  }
  for (const [mmsi, { straitId, ...rest }] of snapshot.straits ?? []) {
    const strait = STRAITS.find((candidate) => candidate.id === straitId);
    if (strait && !state.straits.has(mmsi) && Array.isArray(rest?.track)) state.straits.set(mmsi, { ...rest, strait });
  }
  purgeVessels(state, nowMs);
  purgeStraits(state, nowMs);
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

/** Trafic des détroits : même connexion WebSocket, lecture locale de la mémoire. */
export function createStraitsSource(apiKey = process.env.AISSTREAM_API_KEY ?? "", options: AisConnectionOptions = {}): FeedSourceDef {
  const configured = Boolean(apiKey.trim());
  return {
    sourceId: "aisstream-straits",
    sourceName: "AISStream.io",
    category: "shipping",
    homepage: "https://aisstream.io/",
    license: "Conditions AISStream.io ; aucune licence ouverte n’est affirmée",
    ttlMs: 5_000,
    unavailable: configured ? undefined : {
      status: "not_configured",
      message: "Clé AISStream absente (gratuite sur aisstream.io)",
    },
    async load(ctx) {
      ensureAisConnection(apiKey, options);
      const state = maritimeState();
      return {
        items: currentStraitItems(ctx, Date.parse(ctx.fetchedAt)),
        message: state.lastError ?? (state.socket?.readyState === 1 ? null : "Connexion AISStream en cours ; état mémoire retourné sans attente."),
      };
    },
  };
}

export const maritimeSources: FeedSourceDef[] = [createMaritimeSource(), createStraitsSource()];
