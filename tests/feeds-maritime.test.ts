import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  AIS_MAX_TRACKED_VESSELS,
  AIS_MAX_TRACK_POINTS,
  AIS_TRACK_WINDOW_MS,
  clearMaritimeState,
  createMaritimeSource,
  currentAisItems,
  ensureAisConnection,
  flagFromMmsi,
  ingestAisMessage,
  maritimeMemoryStats,
  matchesNavalPrefix,
} from "@/server/feeds/maritime";
import { clearFeedsCache, runSource } from "@/server/feeds/util";
import { ctx, fixtureJson } from "./feeds-helpers";

// Enveloppes représentatives construites d'après https://aisstream.io/documentation
const BASE = Date.parse("2026-10-19T18:00:00.000Z");

function position(mmsi: number, name: string, lat: number, lon: number, speed = 12.4, course = 86.7) {
  return {
    MessageType: "PositionReport",
    // Format réel observé : `latitude`/`longitude` en minuscules dans MetaData.
    MetaData: { MMSI: mmsi, MMSI_String: mmsi, ShipName: name, latitude: lat, longitude: lon, time_utc: "2026-10-19 18:00:00.000000000 +0000 UTC" },
    Message: { PositionReport: { MessageID: 1, UserID: mmsi, Sog: speed, Cog: course, Valid: true } },
  };
}

function staticData(mmsi: number, name: string, type: number, callSign = "CALL") {
  return {
    MessageType: "ShipStaticData",
    MetaData: { MMSI: mmsi, ShipName: name },
    Message: { ShipStaticData: { MessageID: 5, UserID: mmsi, Name: name, CallSign: callSign, Type: type, Valid: true } },
  };
}

beforeEach(() => {
  clearFeedsCache();
  clearMaritimeState();
});
afterEach(() => clearMaritimeState());

describe("AISStream — sélection et rendu", () => {
  it("expose un état not_configured explicite sans clé", async () => {
    const source = createMaritimeSource("");
    const { items, state } = await runSource(source, async () => null);
    expect(items).toEqual([]);
    expect(state).toMatchObject({
      sourceId: "aisstream-military",
      status: "not_configured",
      message: "Clé AISStream absente (gratuite sur aisstream.io)",
    });
  });

  it("garde les types AIS 35/55 ou un préfixe naval exact, jamais un nom civil approchant", () => {
    const messages = fixtureJson("aisstream-messages.json");
    messages.forEach((message: unknown, index: number) => ingestAisMessage(message, BASE + index * 1000));
    const items = currentAisItems(ctx(), BASE + 10_000);
    expect(items.map((item) => item.id).sort()).toEqual([
      "aisstream-military:232123456",
      "aisstream-military:368207620",
    ]);
    expect(items.find((item) => item.id.endsWith("368207620"))).toMatchObject({
      category: "military",
      nature: "sensor_measurement",
      vehicle: "vessel",
      title: "USNS MERCY — opérations militaires (AIS 35)",
      countries: ["USA"],
      metric: { label: "Vitesse", value: 12.4, unit: "kt" },
    });
    const mercy = items.find((item) => item.id.endsWith("368207620"))!;
    expect(mercy.summary).toContain("pavillon USA (MID 368)");
    expect(mercy.summary).toContain("cap 87°");
    expect(mercy.caveat).toContain("la plupart des navires de guerre n’émettent pas");
    expect(items.some((item) => item.title.includes("CIVILIAN"))).toBe(false);

    ingestAisMessage(staticData(227654321, "GENDARMERIE 1", 55), BASE + 11_000);
    ingestAisMessage(position(227654321, "GENDARMERIE 1", 43.2, 5.3), BASE + 12_000);
    expect(currentAisItems(ctx(false), BASE + 13_000)[2].title).toContain("forces de l’ordre (AIS 55)");
  });

  it("utilise uniquement les trois premiers chiffres du MMSI pour le pavillon", () => {
    expect(flagFromMmsi("368000001")).toBe("USA");
    expect(flagFromMmsi("368999999")).toBe("USA");
    expect(flagFromMmsi("999368000")).toBeNull();
    expect(flagFromMmsi("36800")).toBeNull();
  });

  it("limite les motifs au début d'un nom ou indicatif", () => {
    expect(matchesNavalPrefix("HMS Queen Elizabeth")).toBe(true);
    expect(matchesNavalPrefix("HNLMS-Evertsen")).toBe(true);
    expect(matchesNavalPrefix("THE HMS CAFE")).toBe(false);
    expect(matchesNavalPrefix("FISHING SHIP")).toBe(false);
  });

  it("accumule sans interpolation, dédoublonne et retire l'affichage après trente minutes", () => {
    ingestAisMessage(staticData(368207620, "USNS MERCY", 35), BASE);
    ingestAisMessage(position(368207620, "USNS MERCY", 25.7, -80.1), BASE + 1_000);
    ingestAisMessage(position(368207620, "USNS MERCY", 25.7, -80.1), BASE + 60_000);
    ingestAisMessage(position(368207620, "USNS MERCY", 25.8, -80), BASE + 120_000);
    const item = currentAisItems(ctx(false), BASE + 121_000)[0];
    expect(item.track).toEqual([
      { lat: 25.7, lon: -80.1, at: "2026-10-19T18:00:01.000Z" },
      { lat: 25.8, lon: -80, at: "2026-10-19T18:02:00.000Z" },
    ]);
    expect(item.occurredAt).toBe("2026-10-19T18:02:00.000Z");
    expect(currentAisItems(ctx(false), BASE + 120_000 + 30 * 60_000 + 1)).toEqual([]);
  });

  it("purge à six heures et borne navires comme points", () => {
    ingestAisMessage(staticData(368207620, "USNS MERCY", 35), BASE);
    ingestAisMessage(position(368207620, "USNS MERCY", 25.7, -80.1), BASE + 1_000);
    currentAisItems(ctx(false), BASE + 1_000 + AIS_TRACK_WINDOW_MS + 1);
    expect(maritimeMemoryStats()).toEqual({ vessels: 0, points: 0 });

    for (let index = 0; index < AIS_MAX_TRACKED_VESSELS + 5; index++) {
      ingestAisMessage(staticData(100_000_000 + index, `VESSEL ${index}`, 35), BASE + index);
    }
    expect(maritimeMemoryStats().vessels).toBe(AIS_MAX_TRACKED_VESSELS);

    clearMaritimeState();
    ingestAisMessage(staticData(368207620, "USNS MERCY", 35), BASE);
    for (let index = 0; index < AIS_MAX_TRACK_POINTS + 10; index++) {
      ingestAisMessage(position(368207620, "USNS MERCY", 20 + index / 1000, -60), BASE + index * 60_000);
    }
    expect(maritimeMemoryStats().points).toBeLessThanOrEqual(AIS_MAX_TRACK_POINTS);
  });
});

class FakeSocket {
  static instances: FakeSocket[] = [];
  readonly sent: string[] = [];
  readonly listeners = new Map<string, ((event: { data?: unknown }) => void)[]>();
  readyState = 0;

  constructor(readonly url: string) {
    FakeSocket.instances.push(this);
  }

  addEventListener(type: "open" | "message" | "error" | "close", listener: (event: { data?: unknown }) => void) {
    this.listeners.set(type, [...(this.listeners.get(type) ?? []), listener]);
  }

  send(data: string) { this.sent.push(data); }

  emit(type: "open" | "message" | "error" | "close", data?: unknown) {
    if (type === "open") this.readyState = 1;
    if (type === "close") this.readyState = 3;
    for (const listener of this.listeners.get(type) ?? []) listener({ data });
  }

  close() { this.emit("close"); }
}

describe("AISStream — WebSocket de fond", () => {
  beforeEach(() => { FakeSocket.instances = []; });

  it("ouvre une seule connexion, s'abonne au monde et décode les trames binaires", async () => {
    ensureAisConnection("test-key", { WebSocketCtor: FakeSocket });
    ensureAisConnection("test-key", { WebSocketCtor: FakeSocket });
    expect(FakeSocket.instances).toHaveLength(1);
    const socket = FakeSocket.instances[0];
    socket.emit("open");
    const subscription = JSON.parse(socket.sent[0]);
    expect(subscription).toEqual({
      APIKey: "test-key",
      BoundingBoxes: [[[-90, -180], [90, 180]]],
      FilterMessageTypes: ["PositionReport", "ShipStaticData"],
    });
    const message = staticData(368207620, "USNS MERCY", 35);
    socket.emit("message", new TextEncoder().encode(JSON.stringify(message)));
    await Promise.resolve();
    await Promise.resolve();
    expect(maritimeMemoryStats().vessels).toBe(1);
  });

  it("reconnecte avec un backoff après fermeture sans bloquer le lecteur", () => {
    const scheduled: { callback: () => void; delay: number }[] = [];
    const setTimer = ((callback: () => void, delay: number) => {
      scheduled.push({ callback, delay });
      return { unref() {} };
    }) as unknown as typeof setTimeout;
    ensureAisConnection("test-key", { WebSocketCtor: FakeSocket, random: () => 0, setTimer });
    FakeSocket.instances[0].emit("close");
    expect(scheduled).toHaveLength(1);
    expect(scheduled[0].delay).toBe(1_000);
    scheduled[0].callback();
    expect(FakeSocket.instances).toHaveLength(2);
  });

  it("la source configurée retourne immédiatement l'état mémoire", async () => {
    const source = createMaritimeSource("test-key", { WebSocketCtor: FakeSocket });
    const result = await source.load(ctx(false));
    expect(Array.isArray(result) ? result : result.items).toEqual([]);
    expect(FakeSocket.instances).toHaveLength(1);
  });
});
