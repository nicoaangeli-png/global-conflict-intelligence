"use client";

import { useEffect, useState } from "react";
import { absoluteDateTime, coords } from "@/lib/format";
import { tr, type Locale } from "@/lib/i18n";
import { useIntelStore } from "@/store/useIntelStore";
import type { Camera } from "@/types/cameras";

export function CameraDetail({ camera: initial, locale, now }: { camera: Camera; locale: Locale; now: number }) {
  const [camera, setCamera] = useState(initial);
  const [imageError, setImageError] = useState(false);
  const selectCamera = useIntelStore((s) => s.selectCamera);
  useEffect(() => {
    let active = true;
    setCamera(initial);
    setImageError(false);
    fetch(`/api/cameras/${initial.id}`, { cache: "no-store" }).then((response) => response.ok ? response.json() : null).then((body: Camera | null) => { if (active && body?.id === initial.id) setCamera(body); }).catch(() => undefined);
    return () => { active = false; };
  }, [initial]);
  const age = camera.capturedAt ? Math.max(0, now - Date.parse(camera.capturedAt)) : null;
  const status = imageError ? tr(locale, "Erreur image", "Image error") : camera.status === "recent" ? tr(locale, "Image récente", "Recent image") : camera.status === "stale" ? tr(locale, "Image ancienne", "Old image") : camera.status === "offline" ? tr(locale, "Image indisponible", "Image unavailable") : tr(locale, "Erreur source", "Source error");
  return <section className="panel corners boot inspector" aria-label={tr(locale, "Détail caméra", "Camera details")}>
    <span className="corner" />
    <header className="inspector-head"><div className="flex items-center gap-2"><span className="category-tag">CAMÉRAS</span><span className="nature-badge">{tr(locale, "Instantané périodique", "Periodic still image")}</span></div><button className="chip" type="button" onClick={() => selectCamera(null)} aria-label={tr(locale, "Fermer", "Close")}>✕</button></header>
    <div className="inspector-body scroll-thin">
      <h2 className="break-words text-[15px] font-light leading-snug text-[#eaf6ff]">{camera.name ?? camera.id}</h2>
      {camera.status !== "offline" && camera.status !== "error" && !imageError ? <img className="mt-3 w-full rounded border border-[rgba(127,212,255,0.18)]" src={`/api/cameras/${camera.id}/frame`} alt={camera.name ?? tr(locale, "Image de caméra routière", "Road camera image")} onError={() => setImageError(true)} /> : <p className="error-note mt-3">{tr(locale, "Image indisponible à la source.", "Image unavailable at source.")}</p>}
      <dl className="kv mt-3">
        <dt>{tr(locale, "Pays", "Country")}</dt><dd>{camera.country ?? "—"}</dd>
        <dt>{tr(locale, "Localisation", "Location")}</dt><dd>{camera.city ?? "—"} · {coords(camera.latitude, camera.longitude)}</dd>
        <dt>{tr(locale, "Direction", "Direction")}</dt><dd>{camera.direction ?? "—"}</dd>
        <dt>{tr(locale, "Capture", "Captured")}</dt><dd>{camera.capturedAt ? absoluteDateTime(camera.capturedAt, locale) : tr(locale, "Non publiée", "Not published")}</dd>
        <dt>{tr(locale, "Âge", "Age")}</dt><dd>{age === null ? "—" : `${Math.floor(age / 60_000)} min`}</dd>
        <dt>{tr(locale, "Statut", "Status")}</dt><dd>{status}</dd>
        <dt>{tr(locale, "Fournisseur", "Provider")}</dt><dd>{camera.providerName}</dd>
        <dt>{tr(locale, "Licence", "License")}</dt><dd>{camera.license ?? "—"}</dd>
      </dl>
      <p className="meta mt-3">{tr(locale, "Source", "Source")} : <a className="feed-link-inline" href="https://www.digitraffic.fi/en/road-traffic/" target="_blank" rel="noopener noreferrer">{camera.attribution}</a> · <a className="feed-link-inline" href="https://creativecommons.org/licenses/by/4.0/" target="_blank" rel="noopener noreferrer">{camera.license}</a>. {tr(locale, "Images généralement actualisées toutes les 10 min ; aucun flux vidéo direct.", "Images usually update every 10 min; no live video stream.")}</p>
      {camera.sourceUrl ? <a className="action-button mt-4" href={camera.sourceUrl} target="_blank" rel="noopener noreferrer">{tr(locale, "Fiche officielle ↗", "Official source ↗")}</a> : null}
    </div>
  </section>;
}
