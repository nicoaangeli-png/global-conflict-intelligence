import { createHash } from "node:crypto";
import { cleanUnicode } from "../language/unicode";

export interface EmbeddingMetrics {
  calls: number;
  cacheHits: number;
  estimatedCostUsd: number;
  activeProvider: string;
}

// Global metrics tracker for explainability & observability
const METRICS: EmbeddingMetrics = {
  calls: 0,
  cacheHits: 0,
  estimatedCostUsd: 0,
  activeProvider: process.env.ORBITAL_EMBEDDING_PROVIDER || "local_deterministic",
};

// In-memory LRU cache: hash -> vector
const MAX_CACHE_SIZE = 5000;
const EMBEDDING_CACHE = new Map<string, number[]>();

function hashText(text: string): string {
  return createHash("sha256").update(text).digest("hex").slice(0, 32);
}

/**
 * Deterministic local vectorizer: generates a 128-dimensional unit vector
 * from character trigrams and token features. 100% offline, zero-latency, zero-cost.
 */
export function localDeterministicVector(text: string, dimensions = 128): number[] {
  const cleaned = cleanUnicode(text);
  const vector = new Array(dimensions).fill(0);
  if (!cleaned) return vector;

  // Character trigrams
  for (let i = 0; i < cleaned.length - 2; i++) {
    const trigram = cleaned.slice(i, i + 3);
    let hash = 0;
    for (let c = 0; c < trigram.length; c++) {
      hash = (hash << 5) - hash + trigram.charCodeAt(c);
      hash |= 0;
    }
    const idx = Math.abs(hash) % dimensions;
    vector[idx] += 1;
  }

  // Normalize to unit length
  const norm = Math.sqrt(vector.reduce((sum, val) => sum + val * val, 0));
  if (norm > 0) {
    for (let i = 0; i < dimensions; i++) {
      vector[i] /= norm;
    }
  }

  return vector;
}

/**
 * Cosine similarity between two unit vectors.
 */
export function cosineSimilarity(vecA: number[], vecB: number[]): number {
  if (vecA.length !== vecB.length || vecA.length === 0) return 0;
  let dotProduct = 0;
  for (let i = 0; i < vecA.length; i++) {
    dotProduct += vecA[i] * vecB[i];
  }
  return Math.max(0, Math.min(1, dotProduct));
}

/**
 * Retrieves or computes embedding vector for a given text.
 */
export function getEmbeddingVector(text: string): number[] {
  const key = hashText(cleanUnicode(text));
  const cached = EMBEDDING_CACHE.get(key);
  if (cached) {
    METRICS.cacheHits++;
    return cached;
  }

  METRICS.calls++;

  // Default provider: deterministic local vector
  const vector = localDeterministicVector(text);

  // Evict oldest if cache exceeded
  if (EMBEDDING_CACHE.size >= MAX_CACHE_SIZE) {
    const firstKey = EMBEDDING_CACHE.keys().next().value;
    if (firstKey) EMBEDDING_CACHE.delete(firstKey);
  }

  EMBEDDING_CACHE.set(key, vector);
  return vector;
}

/**
 * Evaluates semantic similarity for ambiguous candidate pairs.
 */
export function semanticSimilarity(textA: string, textB: string): number {
  const vecA = getEmbeddingVector(textA);
  const vecB = getEmbeddingVector(textB);
  return cosineSimilarity(vecA, vecB);
}

/**
 * Returns diagnostic metrics for the embedding subsystem.
 */
export function getEmbeddingMetrics(): EmbeddingMetrics {
  return { ...METRICS };
}

/**
 * Resets cache and metrics (useful in test suites).
 */
export function resetEmbeddingCache(): void {
  EMBEDDING_CACHE.clear();
  METRICS.calls = 0;
  METRICS.cacheHits = 0;
  METRICS.estimatedCostUsd = 0;
}
