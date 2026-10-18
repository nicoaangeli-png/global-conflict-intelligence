import { readFile } from "node:fs/promises";
import path from "node:path";
import type { ConflictEvent } from "@/types/conflict";

const SEED_PATH = () => path.join(process.cwd(), "data", "demo-seed.json");

interface SeedFile {
  generatedAt: string;
  dataset: string;
  events: ConflictEvent[];
}

let cache: { at: number; events: ConflictEvent[]; generatedAt: string } | null = null;

export async function loadDemoSeed(): Promise<{ events: ConflictEvent[]; generatedAt: string }> {
  if (cache && Date.now() - cache.at < 60_000) return cache;
  try {
    const raw = await readFile(SEED_PATH(), "utf8");
    const parsed = JSON.parse(raw) as SeedFile;

    const normalized: ConflictEvent[] = (parsed.events ?? []).map((event) => ({
      ...event,
      source: "DEMO SEED — données fictives",
      sourceUrl: "",
      sourceDataset: "demo:seed",
      confidence: "DEMO",
    }));

    cache = {
      at: Date.now(),
      events: normalized,
      generatedAt: parsed.generatedAt || new Date().toISOString(),
    };
    return cache;
  } catch {
    cache = { at: Date.now(), events: [], generatedAt: new Date().toISOString() };
    return cache;
  }
}
