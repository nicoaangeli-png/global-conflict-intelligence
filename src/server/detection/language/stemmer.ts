/**
 * Lightweight deterministic stemmer for the most common grammatical variations
 * across Latin, Cyrillic, Arabic, Hebrew, and Turkish headline text.
 */

// Suffix rules for Latin languages (English, French, Spanish, Portuguese, German, Italian)
export function stemLatin(word: string): string {
  if (word.length <= 3) return word;

  // Spanish / Portuguese plurals like explosiones -> explosion
  if (word.endsWith("iones")) return word.slice(0, -2);
  if (word.endsWith("idades") || word.endsWith("idados")) return word.slice(0, -2);

  // French past participles & plurals
  if (word.endsWith("ees") || word.endsWith("ies")) return word.slice(0, -2);
  if (word.endsWith("eurs") || word.endsWith("euses")) return word.slice(0, -3);

  // German plurals
  if (word.endsWith("ungen")) return word.slice(0, -2);
  if (word.endsWith("innen")) return word.slice(0, -3);

  // English -ing, -ed, -es, -s
  if (word.endsWith("ing") && word.length > 5) return word.slice(0, -3);
  if (word.endsWith("es") && word.length > 4) return word.slice(0, -2);
  if (word.endsWith("s") && !word.endsWith("ss") && word.length > 3) return word.slice(0, -1);

  return word;
}

// Common Slavic case endings for nouns (nominative, prepositional, locative, genitive, plural)
export function stemCyrillic(word: string): string {
  if (word.length <= 3) return word;

  // Plurals: -ы, -и, -ов, -ев, -ів
  if (word.endsWith("ами") || word.endsWith("ями") || word.endsWith("ах") || word.endsWith("ях")) {
    return word.slice(0, -2);
  }
  if (word.endsWith("ів") || word.endsWith("ов") || word.endsWith("ев")) {
    return word.slice(0, -2);
  }
  // Case endings: -е, -і, -у, -ю, -ом, -ем, -ам, -ям
  if (word.endsWith("ом") || word.endsWith("ем") || word.endsWith("ам") || word.endsWith("ям")) {
    return word.slice(0, -2);
  }
  if (word.endsWith("е") || word.endsWith("і") || word.endsWith("и") || word.endsWith("ы") || word.endsWith("у") || word.endsWith("ю") || word.endsWith("а") || word.endsWith("я")) {
    return word.slice(0, -1);
  }

  return word;
}

// Arabic prefix detachment (al-, wa-, bi-, li-) and simple plural suffixes (-at, -un, -in)
export function stemArabic(word: string): string {
  if (word.length <= 3) return word;

  let out = word;
  // Detach leading conjunction wa- (و) if word remains long enough
  if (out.startsWith("و") && out.length > 4) {
    out = out.slice(1);
  }
  // Detach definite article al- (ال)
  if (out.startsWith("ال") && out.length > 4) {
    out = out.slice(2);
  }
  // Detach prepositions bi- (ب), li- (ل)
  else if ((out.startsWith("ب") || out.startsWith("ل")) && out.length > 4) {
    out = out.slice(1);
  }

  // Strip regular plural suffixes -at (ات), -in (ين), -un (ون)
  if (out.endsWith("ات") && out.length > 4) out = out.slice(0, -2);
  else if (out.endsWith("ين") && out.length > 4) out = out.slice(0, -2);
  else if (out.endsWith("ون") && out.length > 4) out = out.slice(0, -2);

  return out;
}

// Hebrew prefix detachment (ha-, be-, le-, me-, ve-)
export function stemHebrew(word: string): string {
  if (word.length <= 3) return word;

  let out = word;
  // Definite article ha- (ה), conjunction ve- (ו), prepositions be- (ב), le- (ל), me- (מ)
  if (/^[הובלמ]/.test(out) && out.length > 4) {
    out = out.slice(1);
  }
  // Plural suffixes -im (ים), -ot (ות)
  if (out.endsWith("ים") && out.length > 4) out = out.slice(0, -2);
  else if (out.endsWith("ות") && out.length > 4) out = out.slice(0, -2);

  return out;
}

// Turkish suffix stripping (-ler, -lar, -de, -da, -te, -ta)
export function stemTurkish(word: string): string {
  if (word.length <= 3) return word;

  let out = word;
  // Apostrophe separation for proper nouns: Odessa'da -> odessa
  const apostropheIdx = out.indexOf("'");
  if (apostropheIdx > 2) {
    out = out.slice(0, apostropheIdx);
  }

  if (out.endsWith("lerde") || out.endsWith("larda") || out.endsWith("lerda") || out.endsWith("larde")) {
    out = out.slice(0, -5);
  } else if (out.endsWith("ler") || out.endsWith("lar")) {
    out = out.slice(0, -3);
  } else if (out.endsWith("de") || out.endsWith("da") || out.endsWith("te") || out.endsWith("ta")) {
    if (out.length > 4) out = out.slice(0, -2);
  }

  return out;
}

/**
 * Dispatches word to appropriate lightweight stemmer based on script.
 */
export function stemWord(word: string): string {
  if (!word || word.length <= 2) return word;

  if (/^[\p{Script=Latin}]+$/u.test(word)) return stemLatin(word);
  if (/^[\p{Script=Cyrillic}]+$/u.test(word)) return stemCyrillic(word);
  if (/^[\p{Script=Arabic}]+$/u.test(word)) return stemArabic(word);
  if (/^[\p{Script=Hebrew}]+$/u.test(word)) return stemHebrew(word);
  // Turkish may be detected as Latin, handled via stemLatin + apostrophe rule
  return word;
}
