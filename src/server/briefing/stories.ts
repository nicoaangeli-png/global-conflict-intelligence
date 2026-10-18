/**
 * Regroupement d'articles de presse en « histoires » : un même événement couvert
 * par plusieurs médias indépendants, détecté par similarité de titres.
 */

const STOPWORDS = new Set(
  (
    "le la les un une des du de d l et ou au aux en dans sur sous par pour avec sans entre vers chez est sont a ont ete etre ce cet cette ces se sa son ses leur leurs qui que quoi dont " +
    "il elle ils elles on nous vous ne pas plus mais donc car si apres avant contre selon face suite apres " +
    "the a an of in on at to for from with without by and or but is are was were be been has have had this that these those it its as into over after before against amid " +
    "says say said news video live photos update breaking new"
  ).split(/\s+/),
);

/** Retire un suffixe « - Nom du média » ou « | Nom du média » en fin de titre. */
export function stripOutlet(title: string): string {
  return title
    .replace(/^[\p{L}\p{N} .'’&-]{2,30}\s\|\s+(?=\S)/u, "") // « Arab News | titre »
    .replace(/\s+[-|–—]\s+[^-|–—]{2,40}$/u, "")
    .replace(/\s+/g, " ")
    .trim();
}

const fold = (s: string) => s.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase();
const stem = (w: string) => (w.length > 4 && /[sx]$/.test(w) ? w.slice(0, -1) : w);

export interface TitleProfile {
  tokens: Set<string>;
  /** Mots capitalisés (noms propres probables), normalisés. */
  entities: Set<string>;
}

export function profileOf(title: string): TitleProfile {
  const clean = stripOutlet(title);
  const tokens = new Set<string>();
  const entities = new Set<string>();
  const shouting = clean.length > 8 && clean === clean.toUpperCase();
  // Mots en début de phrase ou de proposition (après « : », guillemet, tiret) : la majuscule n'indique pas un nom propre.
  const found = [...clean.matchAll(/[\p{L}\p{N}]+/gu)].map((m) => ({ raw: m[0], initial: m.index === 0 || /[:;"'“‘«—–-]\s*$/u.test(clean.slice(Math.max(0, (m.index ?? 0) - 3), m.index)) }));
  const long = found.filter((w) => w.raw.length >= 4);
  // Titre en casse « Title Case » : toutes les majuscules sont trompeuses.
  const titleCase = long.length >= 4 && long.filter((w) => w.raw[0] === w.raw[0].toUpperCase() && w.raw[0] !== w.raw[0].toLowerCase()).length / long.length > 0.7;
  for (const { raw, initial } of found) {
    const w = stem(fold(raw));
    if (w.length < 3 || STOPWORDS.has(w) || /^\d+$/.test(w)) continue;
    tokens.add(w);
    const capitalized = raw[0] !== raw[0].toLowerCase() && raw[0] === raw[0].toUpperCase();
    if (!shouting && !titleCase && !initial && raw.length >= 4 && capitalized) entities.add(w);
  }
  return { tokens, entities };
}

const inter = (a: Set<string>, b: Set<string>) => [...a].filter((x) => b.has(x)).length;

/** Deux titres racontent-ils la même histoire ? (≥ 2 mots communs et Jaccard ≥ 0,3, ou ≥ 2 noms propres communs) */
export function sameStory(a: TitleProfile, b: TitleProfile): boolean {
  if (inter(a.entities, b.entities) >= 2) return true;
  const shared = inter(a.tokens, b.tokens);
  if (shared < 2) return false;
  return shared / (a.tokens.size + b.tokens.size - shared) >= 0.3;
}

/** Domaine « enregistrable » approximatif (sans www ; gère co.uk et similaires). */
export function domainOf(url: string | null): string | null {
  if (!url) return null;
  try {
    const host = new URL(url).hostname.toLowerCase().replace(/^www\./, "");
    const parts = host.split(".");
    if (parts.length <= 2) return host;
    const last2 = parts.slice(-2);
    return last2[0].length <= 3 && last2[1].length === 2 ? parts.slice(-3).join(".") : last2.join(".");
  } catch {
    return null;
  }
}

export interface StoryCandidate {
  title: string;
  url: string | null;
  /** Pays (ISO3 ou nom) : deux articles de pays disjoints ne forment jamais une histoire. */
  countries: string[];
}

export interface Story<T extends StoryCandidate> {
  /** Un article par domaine, dans l'ordre d'entrée. */
  items: T[];
}

/** Histoires couvertes par ≥ 2 domaines indépendants, classées par nombre de domaines décroissant. */
export function clusterStories<T extends StoryCandidate>(candidates: T[]): Story<T>[] {
  const clusters: { members: { item: T; profile: TitleProfile }[] }[] = [];
  for (const item of candidates) {
    if (!item.title?.trim() || !domainOf(item.url)) continue;
    const profile = profileOf(item.title);
    if (profile.tokens.size < 2) continue;
    const home = clusters.find((c) =>
      c.members.some(
        (m) =>
          (!m.item.countries.length || !item.countries.length || m.item.countries.some((x) => item.countries.includes(x))) && sameStory(m.profile, profile),
      ),
    );
    if (home) home.members.push({ item, profile });
    else clusters.push({ members: [{ item, profile }] });
  }
  const stories: Story<T>[] = [];
  for (const c of clusters) {
    const byDomain = new Map<string, T>();
    for (const m of c.members) {
      const d = domainOf(m.item.url) as string;
      if (!byDomain.has(d)) byDomain.set(d, m.item);
    }
    if (byDomain.size >= 2) stories.push({ items: [...byDomain.values()] });
  }
  return stories.sort((a, b) => b.items.length - a.items.length);
}

/** Titre absent ou simple nom de domaine (GDELT sans titre) : inutilisable pour regrouper. */
export function hasRealTitle(title: string | null | undefined, url: string | null): boolean {
  const t = (title ?? "").trim();
  if (t.length < 12 || !/\s/.test(t)) return false;
  const d = domainOf(url);
  return !(d && fold(t).includes(d));
}
