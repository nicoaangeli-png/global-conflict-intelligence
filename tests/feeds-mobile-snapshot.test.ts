import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { adsbTrackStats, clearAdsbTracks, exportAdsbTracks, importAdsbTracks } from "@/server/feeds/military";
import { clearMaritimeState, currentStraitItems, ingestAisMessage } from "@/server/feeds/maritime";
import { restoreMobileSnapshot, saveMobileSnapshot } from "@/server/feeds/mobileSnapshot";
import { ctx } from "./feeds-helpers";

afterEach(() => {
  clearAdsbTracks();
  clearMaritimeState();
});

describe("sauvegarde des trajets entre redémarrages", () => {
  it("restaure trajets d'avions et trafic des détroits depuis le disque", () => {
    const now = Date.now();
    const at = (ms: number) => new Date(ms).toISOString();
    importAdsbTracks([["ae1234", { lastSeenAt: now - 60_000, points: [{ lat: 50, lon: 2, at: at(now - 120_000) }, { lat: 50.1, lon: 2.1, at: at(now - 60_000) }] }]], now);
    ingestAisMessage({ MessageType: "PositionReport", MetaData: { MMSI: 538000001, ShipName: "FRONT ALTA", latitude: 26.5, longitude: 56.3 }, Message: { PositionReport: { UserID: 538000001, Sog: 10, Cog: 90, Valid: true } } }, now - 30_000);

    const file = path.join(fs.mkdtempSync(path.join(os.tmpdir(), "orbital-mobiles-")), "snapshot.json");
    saveMobileSnapshot(file, new Date(now));
    clearAdsbTracks();
    clearMaritimeState();
    expect(adsbTrackStats().aircraft).toBe(0);

    expect(restoreMobileSnapshot(file, now)).toBe(true);
    expect(exportAdsbTracks()[0][1].points).toHaveLength(2);
    expect(currentStraitItems(ctx(), now).map((item) => item.title)).toEqual(["FRONT ALTA — type non déclaré"]);
    expect(restoreMobileSnapshot(path.join(os.tmpdir(), "absent-orbital.json"), now)).toBe(false);
  });
});
