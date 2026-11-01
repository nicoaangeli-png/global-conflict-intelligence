import { describe, expect, it } from "vitest";
import type { ConflictCluster } from "@/types/conflict";
import type { FeedsResponse } from "@/types/feeds";
import sample from "./fixtures/ui-feeds-sample.json";
import { dedupeFeeds, selectConflictSignals, signalForFeed, validPosition } from "@/components/globe2/productIntel";

const feeds = sample as unknown as FeedsResponse;
const earthquake = feeds.items.find(item => item.sourceId === "usgs")!;

const cluster = (overrides: Partial<ConflictCluster> = {}): ConflictCluster => ({
  id: "cluster:test", latitude: 48, longitude: 2, country: "France", region: "", locality: "",
  eventCount: 10, fatalities: 0, intensity: 0.5, typeCounts: { Battles: 10 }, topType: "Battles",
  confidence: "MEDIA_SIGNAL", confidenceCounts: { MEDIA_SIGNAL: 10 },
  firstEventAt: "2026-10-01T00:00:00Z", lastEventAt: "2026-10-18T00:00:00Z", eventIds: [], realShare: 1,
  ...overrides,
});

describe("Globe2 Product Integration — signaux réels", () => {
  it("écarte les fixtures, anomalies non conflictuelles et coordonnées invalides du rouge conflit", () => {
    const selected = selectConflictSignals([
      cluster(), cluster({ id: "demo", realShare: 0 }),
      cluster({ id: "thermal", topType: "Thermal anomaly" }),
      cluster({ id: "invalid", latitude: NaN }),
      cluster({ id: "weak", intensity: 0.2 }),
    ]);
    expect(selected.map(item => item.id)).toEqual(["cluster:test"]);
  });

  it("réserve le rouge critique aux alertes officielles sévères ou extrêmes", () => {
    expect(signalForFeed(earthquake)?.kind).toBe("event");
    expect(signalForFeed({ ...earthquake, nature: "official_alert", severity: "severe" })?.kind).toBe("critical");
    expect(signalForFeed({ ...earthquake, nature: "press_article", severity: "severe" })?.kind).toBe("event");
  });

  it("ne géolocalise pas une actualité sans position valide", () => {
    expect(signalForFeed({ ...earthquake, lat: null })).toBeNull();
    expect(signalForFeed({ ...earthquake, lon: Infinity })).toBeNull();
    expect(validPosition(90, 180)).toBe(true);
    expect(validPosition(91, 0)).toBe(false);
  });

  it("déduplique les réponses de sources sans toucher à la provenance", () => {
    const result = dedupeFeeds([feeds, feeds]);
    expect(result).toHaveLength(feeds.items.length);
    expect(result.find(item => item.id === earthquake.id)?.sourceName).toBe(earthquake.sourceName);
  });
});
