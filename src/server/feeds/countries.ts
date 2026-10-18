import { resolveCountryIdentity, normalizeCountryName } from "@/lib/geo/country";

/**
 * Attribution d'un pays à un texte (titre d'article, communiqué) par
 * correspondance de MOT ENTIER sur des noms anglais et français.
 *
 * Garde-fous :
 * - la recherche se fait sur le texte normalisé (accents et ponctuation retirés), avec
 *   frontières de mots : « Niger » ne correspond jamais à « Nigeria », « Iran » pas à « Tirana » ;
 * - les noms les plus longs sont consommés d'abord : « Papua New Guinea » ne déclenche pas « Guinea »,
 *   « South Sudan » ne déclenche pas « Sudan », « New Mexico » ne déclenche pas « Mexico » ;
 * - les noms ambigus (Georgia, Congo seul, Guinea-pig…) sont volontairement absents ;
 * - les sigles (US, UK, UAE, DRC) ne sont reconnus qu'en majuscules, jamais « us » (pronom).
 * En cas de doute, la liste retournée est vide.
 */

// Chaque entrée : ISO3 puis noms séparés par « | » (anglais et français, sans doublon accent).
const TABLE = `
AFG|Afghanistan
ALB|Albania|Albanie
DZA|Algeria|Algérie
AND|Andorra|Andorre
AGO|Angola
ATG|Antigua and Barbuda|Antigua-et-Barbuda
ARG|Argentina|Argentine
ARM|Armenia|Arménie
AUS|Australia|Australie
AUT|Austria|Autriche
AZE|Azerbaijan|Azerbaïdjan
BHS|Bahamas
BHR|Bahrain|Bahreïn
BGD|Bangladesh
BRB|Barbados|Barbade
BLR|Belarus|Bélarus|Biélorussie
BEL|Belgium|Belgique
BLZ|Belize
BEN|Benin|Bénin
BTN|Bhutan|Bhoutan
BOL|Bolivia|Bolivie
BIH|Bosnia and Herzegovina|Bosnia|Bosnie-Herzégovine|Bosnie
BWA|Botswana
BRA|Brazil|Brésil
BRN|Brunei
BGR|Bulgaria|Bulgarie
BFA|Burkina Faso
BDI|Burundi
CPV|Cabo Verde|Cape Verde
KHM|Cambodia|Cambodge
CMR|Cameroon|Cameroun
CAN|Canada
CAF|Central African Republic|République centrafricaine|Centrafrique
TCD|Chad|Tchad
CHL|Chile|Chili
CHN|China|Chine|People's Republic of China
COL|Colombia|Colombie
COM|Comoros|Comores
COD|Democratic Republic of the Congo|Democratic Republic of Congo|DR Congo|RD Congo|RDC|République démocratique du Congo|Congo-Kinshasa
COG|Republic of the Congo|Republic of Congo|République du Congo|Congo-Brazzaville
CRI|Costa Rica
CIV|Côte d'Ivoire|Cote d'Ivoire|Ivory Coast
HRV|Croatia|Croatie
CUB|Cuba
CYP|Cyprus|Chypre
CZE|Czech Republic|Czechia|Tchéquie|République tchèque
DNK|Denmark|Danemark
DJI|Djibouti
DMA|Dominica|Dominique
DOM|Dominican Republic|République dominicaine
ECU|Ecuador|Équateur
EGY|Egypt|Égypte
SLV|El Salvador
GNQ|Equatorial Guinea|Guinée équatoriale
ERI|Eritrea|Érythrée
EST|Estonia|Estonie
SWZ|Eswatini|Swaziland
ETH|Ethiopia|Éthiopie
FJI|Fiji|Fidji
FIN|Finland|Finlande
FRA|France|Français|French Republic
GAB|Gabon
GMB|Gambia|Gambie
DEU|Germany|Allemagne
GHA|Ghana
GRC|Greece|Grèce
GRD|Grenada|Grenade
GTM|Guatemala
GIN|Guinea|Guinée
GNB|Guinea-Bissau|Guinée-Bissau
GUY|Guyana
HTI|Haiti|Haïti
HND|Honduras
HKG|Hong Kong
HUN|Hungary|Hongrie
ISL|Iceland|Islande
IND|India|Inde
IDN|Indonesia|Indonésie
IRN|Iran
IRQ|Iraq|Irak
IRL|Ireland|Irlande
ISR|Israel|Israël
ITA|Italy|Italie
JAM|Jamaica|Jamaïque
JPN|Japan|Japon
JOR|Jordan|Jordanie
KAZ|Kazakhstan
KEN|Kenya
KIR|Kiribati
PRK|North Korea|Corée du Nord|Democratic People's Republic of Korea
KOR|South Korea|Corée du Sud|Republic of Korea
KOS|Kosovo
KWT|Kuwait|Koweït
KGZ|Kyrgyzstan|Kirghizistan
LAO|Laos
LVA|Latvia|Lettonie
LBN|Lebanon|Liban
LSO|Lesotho
LBR|Liberia|Libéria
LBY|Libya|Libye
LIE|Liechtenstein
LTU|Lithuania|Lituanie
LUX|Luxembourg
MDG|Madagascar
MWI|Malawi
MYS|Malaysia|Malaisie
MDV|Maldives
MLI|Mali
MLT|Malta|Malte
MHL|Marshall Islands|Îles Marshall
MRT|Mauritania|Mauritanie
MUS|Mauritius|Maurice
MEX|Mexico|Mexique
FSM|Micronesia|Micronésie
MDA|Moldova|Moldavie
MCO|Monaco
MNG|Mongolia|Mongolie
MNE|Montenegro|Monténégro
MAR|Morocco|Maroc
MOZ|Mozambique
MMR|Myanmar|Burma|Birmanie
NAM|Namibia|Namibie
NRU|Nauru
NPL|Nepal|Népal
NLD|Netherlands|Pays-Bas|Holland
NZL|New Zealand|Nouvelle-Zélande
NIC|Nicaragua
NER|Niger
NGA|Nigeria|Nigéria
MKD|North Macedonia|Macédoine du Nord
NOR|Norway|Norvège
OMN|Oman
PAK|Pakistan
PLW|Palau|Palaos
PSE|Palestine|Palestinian territories|Palestinian Territory|Gaza|West Bank|Cisjordanie|Territoire palestinien occupé|Territoires palestiniens
PAN|Panama
PNG|Papua New Guinea|Papouasie-Nouvelle-Guinée
PRY|Paraguay
PER|Peru|Pérou
PHL|Philippines
POL|Poland|Pologne
PRT|Portugal
QAT|Qatar
ROU|Romania|Roumanie
RUS|Russia|Russian Federation|Russie|Fédération de Russie
RWA|Rwanda
KNA|Saint Kitts and Nevis|Saint-Kitts-et-Nevis
LCA|Saint Lucia|Sainte-Lucie
VCT|Saint Vincent and the Grenadines|Saint-Vincent-et-les-Grenadines
WSM|Samoa
SMR|San Marino|Saint-Marin
STP|Sao Tome and Principe|São Tomé-et-Príncipe
SAU|Saudi Arabia|Arabie saoudite
SEN|Senegal|Sénégal
SRB|Serbia|Serbie
SYC|Seychelles
SLE|Sierra Leone
SGP|Singapore|Singapour
SVK|Slovakia|Slovaquie
SVN|Slovenia|Slovénie
SLB|Solomon Islands|Îles Salomon
SOM|Somalia|Somalie
ZAF|South Africa|Afrique du Sud
SSD|South Sudan|Soudan du Sud
ESP|Spain|Espagne
LKA|Sri Lanka
SDN|Sudan|Soudan
SUR|Suriname
SWE|Sweden|Suède
CHE|Switzerland|Suisse
SYR|Syria|Syrie
TWN|Taiwan|Taïwan
TJK|Tajikistan|Tadjikistan
TZA|Tanzania|Tanzanie
THA|Thailand|Thaïlande
TLS|Timor-Leste|East Timor|Timor oriental
TGO|Togo
TON|Tonga
TTO|Trinidad and Tobago|Trinité-et-Tobago
TUN|Tunisia|Tunisie
TUR|Turkey|Türkiye|Turkiye|Turquie
TKM|Turkmenistan|Turkménistan
TUV|Tuvalu
UGA|Uganda|Ouganda
UKR|Ukraine
ARE|United Arab Emirates|Émirats arabes unis
GBR|United Kingdom|Great Britain|Royaume-Uni|Grande-Bretagne|England|Angleterre|Scotland|Écosse|Wales|Northern Ireland|Irlande du Nord
USA|United States|United States of America|États-Unis|Etats-Unis
URY|Uruguay
UZB|Uzbekistan|Ouzbékistan
VUT|Vanuatu
VAT|Vatican|Holy See|Saint-Siège
VEN|Venezuela
VNM|Vietnam|Viet Nam
YEM|Yemen|Yémen
ZMB|Zambia|Zambie
ZWE|Zimbabwe
`;

// Noms qui absorbent un faux positif sans attribuer de pays (ex. l'État du Nouveau-Mexique).
const ABSORBERS = ["New Mexico", "Nouveau-Mexique", "New Guinea pig", "West Virginia", "Guinea pig", "Guinea pigs", "Jersey"];

// Sigles reconnus seulement tels quels (casse respectée).
const ACRONYMS: Array<[RegExp, string]> = [
  [/(?<![A-Za-z])U\.S\.(?![A-Za-z])/, "USA"],
  [/\bUSA\b/, "USA"],
  [/\bUS\b(?!\s*(?:\$|dollars?))/, "USA"],
  [/\bUK\b/, "GBR"],
  [/\bUAE\b/, "ARE"],
  [/\bDRC\b/, "COD"],
  [/\bDPRK\b/, "PRK"],
];

interface AliasEntry {
  key: string; // texte normalisé
  iso3: string | null; // null = absorbeur
}

let ALIASES: AliasEntry[] | null = null;

function aliases(): AliasEntry[] {
  if (ALIASES) return ALIASES;
  const list: AliasEntry[] = [];
  const seen = new Set<string>();
  for (const line of TABLE.split("\n")) {
    const parts = line.trim().split("|");
    if (parts.length < 2) continue;
    const [iso3, ...names] = parts;
    for (const name of names) {
      // « Français » seul désignerait une langue : ne retenu que les noms de pays.
      if (name === "Français") continue;
      const key = normalizeCountryName(name);
      if (!key || seen.has(key)) continue;
      seen.add(key);
      list.push({ key, iso3 });
    }
  }
  for (const name of ABSORBERS) {
    const key = normalizeCountryName(name);
    if (!seen.has(key)) list.push({ key, iso3: null });
  }
  // Les plus longs d'abord : ils consomment leur texte avant les noms plus courts qu'ils contiennent.
  list.sort((a, b) => b.key.length - a.key.length);
  ALIASES = list;
  return list;
}

/** ISO3 des pays nommés dans un texte (ordre d'apparition, sans doublon). Vide si aucun nom certain. */
export function countriesInText(text: string | null | undefined): string[] {
  if (!text) return [];
  const found = new Map<string, number>(); // iso3 -> position
  for (const [re, iso3] of ACRONYMS) {
    const m = re.exec(text);
    if (m && !found.has(iso3)) found.set(iso3, m.index);
  }
  let hay = ` ${normalizeCountryName(text)} `;
  for (const { key, iso3 } of aliases()) {
    const needle = ` ${key} `;
    let from = 0;
    for (;;) {
      const at = hay.indexOf(needle, from);
      if (at < 0) break;
      if (iso3 && !found.has(iso3)) found.set(iso3, at);
      // Consomme le nom (en gardant les espaces de bordure) pour que les noms plus courts ne le revoient pas.
      hay = hay.slice(0, at + 1) + "#".repeat(key.length) + hay.slice(at + 1 + key.length);
      from = at + needle.length - 1;
    }
  }
  return [...found.entries()].sort((a, b) => a[1] - b[1]).map(([iso3]) => iso3);
}

/** Normalise un code pays en ISO3 canonique via le référentiel du projet (null si inconnu). */
export function canonicalIso3(value: string | null | undefined): string | null {
  if (!value) return null;
  const identity = resolveCountryIdentity(value.trim());
  return identity && /^[A-Z]{3}$/.test(identity.iso3) ? identity.iso3 : null;
}

/**
 * Pays d'un titre de presse ; à défaut, du résumé, mais seulement s'il en nomme au plus deux
 * (au-delà, l'article cite des pays en passant et l'attribution serait trompeuse).
 */
export function countriesFromHeadline(title: string, summary?: string | null): string[] {
  const fromTitle = countriesInText(title);
  if (fromTitle.length) return fromTitle.slice(0, 4);
  const fromSummary = countriesInText(summary ?? "");
  return fromSummary.length <= 2 ? fromSummary : [];
}
