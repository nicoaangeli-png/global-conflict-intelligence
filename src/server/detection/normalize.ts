import type { Signal, SignalKind } from "@/types/detection";
import type { ConflictEvent } from "@/types/conflict";
import type { LiveItem } from "@/types/feeds";
import { isRealSourceRecord } from "@/server/dataPolicy";
import { cleanUnicode } from "./language/unicode";
import { isCjkChar } from "./language/scripts";
import { classifySignalText } from "./lexicon/categories";
import { detectUpstreamAgency } from "./lexicon/entities";
import { extractPlaces } from "./lexicon/places";

function uReplace(text: string, regexStr: string, replacement: string): string {
  const converted = regexStr
    .replace(/(^|[(|])\\b/g, "$1(?<![\\p{L}\\p{N}])")
    .replace(/\\b([)|]|$)/g, "(?![\\p{L}\\p{N}])$1");
  return text.replace(new RegExp(converted, "giu"), replacement);
}

/**
 * Normalizes multi-lingual words and concept terms into canonical representations.
 */
export function words(value: string): string[] {
  if (!value) return [];
  const cleaned = cleanUnicode(value);

  let mapped = cleaned;

  // CJK non-segmented concept keywords
  mapped = mapped
    .replace(/(爆炸|爆発|폭발)/gu, " explosion ")
    .replace(/(地震|震源|震级|余震|强震|지진)/gu, " earthquake ")
    .replace(/(マグニチュード|규모)/gu, " magnitude ")
    .replace(/(导弹|火箭弹|空袭|轰炸|ミサイル|空爆|미사일|공습)/gu, " missile ")
    .replace(/(抗议|示威|游行|骚乱|暴乱|罢工|デモ|抗議|暴動|항의|시위|폭동|파업)/gu, " protest ")
    .replace(/(停电|断电|电网故障|大面积停电|停電|送電停止|정전|전력\s*차단)/gu, " outage ")
    .replace(/(洪水|内涝|飓风|台风|暴风雨|颱風|暴風雨|침수|허리케인|태풍|폭풍우)/gu, " weather ")
    .replace(/(港口|港|港湾|埠頭|항구|부두)/gu, " port ")
    .replace(/(机场|航站楼|空军基地|空港|飛行場|공항|비행장)/gu, " airport ")
    .replace(/(敖德萨|オデッサ|오데사)/gu, " odesa ")
    .replace(/(基辅|キエフ|キーウ|키이우|키예프)/gu, " kyiv ")
    .replace(/(莫斯科|モスクワ|모스크바)/gu, " moscow ")
    .replace(/(德黑兰|テヘラン|테헤란)/gu, " tehran ")
    .replace(/(北京|ペキン|ベイジン|베이징|북경)/gu, " beijing ")
    .replace(/(东京|東京|도쿄)/gu, " tokyo ")
    .replace(/(首尔|汉城|ソウル|서울)/gu, " seoul ")
    .replace(/(台北|臺北|タイペイ)/gu, " taipei ")
    .replace(/(耶路撒冷|エルサレム)/gu, " jerusalem ")
    .replace(/(巴格达|バグダッド)/gu, " baghdad ")
    .replace(/(大马士革|ダマスカス)/gu, " damascus ")
    .replace(/(贝鲁特|ベイルート)/gu, " beirut ")
    .replace(/(加沙|ガザ)/gu, " gaza ")
    .replace(/(特拉维夫|テルアビブ)/gu, " tel_aviv ")
    .replace(/(扎波罗热)/gu, " zaporizhzhia ")
    .replace(/(塞瓦斯托波尔)/gu, " sevastopol ")
    .replace(/(哈尔科夫|ハリコフ)/gu, " kharkiv ");

  // Segmented / space-delimited concept replacements with Unicode boundaries
  mapped = uReplace(mapped, "\\b(odessa|одес[аіеу]|одесс[аеуі]|أوديسا|اوديسا|اودسا|אודסה)\\b", "odesa");
  mapped = uReplace(mapped, "\\b(kyiv|kiev|kiew|київ|києв[іеау]|киев[еау]?|كييف|کی‌یف|کیف|קייב)\\b", "kyiv");
  mapped = uReplace(mapped, "\\b(moscow|moskva|moscou|moskau|mosca|москв[аеіу]|москвой|موسكو|مسکو|מוסקבה)\\b", "moscow");
  mapped = uReplace(mapped, "\\b(tehran|teheran|tahran|тегеран[еау]?|тегерані|تهران|طهران|טהראן|טהרן)\\b", "tehran");
  mapped = uReplace(mapped, "\\b(beijing|pekin|peking|pequim|pechino|пекин[еау]?|пекіні|بكين|پکن|בייג'ינג|בייג'ין)\\b", "beijing");
  mapped = uReplace(mapped, "\\b(tokyo|tokio|токио|طوكيو|טוקיו)\\b", "tokyo");
  mapped = uReplace(mapped, "\\b(seoul|seul|сеул[еау]?|سيول|سول|סיאול)\\b", "seoul");
  mapped = uReplace(mapped, "\\b(taipei|taipeh|тайбэ[еяй]|تايبيه|טאיפיי)\\b", "taipei");
  mapped = uReplace(mapped, "\\b(jerusalem|jerusalen|gerusalemme|иерусалим[еау]?|القدس|اورشليم|ירושלים)\\b", "jerusalem");
  mapped = uReplace(mapped, "\\b(baghdad|bagdad|багдад[еау]?|بغداد|בגדאד)\\b", "baghdad");
  mapped = uReplace(mapped, "\\b(kharkiv|kharkov|харків[іау]?|харьков[еау]?|خاركيف|خاركوف|חרקוב)\\b", "kharkiv");
  mapped = uReplace(mapped, "\\b(zaporizhzhia|zaporizhia|zaporozhye|запоріжж[яіе]|запорожь[ея]|запорожье|زابوريجيا|זפורוז'יה)\\b", "zaporizhzhia");
  mapped = uReplace(mapped, "\\b(sevastopol|sebastopol|севастопол[ьяеі]|سيفاستوبول|סבסטופול)\\b", "sevastopol");
  mapped = uReplace(mapped, "\\b(damascus|damas|damaskus|damasco|дамаск[еау]?|دمشق|דמשק)\\b", "damascus");
  mapped = uReplace(mapped, "\\b(beirut|beyrouth|beirute|бейрут[еау]?|بيروت|ביירות)\\b", "beirut");
  mapped = uReplace(mapped, "\\b(gaza|газ[аеуы]|غزة|עזה)\\b", "gaza");
  mapped = uReplace(mapped, "\\b(tel\\s+aviv|tel-aviv|тель-авив[еау]?|تل\\s+ابيب|תל\\s+אביב)\\b", "tel_aviv");

  // Event category terms
  mapped = uReplace(
    mapped,
    "\\b(explosions?|detonations?|blasts?|de[Bb]tonations?|esplosioni?|explosoes?|explosao|detonacao|detonacoes|esplosion[ei]|sprengungen?|взрыв(?:ы|ов)?|детонаци[ия]|вибух(?:и|ів)?|детонаці[їя]|انفجار(?:ات)?|دوي\\s+انفجار|פיצוץ|פיצוצים|patlama(?:lar)?|infilak)\\b",
    "explosion"
  );
  mapped = uReplace(
    mapped,
    "\\b(seismes?|earthquakes?|tremblement(?:s)?|quakes?|terremotos?|sismos?|erdbeben|beben|землетрясени[ея]|землетрус(?:и)?|زلزال|زلزلة|زمین\\s*لرزه|deprem|רעידת\\s+אדמה)\\b",
    "earthquake"
  );
  mapped = uReplace(
    mapped,
    "\\b(missiles?|missile\\s+strikes?|rockets?|airstrikes?|bombardements?|frappes?|misil(?:es)?|raketen?|ракет[аыи]|обстрел(?:ы|ов)?|обстріл(?:и|ів)?|авиаудар(?:ы|ов)?|авіаудар(?:и|ів)?|صاروخ|صواريخ|قصف|ضربة\\s+جوية|غارة|טיל|טילים|הפצצה|fuze(?:ler)?|roket)\\b",
    "missile"
  );
  mapped = uReplace(
    mapped,
    "\\b(protests?|protesters?|manifestations?|manifestants?|emeutes?|riots?|disturbios?|unruhen|протест(?:ы|и)?|митинг(?:и)?|заворушенн[яі]|احتجاجات|مظاهرة|اعتراضات|מחאה|הפגנה|eylem|gosteri)\\b",
    "protest"
  );
  mapped = uReplace(
    mapped,
    "\\b(outages?|blackouts?|pannes?(?:\\s+generales?)?|apag(?:on|ones|ao|oes)|stromausfall|блэкаут|блекаут|отключени[ея]\\s+света|відключенн[яі]\\s+світла|انقطاع\\s+الكهرباء|قطعي\\s+برق|قطع\\s+برق|elektrik\\s+kesintisi|הפסקת\\s+חשמל)\\b",
    "outage"
  );
  mapped = uReplace(
    mapped,
    "\\b(ports?|harbors?|harbours?|quais?|docks?|puertos?|hafen|порт(?:а|у|е|ом|і)?|причал[ауеі]?|ميناء|נמל|liman)\\b",
    "port"
  );
  mapped = uReplace(
    mapped,
    "\\b(airports?|aeroports?|aeropuertos?|flughafen|аэропорт[ауе]?|аеропорт[уі]?|مطار|נמל\\s+תعופה|havalimani)\\b",
    "airport"
  );

  const rawMatches = mapped.match(/[\p{L}\p{N}]+/gu) ?? [];
  const tokens: string[] = [];

  for (const token of rawMatches) {
    const hasCjk = Array.from(token).some(isCjkChar);
    if (hasCjk) {
      const chars = Array.from(token);
      if (chars.length <= 3) {
        tokens.push(token);
      } else {
        tokens.push(token);
        for (let i = 0; i < chars.length - 1; i++) {
          tokens.push(chars[i] + chars[i + 1]);
        }
      }
    } else {
      tokens.push(token);
    }
  }

  return tokens;
}

export const normalized = (value: string): string => words(value).join(" ");

export function safeUrl(value: string | null): string | null {
  try {
    const url = new URL(value ?? "");
    return ["http:", "https:"].includes(url.protocol) && !url.username && !url.password ? url.href : null;
  } catch {
    return null;
  }
}

export function date(value: string | null | undefined): string | null {
  const time = value ? Date.parse(value) : NaN;
  return Number.isFinite(time) ? new Date(time).toISOString() : null;
}

export function classify(text: string): SignalKind {
  return classifySignalText(text);
}

export function validPosition(
  lat: number | null,
  lon: number | null,
  precision: NonNullable<Signal["position"]>["precision"]
): Signal["position"] {
  return lat !== null && lon !== null && Number.isFinite(lat) && Number.isFinite(lon) && Math.abs(lat) <= 90 && Math.abs(lon) <= 180
    ? { lat, lon, precision }
    : null;
}

export function agencyIn(text: string): string | null {
  return detectUpstreamAgency(text);
}

export function fromFeed(item: LiveItem): Signal | null {
  if (["military", "shipping", "economy", "space", "uap"].includes(item.category)) return null;
  const occurredAt = date(item.occurredAt);
  const isUsgs = item.sourceId === "usgs" && item.nature === "sensor_measurement";
  const kind = isUsgs ? "earthquake" : item.category === "weather" ? "weather" : classify(item.title);
  // LiveItem n'expose pas de localité structurée : on ne promeut que les toponymes
  // canoniques explicitement présents dans le texte, jamais une ville devinée.
  const place = extractPlaces(`${item.title} ${item.summary ?? ""}`)[0] ?? null;
  return {
    id: `feed:${item.id}`,
    provider: item.sourceId,
    sourceName: item.sourceName,
    url: safeUrl(item.url),
    title: item.title.slice(0, 500),
    text: item.summary?.slice(0, 4000) ?? null,
    kind,
    nature:
      item.nature === "press_article"
        ? "press"
        : item.nature === "sensor_measurement"
          ? "sensor"
          : item.nature.startsWith("official_")
            ? "official"
            : "report",
    occurredAt,
    publishedAt: date(item.publishedAt),
    receivedAt: date(item.fetchedAt) ?? new Date().toISOString(),
    position: validPosition(item.lat, item.lon, isUsgs ? "point" : "unknown"),
    place,
    countries: item.countries ?? [],
    entities: [],
    upstreamAgency: agencyIn(`${item.title} ${item.summary ?? ""}`),
    confirmsOccurrence: isUsgs && occurredAt !== null,
    severity: item.severity,
    metric: item.metric,
    caveat: item.caveat,
  };
}

export function fromConflict(item: ConflictEvent, receivedAt: string): Signal | null {
  if (!isRealSourceRecord(item)) return null;
  const media = item.sourceDataset === "gdelt";
  const thermal = item.sourceDataset === "firms";
  const structured = ["ucdp", "acled"].includes(item.sourceDataset);
  const title = item.title?.trim() || item.subEventType?.trim() || item.eventType;
  const kind = thermal ? "thermal" : classify(`${title} ${item.eventType}`);
  return {
    id: `record:${item.sourceDataset}:${item.id}`,
    provider: item.sourceDataset,
    sourceName: item.source,
    url: safeUrl(item.sourceUrl),
    title: title.slice(0, 500),
    text: null,
    kind: kind === "other" && structured ? "incident" : kind,
    nature: media ? "press" : thermal ? "sensor" : structured ? "structured" : "report",
    occurredAt: media ? null : date(item.eventDate),
    publishedAt: null,
    detectedAt: media ? date(item.eventDate) : null,
    receivedAt,
    position: validPosition(item.latitude, item.longitude, media ? "unknown" : item.geoPrecision ?? "unknown"),
    place: item.locality || null,
    countries: item.country ? [item.country] : [],
    entities: item.actors ?? [],
    upstreamAgency: agencyIn(`${item.source} ${title}`),
    confirmsOccurrence: false,
    severity: null,
    metric: null,
    caveat: media
      ? "Mention presse GDELT ; date de détection, lieu mentionné, événement non confirmé."
      : thermal
        ? "Détection thermique ; aucune attribution à un conflit."
        : structured
          ? "Incident codé par la source ; publication différée."
          : "Import opérateur ; provenance indépendante non établie.",
  };
}

export const fromEvent = fromConflict;
