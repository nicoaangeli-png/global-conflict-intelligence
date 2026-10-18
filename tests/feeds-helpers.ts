import { readFileSync } from "node:fs";
import path from "node:path";
import { buildWorldIndex, type WorldIndex } from "@/lib/geo/world";
import type { FeedContext } from "@/server/feeds/util";

export const FIXTURES = path.join(__dirname, "fixtures", "feeds");

export const fixtureText = (name: string) => readFileSync(path.join(FIXTURES, name), "utf8");
export const fixtureJson = (name: string) => JSON.parse(fixtureText(name));
export const fixtureBytes = (name: string) => new Uint8Array(readFileSync(path.join(FIXTURES, name)));

let index: WorldIndex | null = null;
/** Frontières Natural Earth locales (lecture disque, aucun réseau). */
export function worldIndex(): WorldIndex {
  index ??= buildWorldIndex(JSON.parse(readFileSync(path.join(process.cwd(), "public", "data", "ne_110m_countries.geojson"), "utf8")));
  return index;
}

export const ctx = (withIndex = true): FeedContext => ({ fetchedAt: "2026-10-18T10:00:00.000Z", index: withIndex ? worldIndex() : null });
