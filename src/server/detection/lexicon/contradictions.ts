/**
 * Multilingual contradiction detection for event evidence.
 * Flags disagreements between weapons/strikes vs industrial accidents,
 * and detects official denials or retractions across 15 languages.
 */

import { cleanUnicode } from "../language/unicode";

function compilePattern(patternStr: string): RegExp {
  const converted = patternStr
    .replace(/(^|[(|])\\b/g, "$1(?<![\\p{L}\\p{N}])")
    .replace(/\\b([)|]|$)/g, "(?![\\p{L}\\p{N}])$1");
  return new RegExp(converted, "iu");
}

const WEAPON_REGEX = compilePattern(
  [
    "\\b(missiles?|rockets?|airstrikes?|bombings?|shelling|drone\\s+strikes?)\\b",
    "\\b(missiles?|frappes?(?:\\s+aeriennes?)?|bombardements?|roquettes?)\\b",
    "\\b(misil(?:es)?|bombardeos?|ataques?\\s+aereos?|cohetes?)\\b",
    "\\b(raketen?|luftangriffe?|beschuss|bombardements?)\\b",
    "\\b(missili?|raid\\s+aerei?|bombardamenti?|razzi?)\\b",
    "\\b(ракет(?:а|ы|ный|ные)|обстрел(?:ы|ов)?|авиаудар(?:ы|ов)?|бомбардировк[аи])\\b",
    "\\b(ракет(?:а|и|ний|ні)|обстріл(?:и|ів)?|авіаудар(?:и|ів)?|бомбардуванн[яі])\\b",
    "(صاروخ|صواريخ|قصف|غارة\\s+جوية|ضربة\\s+جوية)",
    "(موشک|موشکها|حمله\\s+هوایی)",
    "\\b(fuze(?:ler)?|hava\\s+saldirisi|bombardiman|roket)\\b",
    "(טיל|טילים|הפצצה|תקיפה\\s+אווירית|הפגזה)",
    "(导弹|轰炸|空袭|炮击)",
    "(ミサイル|空爆|砲撃)",
    "(미사일|공습|포격)",
  ].join("|")
);

const INDUSTRIAL_REGEX = compilePattern(
  [
    "\\b(industrial|factory|plant|refinery|gas\\s+leak|gas\\s+pipeline)\\b",
    "\\b(industriel(?:le)?|usine|raffinerie|fuite\\s+de\\s+gaz|gazoduc)\\b",
    "\\b(industrial|fabrica|refineria|fuga\\s+de\\s+gas|gasoducto)\\b",
    "\\b(industrieunfall|fabrik|gasleck|raffinerie)\\b",
    "\\b(industriale|fabbrica|raffineria|fuga\\s+di\\s+gas)\\b",
    "\\b(промышленн(?:ый|ая)|завод(?:е|а)?|утечк[аи]\\s+газа|газопровод(?:е)?)\\b",
    "\\b(промислов(?:ий|а)|завод(?:і|у)?|витік\\s+газу|газопровід(?:і)?)\\b",
    "(صناعي|مصنع|تسرب\\s+غاز|خط\\s+انابيب\\s+الغاز)",
    "(صنعتی|کارخانه|نشت\\s+گاز)",
    "\\b(sanayi|fabrika|gaz\\s+kacagi)\\b",
    "(תעשייתי|מפעל|דליפת\\s+גז)",
    "(工业|化工厂|工厂|瓦斯泄漏|天然气管道)",
    "(工場|ガス漏れ|産業事故)",
    "(공장|산업단지|가스\\s*누출)",
  ].join("|")
);

const DENIAL_REGEX = compilePattern(
  [
    "\\b(denies|denied|denial|false\\s+report|false\\s+alarm|no\\s+explosion|fake\\s+news)\\b",
    "\\b(dement|dementi|fausse\\s+alerte|pas\\s+d'explosion|faux\\s+rapport)\\b",
    "\\b(desmiente|desmentido|falsa\\s+alarma|no\\s+hubo\\s+explosion)\\b",
    "\\b(desmente|desmentido|falso\\s+alarme|sem\\s+explosao)\\b",
    "\\b(dementiert|dementi|fehlalarm|keine\\s+explosion)\\b",
    "\\b(smentisce|smentita|falso\\s+allarme|nessuna\\s+esplosione)\\b",
    "\\b(опровергает|опровержение|фейк|нет\\s+взрыва|ложная\\s+тревога)\\b",
    "\\b(спростовує|спростування|фейк|немає\\s+вибуху|хибна\\s+тривога)\\b",
    "(ينفي|تنفي|نفي|تقرير\\s+كاذب|انكار|لا\\s+صحة|لا\\s+انفجار)",
    "(تکذیب|رد\\s+کرد|گزارش\\s+دروغ)",
    "\\b(yalanladi|yalanlama|asilsiz|patlama\\s+yok|yanlis\\s+alarm)\\b",
    "(מכחיש|הכחשה|דיווח\\s+כוזב|אזעקת\\s+שווא|אין\\s+פיצוץ)",
    "(否认|辟谣|假消息|误报|未发生爆炸)",
    "(否定|誤報|デマ|爆発なし)",
    "(부인|오보|거짓\\s*뉴스|폭발\\s*없음)",
  ].join("|")
);

/**
 * Evaluates whether evidence texts contain contradictory statements.
 */
export function detectContradictions(texts: string[]): string[] {
  const cleanedTexts = texts.map(cleanUnicode);

  const hasWeapon = cleanedTexts.some((t) => WEAPON_REGEX.test(t));
  const hasIndustrial = cleanedTexts.some((t) => INDUSTRIAL_REGEX.test(t));
  const hasDenial = cleanedTexts.some((t) => DENIAL_REGEX.test(t));

  const result: string[] = [];
  if (hasWeapon && hasIndustrial) {
    result.push("Nature exacte incertaine : les descriptions mentionnent une arme et une origine industrielle.");
  }
  if (hasDenial) {
    result.push("Un démenti ou une négation figure dans les preuves ; clarification nécessaire.");
  }

  return result;
}
