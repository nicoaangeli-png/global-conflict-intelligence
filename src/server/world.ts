import "server-only";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { buildWorldIndex, type WorldIndex } from "@/lib/geo/world";

/** Frontières Natural Earth (les mêmes que le globe), chargées une fois côté serveur. */
let worldIndex: Promise<WorldIndex> | null = null;

export function loadWorldIndex(): Promise<WorldIndex> {
  worldIndex ??= readFile(path.join(process.cwd(), "public", "data", "ne_110m_countries.geojson"), "utf8")
    .then((text) => buildWorldIndex(JSON.parse(text)))
    .catch((error) => {
      worldIndex = null;
      throw error;
    });
  return worldIndex;
}
