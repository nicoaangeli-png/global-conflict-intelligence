import CameraLab from "@/components/globe2/CameraLab";

export const metadata = {
  title: "ORBITAL LAB — Tile Engine + LOD Phase 3A",
  robots: { index: false, follow: false },
};

export default function Globe2TilesPage() { return <CameraLab tileLab />; }
