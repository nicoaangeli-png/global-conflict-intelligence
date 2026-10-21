import { describe, expect, it } from "vitest";
import { canFocusEvent, sourceHref, statusLabel, utcTime } from "@/components/detection/presentation";

describe("detection presentation boundaries", () => {
  it("allows globe focus only for finite point/city coordinates", () => {
    for (const precision of ["point", "city"] as const) expect(canFocusEvent({ lat: 48, lon: 2, precision })).toBe(true);
    for (const precision of ["region", "country", "unknown"] as const) expect(canFocusEvent({ lat: 48, lon: 2, precision })).toBe(false);
    expect(canFocusEvent(null)).toBe(false);
    expect(canFocusEvent({ lat: NaN, lon: 2, precision: "point" })).toBe(false);
    expect(canFocusEvent({ lat: 91, lon: 2, precision: "point" })).toBe(false);
    expect(canFocusEvent({ lat: 48, lon: 181, precision: "city" })).toBe(false);
  });
  it("permits only absolute HTTP source links without credentials", () => {
    expect(sourceHref("https://example.org/report")).toBe("https://example.org/report");
    for (const value of [null, "javascript:alert(1)", "data:text/html,test", "/api/secrets", "https://user:pass@example.org"]) expect(sourceHref(value)).toBeNull();
  });
  it("localizes assessments without conflating watch and confirmed", () => {
    expect(statusLabel("watch", "fr")).toBe("À surveiller");
    expect(statusLabel("confirmed", "en")).toBe("Confirmed");
    expect(statusLabel("high", "fr")).not.toBe("Confirmé");
  });
  it("keeps missing occurrence unknown and formats valid dates in UTC", () => {
    expect(utcTime(null, "fr")).toBe("Date inconnue");
    expect(utcTime("bad", "en")).toBe("Unknown time");
    expect(utcTime("2026-10-20T12:00:00+02:00", "en")).toContain("10:00:00 UTC");
  });
});
