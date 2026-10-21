/**
 * Multi-script intelligent tokenizer.
 * Handles space-delimited alphabets (Latin, Cyrillic, Arabic, Hebrew, Hangul)
 * and unsegmented CJK scripts (Chinese, Japanese) via n-grams + dictionary matching.
 */

import { cleanUnicode } from "./unicode";
import { isCjkChar } from "./scripts";
import { isStopWord } from "./stopwords";
import { stemWord } from "./stemmer";

/**
 * Generates character 2-grams (bigrams) from a continuous sequence of CJK characters.
 */
export function cjkBigrams(text: string): string[] {
  const chars = Array.from(text);
  if (chars.length <= 1) return chars;
  const bigrams: string[] = [];
  for (let i = 0; i < chars.length - 1; i++) {
    bigrams.push(chars[i] + chars[i + 1]);
  }
  return bigrams;
}

/**
 * Tokenizes cleaned multilingual text into a normalized list of tokens.
 */
export function tokenizeText(text: string): string[] {
  if (!text) return [];
  const cleaned = cleanUnicode(text);
  if (!cleaned) return [];

  const rawTokens: string[] = [];

  // Match sequences of letters/numbers or CJK clusters
  const matches = cleaned.match(/[\p{L}\p{N}]+/gu) ?? [];

  for (const match of matches) {
    // Check if the match is CJK
    const hasCjk = Array.from(match).some(isCjkChar);

    if (hasCjk) {
      // Split into CJK runs vs non-CJK runs if mixed
      let currentRun = "";
      let inCjk = false;

      for (const char of Array.from(match)) {
        const charIsCjk = isCjkChar(char);
        if (charIsCjk === inCjk) {
          currentRun += char;
        } else {
          if (currentRun) {
            if (inCjk) {
              rawTokens.push(...cjkBigrams(currentRun));
              if (currentRun.length <= 4) rawTokens.push(currentRun);
            } else {
              rawTokens.push(currentRun);
            }
          }
          currentRun = char;
          inCjk = charIsCjk;
        }
      }
      if (currentRun) {
        if (inCjk) {
          rawTokens.push(...cjkBigrams(currentRun));
          if (currentRun.length <= 4) rawTokens.push(currentRun);
        } else {
          rawTokens.push(currentRun);
        }
      }
    } else {
      rawTokens.push(match);
    }
  }

  // Filter stop words and stem words
  const result: string[] = [];
  for (const raw of rawTokens) {
    if (isStopWord(raw)) continue;
    const stemmed = stemWord(raw);
    if (isStopWord(stemmed)) continue;
    if (stemmed.length >= 2 || isCjkChar(stemmed)) {
      result.push(stemmed);
    }
  }

  return result;
}
