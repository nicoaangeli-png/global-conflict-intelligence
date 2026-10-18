"use client";

import { useCallback, useEffect, useRef, useState } from "react";

/**
 * Voix d'AURA : synthèse vocale du navigateur (Web Speech API).
 *
 * Choisit une voix féminine française douce si disponible, lit le texte
 * phrase par phrase (évite la coupure des longues lectures sous Chrome) et
 * expose un niveau 0..1 qui anime la bouche de l'hologramme.
 */

const FEMALE_HINTS = /vivienne|denise|eloise|brigitte|audrey|aurélie|aurelie|amélie|amelie|marie|céline|celine|julie|hortense|virginie|chantal|sylvie|léa|lea|google français|google francais|samantha|female|femme/i;
const MALE_HINTS = /thomas|jacques|daniel|nicolas|henri|paul|rémy|remy|claude|alain|antoine|jean|male\b|homme|grandpa|reed|rocko|eddy/i;
const STORAGE_KEY = "orbital.aura.voice.v1";

function rank(voice: SpeechSynthesisVoice, lang: string) {
  let score = 0;
  if (voice.lang.toLowerCase().startsWith(lang)) score += 100;
  if (voice.lang.toLowerCase() === `${lang}-fr` || voice.lang.toLowerCase() === "en-us") score += 10;
  if (FEMALE_HINTS.test(voice.name)) score += 40;
  if (MALE_HINTS.test(voice.name)) score -= 80;
  if (/premium|enhanced|améliorée|natural|neural|online/i.test(voice.name)) score += 25;
  return score;
}

/**
 * Texte prononçable : la voix ne lit jamais le markdown, les marqueurs de
 * citation [n], les URL ni les noms de domaine.
 */
export function speakable(text: string) {
  return text
    .replace(/```[\s\S]*?```/g, " ")
    .replace(/\(\s*\[[^\]]*\]\([^)]*\)\s*\)/g, "")
    .replace(/!?\[([^\]]+)\]\([^)]*\)/g, "$1")
    .replace(/\[\s*\d+(?:\s*[,;–-]\s*\d+)*\s*\]/g, "")
    .replace(/\[\^?\d+\]/g, "")
    .replace(/<?https?:\/\/[^\s>)\]]+>?/g, "")
    .replace(/\bwww\.[^\s)\]]+/g, "")
    .replace(/^\s{0,3}(?:#{1,6}\s+|>\s?|[-*+•]\s+|\d+[.)]\s+)/gm, "")
    .replace(/(\*\*|__|~~|`)/g, "")
    .replace(/(^|\s)[*_](\S[^*_]*\S|\S)[*_](?=\s|[.,;:!?]|$)/g, "$1$2")
    .replace(/^\s*\|?[-:| ]{3,}\|?\s*$/gm, "")
    .replace(/\|/g, ", ")
    .replace(/[*_#>`~]+/g, "")
    .replace(/\(\s*\)/g, "")
    .replace(/\s+([.,])/g, "$1")
    .replace(/\s+/g, " ")
    .trim();
}

export function useAuraVoice(locale: "fr" | "en") {
  const [voices, setVoices] = useState<SpeechSynthesisVoice[]>([]);
  const [voiceName, setVoiceName] = useState<string | null>(null);
  const [enabled, setEnabled] = useState(true);
  const [speaking, setSpeaking] = useState(false);
  const levelRef = useRef(0);
  const queueRef = useRef(0);
  const supported = typeof window !== "undefined" && "speechSynthesis" in window;

  useEffect(() => {
    if (!supported) return;
    try { setVoiceName(localStorage.getItem(STORAGE_KEY)); } catch { /* stockage indisponible */ }
    const load = () => setVoices(window.speechSynthesis.getVoices());
    load();
    window.speechSynthesis.addEventListener("voiceschanged", load);
    return () => {
      window.speechSynthesis.removeEventListener("voiceschanged", load);
      window.speechSynthesis.cancel();
    };
  }, [supported]);

  const lang = locale === "en" ? "en" : "fr";
  const candidates = voices.filter((v) => v.lang.toLowerCase().startsWith(lang)).sort((a, b) => rank(b, lang) - rank(a, lang));
  const voice = candidates.find((v) => v.name === voiceName) ?? candidates[0] ?? null;

  const chooseVoice = useCallback((name: string) => {
    setVoiceName(name);
    try { localStorage.setItem(STORAGE_KEY, name); } catch { /* stockage indisponible */ }
  }, []);

  // Décroissance du niveau entre deux mots.
  useEffect(() => {
    if (!speaking) { levelRef.current = 0; return; }
    const id = window.setInterval(() => { levelRef.current = Math.max(0.35, levelRef.current * 0.86); }, 60);
    return () => window.clearInterval(id);
  }, [speaking]);

  const speak = useCallback((text: string) => {
    if (!supported || !enabled) return;
    const clean = speakable(text);
    if (!clean) return;
    const utterance = new SpeechSynthesisUtterance(clean);
    if (voice) utterance.voice = voice;
    utterance.lang = voice?.lang ?? (lang === "fr" ? "fr-FR" : "en-US");
    utterance.rate = 0.98;
    utterance.pitch = 1.06;
    utterance.volume = 1;
    utterance.onstart = () => { setSpeaking(true); levelRef.current = 0.8; };
    utterance.onboundary = () => { levelRef.current = 1; };
    const finish = () => {
      queueRef.current = Math.max(0, queueRef.current - 1);
      if (queueRef.current === 0) setSpeaking(false);
    };
    utterance.onend = finish;
    utterance.onerror = finish;
    queueRef.current += 1;
    window.speechSynthesis.speak(utterance);
  }, [enabled, lang, supported, voice]);

  const stop = useCallback(() => {
    if (!supported) return;
    queueRef.current = 0;
    window.speechSynthesis.cancel();
    setSpeaking(false);
  }, [supported]);

  const toggle = useCallback(() => {
    setEnabled((value) => {
      if (value && supported) { window.speechSynthesis.cancel(); queueRef.current = 0; setSpeaking(false); }
      return !value;
    });
  }, [supported]);

  return { supported, enabled, toggle, speaking, speak, stop, levelRef, voice, candidates, chooseVoice };
}
