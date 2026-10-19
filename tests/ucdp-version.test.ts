import { describe, expect, it } from "vitest";
import { candidateVersions } from "@/server/connectors/ucdp";

describe("UCDP — versions candidates", () => {
  it("sonde du mois courant vers le passé, en changeant d'année", () => {
    const v = candidateVersions(new Date("2026-02-15T00:00:00Z"));
    expect(v.slice(0, 4)).toEqual(["26.0.2", "26.0.1", "25.0.12", "25.0.11"]);
    expect(v).toHaveLength(14);
  });
});
