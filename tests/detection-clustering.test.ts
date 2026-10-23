import { afterEach, describe, expect, it } from "vitest";
import type { OrbitalEvent, Signal } from "@/types/detection";
import { CANDIDATE_WINDOW_MS, match, matchDecision, MAX_EVENT_SPAN_MS, WINDOW_MS } from "@/server/detection/cluster";
import { DetectionEngine } from "@/server/detection/engine";
import { evidence, independence } from "@/server/detection/fingerprint";
import { SqliteDetectionStore } from "@/server/detection/store";
import { MAX_CANDIDATES, MAX_EVIDENCE, MAX_MATCH_EVIDENCE } from "@/server/detection/limits";

const NOW = Date.parse("2026-10-21T12:00:00Z");
const stores: SqliteDetectionStore[] = [];
afterEach(async () => { await Promise.all(stores.splice(0).map((store) => store.close())); });

function signal(index: number, minutes = 0, overrides: Partial<Signal> = {}): Signal {
  return {
    id: `signal-${index}`, provider: `provider-${index}`, sourceName: `Source ${index}`,
    url: `https://source-${index}.example/article`, title: [
      "Explosion au terminal Neptune du port Odessa", "Terminal Neptune Odessa : détonation et incendie sur les quais",
      "Dégâts et évacuation du terminal Neptune Odessa après une explosion", "Neptune Odessa : explosion observée, accès au terminal fermé",
    ][index % 4],
    text: null, kind: "explosion", nature: "press", occurredAt: new Date(NOW + minutes * 60_000).toISOString(),
    publishedAt: null, receivedAt: new Date(NOW).toISOString(),
    position: { lat: 46.48, lon: 30.73, precision: "city" }, place: "Odessa", countries: ["UKR"],
    entities: ["terminal Neptune"], upstreamAgency: null, confirmsOccurrence: false,
    severity: null, metric: null, caveat: "Fixture synthétique, pas un événement réel", ...overrides,
  };
}

function setup() {
  const store = new SqliteDetectionStore(":memory:");
  stores.push(store);
  return { store, engine: new DetectionEngine(store) };
}

async function cluster(signals: Signal[]): Promise<OrbitalEvent> {
  const { engine } = setup();
  await engine.ingest([signals[0]], NOW);
  const event = (await engine.snapshot(NOW)).events[0];
  event.evidence = independence(signals.map(evidence));
  return event;
}

describe("clustering prudent et robuste", async () => {
  it("une vieille preuve isolée ne rejette pas deux preuves récentes compatibles", async () => {
    const event = await cluster([signal(0, -120), signal(1, -10), signal(2, -5)]);
    expect(match(signal(3), event)).toBeGreaterThan(0);
  });

  it("une coordonnée aberrante isolée ne rejette pas la majorité cohérente", async () => {
    const event = await cluster([signal(0, 0, { position: { lat: 60, lon: 10, precision: "point" } }), signal(1), signal(2)]);
    expect(match(signal(3), event)).toBeGreaterThan(0);
    expect(match(signal(4, 0, { position: { lat: 60, lon: 10, precision: "point" } }), event)).toBe(0);
  });

  it("retrouve un cluster existant malgré son ancrage ancien", async () => {
    const event = await cluster([signal(0, -120), signal(1, -10), signal(2, -5)]);
    const { store, engine } = setup();
    await store.transaction(async (transaction) => { await transaction.createEventExclusive(event, NOW - 120 * 60_000); });
    await engine.ingest([signal(3)], NOW);
    expect((await engine.snapshot(NOW)).events).toHaveLength(1);
  });

  it("suit une panne pendant plus de 45 minutes avec plusieurs appuis récents", async () => {
    const { engine } = setup();
    await engine.ingest([0, 20, 40, 60, 80, 100, 120].map((minutes, index) => signal(index, minutes, {
      kind: "outage", entities: ["réseau Neptune"], title: [
        "Panne du réseau Neptune Odessa, alimentation interrompue", "Neptune Odessa : panne, réparation du réseau en cours",
        "Réseau Neptune Odessa indisponible, équipes mobilisées", "Réseau Neptune Odessa : panne persistante, rétablissement différé",
        "Réseau Neptune Odessa privé de courant, techniciens présents", "Neptune Odessa : réseau toujours coupé, nouvelles interventions",
        "Panne du réseau Neptune Odessa, réparation achevée et remise sous tension",
      ][index],
    })), NOW + 120 * 60_000);
    expect((await engine.snapshot(NOW + 120 * 60_000)).events.map((event) => event.evidence.map((item) => item.signal.id))).toEqual([
      ["signal-0", "signal-1", "signal-2", "signal-3", "signal-4", "signal-5", "signal-6"],
    ]);
  });

  it.each(["explosion", "missile", "earthquake", "protest", "outage", "attack"])("le mot générique %s et la ville ne suffisent pas", async (word) => {
    const event = await cluster([signal(0, 0, { title: `${word} Odessa`, entities: [] })]);
    expect(match(signal(1, 0, { title: `${word} Odessa`, entities: [] }), event)).toBe(0);
  });

  it("sépare deux sites simultanés dans la même ville", async () => {
    const event = await cluster([signal(0)]);
    expect(match(signal(1, 0, { title: "Explosion au terminal Boreal du port Odessa", entities: ["terminal Boreal"] }), event)).toBe(0);
  });

  it("sépare deux lieux explicites même sans coordonnées fiables", async () => {
    const event = await cluster([signal(0, 0, { position: null })]);
    expect(match(signal(1, 0, { position: null, place: "Kharkiv" }), event)).toBe(0);
  });

  it("accepte une nouvelle preuve précise à proximité du noyau", async () => {
    expect(matchDecision(signal(3, 0, { position: { lat: 46.49, lon: 30.72, precision: "point" } }), await cluster([signal(0)])))
      .toMatchObject({ reasons: expect.arrayContaining(["geographic_match", "temporal_match", "entity_match"]), supportingSignalIds: ["signal-0"] });
  });

  it("ne laisse pas une forte ressemblance franchir 1500 km", async () => {
    expect(matchDecision(signal(1, 0, { title: signal(0).title, position: { lat: 46.48, lon: 10.73, precision: "point" } }), await cluster([signal(0)])))
      .toMatchObject({ score: 0, reasons: ["rejected_distance"] });
  });

  it("refuse une géographie partagée à égalité", async () => {
    const event = await cluster([signal(0), signal(1, 0, { position: { lat: 60, lon: 10, precision: "point" } })]);
    expect(match(signal(2), event)).toBe(0);
  });

  it("un seul appui cohérent ne suffit pas face à une majorité incompatible", async () => {
    const event = await cluster([signal(0), signal(1, 0, { entities: ["terminal Boreal"] }), signal(2, 0, { entities: ["terminal Boreal"] })]);
    expect(matchDecision(signal(3), event)).toMatchObject({ score: 0, reasons: expect.arrayContaining(["rejected_consensus", "rejected_entities"]) });
  });

  it("des copies syndiquées ne constituent pas une majorité géographique", async () => {
    const event = await cluster([signal(0), ...Array.from({ length: 10 }, (_, index) => signal(index + 1, 0, {
      upstreamAgency: "reuters", position: { lat: 60, lon: 10, precision: "point" },
    }))]);
    expect(match(signal(20, 0, { position: { lat: 60, lon: 10, precision: "point" } }), event)).toBe(0);
  });

  it("deux reformulations précises avec une entité spécifique commune peuvent se rejoindre", async () => {
    expect(match(signal(1), await cluster([signal(0)]))).toBeGreaterThan(0);
  });

  it("sans coordonnées il faut un lieu explicite et une forte ressemblance descriptive", async () => {
    const event = await cluster([signal(0, 0, { position: null })]);
    expect(match(signal(1, 0, { title: signal(0).title, position: null }), event)).toBeGreaterThan(0);
    expect(match(signal(2, 0, { title: "Neptune Odessa : bâtiment évacué", position: null }), event)).toBe(0);
    expect(match(signal(3, 0, { title: signal(0).title, position: null, place: null }), event)).toBe(0);
  });

  it("une position régionale ne devient pas un appui géographique précis", async () => {
    const event = await cluster([signal(0, 0, { position: { lat: 46.48, lon: 30.73, precision: "region" } })]);
    const decision = matchDecision(signal(1, 0, { title: signal(0).title }), event);
    expect(decision.score).toBeGreaterThan(0);
    expect(decision.reasons).not.toContain("geographic_match");
  });

  it("des pays explicitement différents restent un indice négatif", async () => {
    expect(matchDecision(signal(1, 0, { countries: ["FRA"] }), await cluster([signal(0)])))
      .toMatchObject({ score: 0, reasons: expect.arrayContaining(["rejected_country"]) });
  });

  it("une date de publication ne prouve pas la date d'occurrence", async () => {
    const incoming = signal(1, 0, { title: signal(0).title, occurredAt: null, publishedAt: new Date(NOW).toISOString() });
    expect(matchDecision(incoming, await cluster([signal(0)]))).toMatchObject({ score: 0, reasons: expect.arrayContaining(["uncertain_occurrence"]) });
  });

  it.each(["publishedAt", "detectedAt"] as const)("regroupe les copies à occurrence inconnue avec %s sans confirmer l'occurrence", async (field) => {
    const { engine } = setup();
    await engine.ingest([0, 1, 2].map((index) => signal(index, 0, {
      title: signal(0).title, occurredAt: null, [field]: new Date(NOW).toISOString(),
    })), NOW);
    const events = (await engine.snapshot(NOW)).events;
    expect(events).toHaveLength(1);
    expect(events[0]).toMatchObject({ occurredAt: null, independentSourceCount: 1, confidence: { confirmationBasis: null } });
    expect(events[0].confidenceScore).toBeLessThan(50);
    expect(events[0].evidence[1].matching?.reasons).toContain("uncertain_occurrence");
  });

  it("les titres différents à occurrence inconnue restent séparés", async () => {
    const event = await cluster([signal(0, 0, { occurredAt: null, publishedAt: new Date(NOW).toISOString() })]);
    expect(match(signal(1, 0, { occurredAt: null, publishedAt: new Date(NOW).toISOString() }), event)).toBe(0);
  });

  it("refuse les dates manquantes et les positions invalides ne deviennent pas précises", async () => {
    expect(match(signal(1, 0, { occurredAt: null }), await cluster([signal(0)]))).toBe(0);
    const decision = matchDecision(signal(1, 0, { title: signal(0).title, position: { lat: NaN, lon: 30, precision: "point" } }), await cluster([signal(0)]));
    expect(decision.reasons).not.toContain("geographic_match");
  });

  it.each(["explosion", "earthquake", "incident", "thermal"] as const)("ne chaîne pas indéfiniment des %s instantanés", async (kind) => {
    const { engine } = setup();
    await engine.ingest([0, 40, 80].map((minutes, index) => signal(index, minutes, { kind })), NOW + 80 * 60_000);
    expect((await engine.snapshot(NOW + 80 * 60_000)).events).toHaveLength(2);
  });

  it.each(["outage", "protest", "weather"] as const)("la continuation %s exige deux groupes récents et une durée bornée", async (kind) => {
    const event = await cluster([signal(0, -100, { kind }), signal(1, -20, { kind }), signal(2, -10, { kind })]);
    expect(matchDecision(signal(3, 0, { kind }), event).reasons).toContain("continuing_event");
    const isolated = await cluster([signal(0, -100, { kind }), signal(1, -20, { kind })]);
    expect(match(signal(2, 0, { kind }), isolated)).toBe(0);
    expect(match(signal(3, MAX_EVENT_SPAN_MS / 60_000, { kind }), event)).toBe(0);
  });

  it("une seule dépêche copiée ne prolonge pas un événement durable", async () => {
    const event = await cluster([signal(0, -100, { kind: "outage" }), signal(1, -20, { kind: "outage", upstreamAgency: "reuters" }), signal(2, -10, { kind: "outage", upstreamAgency: "reuters" })]);
    expect(match(signal(3, 0, { kind: "outage" }), event)).toBe(0);
  });

  it("préserve la limite exacte de 45 minutes pour un appui isolé", async () => {
    const event = await cluster([signal(0)]);
    expect(match(signal(1, WINDOW_MS / 60_000), event)).toBeGreaterThan(0);
    expect(match(signal(1, (WINDOW_MS + 1) / 60_000), event)).toBe(0);
  });

  it("reste déterministe quand l'ordre des preuves change", async () => {
    const event = await cluster([signal(0, -120), signal(1, -10), signal(2, -5)]);
    const before = matchDecision(signal(3), event);
    event.evidence.reverse();
    expect(matchDecision(signal(3), event)).toEqual(before);
  });

  it("refuse explicitement les ensembles dépassant les limites au lieu de sous-échantillonner", async () => {
    const event = await cluster([signal(0)]);
    event.evidence = Array.from({ length: MAX_MATCH_EVIDENCE + 1 }, (_, index) => evidence(signal(index)));
    expect(matchDecision(signal(40), event)).toMatchObject({ score: 0, reasons: ["rejected_limit"] });
    event.evidence = Array.from({ length: MAX_EVIDENCE + 1 }, () => evidence(signal(0)));
    expect(matchDecision(signal(40), event).reasons).toEqual(["rejected_limit"]);
  });

  it("borne et ordonne les candidats SQLite avant désérialisation", async () => {
    const event = await cluster([signal(0)]);
    const { store } = setup();
    await store.transaction(async (transaction) => {
      for (let index = 0; index < MAX_CANDIDATES * 4; index++) await transaction.createEventExclusive({ ...event, id: `candidate-${index}` }, NOW + (index - MAX_CANDIDATES * 2) * 1000);
      const candidates = await transaction.candidates("explosion", NOW, CANDIDATE_WINDOW_MS);
      expect(candidates).toHaveLength(MAX_CANDIDATES);
      expect(candidates[0].id).toBe(`candidate-${MAX_CANDIDATES * 2}`);
      expect(new Set(candidates.map((candidate) => candidate.id)).size).toBe(MAX_CANDIDATES);
      expect(await transaction.candidates("weather", NOW, CANDIDATE_WINDOW_MS)).toEqual([]);
    });
  });

  it("conserve séparé un signal aussi compatible avec deux clusters distincts", async () => {
    const first = await cluster([signal(0)]);
    const { store, engine } = setup();
    await store.transaction(async (transaction) => {
      await transaction.createEventExclusive(first, NOW);
      await transaction.createEventExclusive({ ...first, id: "second-event" }, NOW);
    });
    await engine.ingest([signal(3)], NOW);
    const events = (await engine.snapshot(NOW)).events;
    expect(events).toHaveLength(3);
    expect(events.find((event) => event.evidence.some((item) => item.signal.id === "signal-3"))?.evidence[0].matching?.reasons).toEqual(["rejected_ambiguous"]);
  });
});
