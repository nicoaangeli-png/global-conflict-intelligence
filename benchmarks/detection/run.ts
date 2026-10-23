import { execFileSync } from "node:child_process";
import { randomUUID } from "node:crypto";
import { Pool } from "pg";
import type { OrbitalEvent, Signal } from "@/types/detection";
import { DetectionEngine, MAX_EVIDENCE } from "@/server/detection/engine";
import { PostgresDetectionStore } from "@/server/detection/postgresStore";
import { SqliteDetectionStore, type DetectionStore } from "@/server/detection/store";
import { BENCHMARK_NOW, DATASET_VERSION, EXPECTED_EVENTS, GOLDEN_CASES, GOLDEN_REVISIONS, saturationSignals } from "./golden";
import { detectionCounts, pairwiseCounts, partition, percentile } from "./metrics";

export const ADMISSION_NOW = BENCHMARK_NOW + 190 * 60_000;
export type Backend = "sqlite" | "postgres";
type Context = { store: DetectionStore; engine: DetectionEngine; schema?: string; cleanup(): Promise<void> };
let sequence = 0;

export async function context(backend: Backend, url?: string): Promise<Context> {
  if (backend === "sqlite") {
    const store = new SqliteDetectionStore(":memory:");
    return { store, engine: new DetectionEngine(store), cleanup: () => store.close() };
  }
  if (!url) throw new Error("PostgreSQL benchmark requires ORBITAL_TEST_DATABASE_URL");
  const schema = `benchmark_${process.pid}_${++sequence}_${randomUUID().replaceAll("-", "").slice(0, 8)}`;
  const admin = new Pool({ connectionString: url, max: 2 });
  await admin.query(`CREATE SCHEMA "${schema}"`);
  const store = new PostgresDetectionStore({ connectionString: url, schema });
  return {
    store, engine: new DetectionEngine(store), schema,
    async cleanup() {
      await store.close();
      try { await admin.query(`DROP SCHEMA "${schema}" CASCADE`); } finally { await admin.end(); }
    },
  };
}

async function integrity(store: DetectionStore, events: readonly OrbitalEvent[], ids: readonly string[]) {
  return store.transaction(async (transaction) => {
    const represented = new Set(events.flatMap((event) => event.evidence.map((item) => item.signal.id)));
    const mapped: string[] = [];
    let hiddenMappings = 0;
    for (const event of events) {
      const count = await transaction.signalCountForEvent(event.id);
      hiddenMappings += Math.abs(count - event.evidence.length);
    }
    for (const id of ids) {
      const relation = await transaction.bySignal(id);
      if (relation) {
        mapped.push(id);
        if (!represented.has(id) || !relation.event.evidence.some((item) => item.signal.id === id)) hiddenMappings++;
      }
    }
    return { represented: represented.size, mapped: mapped.length, hiddenMappings, missingMappings: [...represented].filter((id) => !mapped.includes(id)).length };
  });
}

export async function quality(backend: Backend, url?: string, order?: readonly number[]) {
  const run = await context(backend, url);
  try {
    const input = order ? order.map((index) => GOLDEN_CASES[index]) : GOLDEN_CASES;
    const admission = { accepted: 0, skipped: 0 };
    for (const item of input) {
      const result = await run.engine.ingest([item.signal], ADMISSION_NOW);
      admission.accepted += result.accepted; admission.skipped += result.skipped;
    }
    const duplicate = await run.engine.ingest([GOLDEN_CASES[0].signal], ADMISSION_NOW);
    const events = (await run.engine.snapshot(ADMISSION_NOW)).events;
    const represented = new Set(events.flatMap((event) => event.evidence.map((item) => item.signal.id)));
    const truth = new Map(GOLDEN_CASES.map((item) => [item.id, item.truth] as const));
    const relation = await integrity(run.store, events, GOLDEN_CASES.map((item) => item.id));
    const cases = GOLDEN_CASES.map(({ id, truth: group, rationale }) => ({ id, group, rationale, represented: represented.has(id), eventId: events.find((event) => event.evidence.some((item) => item.signal.id === id))?.id ?? null }));
    const groupAssessment = Object.entries(EXPECTED_EVENTS).map(([group, expected]) => {
      const ids = GOLDEN_CASES.filter((item) => item.truth === group).map((item) => item.id);
      const observed = events.filter((event) => event.evidence.some((item) => ids.includes(item.signal.id)));
      return { group, expected, eventCount: observed.length, categoryCorrect: observed.length === 1 && observed[0].kind === expected.kind,
        placeCorrect: observed.length === 1 && observed[0].place?.toLowerCase().replace("odesa", "odessa") === expected.place.toLowerCase(),
        countryCorrect: observed.length === 1 && observed[0].countries.includes(expected.country) };
    });
    return {
      backend, datasetVersion: DATASET_VERSION, signalCount: GOLDEN_CASES.length,
      positiveSignals: GOLDEN_CASES.filter((item) => item.truth !== null).length,
      truthEvents: new Set(GOLDEN_CASES.map((item) => item.truth).filter(Boolean)).size,
      admission, duplicate, eventCount: events.length, detection: detectionCounts(truth, represented),
      clustering: pairwiseCounts(truth, events), deduplication: { exactReplaySkipped: duplicate.skipped === 1, representedSignalIds: represented.size },
      corroboration: events.map((event) => ({ evidenceIds: event.evidence.map((item) => item.signal.id).sort(),
        evidence: event.evidence.length, independentSourceCount: event.independentSourceCount,
        distinctProviderCount: event.distinctProviderCount }))
        .sort((a, b) => a.evidenceIds.join("|").localeCompare(b.evidenceIds.join("|"))),
      integrity: relation, partition: partition(events),
      identities: Object.fromEntries(cases.map((item) => [item.id, item.eventId])),
      eventCategories: events.map((event) => ({ evidence: event.evidence.map((item) => item.signal.id).sort(), kind: event.kind, place: event.place, countries: [...event.countries].sort() }))
        .sort((a, b) => a.evidence.join("|").localeCompare(b.evidence.join("|"))),
      groupAssessment, cases,
    };
  } finally { await run.cleanup(); }
}

export async function revisions(backend: Backend, url?: string) {
  const run = await context(backend, url);
  try {
    for (const item of GOLDEN_CASES.filter((entry) => entry.truth !== null)) await run.engine.ingest([item.signal], ADMISSION_NOW);
    const before = (await run.engine.snapshot(ADMISSION_NOW)).events;
    const locate = (events: OrbitalEvent[], id: string) => events.find((event) => event.evidence.some((item) => item.signal.id === id))?.id ?? null;
    const portBefore = locate(before, "port-en"), laterBefore = locate(before, "port-later");
    const compatible = { ...GOLDEN_CASES[0].signal, title: GOLDEN_REVISIONS[0].title };
    await run.engine.ingest([compatible], ADMISSION_NOW);
    const middle = (await run.engine.snapshot(ADMISSION_NOW)).events;
    const incompatible: Signal = { ...GOLDEN_CASES.find((item) => item.id === "port-later")!.signal, ...GOLDEN_REVISIONS[1], countries: [...GOLDEN_REVISIONS[1].countries] };
    await run.engine.ingest([incompatible], ADMISSION_NOW);
    const after = (await run.engine.snapshot(ADMISSION_NOW)).events;
    const relation = await integrity(run.store, after, GOLDEN_CASES.filter((item) => item.truth !== null).map((item) => item.id));
    return {
      compatibleIdentityRetained: portBefore !== null && locate(middle, "port-en") === portBefore,
      incompatibleOldIdentityRemoved: laterBefore !== null && !after.some((event) => event.id === laterBefore),
      incompatibleCorrectCategory: after.find((event) => event.evidence.some((item) => item.signal.id === "port-later"))?.kind === "earthquake",
      incompatibleCorrectPlace: after.find((event) => event.evidence.some((item) => item.signal.id === "port-later"))?.place === "Tokyo",
      incompatibleNewIdentity: locate(after, "port-later") !== laterBefore,
      integrity: relation,
    };
  } finally { await run.cleanup(); }
}

export async function saturation(backend: Backend, url?: string) {
  const run = await context(backend, url);
  try {
    const signals = saturationSignals(MAX_EVIDENCE + 1);
    const first = await run.engine.ingest(signals.slice(0, MAX_EVIDENCE), ADMISSION_NOW);
    const next = await run.engine.ingest([signals[MAX_EVIDENCE]], ADMISSION_NOW);
    const retry = await run.engine.ingest([signals[MAX_EVIDENCE]], ADMISSION_NOW);
    const events = (await run.engine.snapshot(ADMISSION_NOW)).events;
    const relation = await integrity(run.store, events, signals.map((item) => item.id));
    return { first, next, retry, evidence: events[0]?.evidence.length ?? 0, truncated: events[0]?.evidenceTruncated ?? false, integrity: relation };
  } finally { await run.cleanup(); }
}

function shuffle(length: number, seed: number): number[] {
  const result = Array.from({ length }, (_, index) => index);
  let state = seed;
  const next = () => ((state = (Math.imul(state, 1664525) + 1013904223) >>> 0) / 2 ** 32);
  for (let i = result.length - 1; i > 0; i--) { const j = Math.floor(next() * (i + 1)); [result[i], result[j]] = [result[j], result[i]]; }
  return result;
}

export async function permutations(backend: Backend, url?: string, seeds = [1, 7, 42, 2026]) {
  const baseline = await quality(backend, url);
  const variants = [];
  for (const seed of seeds) {
    const result = await quality(backend, url, shuffle(GOLDEN_CASES.length, seed));
    const eventMetadataDifferences = baseline.eventCategories.flatMap((expected) => {
      const actual = result.eventCategories.find((entry) => entry.evidence.join("|") === expected.evidence.join("|"));
      return JSON.stringify(actual) === JSON.stringify(expected) ? [] : [{ evidence: expected.evidence, expected: { kind: expected.kind, place: expected.place, countries: expected.countries }, actual: actual ? { kind: actual.kind, place: actual.place, countries: actual.countries } : null }];
    });
    variants.push({ seed, eventCount: result.eventCount, samePartition: JSON.stringify(result.partition) === JSON.stringify(baseline.partition), sameIdentities: JSON.stringify(result.identities) === JSON.stringify(baseline.identities), sameEventMetadata: eventMetadataDifferences.length === 0, eventMetadataDifferences, detection: result.detection, clustering: result.clustering });
  }
  return { baselineEvents: baseline.eventCount, variants };
}

export async function loadPerformance(backend: Backend, url?: string, sizes = [30, 90, 180]) {
  const results = [];
  for (const size of sizes) {
    const run = await context(backend, url);
    try {
      const titles = ["Explosion at Odessa Neptune port terminal, nearby windows damaged", "Power outage in Odessa northern grid after transformer failure", "Protest in Odessa central square over transport cuts"];
      const base = saturationSignals(size).map((item, index) => ({ ...item, kind: (["explosion", "outage", "protest"] as const)[index % 3], title: titles[index % 3], id: `load-${index}` }));
      // Exclut la migration et l'ouverture initiale du pool du temps de traitement.
      await run.store.transaction((transaction) => transaction.recent(0));
      const rssBefore = process.memoryUsage().rss;
      const durations: number[] = [];
      const start = performance.now();
      let accepted = 0;
      for (const item of base) {
        const tick = performance.now();
        accepted += (await run.engine.ingest([item], ADMISSION_NOW)).accepted;
        durations.push(performance.now() - tick);
      }
      const totalMs = performance.now() - start;
      const batchStart = performance.now();
      const batch = base.slice(0, Math.min(20, base.length)).map((item, index) => ({ ...item, id: `batch-${size}-${index}`, provider: `batch-provider-${size}-${index}`, url: `https://batch-${size}-${index}.example/story` }));
      const batchResult = await run.engine.ingest(batch, ADMISSION_NOW);
      const batchMs = performance.now() - batchStart;
      results.push({ size, accepted, totalMs, signalsPerSecond: size / (totalMs / 1000), latencyMs: { p50: percentile(durations, 0.5), p95: percentile(durations, 0.95), p99: percentile(durations, 0.99) }, batch20Ms: batchMs, batch20Accepted: batchResult.accepted, rssBefore, rssAfter: process.memoryUsage().rss, rssDelta: process.memoryUsage().rss - rssBefore });
    } finally { await run.cleanup(); }
  }
  return results;
}

export function benchmarkMetadata(backend: Backend) {
  let commit = "unknown";
  try { commit = execFileSync("git", ["rev-parse", "HEAD"], { encoding: "utf8" }).trim(); } catch { /* detached test archive */ }
  return { reportVersion: 1, generatedAt: new Date().toISOString(), commit, datasetVersion: DATASET_VERSION, backend, parameters: { now: new Date(ADMISSION_NOW).toISOString(), permutations: [1, 7, 42, 2026], loadSizes: [30, 90, 180], maxEvidence: MAX_EVIDENCE } };
}
