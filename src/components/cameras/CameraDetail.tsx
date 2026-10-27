"use client";

import { useEffect, useState } from "react";
import { absoluteDateTime, coords } from "@/lib/format";
import { tr, type Locale } from "@/lib/i18n";
import { useIntelStore } from "@/store/useIntelStore";
import type { Camera, CameraMarker } from "@/types/cameras";
import { CameraPlayer } from "./CameraPlayer";

export function CameraDetail({ camera: initial, locale, now }: { camera: CameraMarker; locale: Locale; now: number }) {
  const [camera, setCamera] = useState<Camera | CameraMarker>(initial);
  const [imageError, setImageError] = useState(false);
  const [frameVersion, setFrameVersion] = useState(0);
  const selectCamera = useIntelStore((s) => s.selectCamera);
  useEffect(() => {
    let active = true;
    setCamera(initial); setImageError(false); setFrameVersion(0);
    const refresh = () => fetch(`/api/cameras/${encodeURIComponent(initial.id)}`, { cache: "no-store" })
      .then((response) => response.ok ? response.json() as Promise<Camera> : null)
      .then((body) => { if (active && body?.id === initial.id) { setCamera(body); setFrameVersion(Date.now()); } })
      .catch(() => undefined);
    void refresh();
    const seconds = initial.expectedRefreshSeconds;
    const interval = initial.mediaType !== "live_video" && seconds ? setInterval(() => { void refresh(); }, Math.max(20, seconds) * 1000) : null;
    return () => { active = false; if (interval) clearInterval(interval); };
  }, [initial]);
  const age = camera.capturedAt ? Math.max(0, now - Date.parse(camera.capturedAt)) : null;
  const status = imageError ? tr(locale, "Erreur image", "Image error") : camera.mediaType === "live_video" ? tr(locale, "Flux HLS annoncé", "HLS stream listed") : camera.status === "recent" ? tr(locale, "Image récente", "Recent image") : camera.status === "stale" ? tr(locale, "Image ancienne", "Old image") : camera.status === "offline" ? tr(locale, "Image indisponible", "Image unavailable") : camera.status === "unknown" ? tr(locale, "Fraîcheur inconnue", "Freshness unknown") : tr(locale, "Erreur source", "Source error");
  const nature = camera.mediaType === "live_video" ? tr(locale, "Vidéo en direct", "Live video") : camera.mediaType === "near_live_image" ? tr(locale, "Image quasi directe", "Near live image") : tr(locale, "Instantané périodique", "Periodic still image");
  const stream = "streamUrl" in camera ? camera.streamUrl : null;
  const image = "imageUrl" in camera ? camera.imageUrl : null;
  return <section className="panel corners boot inspector" aria-label={tr(locale, "Détail caméra", "Camera details")}>
    <span className="corner" />
    <header className="inspector-head"><div className="flex items-center gap-2"><span className="category-tag">CAMÉRAS</span><span className="nature-badge">{nature}</span></div><button className="chip" type="button" onClick={() => selectCamera(null)} aria-label={tr(locale, "Fermer", "Close")}>✕</button></header>
    <div className="inspector-body scroll-thin">
      <h2 className="break-words text-[15px] font-light leading-snug text-[#eaf6ff]">{camera.name ?? camera.id}</h2>
      <p className="meta mt-1">{camera.providerName}</p>
      {camera.mediaType === "live_video" && stream && camera.streamProtocol === "hls" ? <CameraPlayer key={camera.id} streamUrl={stream} /> : null}
      {camera.mediaType !== "live_video" && image && camera.status !== "offline" && camera.status !== "error" && !imageError ? <img className="mt-3 w-full rounded border border-[rgba(127,212,255,0.18)]" src={`/api/cameras/${encodeURIComponent(camera.id)}/frame?v=${frameVersion}`} alt={camera.name ?? tr(locale, "Image de caméra routière", "Road camera image")} onError={() => setImageError(true)} /> : null}
      {camera.mediaType !== "live_video" && (imageError || camera.status === "offline" || camera.status === "error") ? <p className="error-note mt-3">{tr(locale, "Image indisponible à la source.", "Image unavailable at source.")}</p> : null}
      {camera.mediaType === "live_video" && !stream ? <p className="meta mt-3">{tr(locale, "Chargement du flux…", "Loading stream…")}</p> : null}
      <dl className="detail-grid mt-4">
        <dt>{tr(locale, "Pays", "Country")}</dt><dd>{camera.country ?? "—"}</dd>
        <dt>{tr(locale, "Région", "Region")}</dt><dd>{camera.region ?? "—"}</dd>
        <dt>{tr(locale, "Localisation", "Location")}</dt><dd>{camera.city ?? "—"} · {coords(camera.latitude, camera.longitude)}</dd>
        <dt>{tr(locale, "Direction", "Direction")}</dt><dd>{camera.direction ?? "—"}</dd>
        <dt>{tr(locale, "Capture", "Captured")}</dt><dd>{camera.capturedAt ? absoluteDateTime(camera.capturedAt, locale) : tr(locale, "Non publiée", "Not published")}</dd>
        <dt>{tr(locale, "Âge", "Age")}</dt><dd>{age === null ? "—" : age < 60_000 ? `${Math.floor(age / 1000)} s` : `${Math.floor(age / 60_000)} min`}</dd>
        <dt>{tr(locale, "Fréquence", "Refresh")}</dt><dd>{camera.expectedRefreshSeconds ? `~${camera.expectedRefreshSeconds < 120 ? `${camera.expectedRefreshSeconds} s` : `${Math.round(camera.expectedRefreshSeconds / 60)} min`}` : "—"}</dd>
        <dt>{tr(locale, "Statut", "Status")}</dt><dd>{status}</dd>
        <dt>{tr(locale, "Licence", "License")}</dt><dd>{camera.license ?? "—"}</dd>
      </dl>
      <p className="meta mt-3">{tr(locale, "Source", "Source")} : {camera.attribution}. {camera.mediaType === "periodic_snapshot" ? tr(locale, "Image périodique, pas de vidéo directe.", "Periodic image, no live video.") : camera.mediaType === "near_live_image" ? tr(locale, "Image renouvelée, pas de vidéo continue.", "Refreshing image, not continuous video.") : tr(locale, "La disponibilité du flux dépend du fournisseur.", "Stream availability depends on provider.")}</p>
      {camera.officialPageUrl ? <a className="action-button mt-4" href={camera.officialPageUrl} target="_blank" rel="noopener noreferrer">{tr(locale, "Fiche officielle ↗", "Official camera page ↗")}</a> : camera.providerHomepageUrl ? <a className="action-button mt-4" href={camera.providerHomepageUrl} target="_blank" rel="noopener noreferrer">{tr(locale, "Site du fournisseur ↗", "Provider site ↗")}</a> : null}
    </div>
  </section>;
}
