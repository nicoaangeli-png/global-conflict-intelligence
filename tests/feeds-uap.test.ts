import { describe, expect, it } from "vitest";
import { deflateRawSync } from "node:zlib";
import { parseGeipan } from "@/server/feeds/uap";
import { readFirstSheet, XLSX_ENTRY_MAX_BYTES } from "@/server/feeds/xlsx";
import { uapSources } from "@/server/feeds/uap";
import { runSource } from "@/server/feeds/util";
import { ctx, fixtureBytes } from "./feeds-helpers";

function singleEntryZip(name: string, content: Buffer): Uint8Array {
  const filename = Buffer.from(name);
  const compressed = deflateRawSync(content);
  const local = Buffer.alloc(30);
  local.writeUInt32LE(0x04034b50, 0);
  local.writeUInt16LE(8, 8);
  local.writeUInt32LE(compressed.length, 18);
  local.writeUInt32LE(content.length, 22);
  local.writeUInt16LE(filename.length, 26);
  const central = Buffer.alloc(46);
  central.writeUInt32LE(0x02014b50, 0);
  central.writeUInt16LE(8, 10);
  central.writeUInt32LE(compressed.length, 20);
  central.writeUInt32LE(content.length, 24);
  central.writeUInt16LE(filename.length, 28);
  central.writeUInt32LE(0, 42);
  const centralOffset = local.length + filename.length + compressed.length;
  const eocd = Buffer.alloc(22);
  eocd.writeUInt32LE(0x06054b50, 0);
  eocd.writeUInt16LE(1, 8);
  eocd.writeUInt16LE(1, 10);
  eocd.writeUInt32LE(central.length + filename.length, 12);
  eocd.writeUInt32LE(centralOffset, 16);
  return new Uint8Array(Buffer.concat([local, filename, compressed, central, filename, eocd]));
}

describe("lecteur xlsx", () => {
  it("lit en-têtes et chaînes partagées", () => {
    const rows = readFirstSheet(fixtureBytes("geipan-cas.xlsx"));
    expect(rows).toHaveLength(8);
    expect(rows[0].A).toBe("ID Etude de Cas");
    expect(rows[0].F).toBe("Classification");
  });

  it("refuse un fichier qui n'est pas un classeur", () => {
    expect(() => readFirstSheet(new TextEncoder().encode("<html>403</html>"))).toThrow();
  });

  it("interrompt la décompression d'une entrée supérieure à 16 Mio", () => {
    const bomb = singleEntryZip("xl/worksheets/sheet1.xml", Buffer.alloc(XLSX_ENTRY_MAX_BYTES + 1, 65));
    expect(() => readFirstSheet(bomb)).toThrow(/trop volumineuse/);
  });
});

describe("GEIPAN", () => {
  const items = parseGeipan(fixtureBytes("geipan-cas.xlsx"), ctx(), { recent: 3, dSinceYear: 2022 });

  it("garde les plus récents et les cas D récents, pas les anciens", () => {
    const ids = items.map((i) => i.id);
    expect(ids).toContain("geipan:2026-04-51742");
    expect(ids).toContain("geipan:2023-12-51504"); // D observé en décembre 2022
    expect(ids).not.toContain("geipan:2012-08-08284"); // D ancien
    expect(ids).not.toContain("geipan:1937-01-01656"); // date incomplète : jamais datée au hasard
    expect(items).toHaveLength(4);
  });

  it("trie par date d'observation décroissante et date seulement si le jour est connu", () => {
    const dates = items.map((i) => i.occurredAt);
    expect(dates).toEqual([...dates].sort().reverse());
    expect(items[0].occurredAt).toBe("2026-04-07T00:00:00.000Z");
  });

  it("porte la classification officielle et le caveat sur chaque cas", () => {
    for (const i of items) {
      expect(i.category).toBe("uap");
      expect(i.nature).toBe("published_report");
      expect(i.caveat).toMatch(/^Classification GEIPAN : [ABCD] \(/);
      expect(i.caveat).toMatch(/un cas D signifie non expliqué, pas d'origine extraterrestre établie/);
      expect(i.summary).toMatch(/^Classification GEIPAN [ABCD] \(/);
      expect(i.countries).toEqual(["FRA"]);
      expect(i.url).toMatch(/^https:\/\/www\.cnes-geipan\.fr\/fr\/cas\//);
      expect(i.severity).toBeNull();
    }
    const d = items.find((i) => i.id === "geipan:2023-12-51504");
    expect(d?.summary).toContain("non identifié après enquête");
    expect(items.find((i) => i.id === "geipan:2026-04-51742")?.caveat).toContain("phénomène identifié");
  });

  it("rejette un export aux colonnes inattendues", () => {
    expect(() => parseGeipan(new TextEncoder().encode("pas un zip"), ctx())).toThrow(/GEIPAN/);
  });
});

describe("sources UAP indisponibles", () => {
  it("NASA : état explicite, sans élément ni appel réseau", async () => {
    const def = uapSources.find((s) => s.sourceId === "nasa-uap")!;
    const { items, state } = await runSource(def, async () => null);
    expect(items).toEqual([]);
    expect(state.status).toBe("not_configured");
    expect(state.message).toMatch(/statique/);
  });
});
