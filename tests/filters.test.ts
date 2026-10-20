import { describe, expect, it } from "vitest";
import { filtersFromSearchParams, MAX_FILTER_VALUES } from "@/server/filters";

describe("filtersFromSearchParams — bornes", () => {
  it("borne chaque liste et ne conserve que les valeurs connues", () => {
    const many = Array.from({ length: MAX_FILTER_VALUES + 25 }, (_, index) => `C${index}`).join(",");
    const filters = filtersFromSearchParams(
      new URLSearchParams({
        range: "7d",
        countries: many,
        types: `${Array.from({ length: 60 }, () => "Battles").join(",")},Inconnu`,
        confidences: "CONFIRMED,Unknown",
        datasets: "gdelt,ucdp,autre",
      }),
    );
    expect(filters.countries).toHaveLength(MAX_FILTER_VALUES);
    expect(filters.types).toEqual(["Battles"]);
    expect(filters.confidences).toEqual(["CONFIRMED"]);
    expect(filters.datasets).toEqual(["gdelt", "ucdp"]);
    expect(filters.range).toBe("7d");
  });

  it("retombe sur 30 jours pour une plage inconnue", () => {
    expect(filtersFromSearchParams(new URLSearchParams({ range: "décennie" })).range).toBe("30d");
  });
});
