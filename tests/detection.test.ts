import { mkdtempSync, rmSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import type { Signal } from "@/types/detection";
import { DetectionEngine, MAX_EVIDENCE } from "@/server/detection/engine";
import { canonicalUrl } from "@/server/detection/fingerprint";
import { fromConflict, fromFeed } from "@/server/detection/normalize";
import { RETENTION_MS, SqliteDetectionStore } from "@/server/detection/store";

const NOW = Date.parse("2026-10-20T08:43:00Z");
function signal(overrides: Partial<Signal> = {}): Signal {
  return { id: "first", provider: "local-a", sourceName: "Local A", url: "https://local-a.example/news/1", title: "Explosion signalée à Odessa près du port",
    text: null, kind: "explosion", nature: "press", occurredAt: new Date(NOW).toISOString(), publishedAt: null, receivedAt: new Date(NOW).toISOString(),
    position: { lat: 46.48, lon: 30.73, precision: "city" }, place: "Odessa", countries: ["UKR"], entities: [], upstreamAgency: null,
    confirmsOccurrence: false, severity: null, metric: null, caveat: "Signal non confirmé", ...overrides };
}
function setup() { const store = new SqliteDetectionStore(":memory:"); return { store, engine: new DetectionEngine(store) }; }
function distinct(index: number, overrides: Partial<Signal> = {}): Signal {
  const titles = ["Explosion près du port Odessa : témoins sur les quais", "Détonation entendue à Odessa dans le quartier maritime", "Odessa : explosion observée depuis une rue voisine", "Un bruit d'explosion à Odessa rapporté par une équipe locale", "Explosion dans Odessa, dégâts au port selon un correspondant"];
  return signal({ id: `source-${index}`, provider: `publisher-${index}`, url: `https://news-${index}.example/story`, title: titles[index % titles.length], ...overrides });
}

describe("détection incrémentale ORBITAL", () => {
  it("A : dix copies, même article canonique et dépêche = une source indépendante", () => {
    const { engine, store } = setup();
    engine.ingest(Array.from({ length: 10 }, (_, index) => distinct(index, { title: "Explosion signalée à Odessa près du port", url: `https://wire.example/story?utm_source=${index}`, upstreamAgency: "reuters" })), NOW);
    const events = engine.snapshot(NOW).events;
    expect(events).toHaveLength(1);
    expect(events[0]).toMatchObject({ evidenceCount: 10, independentSourceCount: 1, distinctProviderCount: 10 });
    expect(events[0].confidenceScore).toBeLessThan(50);
    store.close();
  });
  it("B : cinq médias distincts avec descriptions différentes = plusieurs provenances", () => {
    const { engine, store } = setup();
    engine.ingest(Array.from({ length: 5 }, (_, index) => distinct(index)), NOW);
    const events = engine.snapshot(NOW).events;
    expect(events).toHaveLength(1);
    expect(events[0].independentSourceCount).toBe(5);
    expect(events[0].status).not.toBe("confirmed");
    store.close();
  });
  it("C : explosions à trois heures d'intervalle restent séparées", () => {
    const { engine, store } = setup();
    engine.ingest([signal(), distinct(1, { occurredAt: new Date(NOW + 3 * 3_600_000).toISOString() })], NOW + 3 * 3_600_000);
    expect(engine.snapshot(NOW + 3 * 3_600_000).events).toHaveLength(2);
    store.close();
  });
  it("le rapprochement de titres détaillés exige un même lieu et des positions fiables proches", () => {
    for (const overrides of [
      { position: null },
      { place: "Autre quartier" },
      { position: { lat: 49.99, lon: 36.23, precision: "city" as const } },
    ]) {
      const { engine, store } = setup();
      engine.ingest([distinct(0), distinct(2, overrides)], NOW);
      expect(engine.snapshot(NOW).events).toHaveLength(2);
      store.close();
    }
  });
  it("D : formulations et graphies différentes du même lieu fusionnent", () => {
    const { engine, store } = setup();
    engine.ingest([signal(), distinct(1, { title: "Forte détonation entendue dans le centre d'Odesa", place: "Odesa" })], NOW);
    expect(engine.snapshot(NOW).events).toHaveLength(1);
    store.close();
  });
  it("E : missile et explosion industrielle rendent l'incertitude visible", () => {
    const { engine, store } = setup();
    engine.ingest([signal({ title: "Explosion missile près du port Odessa" }), distinct(1, { title: "Explosion industrielle près du port Odessa" })], NOW);
    const event = engine.snapshot(NOW).events[0];
    expect(event.evidenceCount).toBe(2);
    expect(event.contradictions.join(" ")).toContain("incertaine");
    expect(event.confidence.factors.find((factor) => factor.code === "contradictions")?.points).toBeLessThan(0);
    expect(event.confidenceScore).toBeLessThan(75);
    store.close();
  });
  it("F : une observation officielle concordante augmente le score et trace le franchissement", () => {
    const { engine, store } = setup();
    engine.ingest([signal(), distinct(1)], NOW);
    const before = engine.snapshot(NOW).events[0];
    engine.ingest([distinct(2, { nature: "official", confirmsOccurrence: true, title: "Explosion constatée près du port Odessa par les autorités" })], NOW + 60_000);
    const after = engine.snapshot(NOW + 60_000).events[0];
    expect(after.confidenceScore).toBeGreaterThan(before.confidenceScore);
    expect(after.status).toBe("high");
    expect(after.timeline.some((entry) => entry.type === "assessment_changed" && entry.confidenceScore >= 75)).toBe(true);
    expect(after.timeline[0].signalId).toBe("first");
    expect(after.confidence.factors.reduce((sum, factor) => sum + factor.points, 0)).toBe(after.confidenceScore);
    store.close();
  });
  it("G : vieillissement et répétitions ne prolongent pas artificiellement le LIVE", () => {
    const { engine, store } = setup();
    engine.ingest([signal()], NOW);
    expect(engine.snapshot(NOW).live).toHaveLength(1);
    const old = engine.snapshot(NOW + 7 * 3_600_000);
    expect(old.live).toHaveLength(0);
    expect(old.events[0].confidenceScore).toBeLessThan(engine.snapshot(NOW).events[0].confidenceScore);
    engine.ingest([signal({ receivedAt: new Date(NOW + 7 * 3_600_000).toISOString() })], NOW + 7 * 3_600_000);
    expect(engine.snapshot(NOW + 7 * 3_600_000).live).toHaveLength(0);
    store.close();
  });
  it("H : preuves, identité et timeline restaurées après fermeture/réouverture SQLite", () => {
    const directory = mkdtempSync(path.join(os.tmpdir(), "orbital-detection-"));
    try {
      const filename = path.join(directory, "events.sqlite");
      const firstStore = new SqliteDetectionStore(filename);
      const first = new DetectionEngine(firstStore);
      first.ingest([signal(), distinct(1)], NOW);
      const before = first.snapshot(NOW);
      firstStore.close();
      const secondStore = new SqliteDetectionStore(filename);
      const second = new DetectionEngine(secondStore);
      expect(second.snapshot(NOW)).toEqual(before);
      expect(second.ingest([signal()], NOW).skipped).toBe(1);
      secondStore.close();
    } finally { rmSync(directory, { recursive: true, force: true }); }
  });
  it("I : sans coordonnées, conserve null et rapproche le lieu explicite", () => {
    const { engine, store } = setup();
    engine.ingest([signal({ position: null }), distinct(1, { position: null })], NOW);
    const event = engine.snapshot(NOW).events[0];
    expect(event.position).toBeNull();
    expect(event.evidenceCount).toBe(2);
    expect(event.confidenceScore).toBeLessThan(75);
    store.close();
  });
  it("J : deux fournisseurs relayant Reuters restent une seule provenance", () => {
    const { engine, store } = setup();
    engine.ingest([signal({ provider: "gdelt", upstreamAgency: "reuters" }), distinct(1, { upstreamAgency: "reuters" })], NOW);
    expect(engine.snapshot(NOW).events[0]).toMatchObject({ independentSourceCount: 1, distinctProviderCount: 2 });
    store.close();
  });
  it("même fournisseur, copies transitives et sous-domaine ne multiplient pas les confirmations", () => {
    const { engine, store } = setup();
    engine.ingest([signal({ upstreamAgency: "reuters" }), distinct(1, { provider: "local-a", upstreamAgency: "reuters" }), distinct(2, { upstreamAgency: "reuters" })], NOW);
    expect(engine.snapshot(NOW).events[0].independentSourceCount).toBe(1);
    store.close();
  });
  it("borne la fenêtre entière et ne chaîne pas des explosions à l'infini", () => {
    const { engine, store } = setup();
    engine.ingest([signal(), distinct(1, { occurredAt: new Date(NOW + 40 * 60_000).toISOString() }), distinct(2, { occurredAt: new Date(NOW + 80 * 60_000).toISOString() })], NOW + 80 * 60_000);
    expect(engine.snapshot(NOW + 80 * 60_000).events).toHaveLength(2);
    store.close();
  });
  it("ne rapproche pas deux villes distantes malgré le même titre", () => {
    const { engine, store } = setup();
    engine.ingest([signal(), distinct(1, { position: { lat: 49.99, lon: 36.23, precision: "city" } })], NOW);
    expect(engine.snapshot(NOW).events).toHaveLength(2);
    store.close();
  });
  it("dates absentes : pas de date réelle fabriquée, pas de LIVE", () => {
    const { engine, store } = setup();
    engine.ingest([signal({ occurredAt: null, position: null })], NOW);
    expect(engine.snapshot(NOW).events[0].occurredAt).toBeNull();
    expect(engine.snapshot(NOW).live).toHaveLength(0);
    store.close();
  });
  it("répétition idempotente et révision de magnitude sans nouvelle preuve", () => {
    const { engine, store } = setup();
    engine.ingest([signal()], NOW);
    const first = engine.snapshot(NOW).events[0];
    engine.ingest([signal()], NOW + 1000);
    expect(engine.snapshot(NOW).events[0].timeline).toEqual(first.timeline);
    engine.ingest([signal({ text: "Correction publiée", severity: "severe" })], NOW + 2000);
    const revised = engine.snapshot(NOW + 2000).events[0];
    expect(revised.evidenceCount).toBe(1);
    expect(revised.timeline.some((entry) => entry.type === "evidence_updated")).toBe(true);
    store.close();
  });
  it("rétention explicite à sept jours", () => {
    const { engine, store } = setup();
    engine.ingest([signal()], NOW);
    expect(engine.snapshot(NOW + RETENTION_MS + 1).events).toEqual([]);
    store.close();
  });
  it("borne les preuves et plafonne les événements tronqués", () => {
    const { engine, store } = setup();
    engine.ingest(Array.from({ length: MAX_EVIDENCE + 5 }, (_, index) => distinct(index, { title: "Explosion près du port Odessa" })), NOW);
    const event = engine.snapshot(NOW).events[0];
    expect(event.evidence).toHaveLength(MAX_EVIDENCE);
    expect(event.evidenceTruncated).toBe(true);
    expect(event.confidenceScore).toBeLessThan(75);
    store.close();
  });
  it("URL canonique : tracking retiré, identifiant d'article préservé", () => {
    expect(canonicalUrl("https://www.example.com/story?id=7&utm_campaign=news#top")).toBe("example.com/story?id=7");
    expect(canonicalUrl("javascript:alert(1)")).toBeNull();
  });
  it("adaptateur GDELT : date de détection, pas heure de l'événement/publication", () => {
    const value = fromConflict({ id: "gdelt-1", sourceDataset: "gdelt", source: "GDELT", sourceUrl: "https://example.com/story", title: "Explosion à Odessa", eventType: "Media signal", subEventType: "", actors: [], fatalities: 0, latitude: 46.48, longitude: 30.73, geoPrecision: "city", country: "Ukraine", locality: "Odessa", region: "", confidence: "MEDIA_SIGNAL", eventDate: new Date(NOW).toISOString(), updatedAt: new Date(NOW).toISOString() }, new Date(NOW).toISOString());
    expect(value).toMatchObject({ occurredAt: null, publishedAt: null, detectedAt: new Date(NOW).toISOString(), confirmsOccurrence: false });
    expect(value?.position?.precision).toBe("unknown");
  });
  it("un séisme USGS mesuré peut entrer vite ; magnitude indépendante de confiance", () => {
    const item = fromFeed({ id: "usgs:test", sourceId: "usgs", sourceName: "USGS", nature: "sensor_measurement", category: "disaster", title: "Séisme de magnitude 6.4 au Japon", summary: null, url: "https://earthquake.usgs.gov/test", occurredAt: new Date(NOW).toISOString(), publishedAt: null, fetchedAt: new Date(NOW).toISOString(), lat: 35, lon: 140, countries: ["JPN"], severity: "severe", metric: { label: "Magnitude", value: 6.4, unit: "M" }, caveat: "Mesure préliminaire" })!;
    const { engine, store } = setup();
    engine.ingest([item], NOW);
    expect(engine.snapshot(NOW).live[0]).toMatchObject({ status: "probable", importanceScore: 70 });
    expect(engine.snapshot(NOW).live[0].evidence[0].signal.caveat).toBe("Mesure préliminaire");
    store.close();
  });
});
