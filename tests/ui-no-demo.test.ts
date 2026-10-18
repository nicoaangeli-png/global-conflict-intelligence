import { describe, expect, it } from "vitest";
import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";

/**
 * Garde-fou statique de l'interface : plus aucune mention « démo / fictif »,
 * plus de « N/A » ni d'« Inconnu » affichés, et les composants morts supprimés.
 */
const ROOT = join(__dirname, "..");

function files(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name);
    return statSync(path).isDirectory() ? files(path) : /\.(tsx?|css)$/.test(name) ? [path] : [];
  });
}

/** Retire commentaires de bloc et de ligne (le texte affiché reste). */
const stripComments = (source: string) => source.replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:"'`])\/\/.*$/gm, "$1");

const UI_FILES = [...files(join(ROOT, "src/components")), join(ROOT, "src/lib/i18n.ts"), join(ROOT, "src/app/layout.tsx"), join(ROOT, "src/app/page.tsx")];

describe("interface : vocabulaire honnête", () => {
  it("ne mentionne nulle part démo, démonstration ni données fictives", () => {
    const offenders: string[] = [];
    for (const file of UI_FILES) {
      const code = stripComments(readFileSync(file, "utf8"))
        // identifiant technique historique filtré côté réglages (jamais affiché)
        .replace(/\(c\.id as string\) !== "demo"/g, "");
      const match = code.match(/d[ée]mo(nstration)?\b|fictif|fictive|fictional|DEMO\b/i);
      if (match) offenders.push(`${file.replace(ROOT, "")}: ${match[0]}`);
    }
    expect(offenders).toEqual([]);
  });

  it("n'affiche jamais « N/A » ni « Inconnu » pour une absence de donnée", () => {
    const offenders = UI_FILES.filter((file) => /["'>]\s*(N\/A|Inconnu)\b/.test(stripComments(readFileSync(file, "utf8"))));
    expect(offenders).toEqual([]);
  });

  it("a supprimé les bandeaux de provenance, onglets fantômes et fiches pays concurrentes", () => {
    for (const dead of ["Timeline", "ViewPanel", "FiltersPanel", "GlobalSituationPanel", "LiveConflictPanel", "CountryProfile", "CountryIndicators", "TacticalReconModal"]) {
      expect(existsSync(join(ROOT, `src/components/ui/${dead}.tsx`))).toBe(false);
    }
    const overlays = readFileSync(join(ROOT, "src/components/ui/Overlays.tsx"), "utf8");
    expect(overlays).not.toMatch(/DataProvenanceBanner|CountryCard|SystemReadout/);
    expect(readFileSync(join(ROOT, "src/lib/i18n.ts"), "utf8")).not.toMatch(/TACTICAL|CHRONOLOGIE/);
  });
});
