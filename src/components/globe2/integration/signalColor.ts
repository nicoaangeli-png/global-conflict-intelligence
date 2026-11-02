import { THEME_COLORS } from "@/components/feeds/feedModel";
import type { ClusterSignalColor } from "@/components/conflicts/ConflictLayer";

/** Rendering classification, with all source records retained and no change to V1 `/`. */
export const signalColor: ClusterSignalColor = cluster => {
  switch (cluster.topType) {
    case "Battles": case "Explosions/Remote violence": case "Violence against civilians": return null;
    case "Thermal anomaly": return THEME_COLORS.disaster;
    case "Strategic developments": return THEME_COLORS.infrastructure;
    case "Protests": case "Riots": case "Media signal": return THEME_COLORS.social;
  }
};
