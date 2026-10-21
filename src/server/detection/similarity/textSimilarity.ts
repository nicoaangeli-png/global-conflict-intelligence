/**
 * Text and concept similarity metrics.
 * Computes Jaccard overlap over combined content words, canonical places,
 * and semantic concept tokens.
 */

/**
 * Standard Jaccard index between two sets of tokens.
 */
export function jaccardSimilarity(first: Set<string>, second: Set<string>): number {
  if (!first.size || !second.size) return 0;
  let common = 0;
  for (const token of first) {
    if (second.has(token)) common++;
  }
  return common / (first.size + second.size - common);
}

/**
 * Overlap coefficient relative to the smaller set:
 * |A ∩ B| / min(|A|, |B|)
 */
export function minOverlapCoefficient(first: Set<string>, second: Set<string>): number {
  const minSize = Math.min(first.size, second.size);
  if (minSize === 0) return 0;
  let common = 0;
  for (const token of first) {
    if (second.has(token)) common++;
  }
  return common / minSize;
}

/**
 * Returns shared tokens that represent concrete concepts or places,
 * excluding generic words.
 */
export function sharedDescriptiveTokens(first: Set<string>, second: Set<string>): string[] {
  const shared: string[] = [];
  for (const token of first) {
    if (second.has(token)) {
      shared.push(token);
    }
  }
  return shared;
}
