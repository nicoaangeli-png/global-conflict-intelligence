/**
 * Multilingual stop words and journalistic noise tokens for 15 priority languages:
 * en, fr, es, pt, de, it, ru, uk, ar, fa, tr, he, zh, ja, ko.
 */

// Journalistic fluff, wire boilerplate and clickbait prefixes
const JOURNALISTIC_NOISE = [
  // French / English
  "breaking", "urgent", "alerte", "flash", "live", "update", "updates", "just",
  "developing", "exclusive", "reported", "reports", "witnesses", "witness", "sources",
  "source", "official", "officials", "according", "news", "story", "feed", "wire",
  "d'apres", "selon", "pres", "signale", "signalee", "signalent", "entendu",
  "entendue", "plusieurs", "centre", "center", "central", "bruit", "quartier",
  // Russian / Ukrainian
  "срочно", "молния", "внимание", "сообщают", "сообщает", "очевидцы", "источники",
  "данным", "новость", "сводка", "терміново", "увага", "повідомляють", "повідомляє",
  "джерела", "очевидці",
  // Arabic / Persian
  "عاجل", "مباشر", "انباء", "شهود", "مصادر", "وفقا", "خبر", "فوری", "گزارش",
  // Turkish
  "son", "dakika", "sicak", "gelisme", "iddia", "haber",
  // Hebrew
  "מבזק", "ראשוני", "דיווח", "עדי", "ראייה", "מקורות",
  // CJK
  "突发", "快讯", "速报", "报道", "据报道", "消息", "现场", "速報", "速報", "속보", "전언",
];

// Core function words, prepositions, articles and auxiliary verbs by language
const LANGUAGE_STOP_WORDS: string[] = [
  // English
  "a", "an", "the", "and", "or", "in", "on", "at", "to", "for", "from", "by", "with",
  "about", "after", "before", "is", "are", "was", "were", "been", "has", "have", "had",
  "near", "over", "into", "it", "its", "of", "that", "this",

  // French
  "le", "la", "les", "un", "une", "des", "du", "de", "d", "en", "dans", "par", "pour",
  "avec", "sur", "sous", "et", "ou", "a", "au", "aux", "est", "sont", "ete", "qui",
  "que", "ce", "cette", "ces", "il", "ils", "elle", "elles",

  // Spanish
  "el", "la", "los", "las", "un", "una", "unos", "unas", "de", "del", "en", "por",
  "para", "con", "y", "o", "a", "al", "es", "son", "fue", "fueron", "ha", "han",
  "este", "esta", "que", "se", "su", "sus", "sobre", "cerca",

  // Portuguese
  "o", "a", "os", "as", "um", "uma", "uns", "umas", "de", "do", "da", "dos", "das",
  "em", "no", "na", "nos", "nas", "por", "para", "com", "e", "ou", "foi", "foram",
  "tem", "sao", "sobre", "perto",

  // German
  "der", "die", "das", "den", "dem", "des", "ein", "eine", "einer", "eines", "einem",
  "einen", "und", "oder", "in", "im", "an", "am", "auf", "mit", "von", "vom", "zu",
  "zum", "zur", "nach", "bei", "beim", "ist", "sind", "war", "wurden", "hat", "haben",
  "über", "nahe",

  // Italian
  "il", "lo", "la", "i", "gli", "le", "l", "un", "uno", "una", "di", "del", "della",
  "dei", "degli", "delle", "in", "nel", "nella", "nei", "negli", "nelle", "su", "sul",
  "con", "per", "tra", "fra", "e", "o", "ed", "ha", "hanno", "e", "sono", "stato",
  "stati", "vicino",

  // Russian
  "и", "в", "во", "на", "с", "со", "по", "к", "ко", "у", "о", "об", "за", "из", "от",
  "до", "для", "не", "что", "он", "она", "оно", "они", "это", "как", "так", "был",
  "была", "были", "будет", "районе", "около", "возле",

  // Ukrainian
  "і", "й", "та", "в", "у", "на", "з", "із", "зі", "по", "до", "від", "для", "про",
  "за", "не", "що", "це", "він", "вона", "вони", "був", "була", "були", "буде",
  "районі", "біля", "поблизу",

  // Arabic
  "في", "من", "على", "الى", "إلى", "عن", "مع", "هذا", "هذه", "ذلك", "تلك", "تم", "كان",
  "كانت", "ان", "أن", "قد", "ما", "هو", "هي", "قرب", "نحو",

  // Persian
  "در", "به", "از", "با", "بر", "که", "این", "آن", "شد", "است", "بود", "برای", "نزدیک",

  // Turkish
  "bir", "ve", "veya", "ile", "de", "da", "den", "dan", "bu", "şu", "o", "icin",
  "için", "olan", "olarak", "var", "yok", "yakin", "yakınlarında",

  // Hebrew
  "על", "את", "של", "אל", "עם", "כל", "זה", "זאת", "היה", "היתה", "היו", "ליד", "בתוך",

  // Chinese & Japanese common particles
  "的", "了", "在", "和", "与", "及", "等", "之", "为", "已", "并",
  "の", "に", "は", "を", "た", "が", "で", "て", "と", "し", "れ", "さ",

  // Korean common particles
  "이", "가", "을", "를", "에", "에서", "와", "과", "의", "로", "으로",
];

export const STOP_WORDS = new Set<string>([
  ...JOURNALISTIC_NOISE.map((w) => w.toLowerCase()),
  ...LANGUAGE_STOP_WORDS.map((w) => w.toLowerCase()),
]);

export function isStopWord(word: string): boolean {
  return STOP_WORDS.has(word);
}
