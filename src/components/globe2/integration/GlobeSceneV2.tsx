"use client";

import { GlobeScene } from "@/components/globe/GlobeScene";
import { OrbitalNavigation } from "./OrbitalNavigation";
import { signalColor } from "./signalColor";

const createNavigation = () => new OrbitalNavigation();

/** Same V1 scene/layers/store and interaction ownership; only the spatial runtime is replaced. */
export function GlobeSceneV2() {
  return <GlobeScene createNavigation={createNavigation} signalColor={signalColor} />;
}
