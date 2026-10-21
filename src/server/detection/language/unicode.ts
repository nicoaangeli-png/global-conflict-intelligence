/**
 * Unicode cleaning and normalization for international text signals.
 * Preserves non-Latin scripts (Cyrillic, Arabic, Hebrew, CJK, etc.)
 * while stripping combining marks, zero-width characters, and normalizing Latin diacritics.
 */

// Arabic harakat/tashkeel and tatweel
const ARABIC_DIACRITICS_RE = /[\u064B-\u065F\u0670\u0640]/g;

// Hebrew niqqud and cantillation marks
const HEBREW_NIQQUD_RE = /[\u0591-\u05BD\u05BF\u05C1-\u05C2\u05C4-\u05C5\u05C7]/g;

// Zero-width characters and control markers
const ZERO_WIDTH_RE = /[\u200B-\u200D\uFEFF\u200E\u200F\u00AD]/g;

// Typographical punctuation normalization
const SMART_QUOTES_RE = /[“”«»„‟]/g;
const SMART_APOS_RE = /[‘’‚‛‹›′`]/g;
const DASHES_RE = /[—–―‐‑]/g;

/**
 * Normalizes text cleanly without destructive distortion of non-Latin scripts.
 */
export function cleanUnicode(text: string): string {
  if (!text) return "";

  // Step 1: NFKC canonical decomposition + compatibility composition
  let out = text.normalize("NFKC");

  // Step 2: Strip zero-width and invisible control characters
  out = out.replace(ZERO_WIDTH_RE, "");

  // Step 3: Typography unification
  out = out
    .replace(SMART_QUOTES_RE, '"')
    .replace(SMART_APOS_RE, "'")
    .replace(DASHES_RE, "-");

  // Step 4: Arabic normalization (strip tashkeel/tatweel, normalize alif variants)
  out = out
    .replace(ARABIC_DIACRITICS_RE, "")
    .replace(/[أإآٱ]/g, "ا")
    .replace(/ة\b/g, "ه")
    .replace(/ى\b/g, "ي");

  // Step 5: Hebrew normalization (strip niqqud)
  out = out.replace(HEBREW_NIQQUD_RE, "");

  // Step 6: Cyrillic standard Russian/Belarusian e/ё unification
  out = out.replace(/ё/g, "е").replace(/Ё/g, "Е");

  // Step 7: German eszett
  out = out.replace(/ß/g, "ss");

  // Step 8: Turkish dotless/dotted i safety for cross-locale lowercasing
  out = out.replace(/İ/g, "i").replace(/ı/g, "i");

  // Step 9: Lowercase
  out = out.toLowerCase();

  // Step 10: Fold Latin diacritics ONLY on Latin characters (leaving non-Latin intact)
  out = out.replace(/[\p{Script=Latin}\u0300-\u036f]+/gu, (segment) =>
    segment.normalize("NFD").replace(/[\u0300-\u036f]/g, "")
  );

  return out.replace(/\s+/g, " ").trim();
}
