/**
 * International place name gazetteer and transliteration normalizer.
 * Maps multilingual representations and case inflections of cities
 * to neutral canonical identifiers without arbitrary geopolitical remapping.
 */

import { cleanUnicode } from "../language/unicode";

export interface PlaceEntry {
  id: string; // e.g. "kyiv"
  primaryName: string; // e.g. "Kyiv"
  patterns: RegExp[];
}

function compilePattern(patternStr: string): RegExp {
  const converted = patternStr
    .replace(/(^|[(|])\\b/g, "$1(?<![\\p{L}\\p{N}])")
    .replace(/\\b([)|]|$)/g, "(?![\\p{L}\\p{N}])$1");
  return new RegExp(converted, "iu");
}

export const CANONICAL_PLACES: PlaceEntry[] = [
  // 1. Kyiv / Kiev
  {
    id: "kyiv",
    primaryName: "Kyiv",
    patterns: [
      compilePattern("\\b(kyiv|kiev|kiew)\\b"),
      compilePattern("\\b(київ|києв[іеау]|киев[еау]?)\\b"),
      /(كييف|کی‌یف|کیف)/i,
      /(קייב)/i,
      /(基辅)/,
      /(キエフ|キーウ)/,
      /(키이우|키예프)/,
    ],
  },

  // 2. Odesa / Odessa
  {
    id: "odesa",
    primaryName: "Odesa",
    patterns: [
      compilePattern("\\b(odesa|odessa)\\b"),
      compilePattern("\\b(одес[аіеу]|одесс[аеуі])\\b"),
      /(أوديسا|اوديسا|اودسا)/i,
      /(אודסה)/i,
      /(敖德萨)/,
      /(オデッサ)/,
      /(오데사)/,
    ],
  },

  // 3. Moscow / Moskva
  {
    id: "moscow",
    primaryName: "Moscow",
    patterns: [
      compilePattern("\\b(moscow|moskva|moscou|moskau|mosca)\\b"),
      compilePattern("\\b(москв[аеіу]|москвой)\\b"),
      /(موسكو|مسکو)/i,
      /(מוסקבה)/i,
      /(莫斯科)/,
      /(モスクワ)/,
      /(모스크바)/,
    ],
  },

  // 4. Tehran / Teheran
  {
    id: "tehran",
    primaryName: "Tehran",
    patterns: [
      compilePattern("\\b(tehran|teheran|tahran)\\b"),
      compilePattern("\\b(тегеран[еау]?|тегерані)\\b"),
      /(تهران|طهران)/i,
      /(טהראן|טהרן)/i,
      /(德黑兰)/,
      /(テヘラン)/,
      /(테헤란)/,
    ],
  },

  // 5. Beijing / Pékin / Peking
  {
    id: "beijing",
    primaryName: "Beijing",
    patterns: [
      compilePattern("\\b(beijing|pekin|peking|pequim|pechino)\\b"),
      compilePattern("\\b(пекин[еау]?|пекіні)\\b"),
      /(بكين|پکن)/i,
      /(בייג'ינג|בייג'ין)/i,
      /(北京)/,
      /(ペキン|ベイジン)/,
      /(베이징|북경)/,
    ],
  },

  // 6. Kharkiv / Kharkov
  {
    id: "kharkiv",
    primaryName: "Kharkiv",
    patterns: [
      compilePattern("\\b(kharkiv|kharkov)\\b"),
      compilePattern("\\b(харків[іау]?|харьков[еау]?)\\b"),
      /(خاركيف|خاركوف)/i,
      /(חרקוב)/i,
      /(哈尔科夫)/,
      /(ハリコフ)/,
    ],
  },

  // 7. Zaporizhzhia / Zaporozhye
  {
    id: "zaporizhzhia",
    primaryName: "Zaporizhzhia",
    patterns: [
      compilePattern("\\b(zaporizhzhia|zaporizhia|zaporozhye|zaporozhe)\\b"),
      compilePattern("\\b(запоріжж[яіе]|запорожь[ея]|запорожье)\\b"),
      /(زابوريجيا)/i,
      /(זפורוז'יה)/i,
      /(扎波罗热)/,
    ],
  },

  // 8. Sevastopol
  {
    id: "sevastopol",
    primaryName: "Sevastopol",
    patterns: [
      compilePattern("\\b(sevastopol|sebastopol)\\b"),
      compilePattern("\\b(севастопол[ьяеі])\\b"),
      /(سيفاستوبول)/i,
      /(סבסטופול)/i,
      /(塞瓦斯托波尔)/,
    ],
  },

  // 9. Damascus / Damas
  {
    id: "damascus",
    primaryName: "Damascus",
    patterns: [
      compilePattern("\\b(damascus|damas|damaskus|damasco)\\b"),
      compilePattern("\\b(дамаск[еау]?)\\b"),
      /(دمشق)/i,
      /(דמשק)/i,
      /(大马士革)/,
      /(ダマスカス)/,
    ],
  },

  // 10. Beirut / Beyrouth
  {
    id: "beirut",
    primaryName: "Beirut",
    patterns: [
      compilePattern("\\b(beirut|beyrouth|beirute)\\b"),
      compilePattern("\\b(бейрут[еау]?)\\b"),
      /(بيروت)/i,
      /(ביירות)/i,
      /(贝鲁特)/,
      /(ベイルート)/,
    ],
  },

  // 11. Gaza
  {
    id: "gaza",
    primaryName: "Gaza",
    patterns: [
      compilePattern("\\b(gaza)\\b"),
      compilePattern("\\b(газ[аеуы])\\b"),
      /(غزة)/i,
      /(עזה)/i,
      /(加沙)/,
      /(ガザ)/,
    ],
  },

  // 12. Tel Aviv
  {
    id: "tel_aviv",
    primaryName: "Tel Aviv",
    patterns: [
      compilePattern("\\b(tel\\s+aviv|tel-aviv)\\b"),
      compilePattern("\\b(тель-авив[еау]?)\\b"),
      /(تل\s+ابيب)/i,
      /(תל\s+אביב)/i,
      /(特拉维夫)/,
      /(テルアビブ)/,
    ],
  },

  // 13. Jerusalem
  {
    id: "jerusalem",
    primaryName: "Jerusalem",
    patterns: [
      compilePattern("\\b(jerusalem|jerusalen|gerusalemme)\\b"),
      compilePattern("\\b(иерусалим[еау]?)\\b"),
      /(القدس|اورشليم)/i,
      /(ירושלים)/i,
      /(耶路撒冷)/,
      /(エルサレム)/,
    ],
  },

  // 14. Baghdad
  {
    id: "baghdad",
    primaryName: "Baghdad",
    patterns: [
      compilePattern("\\b(baghdad|bagdad)\\b"),
      compilePattern("\\b(багдад[еау]?)\\b"),
      /(بغداد)/i,
      /(בגדאד)/i,
      /(巴格达)/,
      /(バグダッド)/,
    ],
  },

  // 15. Taipei
  {
    id: "taipei",
    primaryName: "Taipei",
    patterns: [
      compilePattern("\\b(taipei|taipeh)\\b"),
      compilePattern("\\b(тайбэ[еяй])\\b"),
      /(تايبيه)/i,
      /(טאיפיי)/i,
      /(台北|臺北)/,
      /(台北)/,
    ],
  },

  // 16. Tokyo
  {
    id: "tokyo",
    primaryName: "Tokyo",
    patterns: [
      compilePattern("\\b(tokyo|tokio)\\b"),
      compilePattern("\\b(токио)\\b"),
      /(طوكيو)/i,
      /(טוקיו)/i,
      /(东京|東京)/,
      /(도쿄)/,
    ],
  },

  // 17. Seoul
  {
    id: "seoul",
    primaryName: "Seoul",
    patterns: [
      compilePattern("\\b(seoul|seul)\\b"),
      compilePattern("\\b(сеул[еау]?)\\b"),
      /(سيول|سول)/i,
      /(סיאול)/i,
      /(首尔|汉城)/,
      /(ソウル)/,
      /(서울)/,
    ],
  },
];

/**
 * Normalizes a place string to a canonical key (e.g. "odesa", "kyiv").
 */
export function canonicalPlaceKey(place: string | null): string | null {
  if (!place) return null;
  const cleaned = cleanUnicode(place);
  if (!cleaned) return null;

  for (const entry of CANONICAL_PLACES) {
    for (const pat of entry.patterns) {
      if (pat.test(cleaned)) {
        return entry.id;
      }
    }
  }

  return null;
}

export const canonicalPlaceId = canonicalPlaceKey;

/**
 * Extracts canonical place identifiers found inside text.
 */
export function extractPlaces(text: string): string[] {
  const cleaned = cleanUnicode(text);
  if (!cleaned) return [];

  const found: string[] = [];
  for (const entry of CANONICAL_PLACES) {
    for (const pat of entry.patterns) {
      if (pat.test(cleaned)) {
        found.push(entry.id);
        break;
      }
    }
  }
  return found;
}
