import { NextResponse } from "next/server";
import { catalogForViewport, validBbox, type LabBbox, type LabLevel } from "@/lib/lab/globe2/model";

export const dynamic = "force-dynamic";
const LEVELS = new Set<LabLevel>(["PLANET", "CONTINENT", "COUNTRY", "REGION", "CITY", "DISTRICT"]);

export function GET(request: Request) {
  const query = new URL(request.url).searchParams;
  const parts = query.get("bbox")?.split(",");
  const raw = parts?.every((part) => /^-?(?:\d+(?:\.\d*)?|\.\d+)$/.test(part)) ? parts.map(Number) : null;
  const level = query.get("level") as LabLevel | null;
  if (!raw || raw.length !== 4 || !raw.every(Number.isFinite) || !level || !LEVELS.has(level))
    return NextResponse.json({ error: "Invalid bbox or level" }, { status: 400 });
  const bbox: LabBbox = { west: raw[0], south: raw[1], east: raw[2], north: raw[3] };
  if (!validBbox(bbox)) return NextResponse.json({ error: "Invalid bbox" }, { status: 400 });
  const cameras = query.get("cameras") === "1";
  const satellites = query.get("satellites") === "1";
  const result = catalogForViewport(bbox, level, cameras, satellites);
  return NextResponse.json({ ...result, level, synthetic: true }, { headers: { "Cache-Control": "private, max-age=10" } });
}
