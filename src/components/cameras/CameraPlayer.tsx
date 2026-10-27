"use client";

import { useEffect, useRef, useState } from "react";

/** The component only exists while its camera detail is open. Cleanup always releases the stream. */
export function CameraPlayer({ streamUrl }: { streamUrl: string }) {
  const video = useRef<HTMLVideoElement>(null);
  const [attempt, setAttempt] = useState(0);
  const [state, setState] = useState<"connecting" | "playing" | "error">("connecting");
  useEffect(() => {
    const element = video.current;
    if (!element) return;
    let disposed = false;
    let destroyHls: (() => void) | null = null;
    const playing = () => { if (!disposed) setState("playing"); };
    const failed = () => { if (!disposed) setState("error"); };
    setState("connecting");
    element.addEventListener("playing", playing);
    element.addEventListener("error", failed);
    if (element.canPlayType("application/vnd.apple.mpegurl")) {
      element.src = streamUrl;
      void element.play().catch(failed);
    } else {
      void import("hls.js").then(({ default: Hls }) => {
        if (disposed) return;
        if (!Hls.isSupported()) { failed(); return; }
        const hls = new Hls({ enableWorker: true, lowLatencyMode: true });
        destroyHls = () => hls.destroy();
        hls.on(Hls.Events.ERROR, (_event, data) => { if (data.fatal) failed(); });
        hls.on(Hls.Events.MANIFEST_PARSED, () => { void element.play().catch(failed); });
        hls.loadSource(streamUrl);
        hls.attachMedia(element);
      }).catch(failed);
    }
    return () => {
      disposed = true;
      destroyHls?.();
      element.removeEventListener("playing", playing);
      element.removeEventListener("error", failed);
      element.pause();
      element.removeAttribute("src");
      element.load();
    };
  }, [streamUrl, attempt]);
  return <div className="mt-3">
    <video ref={video} className="w-full rounded border border-[rgba(127,212,255,0.18)]" controls playsInline muted autoPlay aria-label="Flux vidéo de caméra" />
    <div className="meta mt-1" role="status">{state === "playing" ? "HLS · connexion OK" : state === "connecting" ? "HLS · connexion…" : "Flux indisponible"}</div>
    {state === "error" ? <button type="button" className="chip mt-2" onClick={() => setAttempt((value) => value + 1)}>Réessayer</button> : null}
  </div>;
}
