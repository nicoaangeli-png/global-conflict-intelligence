import { readFileSync } from "node:fs";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { FIPS_TO_ISO3, fipsToIso3, resolveCountryIdentity } from "@/lib/geo/country";
import {
  buildEvents, cachedEvents, EVENT_COLUMNS, fetchSocialFeed, GDELT_DOWNLOAD_MAX_BYTES, geoPrecisionOf, mapCameo, parseExportCsv,
  parseGkgTitles, parseLastUpdate, recentTimestamps, refreshGdeltEvents, resetGdeltEventsCache,
  titleFromExtras, unzipFirstEntry, type GdeltFetchers,
} from "@/server/connectors/gdeltEvents";
import { safeFetch } from "@/server/connectors/types";

const dir = join(__dirname, "fixtures", "gdelt");
const read = (n: string) => readFileSync(join(dir, n));
const exportCsv = read("sample.export.CSV").toString("utf8");
const gkgCsv = read("sample.gkg.csv").toString("utf8");

/** Ligne d'export synthétique à 61 colonnes (dérivée du format réel). */
function line(o: Partial<{ code: string; sources: number; articles: number; type: number; name: string; fips: string; lat: string; lon: string; added: string; url: string }> = {}): string {
  const f = new Array<string>(EVENT_COLUMNS).fill("");
  const code = o.code ?? "141";
  f[0] = "1"; f[26] = code; f[27] = code.slice(0, 3); f[28] = code.slice(0, 2); f[29] = "3";
  f[31] = "1"; f[32] = String(o.sources ?? 2); f[33] = String(o.articles ?? 2);
  f[51] = String(o.type ?? 4); f[52] = o.name ?? "Paris, France (general), France"; f[53] = o.fips ?? "FR";
  f[56] = o.lat ?? "48.8667"; f[57] = o.lon ?? "2.3333";
  f[59] = o.added ?? "20261018100000"; f[60] = o.url ?? "https://exemple.test/a";
  return f.join("\t");
}

describe("table FIPS 10-4 → ISO3", () => {
  it("résout les pièges connus", () => {
    const expected: Record<string, string> = {
      UK: "GBR", GM: "DEU", RS: "RUS", UP: "UKR", FR: "FRA", SP: "ESP", CH: "CHN", IS: "ISR", CG: "COD", CF: "COG",
      KN: "PRK", KS: "KOR", SZ: "CHE", AU: "AUT", AS: "AUS", BU: "BGR", NI: "NGA", NG: "NER", IZ: "IRQ", IR: "IRN",
      SF: "ZAF", JA: "JPN", EZ: "CZE", KV: "KOS", GZ: "PSE", WE: "PSE", TU: "TUR", SU: "SDN", OD: "SSD", US: "USA",
    };
    for (const [fips, iso] of Object.entries(expected)) expect(fipsToIso3(fips), fips).toBe(iso);
  });
  it("est complète et cohérente", () => {
    expect(Object.keys(FIPS_TO_ISO3).length).toBeGreaterThan(240);
    for (const [k, v] of Object.entries(FIPS_TO_ISO3)) {
      expect(k).toMatch(/^[A-Z]{2}$/);
      expect(v).toMatch(/^[A-Z]{3}$/);
    }
  });
  it("ne devine jamais un code inconnu", () => {
    expect(fipsToIso3("ZZ")).toBeNull();
    expect(fipsToIso3("PF")).toBeNull(); // Paracels : contesté, pas d'ISO3
    expect(fipsToIso3("")).toBeNull();
    expect(fipsToIso3(null)).toBeNull();
  });
  it("resolveCountryIdentity applique la table pour le fournisseur fips", () => {
    expect(resolveCountryIdentity("SP", "fips")?.iso3).toBe("ESP");
    expect(resolveCountryIdentity("GM", "fips")?.iso3).toBe("DEU");
    expect(resolveCountryIdentity("UK", "fips")?.iso3).toBe("GBR");
    expect(resolveCountryIdentity("CG", "fips")?.iso3).toBe("COD");
    expect(resolveCountryIdentity("FR", "fips")?.name).toBe("France");
  });
});

describe("mapping CAMEO", () => {
  it("racine 14 : protestation, émeute pour 145x", () => {
    expect(mapCameo("141")).toMatchObject({ eventType: "Protests", social: true, subEventType: "Manifestation" });
    expect(mapCameo("142")?.subEventType).toBe("Grève de la faim");
    expect(mapCameo("143")?.subEventType).toBe("Grève / boycott");
    expect(mapCameo("144")?.subEventType).toBe("Blocage");
    expect(mapCameo("145")?.eventType).toBe("Riots");
    expect(mapCameo("1451")?.eventType).toBe("Riots");
    expect(mapCameo("14")?.eventType).toBe("Protests");
  });
  it("18x, 19x, 20x : types violents existants", () => {
    expect(mapCameo("182")?.eventType).toBe("Violence against civilians");
    expect(mapCameo("1822")?.eventType).toBe("Violence against civilians");
    expect(mapCameo("183")?.eventType).toBe("Explosions/Remote violence");
    expect(mapCameo("193")?.eventType).toBe("Battles");
    expect(mapCameo("195")?.eventType).toBe("Explosions/Remote violence");
    expect(mapCameo("202")?.eventType).toBe("Violence against civilians");
    expect(mapCameo("190")?.social).toBe(false);
  });
  it("ignore le reste", () => {
    for (const c of ["010", "042", "112", "130", "173", "211", "", "abc", "1"]) expect(mapCameo(c), c).toBeNull();
  });
  it("précision géographique", () => {
    expect(geoPrecisionOf(4)).toBe("city");
    expect(geoPrecisionOf(3)).toBe("city");
    expect(geoPrecisionOf(5)).toBe("region");
    expect(geoPrecisionOf(2)).toBe("region");
    expect(geoPrecisionOf(1)).toBe("country");
    expect(geoPrecisionOf(0)).toBeNull();
  });
});

describe("zip, horodatages", () => {
  it("borne les téléchargements GDELT 15 minutes à 50 Mio", () => {
    expect(GDELT_DOWNLOAD_MAX_BYTES).toBe(50 * 1024 * 1024);
  });

  it("lit l'entrée unique d'un vrai zip (deflate)", async () => {
    const csv = await unzipFirstEntry(read("sample.export.CSV.zip"));
    expect(csv.toString("utf8")).toBe(exportCsv);
    const gkg = await unzipFirstEntry(read("sample.gkg.csv.zip"));
    expect(gkg.toString("utf8")).toBe(gkgCsv);
  });
  it("rejette un zip corrompu ou tronqué", async () => {
    await expect(unzipFirstEntry(Buffer.from("pas un zip"))).rejects.toThrow(/invalide/);
    const z = read("sample.export.CSV.zip");
    await expect(unzipFirstEntry(z.subarray(0, z.length - 40))).rejects.toThrow();
  });
  it("lastupdate.txt et séquence de 15 min", () => {
    expect(parseLastUpdate(read("lastupdate.txt").toString("utf8"))).toEqual({ ts: "20261018101500" });
    expect(parseLastUpdate("n'importe quoi")).toBeNull();
    const ts = recentTimestamps("20261018001500", 4);
    expect(ts).toEqual(["20261018001500", "20261018000000", "20261017234500", "20261017233000"]);
    expect(recentTimestamps("20261018101500", 96)).toHaveLength(96);
  });
});

describe("lecture HTTP bornée des connecteurs", () => {
  afterEach(() => vi.unstubAllGlobals());

  it("rejette Content-Length avant lecture avec une ConnectorError lisible", async () => {
    let cancelled = false;
    const body = new ReadableStream<Uint8Array>({
      pull(controller) { controller.enqueue(new Uint8Array([1])); },
      cancel() { cancelled = true; },
    });
    vi.stubGlobal("fetch", vi.fn(async () => new Response(body, { headers: { "Content-Length": "6" } })));
    await expect(safeFetch("test", "https://example.org/data", {}, 1_000, 5)).rejects.toThrow(/test: réponse trop volumineuse.*5 octets/);
    expect(cancelled).toBe(true);
  });
});

describe("export 2.0 : filtre et lecture", () => {
  it("garde les colonnes documentées", () => {
    const { rows } = parseExportCsv(line({ url: "https://exemple.test/x" }));
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ code: "141", root: "14", fips: "FR", geoType: 4, lat: 48.8667, lon: 2.3333, url: "https://exemple.test/x", addedAt: "2026-10-18T10:00:00.000Z" });
  });
  it("filtre qualité : 2 sources OU 3 articles", () => {
    expect(parseExportCsv(line({ sources: 1, articles: 1 })).rows).toHaveLength(0);
    expect(parseExportCsv(line({ sources: 1, articles: 2 })).rows).toHaveLength(0);
    expect(parseExportCsv(line({ sources: 2, articles: 2 })).rows).toHaveLength(1);
    expect(parseExportCsv(line({ sources: 1, articles: 3 })).rows).toHaveLength(1);
  });
  it("ignore codes hors 14/18/19/20, géo absente ou invalide, lignes courtes", () => {
    const text = [
      line({ code: "042" }), line({ type: 0 }), line({ lat: "", lon: "" }), line({ lat: "95", lon: "2" }),
      "a\tb\tc", line({ url: "ftp://exemple.test/x" }), line(),
    ].join("\n");
    expect(parseExportCsv(text).rows).toHaveLength(1);
  });
  it("fixture réelle : uniquement des lignes valides", () => {
    const { rows, scanned } = parseExportCsv(exportCsv);
    expect(scanned).toBe(exportCsv.trim().split("\n").length);
    expect(rows.length).toBeGreaterThan(5);
    for (const r of rows) expect(r.sources >= 2 || r.articles >= 3).toBe(true);
  });
});

describe("dédoublonnage", () => {
  const now = "2026-10-18T11:00:00.000Z";
  it("même URL + racine + lieu = un événement, date la plus ancienne, pas de somme", () => {
    const rows = parseExportCsv([
      line({ added: "20261018101500" }), line({ added: "20261018100000", sources: 5 }), line({ code: "143", added: "20261018103000" }),
    ].join("\n")).rows;
    const ev = buildEvents(rows, new Map(), now);
    expect(ev).toHaveLength(1);
    expect(ev[0].eventDate).toBe("2026-10-18T10:00:00.000Z");
  });
  it("un article citant 19 lieux : 19 lieux distincts, mais jamais de doublon", () => {
    const lines: string[] = [];
    for (let i = 0; i < 19; i++) for (let k = 0; k < 3; k++) {
      lines.push(line({ name: `Ville${i}, France (general), France`, lat: String(40 + i * 0.5), lon: String(2 + i * 0.5) }));
    }
    const ev = buildEvents(parseExportCsv(lines.join("\n")).rows, new Map(), now);
    expect(ev).toHaveLength(19);
    expect(new Set(ev.map((e) => e.id)).size).toBe(19);
  });
  it("lieu pays supprimé si un lieu précis existe pour le même article et pays", () => {
    const rows = parseExportCsv([line(), line({ type: 1, name: "France", lat: "46", lon: "2" })].join("\n")).rows;
    const ev = buildEvents(rows, new Map(), now);
    expect(ev).toHaveLength(1);
    expect(ev[0].geoPrecision).toBe("city");
  });
  it("niveau pays conservé seul, marqué geoPrecision=country", () => {
    const ev = buildEvents(parseExportCsv(line({ type: 1, name: "France", lat: "46", lon: "2" })).rows, new Map(), now);
    expect(ev).toHaveLength(1);
    expect(ev[0]).toMatchObject({ geoPrecision: "country", locality: "France" });
  });
  it("même URL, codes racine différents = événements distincts", () => {
    const rows = parseExportCsv([line({ code: "141" }), line({ code: "190" })].join("\n")).rows;
    expect(buildEvents(rows, new Map(), now)).toHaveLength(2);
  });
  it("identifiant stable d'un passage à l'autre", () => {
    const rows = parseExportCsv(line()).rows;
    expect(buildEvents(rows, new Map(), now)[0].id).toBe(buildEvents(rows, new Map(), "2027-01-01T00:00:00.000Z")[0].id);
  });
});

describe("titres GKG", () => {
  it("extrait et nettoie PAGE_TITLE", () => {
    expect(titleFromExtras("<PAGE_PRECISEPUBTIMESTAMP>1</PAGE_PRECISEPUBTIMESTAMP><PAGE_TITLE>Grève &amp; blocage &quot;Paris&quot; &#233;</PAGE_TITLE>")).toBe('Grève & blocage "Paris" é');
    expect(titleFromExtras("<PAGE_TITLE>   </PAGE_TITLE>")).toBeNull();
    expect(titleFromExtras("sans titre")).toBeNull();
    expect(titleFromExtras("<PAGE_TITLE>https://x.test/a</PAGE_TITLE>")).toBeNull();
  });
  it("jointure DocumentIdentifier = SOURCEURL sur la fixture réelle", () => {
    const { rows } = parseExportCsv(exportCsv);
    const titles = parseGkgTitles(gkgCsv, new Set(rows.map((r) => r.url)));
    expect(titles.get("https://article.wn.com/view/2026/10/18/Nearly_300_arrested_as_Yellow_Vests_join_mass_protests_in_Fr/")).toBe("Nearly 300 arrested as Yellow Vests join mass protests in France");
    expect(parseGkgTitles(gkgCsv, new Set()).size).toBe(0);
  });
  it("pas de titre connu : title = null, aucun titre inventé", () => {
    const rows = parseExportCsv(line({ url: "https://www.lemonde.fr/x" })).rows;
    const [e] = buildEvents(rows, new Map(), "2026-10-18T11:00:00.000Z");
    expect(e.title).toBeNull();
    expect(e.source).toBe("GDELT · lemonde.fr (titre non fourni)");
  });
});

describe("événements normalisés (fixture réelle)", () => {
  const now = "2026-10-18T10:30:00.000Z";
  const { rows } = parseExportCsv(exportCsv);
  const titles = parseGkgTitles(gkgCsv, new Set(rows.map((r) => r.url)));
  const events = buildEvents(rows, titles, now);

  it("nature presse : provenance, confiance, pas de bilan, dates distinctes", () => {
    expect(events.length).toBeGreaterThan(5);
    for (const e of events) {
      expect(e.sourceDataset).toBe("gdelt");
      expect(e.confidence).toBe("MEDIA_SIGNAL");
      expect(e.fatalities).toBe(0);
      expect(e.eventDate).toBe("2026-10-18T10:00:00.000Z");
      expect(e.eventDate).not.toBe(e.updatedAt);
      expect(e.sourceUrl).toMatch(/^https?:\/\//);
      expect(e.country).not.toBe("");
    }
  });
  it("France : manifestation datée, titrée, pays FRA", () => {
    const fr = events.filter((e) => e.country === "France");
    expect(fr.length).toBeGreaterThan(0);
    const protest = fr.find((e) => e.eventType === "Protests");
    expect(protest?.title).toMatch(/France/);
    expect(protest?.locality).toBe("Paris");
    expect(protest?.geoPrecision).toBe("city");
  });
  it("UK donne le Royaume-Uni (GBR), pas une confusion de nom", () => {
    const uk = events.filter((e) => e.country === "United Kingdom");
    expect(uk.length).toBeGreaterThan(0);
  });
});

describe("collecte avec cache (réseau simulé)", () => {
  const exportZip = read("sample.export.CSV.zip");
  const gkgZip = read("sample.gkg.csv.zip");
  const lastupdate = read("lastupdate.txt").toString("utf8");

  function fetchers(calls: string[]): GdeltFetchers {
    return {
      async text(url) { calls.push(url); return lastupdate; },
      async bytes(url) {
        calls.push(url);
        if (url.includes("20261018101500.export")) return exportZip;
        if (url.includes("20261018101500.gkg")) return gkgZip;
        return null; // fichiers non publiés (404)
      },
    };
  }

  beforeEach(() => { resetGdeltEventsCache(); });
  afterEach(() => { vi.useRealTimers(); vi.unstubAllGlobals(); delete process.env.GDELT_EVENTS_CATCHUP_FILES; });

  it("rattrape N fichiers, tolère les 404 et ne retélécharge pas les fichiers traités", async () => {
    const calls: string[] = [];
    await refreshGdeltEvents({ files: 4, fetchers: fetchers(calls), delayMs: 0, force: true });
    const first = calls.filter((c) => c.endsWith(".zip"));
    expect(first.filter((c) => c.includes(".export.")).length).toBe(4);
    expect(first.filter((c) => c.includes(".gkg.")).length).toBe(1); // GKG seulement si l'export a des lignes
    const n = calls.length;
    await refreshGdeltEvents({ files: 4, fetchers: fetchers(calls), delayMs: 0, force: true });
    // 2e passage : seul lastupdate.txt, plus les fichiers 404 récents ne sont pas retentés avant 5 min.
    expect(calls.slice(n).filter((c) => c.endsWith(".zip"))).toHaveLength(0);
    const ev = cachedEvents(24 * 3600e3, Date.parse("2026-10-18T10:30:00Z"));
    expect(ev.length).toBeGreaterThan(5);
    expect(ev.find((e) => e.title)).toBeTruthy();
  });

  it("respecte le budget de temps", async () => {
    const calls: string[] = [];
    await refreshGdeltEvents({ files: 10, fetchers: fetchers(calls), delayMs: 0, budgetMs: -1, force: true });
    expect(calls.filter((c) => c.endsWith(".zip"))).toHaveLength(0);
  });

  it("erreur franche si lastupdate est illisible et le cache vide", async () => {
    await expect(refreshGdeltEvents({ files: 2, force: true, fetchers: { text: async () => "rien", bytes: async () => null } })).rejects.toThrow();
  });

  it("fetchSocialFeed : racine 14 seulement, un item par article, caveat, titre ou domaine", async () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(new Date("2026-10-18T10:30:00Z"));
    process.env.GDELT_EVENTS_CATCHUP_FILES = "2";
    const stub = vi.fn(async (input: string | URL | Request) => {
      const url = String(input);
      const ok = (b: Buffer | string) => new Response(typeof b === "string" ? b : new Uint8Array(b), { status: 200 });
      if (url.endsWith("lastupdate.txt")) return ok(lastupdate);
      if (url.includes("20261018101500.export")) return ok(exportZip);
      if (url.includes("20261018101500.gkg")) return ok(gkgZip);
      return new Response("", { status: 404 });
    });
    vi.stubGlobal("fetch", stub);
    const items = await fetchSocialFeed();
    expect(items.length).toBeGreaterThan(0);
    expect(new Set(items.map((i) => i.url)).size).toBe(items.length);
    for (const i of items) {
      expect(i.category).toBe("social");
      expect(i.nature).toBe("press_article");
      expect(i.caveat).toBe("Signal presse GDELT, non confirmé");
      expect(i.title.length).toBeGreaterThan(0);
      expect(i.fetchedAt).not.toBe(i.publishedAt);
      expect(i.publishedAt).toBe("2026-10-18T10:00:00.000Z");
      expect(i.occurredAt).toBeNull();
      expect(i.id.startsWith("gdelt-events:")).toBe(true);
    }
    const fr = items.filter((i) => i.countries.includes("FRA"));
    expect(fr.length).toBeGreaterThan(0);
    expect(fr.some((i) => /France/.test(i.title))).toBe(true);
    // Aucune ligne 18x/19x/20x dans le flux social.
    expect(items.some((i) => /Quentin|Balochistan/.test(i.title))).toBe(false);
  });
});
