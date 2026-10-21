/**
 * Script detection and multi-alphabet handling.
 * Supports detection of Latin, Cyrillic, Arabic, Hebrew, Han (Chinese),
 * Hiragana/Katakana (Japanese), and Hangul (Korean).
 */

export type ScriptName =
  | "latin"
  | "cyrillic"
  | "arabic"
  | "hebrew"
  | "han"
  | "kana"
  | "hangul"
  | "other";

const SCRIPT_RANGES: { name: ScriptName; re: RegExp }[] = [
  { name: "latin", re: /\p{Script=Latin}/u },
  { name: "cyrillic", re: /\p{Script=Cyrillic}/u },
  { name: "arabic", re: /\p{Script=Arabic}/u },
  { name: "hebrew", re: /\p{Script=Hebrew}/u },
  { name: "han", re: /\p{Script=Han}/u },
  { name: "kana", re: /[\p{Script=Hiragana}\p{Script=Katakana}]/u },
  { name: "hangul", re: /\p{Script=Hangul}/u },
];

/**
 * Returns all distinct writing scripts present in the text.
 */
export function detectScripts(text: string): ScriptName[] {
  const detected: ScriptName[] = [];
  for (const { name, re } of SCRIPT_RANGES) {
    if (re.test(text)) {
      detected.push(name);
    }
  }
  return detected.length > 0 ? detected : ["other"];
}

/**
 * Checks whether text contains multiple distinct alphabets / scripts.
 * Useful for OSINT signals that embed English tags in Cyrillic/Arabic/Chinese titles.
 */
export function isMultiScript(text: string): boolean {
  return detectScripts(text).length > 1;
}

/**
 * Checks if a character is part of CJK (Chinese, Japanese Kanji, Kana).
 */
export function isCjkChar(char: string): boolean {
  return /[\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}]/u.test(char);
}
