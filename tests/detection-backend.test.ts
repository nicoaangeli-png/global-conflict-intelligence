import { afterEach, describe, expect, it, vi } from "vitest";
import { detectionBackend } from "@/server/detection";

afterEach(() => { vi.unstubAllEnvs(); });

describe("sélection du backend de détection", () => {
  it("auto : SQLite sans DATABASE_URL, PostgreSQL avec DATABASE_URL", () => {
    vi.stubEnv("ORBITAL_DETECTION_STORAGE", "auto");
    vi.stubEnv("DATABASE_URL", "");
    expect(detectionBackend()).toBe("sqlite");
    vi.stubEnv("DATABASE_URL", "postgresql://orbital.invalid/orbital");
    expect(detectionBackend()).toBe("postgres");
  });

  it("sqlite force le local même avec DATABASE_URL (échappatoire de migration)", () => {
    vi.stubEnv("ORBITAL_DETECTION_STORAGE", "sqlite");
    vi.stubEnv("DATABASE_URL", "postgresql://orbital.invalid/orbital");
    expect(detectionBackend()).toBe("sqlite");
  });

  it("postgres exige DATABASE_URL et ne retombe jamais silencieusement sur SQLite", () => {
    vi.stubEnv("ORBITAL_DETECTION_STORAGE", "postgres");
    vi.stubEnv("DATABASE_URL", "");
    expect(detectionBackend()).toBe("postgres");
  });

  it("refuse une valeur inconnue", () => {
    vi.stubEnv("ORBITAL_DETECTION_STORAGE", "mysql");
    expect(() => detectionBackend()).toThrow(/auto, sqlite ou postgres/);
  });
});
