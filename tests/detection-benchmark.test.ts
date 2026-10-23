import { describe, expect, it } from "vitest";
import { renderMetrics, resetMetrics } from "@/server/observability/metrics";
import { MAX_EVIDENCE } from "@/server/detection/engine";
import { DetectionEngine } from "@/server/detection/engine";
import { PostgresDetectionStore } from "@/server/detection/postgresStore";
import { assess } from "@/server/detection/engine";
import { matchingAnchor } from "@/server/detection/cluster";
import { evidence, hash } from "@/server/detection/fingerprint";
import { Pool } from "pg";
import { ADMISSION_NOW, benchmarkMetadata, context, loadPerformance, permutations, quality, revisions, saturation } from "../benchmarks/detection/run";
import { BENCHMARK_NOW, DATASET_VERSION, GOLDEN_CASES } from "../benchmarks/detection/golden";
import { detectionCounts, pairwiseCounts, percentile } from "../benchmarks/detection/metrics";
import { event } from "./detection-store-helpers";

const postgresUrl = process.env.ORBITAL_TEST_DATABASE_URL;
const full = process.env.ORBITAL_BENCHMARK_FULL === "1";

describe("benchmark de qualité détection", () => {
  it("charge une vérité terrain versionnée, explicite, sans réseau et avec contre-exemples", () => {
    expect(DATASET_VERSION).toMatch(/^\d+\.\d+\.\d+$/);
    expect(GOLDEN_CASES.length).toBeGreaterThanOrEqual(16);
    expect(new Set(GOLDEN_CASES.map((item) => item.id)).size).toBe(GOLDEN_CASES.length);
    expect(GOLDEN_CASES.filter((item) => item.truth === null).length).toBeGreaterThanOrEqual(5);
    expect(GOLDEN_CASES.some((item) => /français/.test(item.rationale))).toBe(true);
    expect(GOLDEN_CASES.every((item) => !item.signal.url || item.signal.url.includes(".example/"))).toBe(true);
    expect(BENCHMARK_NOW).toBe(Date.parse("2026-10-22T12:00:00Z"));
  });

  it("calcule les quatre cellules et les ratios sans division artificielle par zéro", () => {
    const truth = new Map([["a", "one"], ["b", "one"], ["c", null], ["d", null]]);
    expect(detectionCounts(truth, new Set(["a", "c"]))).toEqual({ tp: 1, fp: 1, fn: 1, tn: 1, precision: 0.5, recall: 0.5, f1: 0.5 });
    expect(detectionCounts(new Map(), new Set()).precision).toBeNull();
    expect(percentile([9, 2, 5, 1], 0.95)).toBe(9);
    expect(percentile([], 0.5)).toBeNull();
    expect(pairwiseCounts(truth, []).apartWrong).toBe(1);
  });

  it("mesure les admissions, faux positifs, clusters et idempotence SQLite", async () => {
    resetMetrics();
    const result = await quality("sqlite");
    expect(result.signalCount).toBe(GOLDEN_CASES.length);
    expect(result.detection.tp + result.detection.fp + result.detection.fn + result.detection.tn).toBe(GOLDEN_CASES.length);
    expect(result.clustering.togetherCorrect + result.clustering.togetherWrong + result.clustering.apartCorrect + result.clustering.apartWrong).toBe(result.positiveSignals * (result.positiveSignals - 1) / 2);
    expect(result.deduplication.exactReplaySkipped).toBe(true);
    expect(result.integrity).toMatchObject({ hiddenMappings: 0, missingMappings: 0 });
    expect(renderMetrics()).toContain("orbital_detection_duration_seconds_count");
    // Seuils de non-régression initiaux ; les objectifs aspirants sont documentés séparément.
    expect(result.detection.precision).toBeGreaterThanOrEqual(0.7);
    expect(result.detection.recall).toBeGreaterThanOrEqual(0.9);
    expect(result.detection.fp).toBeLessThanOrEqual(4);
    expect(result.clustering.f1).toBeGreaterThanOrEqual(0.9);
    expect(result.groupAssessment.filter((item) => item.categoryCorrect && item.placeCorrect && item.countryCorrect).length).toBeGreaterThanOrEqual(5);
    expect(result.corroboration.some((item) => item.evidence === 1 && item.independentSourceCount === 1)).toBe(true);
    expect(result.corroboration.some((item) => item.evidence === 2 && item.independentSourceCount === 2)).toBe(true);
    expect(result.corroboration.find((item) => item.evidenceIds.includes("port-en"))).toMatchObject({ evidence: 5, independentSourceCount: 3, distinctProviderCount: 5 });
  });

  it("collision d'ID dérivé : l'occupant reste intact et l'identité alternative est distincte", async () => {
    const run = await context("sqlite");
    try {
      const incoming = GOLDEN_CASES[0].signal;
      const occupiedId = `orbital:${hash(incoming.id)}`;
      const occupantSignal = { ...GOLDEN_CASES[7].signal, id: "occupant" };
      const occupant = assess({ ...event(occupiedId), kind: "earthquake", title: occupantSignal.title, place: "Tokyo", evidence: [evidence(occupantSignal)] }, ADMISSION_NOW);
      await run.store.transaction(async (tx) => { expect(await tx.createEventExclusive(occupant, matchingAnchor(occupant))).toBe(true); await tx.remember("occupant", occupiedId, "occupant-digest"); });
      await run.engine.ingest([incoming], ADMISSION_NOW);
      const events = (await run.engine.snapshot(ADMISSION_NOW)).events;
      expect(events.find((item) => item.id === occupiedId)?.evidence.map((item) => item.signal.id)).toEqual(["occupant"]);
      expect(events.find((item) => item.evidence.some((entry) => entry.signal.id === incoming.id))?.id).not.toBe(occupiedId);
    } finally { await run.cleanup(); }
  });

  it("teste séparément la révision compatible et le changement de catégorie/lieu", async () => {
    const result = await revisions("sqlite");
    expect(result).toMatchObject({ compatibleIdentityRetained: true, incompatibleOldIdentityRemoved: true, incompatibleCorrectCategory: true, incompatibleCorrectPlace: true, incompatibleNewIdentity: true, integrity: { hiddenMappings: 0, missingMappings: 0 } });
  });

  it("teste la borne exacte de 128 et l'absence de mapping fantôme", async () => {
    const result = await saturation("sqlite");
    expect(result).toMatchObject({ first: { accepted: MAX_EVIDENCE }, next: { accepted: 0, skipped: 1 }, retry: { accepted: 0, skipped: 1 }, evidence: MAX_EVIDENCE, truncated: true, integrity: { represented: MAX_EVIDENCE, mapped: MAX_EVIDENCE, hiddenMappings: 0, missingMappings: 0 } });
  }, 30_000);

  it("mesure plusieurs ordres déterministes sans imposer une stabilité non démontrée", async () => {
    const result = await permutations("sqlite");
    expect(result.variants.map((entry) => entry.seed)).toEqual([1, 7, 42, 2026]);
    expect(result.variants.every((entry) => entry.eventCount > 0)).toBe(true);
  }, 30_000);

  it("rollback : aucun mapping partiel lors d'un lot invalide", async () => {
    const run = await context("sqlite");
    try {
      const signal = GOLDEN_CASES[0].signal;
      await expect(run.engine.ingest(Array.from({ length: 501 }, () => signal), ADMISSION_NOW)).rejects.toThrow(/500/);
      expect((await run.engine.snapshot(ADMISSION_NOW)).events).toHaveLength(0);
    } finally { await run.cleanup(); }
  });

  it("produit un contrat JSON sans donnée utilisateur ni secret", async () => {
    const report = { ...benchmarkMetadata("sqlite"), quality: await quality("sqlite") };
    const encoded = JSON.stringify(report);
    expect(JSON.parse(encoded)).toMatchObject({ reportVersion: 1, datasetVersion: DATASET_VERSION, backend: "sqlite" });
    expect(encoded).not.toMatch(/DATABASE_URL|Authorization|api[_-]?key|sk-proj/i);
  });
});

describe.skipIf(!postgresUrl)("benchmark réel PostgreSQL", () => {
  it("reproduit la qualité, les révisions et la borne sans divergence fonctionnelle cachée", async () => {
    const sqlite = await quality("sqlite");
    const postgres = await quality("postgres", postgresUrl);
    expect(postgres.detection).toEqual(sqlite.detection);
    expect(postgres.clustering).toEqual(sqlite.clustering);
    expect(postgres.partition).toEqual(sqlite.partition);
    expect(postgres.groupAssessment).toEqual(sqlite.groupAssessment);
    expect(postgres.integrity).toMatchObject({ hiddenMappings: 0, missingMappings: 0 });
    expect(await revisions("postgres", postgresUrl)).toEqual(await revisions("sqlite"));
    expect(await saturation("postgres", postgresUrl)).toEqual(await saturation("sqlite"));
  }, 120_000);

  it("admet en parallèle sur deux stores PostgreSQL indépendants sans double mapping", async () => {
    const run = await context("postgres", postgresUrl);
    const secondStore = new PostgresDetectionStore({ connectionString: postgresUrl!, schema: run.schema });
    const secondEngine = new DetectionEngine(secondStore);
    const query = new Pool({ connectionString: postgresUrl!, options: `-c search_path=${run.schema}` });
    try {
      const admissions = await Promise.all(Array.from({ length: 20 }, (_, index) => {
        const base = GOLDEN_CASES[index % 2].signal;
        const signal = { ...base, id: `concurrent-${index}`, provider: `concurrent-provider-${index}`, url: `https://concurrent-${index}.example/story` };
        return (index % 2 ? secondEngine : run.engine).ingest([signal], ADMISSION_NOW);
      }));
      expect(admissions.reduce((total, result) => total + result.accepted, 0)).toBe(20);
      const events = (await run.engine.snapshot(ADMISSION_NOW)).events;
      expect(events.flatMap((event) => event.evidence).length).toBe(20);
      expect((await query.query("SELECT count(*) AS n FROM detection_signals")).rows[0].n).toBe("20");
      const sql = await query.query<{ orphan: string; hidden: string; empty: string; duplicate: string }>(`
        SELECT
          (SELECT count(*) FROM detection_signals s LEFT JOIN detection_events e ON e.id=s.event_id WHERE e.id IS NULL) AS orphan,
          (SELECT count(*) FROM detection_signals s JOIN detection_events e ON e.id=s.event_id
             WHERE NOT (e.payload->'evidence' @> jsonb_build_array(jsonb_build_object('signal', jsonb_build_object('id', s.id))))) AS hidden,
          (SELECT count(*) FROM detection_events WHERE jsonb_array_length(payload->'evidence')=0) AS empty,
          (SELECT count(*) FROM (SELECT id FROM detection_signals GROUP BY id HAVING count(*)>1) d) AS duplicate`);
      expect(sql.rows[0]).toEqual({ orphan: "0", hidden: "0", empty: "0", duplicate: "0" });
    } finally { await query.end(); await secondStore.close(); await run.cleanup(); }
  }, 120_000);
});

describe.skipIf(!full)("benchmark complet explicite", () => {
  it("émet un rapport machine-readable, avec charge séparée de la qualité", async () => {
    const backends = postgresUrl ? (["sqlite", "postgres"] as const) : (["sqlite"] as const);
    for (const backend of backends) {
      const report = {
        ...benchmarkMetadata(backend),
        quality: await quality(backend, postgresUrl),
        revisions: await revisions(backend, postgresUrl),
        saturation: await saturation(backend, postgresUrl),
        permutations: await permutations(backend, postgresUrl),
        performance: await loadPerformance(backend, postgresUrl),
      };
      const errors = {
        falsePositiveSignalIds: report.quality.cases.filter((item) => item.group === null && item.represented).map((item) => item.id),
        falseNegativeSignalIds: report.quality.cases.filter((item) => item.group !== null && !item.represented).map((item) => item.id),
        splitGroups: report.quality.groupAssessment.filter((item) => item.eventCount !== 1).map((item) => item.group),
        orderDependentIdentitySeeds: report.permutations.variants.filter((item) => !item.sameIdentities).map((item) => item.seed),
      };
      console.log(`ORBITAL_DETECTION_BENCHMARK_JSON=${JSON.stringify({ ...report, errors })}`);
      expect(report.quality.integrity.hiddenMappings).toBe(0);
      expect(report.saturation.integrity.hiddenMappings).toBe(0);
      expect(report.performance).toHaveLength(3);
      expect(report.performance.every((entry) => entry.batch20Accepted === 20)).toBe(true);
      expect(report.performance.every((entry) => entry.latencyMs.p50 !== null && entry.latencyMs.p95 !== null && entry.latencyMs.p99 !== null && entry.signalsPerSecond > 0)).toBe(true);
      expect(errors.falsePositiveSignalIds).toHaveLength(report.quality.detection.fp);
    }
  }, 180_000);
});
