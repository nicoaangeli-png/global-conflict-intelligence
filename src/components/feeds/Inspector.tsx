"use client";

import { useIntelStore } from "@/store/useIntelStore";
import { ClusterDetail } from "./ClusterDetail";
import { CountryPanel } from "./CountryPanel";
import { FeedItemDetail } from "./FeedItem";
import { useNow } from "./useNow";

/**
 * Colonne droite : une seule inspection à la fois (sélection unique du store) —
 * fiche pays, zone de conflit ou élément de flux. Rien n'est affiché sinon :
 * le globe reste dégagé.
 */
export function Inspector() {
  const country = useIntelStore((s) => s.country);
  const selected = useIntelStore((s) => s.selected);
  const item = useIntelStore((s) => s.selectedFeedItem);
  const locale = useIntelStore((s) => s.locale);
  const now = useNow();
  if (item) return <FeedItemDetail item={item} locale={locale} now={now} />;
  if (selected) return <ClusterDetail />;
  if (country) return <CountryPanel key={country.iso || country.name} />;
  return null;
}

export function hasInspection(state: { country: unknown; selected: unknown; selectedFeedItem: unknown }) {
  return Boolean(state.country || state.selected || state.selectedFeedItem);
}
