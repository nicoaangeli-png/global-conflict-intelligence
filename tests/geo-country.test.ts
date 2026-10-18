import { describe, expect, it } from "vitest";
import * as country from "@/lib/geo/country";

describe("référentiel pays", () => {
  it("expose un module de résolution", () => {
    expect(Object.keys(country).length).toBeGreaterThan(0);
  });
});
