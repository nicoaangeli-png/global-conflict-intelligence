import { readFile } from "node:fs/promises";
import path from "node:path";
import type { ConflictEvent } from "@/types/conflict";

/**
 * Chargement du jeu de démonstration.
 *
 * Tant qu'aucun connecteur réel n'est configuré, l'application doit rester
 * démontrable : ce jeu de données (3 190 événements répartis sur 41 foyers
 * documentés publiquement) porte `sourceDataset = "demo:seed"` et
 * `confidence = "DEMO"`. L'interface l'affiche explicitement — il ne peut
 * jamais être confondu avec des données de renseignement réelles.
 */

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
    cache = { at: Date.now(), events: parsed.events, generatedAt: parsed.generatedAt };
    return cache;
  } catch {
    // Le jeu de démo est toujours présent dans le dépôt ; en cas d'absence
    // on renvoie une liste vide plutôt que de faire échouer l'application.
    cache = { at: Date.now(), events: [], generatedAt: new Date().toISOString() };
    return cache;
  }
}
