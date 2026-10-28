import CameraLab from "@/components/globe2/CameraLab";

export const metadata = {
  title: "ORBITAL LAB — Globe 2.0 Product Integration",
  robots: { index: false, follow: false },
};

export default function Globe2Page() {
  return <CameraLab tileLab productLab />;
}
