import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import path from "node:path";
import { getFeeds } from "@/server/feeds";
import { collectFacts, type CollectDeps } from "./collect";
import { CHAPTER_KEYS, type Briefing } from "./types";
import { writeChapters, type WriteDeps } from "./write";

export * from "./types";

/** Un bilan dégradé n'est gardé que brièvement en mémoire (jamais écrit) pour que la panne soit réessayée. */
export const DEGRADED_TTL_MS = 15 * 60_000;
export const REGENERATE_COOLDOWN_MS = 10 * 60_000;

export interface BriefingDeps extends Partial<CollectDeps> {
  write?: WriteDeps;
  /** Dossier de cache fichier (défaut data/briefing). */
  dir?: string;
  now?: () => number;
}

interface State {
  memory: Map<string, { briefing: Briefing; expiresAt: number | null }>;
  inflight: Map<string, Promise<Briefing>>;
  lastForced: number;
}
const holder = globalThis as unknown as { __orbitalBriefing?: State };
const state: State = (holder.__orbitalBriefing ??= { memory: new Map(), inflight: new Map(), lastForced: 0 });

/** Remise à zéro (tests). */
export function resetBriefingState() {
  state.memory.clear();
  state.inflight.clear();
  state.lastForced = 0;
}

export const utcDay = (ms: number) => new Date(ms).toISOString().slice(0, 10);
const defaultDir = () => path.join(process.cwd(), "data", "briefing");

async function defaultConflicts() {
  const { queryLatestEvents } = await import("@/server/intel");
  return queryLatestEvents({ range: "24h", types: [], datasets: ["ucdp", "acled", "gdelt"], confidences: [], countries: [], minFatalities: 0, at: null }, 400);
}

function isBriefing(x: unknown, date: string): x is Briefing {
  const b = x as Briefing;
  return !!b && b.date === date && Array.isArray(b.chapters) && b.chapters.length === CHAPTER_KEYS.length && b.chapters.every((c, i) => c.key === CHAPTER_KEYS[i]);
}

async function readFromDisk(dir: string, date: string): Promise<Briefing | null> {
  try {
    const parsed = JSON.parse(await readFile(path.join(dir, `${date}.json`), "utf8"));
    return isBriefing(parsed, date) && parsed.status === "ok" ? parsed : null;
  } catch {
    return null;
  }
}

/** Collecte, rédige et assemble un bilan (sans cache). */
export async function buildBriefing(deps: BriefingDeps = {}): Promise<Briefing> {
  const now = (deps.now ?? Date.now)();
  const collected = await collectFacts({
    getFeeds: deps.getFeeds ?? (() => getFeeds({ limit: 1000 })),
    getConflictEvents: deps.getConflictEvents ?? defaultConflicts,
    now: () => now,
  });
  const written = await writeChapters(collected.facts, collected.windowHours, deps.write);
  const reasons = [written.reason, collected.notes.length ? `Sources partielles : ${collected.notes.join(" ; ")}.` : null].filter(Boolean);
  return {
    date: utcDay(now),
    generatedAt: new Date(now).toISOString(),
    status: written.status === "ok" && !collected.notes.length ? "ok" : "degraded",
    reason: reasons.length ? reasons.join(" ") : null,
    chapters: written.chapters,
  };
}

async function generate(date: string, deps: BriefingDeps): Promise<Briefing> {
  const dir = deps.dir ?? defaultDir();
  const now = (deps.now ?? Date.now)();
  const briefing = await buildBriefing(deps);
  if (briefing.status === "ok") {
    try {
      await mkdir(dir, { recursive: true });
      const tmp = path.join(dir, `${date}.json.tmp`);
      await writeFile(tmp, JSON.stringify(briefing));
      await rename(tmp, path.join(dir, `${date}.json`));
    } catch {
      // cache fichier facultatif : la mémoire suffit
    }
  }
  state.memory.set(date, { briefing, expiresAt: briefing.status === "ok" ? null : now + DEGRADED_TTL_MS });
  return briefing;
}

/** Bilan du jour UTC : mémoire, puis fichier, sinon génération (une seule à la fois). */
export async function getBriefing(deps: BriefingDeps = {}): Promise<Briefing> {
  const now = (deps.now ?? Date.now)();
  const date = utcDay(now);
  const hit = state.memory.get(date);
  if (hit && (hit.expiresAt === null || hit.expiresAt > now)) return hit.briefing;
  const running = state.inflight.get(date);
  if (running) return running;
  const promise = (async () => {
    const onDisk = await readFromDisk(deps.dir ?? defaultDir(), date);
    if (onDisk) {
      state.memory.set(date, { briefing: onDisk, expiresAt: null });
      return onDisk;
    }
    return generate(date, deps);
  })().finally(() => state.inflight.delete(date));
  state.inflight.set(date, promise);
  return promise;
}

export type Regeneration = { ok: true; briefing: Briefing } | { ok: false; retryAfterSec: number };

/** Régénération manuelle : 1 / 10 min ; rejoint une génération déjà en cours. */
export async function regenerateBriefing(deps: BriefingDeps = {}): Promise<Regeneration> {
  const now = (deps.now ?? Date.now)();
  const date = utcDay(now);
  const running = state.inflight.get(date);
  if (running) return { ok: true, briefing: await running };
  const wait = state.lastForced + REGENERATE_COOLDOWN_MS - now;
  if (wait > 0) return { ok: false, retryAfterSec: Math.ceil(wait / 1000) };
  state.lastForced = now;
  const promise = generate(date, deps).finally(() => state.inflight.delete(date));
  state.inflight.set(date, promise);
  return { ok: true, briefing: await promise };
}
