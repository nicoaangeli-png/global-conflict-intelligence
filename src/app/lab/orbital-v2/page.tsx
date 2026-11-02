"use client";

import dynamic from "next/dynamic";
import Link from "next/link";
const IntelApp = dynamic(() => import("@/components/IntelApp").then(module => module.IntelApp), { ssr: false });

const GlobeSceneV2 = dynamic(() => import("@/components/globe2/integration/GlobeSceneV2").then(module => module.GlobeSceneV2), { ssr: false });

/** V1 application intact, proprietary V2 spatial runtime. No production route switch. */
export default function OrbitalV2Page() {
  return <><IntelApp Scene={GlobeSceneV2} />
    <Link href="/" className="chip fixed bottom-4 right-4 z-40 hidden md:block"
      aria-label="Comparer avec ORBITAL V1" title="Référence V1 — retour navigateur pour revenir à V2">V1 ↗</Link>
  </>;
}
