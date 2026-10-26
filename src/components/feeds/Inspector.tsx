"use client";

import { useIntelStore } from "@/store/useIntelStore";
import { ClusterDetail } from "./ClusterDetail";
import { CountryPanel } from "./CountryPanel";
import { FeedItemDetail } from "./FeedItem";
import { LayerFeatureDetail } from "@/components/layers/LayerFeatureDetail";
import { CameraDetail } from "@/components/cameras/CameraDetail";
import { useNow } from "./useNow";

/**
 * Colonne droite : une seule inspection à la fois (sélection unique du store) —
 * fiche pays, zone de conflit, élément de flux ou élément de calque de référence. Rien n'est affiché sinon :
 * le globe reste dégagé.
 */
export function Inspector() {
  const country = useIntelStore((s) => s.country);
  const selected = useIntelStore((s) => s.selected);
  const item = useIntelStore((s) => s.selectedFeedItem);
  const layerItem = useIntelStore((s) => s.selectedLayerFeature);
  const camera = useIntelStore((s) => s.selectedCamera);
  const locale = useIntelStore((s) => s.locale);
  const now = useNow();
  if (camera) return <CameraDetail key={camera.id} camera={camera} locale={locale} now={now} />;
  if (item) return <FeedItemDetail item={item} locale={locale} now={now} />;
  if (layerItem) return <LayerFeatureDetail key={layerItem.feature.id} layerId={layerItem.layerId} feature={layerItem.feature} locale={locale} />;
  if (selected) return <ClusterDetail />;
  if (country) return <CountryPanel key={country.iso || country.name} />;
  return null;
}

export function hasInspection(state: { country: unknown; selected: unknown; selectedFeedItem: unknown; selectedLayerFeature: unknown; selectedCamera?: unknown }) {
  return Boolean(state.country || state.selected || state.selectedFeedItem || state.selectedLayerFeature || state.selectedCamera);
}
