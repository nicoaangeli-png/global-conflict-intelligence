import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("server-only", () => ({}));

import {
  parseWikidataLeaders,
  buildLeadersQuery,
  getCountryLeaders,
  clearLeadersCache,
  type WikidataBinding,
} from "@/server/leaders";

import fraFixture from "./fixtures/leaders/fra.json";
import usaFixture from "./fixtures/leaders/usa.json";
import gbrFixture from "./fixtures/leaders/gbr.json";
import belFixture from "./fixtures/leaders/bel.json";
import cheFixture from "./fixtures/leaders/che.json";
import edgeCasesFixture from "./fixtures/leaders/edge_cases.json";

describe("Leaders (Wikidata SPARQL)", () => {
  beforeEach(() => {
    clearLeadersCache();
    vi.restoreAllMocks();
  });

  describe("Requête SPARQL", () => {
    it("construit une requête conforme avec filtres de rang, fin de mandat et langues", () => {
      const q = buildLeadersQuery("FRA");
      expect(q).toContain('?country wdt:P298 "FRA"');
      expect(q).toContain("p:P35 ?st");
      expect(q).toContain("p:P6 ?st");
      expect(q).toContain("FILTER(?rank != wikibase:DeprecatedRank)");
      expect(q).toContain("FILTER (!BOUND(?end) || ?end > NOW())");
      expect(q).toContain('wikibase:language "fr,en,mul"');
    });
  });

  describe("Traitement des fixtures réelles", () => {
    it("France (FRA) : renvoie le Président ET le Premier ministre sans omettre le libellé mul", () => {
      const leaders = parseWikidataLeaders(fraFixture.results.bindings as WikidataBinding[]);
      expect(leaders).toHaveLength(2);

      const [president, premierMinistre] = leaders;
      expect(president).toEqual({
        role: "head_of_state",
        roles: ["head_of_state"],
        cumulative: false,
        name: "Emmanuel Macron",
        since: "2017-05-14",
        wikidataId: "Q3052772",
        sourceUrl: "https://www.wikidata.org/wiki/Q3052772",
      });

      expect(premierMinistre).toEqual({
        role: "head_of_government",
        roles: ["head_of_government"],
        cumulative: false,
        name: "Sébastien Lecornu",
        since: "2025-09-09",
        wikidataId: "Q20089181",
        sourceUrl: "https://www.wikidata.org/wiki/Q20089181",
      });
    });

    it("États-Unis (USA) : cumul chef d'État et chef du gouvernement non dupliqué avec indicateur explicite", () => {
      const leaders = parseWikidataLeaders(usaFixture.results.bindings as WikidataBinding[]);
      expect(leaders).toHaveLength(1);

      const [trump] = leaders;
      expect(trump).toEqual({
        role: "head_of_state_and_government",
        roles: ["head_of_state", "head_of_government"],
        cumulative: true,
        name: "Donald Trump",
        since: "2025-01-20",
        wikidataId: "Q22686",
        sourceUrl: "https://www.wikidata.org/wiki/Q22686",
      });
    });

    it("Royaume-Uni (GBR) : monarque en chef d'État et Premier ministre distincts", () => {
      const leaders = parseWikidataLeaders(gbrFixture.results.bindings as WikidataBinding[]);
      expect(leaders).toHaveLength(2);

      const [monarque, premierMinistre] = leaders;
      expect(monarque).toEqual({
        role: "head_of_state",
        roles: ["head_of_state"],
        cumulative: false,
        name: "Charles III",
        since: "2022-09-08",
        wikidataId: "Q43274",
        sourceUrl: "https://www.wikidata.org/wiki/Q43274",
      });

      expect(premierMinistre).toEqual({
        role: "head_of_government",
        roles: ["head_of_government"],
        cumulative: false,
        name: "Andy Burnham",
        since: "2026-07-20",
        wikidataId: "Q269909",
        sourceUrl: "https://www.wikidata.org/wiki/Q269909",
      });
    });

    it("Belgique (BEL) : monarque constitutionnel et chef du gouvernement", () => {
      const leaders = parseWikidataLeaders(belFixture.results.bindings as WikidataBinding[]);
      expect(leaders).toHaveLength(2);

      const [monarque, chefGouv] = leaders;
      expect(monarque.name).toBe("Philippe de Belgique");
      expect(monarque.role).toBe("head_of_state");
      expect(monarque.since).toBe("2013-07-21");

      expect(chefGouv.name).toBe("Bart De Wever");
      expect(chefGouv.role).toBe("head_of_government");
      expect(chefGouv.since).toBe("2025-02-03");
    });

    it("Suisse (CHE) : directoire collégial (Conseil fédéral) cumulé sans date inventée (null)", () => {
      const leaders = parseWikidataLeaders(cheFixture.results.bindings as WikidataBinding[]);
      expect(leaders).toHaveLength(1);

      const [conseil] = leaders;
      expect(conseil.name).toBe("Conseil fédéral");
      expect(conseil.role).toBe("head_of_state_and_government");
      expect(conseil.cumulative).toBe(true);
      expect(conseil.since).toBeNull();
    });
  });

  describe("Règles métier et cas limites (edge cases)", () => {
    it("exclut les rangs dépréciés, mandats échus, libellés non résolus et applique la priorité de rang", () => {
      // Date de référence fixée au 15/06/2025
      const nowMs = new Date("2025-06-15T00:00:00Z").getTime();
      const leaders = parseWikidataLeaders(
        edgeCasesFixture.results.bindings as WikidataBinding[],
        nowMs
      );

      // Q100 (DeprecatedRank) -> exclu
      // Q101 (end: 2024-01-01 < nowMs) -> exclu
      // Q102 (NormalRank alors que Q103 est PreferredRank pour head_of_state) -> exclu
      // Q103 (PreferredRank, head_of_state) -> retenu
      // Q104 (personLabel: 'Q104') -> exclu (non résolu, pas d'invention)
      // Q105 (NormalRank, seul candidat pour head_of_government) -> retenu
      expect(leaders).toHaveLength(2);
      expect(leaders[0].wikidataId).toBe("Q103");
      expect(leaders[0].name).toBe("Chef d'État Actuel Préféré");
      expect(leaders[0].role).toBe("head_of_state");

      expect(leaders[1].wikidataId).toBe("Q105");
      expect(leaders[1].name).toBe("Chef du Gouvernement Actuel");
      expect(leaders[1].role).toBe("head_of_government");
    });
  });

  describe("getCountryLeaders (gestion réseau et erreurs)", () => {
    it("rejette les codes ISO invalides sans appel réseau (not_covered)", async () => {
      const fetchSpy = vi.spyOn(globalThis, "fetch");
      const res = await getCountryLeaders("france");
      expect(res.status).toBe("unavailable");
      expect(res.reason).toBe("not_covered");
      expect(res.leaders).toEqual([]);
      expect(fetchSpy).not.toHaveBeenCalled();
    });

    it("récupère les dirigeants et respecte l'en-tête User-Agent requis", async () => {
      const fetchSpy = vi.spyOn(globalThis, "fetch").mockResolvedValueOnce({
        ok: true,
        json: async () => fraFixture,
      } as unknown as Response);

      const res = await getCountryLeaders("FRA");
      expect(res.status).toBe("available");
      expect(res.reason).toBeNull();
      expect(res.leaders).toHaveLength(2);
      expect(fetchSpy).toHaveBeenCalledTimes(1);

      const callArgs = fetchSpy.mock.calls[0];
      const headers = (callArgs[1]?.headers ?? {}) as Record<string, string>;
      expect(headers["User-Agent"]).toBe("ORBITAL/0.2 (contact nicoa.angeli@gmail.com)");
    });

    it("met en cache les résultats pour les appels ultérieurs", async () => {
      const fetchSpy = vi.spyOn(globalThis, "fetch").mockResolvedValueOnce({
        ok: true,
        json: async () => fraFixture,
      } as unknown as Response);

      const first = await getCountryLeaders("FRA");
      const second = await getCountryLeaders("FRA");
      expect(first).toBe(second);
      expect(fetchSpy).toHaveBeenCalledTimes(1);
    });

    it("gère les pannes réseau sans lever d'exception (error)", async () => {
      vi.spyOn(globalThis, "fetch").mockRejectedValueOnce(new Error("Network timeout"));
      const res = await getCountryLeaders("DEU");
      expect(res.status).toBe("error");
      expect(res.reason).toBe("error");
      expect(res.leaders).toEqual([]);
    });

    it("gère l'absence de dirigeants dans Wikidata (no_data)", async () => {
      vi.spyOn(globalThis, "fetch").mockResolvedValueOnce({
        ok: true,
        json: async () => ({ results: { bindings: [] } }),
      } as unknown as Response);

      const res = await getCountryLeaders("XYZ");
      expect(res.status).toBe("unavailable");
      expect(res.reason).toBe("no_data");
      expect(res.leaders).toEqual([]);
    });
  });
});
