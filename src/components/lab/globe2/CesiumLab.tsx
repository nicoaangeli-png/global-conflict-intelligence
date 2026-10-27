"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import Link from "next/link";
import type { BillboardCollection, PointPrimitiveCollection, PolylineCollection, ScreenSpaceEventHandler, Viewer } from "cesium";
import { PALETTE } from "@/lib/config/visual";
import { LAB_MOBILES, bboxFromCoordinates, longitudeSpan, screenRotation, semanticLevel, syntheticOrbit, type LabBbox, type LabLevel, type LabPoint } from "@/lib/lab/globe2/model";
import { orbitalImagery } from "@/lib/lab/globe2/imagery";
import { terrainForMode, type TerrainMode } from "@/lib/lab/globe2/terrain";

declare global { interface Window { CESIUM_BASE_URL?: string; Cesium?: typeof import("cesium"); __ORBITAL_GLOBE2_LAB__?: { viewer: Viewer; cesium: typeof import("cesium"); mobiles: BillboardCollection; markers: PointPrimitiveCollection; orbit: PolylineCollection } } }

let cesiumScript: Promise<typeof import("cesium")> | null = null;
function loadCesium(): Promise<typeof import("cesium")> {
  if (window.Cesium) return Promise.resolve(window.Cesium);
  if (!cesiumScript) cesiumScript = new Promise((resolve, reject) => {
    const script = document.createElement("script");
    script.src = "/lab/cesium/Cesium.js";
    script.async = true;
    script.onload = () => window.Cesium ? resolve(window.Cesium) : reject(new Error("Cesium global unavailable"));
    script.onerror = () => reject(new Error("Cesium script unavailable"));
    document.head.appendChild(script);
  });
  return cesiumScript;
}

type Scenario = "globe" | "mobiles" | "cameras" | "satellites" | "combined";
type Catalog = { points: LabPoint[]; candidates: number; total: number; synthetic: true };
type Metrics = { fps: number | null; frameMs: number | null; heapMb: number | null; rendered: number; requests: number; candidates: number; loadMs: number | null };
type MemoryPerformance = Performance & { memory?: { usedJSHeapSize: number } };

const PRESETS = [
  { name: "ESPACE", lon: 13, lat: 16, height: 25_000_000, pitch: -90 },
  { name: "CONTINENT", lon: 10, lat: 48, height: 8_000_000, pitch: -90 },
  { name: "PAYS", lon: 2, lat: 47, height: 2_000_000, pitch: -75 },
  { name: "RÉGION", lon: 2.35, lat: 48.86, height: 300_000, pitch: -55 },
  { name: "VILLE", lon: 2.35, lat: 48.86, height: 35_000, pitch: -42 },
  { name: "QUARTIER", lon: 2.35, lat: 48.86, height: 3_000, pitch: -32 },
] as const;

const MOBILE_COLORS = { aircraft: "#b6ff3b", warship: "#2fb8ff", merchant: "#7f93a8" } as const;

function mobileIcon(kind: "aircraft" | "warship" | "merchant", selected: boolean): string {
  const shape = kind === "aircraft"
    ? '<path d="M16 2 19 12 29 16 29 19 19 18 18 27 21 29 21 31 16 29 11 31 11 29 14 27 13 18 3 19 3 16 13 12Z"/>'
    : kind === "warship"
      ? '<path d="M2 20h28l-4 7H7Z M8 19v-4h10v4 M13 15V9h7v6 M16 9V4h2v5 M22 19v-3h5v3"/>'
      : '<path d="M2 20h28l-4 7H7Z M6 19v-7h7v7 M14 19v-7h7v7 M22 19v-7h6v7 M4 10h24v2H4Z"/>';
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 32 32"><circle cx="16" cy="16" r="15" fill="${selected ? '#062036' : '#01040a'}" stroke="${selected ? '#fff' : '#091b27'}" stroke-width="${selected ? 2 : 1}"/><g fill="${MOBILE_COLORS[kind]}" stroke="#01040a" stroke-width=".8">${shape}</g></svg>`;
  return `data:image/svg+xml,${encodeURIComponent(svg)}`;
}

function markerIcon(kind: "camera" | "satellite"): string {
  const symbol = kind === "camera"
    ? '<circle cx="16" cy="16" r="9" fill="none" stroke="#7fd4ff" stroke-width="2"/><circle cx="16" cy="16" r="3" fill="#dff2ff"/>'
    : '<path d="M16 4 19 13 28 16 19 19 16 28 13 19 4 16 13 13Z" fill="#b5a7ff"/>';
  return `data:image/svg+xml,${encodeURIComponent(`<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 32 32">${symbol}</svg>`)}`;
}

function cameraBbox(viewer: Viewer, cesium: typeof import("cesium")): LabBbox {
  const rectangle = viewer.camera.computeViewRectangle();
  if (!rectangle) {
    const samples: Array<{ latitude: number; longitude: number }> = [];
    for (const x of [0.05, 0.25, 0.5, 0.75, 0.95]) for (const y of [0.05, 0.25, 0.5, 0.75, 0.95]) {
      const pixel = new cesium.Cartesian2(viewer.canvas.clientWidth * x, viewer.canvas.clientHeight * y);
      const position = viewer.camera.pickEllipsoid(pixel);
      if (!position) continue;
      const cartographic = cesium.Cartographic.fromCartesian(position);
      samples.push({ latitude: cesium.Math.toDegrees(cartographic.latitude), longitude: cesium.Math.toDegrees(cartographic.longitude) });
    }
    return bboxFromCoordinates(samples) ?? { west: -180, south: -90, east: 180, north: 90 };
  }
  const degrees = cesium.Math.toDegrees;
  const west = Math.max(-180, Math.min(180, degrees(rectangle.west)));
  const east = Math.max(-180, Math.min(180, degrees(rectangle.east)));
  const south = Math.max(-90, Math.min(90, degrees(rectangle.south)));
  const north = Math.max(-90, Math.min(90, degrees(rectangle.north)));
  if (west === east || south >= north) return { west: -180, south: -90, east: 180, north: 90 };
  return { west, south, east, north };
}

export default function CesiumLab() {
  const container = useRef<HTMLDivElement>(null);
  const runtime = useRef<{ viewer: Viewer; cesium: typeof import("cesium"); markers: PointPrimitiveCollection; mobiles: BillboardCollection; selected: BillboardCollection; orbit: PolylineCollection; handler: ScreenSpaceEventHandler; removeMove: () => void; removeChanged: () => void; removeRender: () => void } | null>(null);
  const requestAbort = useRef<AbortController | null>(null);
  const debounce = useRef<ReturnType<typeof setTimeout> | null>(null);
  const lastQuery = useRef("");
  const levelRef = useRef<LabLevel | null>(null);
  const scenarioRef = useRef<Scenario>("globe");
  const selectedRef = useRef<LabPoint | null>(null);
  const [scenario, setScenario] = useState<Scenario>("globe");
  const [terrain, setTerrain] = useState<TerrainMode>("ellipsoid");
  const [terrainStatus, setTerrainStatus] = useState("Ellipsoïde local");
  const [level, setLevel] = useState<LabLevel>("PLANET");
  const [selected, setSelected] = useState<LabPoint | null>(null);
  const [ready, setReady] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [bboxText, setBboxText] = useState("—");
  const [metrics, setMetrics] = useState<Metrics>({ fps: null, frameMs: null, heapMb: null, rendered: 0, requests: 0, candidates: 0, loadMs: null });

  const refresh = useCallback((force = false) => {
    const current = runtime.current;
    if (!current) return;
    const { viewer, cesium, markers, mobiles, selected: selectedCollection, orbit } = current;
    const bbox = cameraBbox(viewer, cesium);
    const fov = cesium.Math.toDegrees(viewer.camera.frustum instanceof cesium.PerspectiveFrustum ? (viewer.camera.frustum.fov ?? Math.PI / 3) : Math.PI / 3);
    const height = Math.max(0, viewer.camera.positionCartographic.height);
    const nextLevel = semanticLevel(height, fov, viewer.canvas.clientHeight, bbox.north - bbox.south, levelRef.current);
    levelRef.current = nextLevel;
    setLevel(nextLevel);
    setBboxText(`${bbox.west.toFixed(1)}, ${bbox.south.toFixed(1)}, ${bbox.east.toFixed(1)}, ${bbox.north.toFixed(1)} · ${longitudeSpan(bbox).toFixed(1)}°`);
    const mode = scenarioRef.current;
    const cameras = mode === "cameras" || mode === "combined";
    const satellites = mode === "satellites" || mode === "combined";
    const mobilesOn = mode === "mobiles" || mode === "combined";
    mobiles.removeAll();
    if (mobilesOn) for (const mobile of LAB_MOBILES) {
      const kind = mobile.kind as "aircraft" | "warship" | "merchant";
      const position = cesium.Cartesian3.fromDegrees(mobile.longitude, mobile.latitude, mobile.altitude + (kind === "aircraft" ? 0 : 50));
      const heading = cesium.Math.toRadians(mobile.heading);
      const ahead = cesium.Cartesian3.fromDegrees(
        mobile.longitude + 0.03 * Math.sin(heading) / Math.max(0.1, Math.cos(cesium.Math.toRadians(mobile.latitude))),
        mobile.latitude + 0.03 * Math.cos(heading), mobile.altitude + (kind === "aircraft" ? 0 : 50),
      );
      const startPixel = cesium.SceneTransforms.worldToWindowCoordinates(viewer.scene, position);
      const aheadPixel = cesium.SceneTransforms.worldToWindowCoordinates(viewer.scene, ahead);
      const rotation = startPixel && aheadPixel
        ? screenRotation(aheadPixel.x - startPixel.x, aheadPixel.y - startPixel.y, kind !== "aircraft")
        : -heading + (kind === "aircraft" ? 0 : Math.PI / 2);
      mobiles.add({
        position,
        image: mobileIcon(kind, selectedRef.current?.id === mobile.id), width: 30, height: 30,
        rotation,
        verticalOrigin: cesium.VerticalOrigin.CENTER, id: mobile,
      });
    }
    selectedCollection.removeAll();
    orbit.removeAll();
    const chosen = selectedRef.current;
    if (chosen && chosen.kind !== "aircraft" && chosen.kind !== "warship" && chosen.kind !== "merchant")
      selectedCollection.add({ position: cesium.Cartesian3.fromDegrees(chosen.longitude, chosen.latitude, chosen.altitude + 100), image: markerIcon(chosen.kind), width: 36, height: 36, id: chosen, disableDepthTestDistance: Number.POSITIVE_INFINITY });
    if (chosen?.kind === "satellite" && chosen.id.startsWith("satellite:"))
      orbit.add({ positions: syntheticOrbit(chosen).map((point) => cesium.Cartesian3.fromDegrees(point.longitude, point.latitude, point.altitude)), width: 1, material: cesium.Material.fromType("Color", { color: cesium.Color.fromCssColorString("#8fd8ff").withAlpha(0.55) }) });
    if (!cameras && !satellites) {
      requestAbort.current?.abort(); markers.removeAll(); lastQuery.current = "";
      setMetrics((m) => ({ ...m, rendered: mobilesOn ? LAB_MOBILES.length : 0, candidates: 0 }));
      return;
    }
    const params = new URLSearchParams({ bbox: `${bbox.west},${bbox.south},${bbox.east},${bbox.north}`, level: nextLevel, cameras: cameras ? "1" : "0", satellites: satellites ? "1" : "0" });
    const url = `/api/lab/globe2/catalog?${params}`;
    if (!force && url === lastQuery.current) return;
    lastQuery.current = url;
    requestAbort.current?.abort();
    const controller = new AbortController(); requestAbort.current = controller;
    const started = performance.now();
    setMetrics((m) => ({ ...m, requests: m.requests + 1 }));
    fetch(url, { signal: controller.signal }).then(async (response) => {
      if (!response.ok) throw new Error(`Catalogue laboratoire HTTP ${response.status}`);
      return await response.json() as Catalog;
    }).then((catalog) => {
      if (controller.signal.aborted || runtime.current !== current) return;
      markers.removeAll();
      for (const point of catalog.points) {
        const color = point.kind === "camera" ? cesium.Color.fromCssColorString(PALETTE.cyan) : cesium.Color.fromCssColorString("#a599d5");
        markers.add({ position: cesium.Cartesian3.fromDegrees(point.longitude, point.latitude, point.altitude + (point.kind === "camera" ? 50 : 0)), color,
          pixelSize: point.count > 1 ? Math.min(12, 4 + Math.log2(point.count)) : 4,
          outlineColor: cesium.Color.fromCssColorString("#02101d"), outlineWidth: 1, id: point });
      }
      setMetrics((m) => ({ ...m, rendered: catalog.points.length + (mobilesOn ? LAB_MOBILES.length : 0) + (selectedRef.current ? 1 : 0), candidates: catalog.candidates, loadMs: Math.round(performance.now() - started) }));
    }).catch((reason: unknown) => { if (!controller.signal.aborted) setError(reason instanceof Error ? reason.message : "Catalogue indisponible"); });
  }, []);

  useEffect(() => {
    let disposed = false;
    let localViewer: Viewer | null = null;
    (async () => {
      if (!container.current) return;
      window.CESIUM_BASE_URL = "/lab/cesium/";
      const cesium = await loadCesium();
      if (disposed || !container.current) return;
      const imageryUrl = await orbitalImagery();
      if (disposed || !container.current) return;
      const imagery = await cesium.SingleTileImageryProvider.fromUrl(imageryUrl, { rectangle: cesium.Rectangle.MAX_VALUE });
      if (disposed || !container.current) return;
      const viewer = new cesium.Viewer(container.current, {
        baseLayer: false, terrainProvider: new cesium.EllipsoidTerrainProvider(),
        animation: false, timeline: false, baseLayerPicker: false, geocoder: false, homeButton: false,
        sceneModePicker: false, navigationHelpButton: false, fullscreenButton: false,
        infoBox: false, selectionIndicator: false, skyBox: false,
        useBrowserRecommendedResolution: true,
      });
      localViewer = viewer;
      viewer.imageryLayers.addImageryProvider(imagery);
      viewer.imageryLayers.get(0).brightness = 0.72;
      viewer.imageryLayers.get(0).saturation = 0.62;
      viewer.scene.backgroundColor = cesium.Color.fromCssColorString(PALETTE.void);
      viewer.scene.globe.baseColor = cesium.Color.fromCssColorString("#03111c");
      viewer.scene.globe.showGroundAtmosphere = false;
      viewer.scene.fog.enabled = true;
      viewer.scene.fog.density = 0.00004;
      viewer.scene.skyAtmosphere!.hueShift = 0.58;
      viewer.scene.skyAtmosphere!.saturationShift = -0.45;
      viewer.scene.skyAtmosphere!.brightnessShift = -0.30;
      viewer.scene.screenSpaceCameraController.enableTilt = true;
      viewer.scene.screenSpaceCameraController.inertiaSpin = 0.78;
      viewer.scene.screenSpaceCameraController.inertiaTranslate = 0.78;
      viewer.scene.screenSpaceCameraController.minimumZoomDistance = 250;
      viewer.camera.setView({ destination: cesium.Cartesian3.fromDegrees(13, 16, 25_000_000) });
      const markers = viewer.scene.primitives.add(new cesium.PointPrimitiveCollection());
      const mobiles = viewer.scene.primitives.add(new cesium.BillboardCollection());
      const selectedCollection = viewer.scene.primitives.add(new cesium.BillboardCollection());
      const orbit = viewer.scene.primitives.add(new cesium.PolylineCollection());
      const handler = new cesium.ScreenSpaceEventHandler(viewer.canvas);
      handler.setInputAction((event: { position: import("cesium").Cartesian2 }) => {
        const picked = viewer.scene.pick(event.position) as { id?: LabPoint } | undefined;
        if (picked?.id && typeof picked.id.id === "string") { selectedRef.current = picked.id; setSelected(picked.id); refresh(true); }
      }, cesium.ScreenSpaceEventType.LEFT_CLICK);
      const scheduleRefresh = () => {
        if (debounce.current) clearTimeout(debounce.current);
        debounce.current = setTimeout(() => refresh(), 250);
      };
      const removeMove = viewer.camera.moveEnd.addEventListener(scheduleRefresh);
      const removeChanged = viewer.camera.changed.addEventListener(scheduleRefresh);
      const frameTimes: number[] = [];
      let lastFrame = 0;
      let lastReport = 0;
      const removeRender = viewer.scene.postRender.addEventListener(() => {
        const now = performance.now();
        if (lastFrame) { frameTimes.push(now - lastFrame); if (frameTimes.length > 120) frameTimes.shift(); }
        lastFrame = now;
        if (now - lastReport > 1000 && frameTimes.length > 5) {
          const average = frameTimes.reduce((a, b) => a + b, 0) / frameTimes.length;
          const heap = (performance as MemoryPerformance).memory?.usedJSHeapSize;
          setMetrics((m) => ({ ...m, fps: Math.round(1000 / average), frameMs: Math.round(average * 10) / 10, heapMb: heap ? Math.round(heap / 1_048_576) : null }));
          lastReport = now;
        }
      });
      if (disposed) { handler.destroy(); viewer.destroy(); return; }
      runtime.current = { viewer, cesium, markers, mobiles, selected: selectedCollection, orbit, handler, removeMove, removeChanged, removeRender };
      window.__ORBITAL_GLOBE2_LAB__ = { viewer, cesium, mobiles, markers, orbit };
      setReady(true);
      refresh(true);
    })().catch((reason: unknown) => { if (!disposed) setError(reason instanceof Error ? reason.message : "Cesium indisponible"); });
    return () => {
      disposed = true;
      if (debounce.current) clearTimeout(debounce.current);
      requestAbort.current?.abort();
      const current = runtime.current;
      if (current) { current.removeMove(); current.removeChanged(); current.removeRender(); current.handler.destroy(); current.viewer.destroy(); runtime.current = null; }
      else if (localViewer && !localViewer.isDestroyed()) localViewer.destroy();
    };
  }, [refresh]);

  useEffect(() => { scenarioRef.current = scenario; lastQuery.current = ""; refresh(true); }, [scenario, refresh]);
  useEffect(() => {
    const current = runtime.current;
    if (!current) return;
    let active = true;
    setTerrainStatus(terrain === "open" ? "Chargement du relief ouvert…" : "Ellipsoïde local");
    terrainForMode(terrain, current.cesium).then(({ provider, fallback }) => {
      if (!active || runtime.current !== current) return;
      current.viewer.terrainProvider = provider;
      current.viewer.scene.globe.material = terrain === "open" && !fallback
        ? current.cesium.Material.fromType(current.cesium.Material.ElevationContourType, { color: current.cesium.Color.fromCssColorString("#48b7de").withAlpha(0.42), spacing: 250, width: 1 })
        : undefined;
      setTerrainStatus(fallback ? "Terrain indisponible · repli ellipsoïde" : terrain === "open" ? "Relief Re:Earth / Mapterhorn" : "Ellipsoïde local");
    });
    return () => { active = false; };
  }, [terrain, ready]);

  const fly = (preset: { lon: number; lat: number; height: number; pitch: number }) => {
    const current = runtime.current;
    if (!current) return;
    current.viewer.camera.flyTo({ destination: current.cesium.Cartesian3.fromDegrees(preset.lon, preset.lat, preset.height),
      orientation: { heading: 0, pitch: current.cesium.Math.toRadians(preset.pitch), roll: 0 }, duration: 1.4, complete: () => refresh(true) });
  };

  return <main className="globe2-lab relative h-dvh w-screen overflow-hidden bg-[#01040a] text-[#dff1ff]" data-testid="cesium-lab">
    <div ref={container} className="absolute inset-0" data-testid="cesium-canvas" />
    <div className="pointer-events-none absolute inset-0 bg-[linear-gradient(90deg,rgba(1,4,10,.72),transparent_36%,transparent_70%,rgba(1,4,10,.46))]" />
    <header className="pointer-events-none absolute left-4 top-4 right-4 flex items-start justify-between gap-3">
      <div><div className="text-[11px] tracking-[.45em] text-[#7fd4ff]">ORBITAL / LAB</div><h1 className="mt-1 text-xl font-light tracking-[.15em]">GLOBE 2.0 · CESIUM</h1><p className="mt-1 text-[10px] tracking-[.16em] text-[#8fb4cc]">POC TECHNIQUE · DONNÉES DE CHARGE SYNTHÉTIQUES · AUCUN FLUX MÉDIA</p></div>
      <Link href="/" className="pointer-events-auto rounded border border-[#7fd4ff]/30 bg-[#02101d]/85 px-3 py-2 text-xs text-[#7fd4ff]">ORBITAL ACTUEL ↗</Link>
    </header>
    <aside className="absolute left-4 top-28 max-h-[calc(100dvh-8rem)] w-[min(320px,calc(100vw-2rem))] overflow-y-auto border border-[#7fd4ff]/25 bg-[#03101ee8] p-4 text-xs shadow-[0_0_40px_rgba(0,50,90,.16)] max-sm:top-auto max-sm:bottom-3 max-sm:max-h-[44dvh]" data-testid="lab-controls">
      <div className="mb-3 text-[10px] tracking-[.25em] text-[#7fd4ff]">ÉCHELLE / NAVIGATION</div>
      <div className="grid grid-cols-3 gap-1">{PRESETS.map((preset) => <button key={preset.name} onClick={() => fly(preset)} className="border border-[#7fd4ff]/20 bg-[#092438]/70 px-1 py-2 text-[10px] hover:border-[#7fd4ff]" data-testid={`preset-${preset.name}`}>{preset.name}</button>)}</div>
      <div className="mt-4 text-[10px] tracking-[.25em] text-[#7fd4ff]">SCÉNARIO DE CHARGE</div>
      <div className="mt-2 grid grid-cols-2 gap-1">{(["globe", "mobiles", "cameras", "satellites", "combined"] as const).map((value) => <button key={value} onClick={() => setScenario(value)} aria-pressed={scenario === value} className={`border px-2 py-2 text-left uppercase ${scenario === value ? "border-[#7fd4ff] bg-[#134362] text-white" : "border-[#7fd4ff]/20 text-[#8fb4cc]"}`} data-testid={`scenario-${value}`}>{value === "combined" ? "TOUT" : value === "globe" ? "GLOBE SEUL" : value === "cameras" ? "20K CAMÉRAS" : value === "satellites" ? "15K SATELLITES" : "MOBILES"}</button>)}</div>
      <div className="mt-4 text-[10px] tracking-[.25em] text-[#7fd4ff]">TERRAIN</div>
      <div className="mt-2 flex flex-wrap gap-1"><button onClick={() => setTerrain("ellipsoid")} aria-pressed={terrain === "ellipsoid"} className="border border-[#7fd4ff]/30 px-2 py-2">LOCAL</button><button onClick={() => setTerrain("open")} aria-pressed={terrain === "open"} className="border border-[#7fd4ff]/30 px-2 py-2">RELIEF OUVERT</button><button onClick={() => { setTerrain("open"); fly({ lon: 7.8, lat: 46.85, height: 25_000, pitch: -55 }); }} className="border border-[#7fd4ff]/30 px-2 py-2">TEST ALPES ↗</button></div>
      <p className="mt-2 text-[10px] text-[#8fb4cc]" data-testid="terrain-status">{terrainStatus}</p>
      {terrain === "open" && <p className="mt-1 text-[10px] text-[#8fb4cc]">Relief : <a className="underline" href="https://terrain.reearth.land/" target="_blank" rel="noreferrer">Re:Earth</a> / Mapterhorn · CC BY 4.0</p>}
      <div className="mt-4 border-t border-[#7fd4ff]/20 pt-3 text-[10px] leading-6 text-[#8fb4cc]">
        <div>ÉTAT SÉMANTIQUE <strong className="text-[#dff2ff]" data-testid="semantic-level">{level}</strong></div>
        <div>BBOX <span data-testid="bbox">{bboxText}</span></div>
        <div>OBJETS RENDUS <strong data-testid="rendered-count">{metrics.rendered}</strong> / 35 000 simulés</div>
        <div>CANDIDATS BBOX <strong data-testid="candidate-count">{metrics.candidates}</strong></div>
        <div>REQUÊTES <strong data-testid="request-count">{metrics.requests}</strong> · dernier chargement {metrics.loadMs ?? "—"} ms</div>
        <div>FPS <strong data-testid="fps">{metrics.fps ?? "—"}</strong> · frame {metrics.frameMs ?? "—"} ms</div>
        <div>HEAP JS <strong data-testid="heap">{metrics.heapMb ?? "indisponible"}</strong> {metrics.heapMb === null ? "" : "Mo"}</div>
        <div>DRAW CALLS / GPU <strong>non exposés par API publique</strong></div>
      </div>
      {selected && <div className="mt-3 border-t border-[#7fd4ff]/20 pt-3" data-testid="selection"><div className="text-[#dff2ff]">SÉLECTION · {selected.kind.toUpperCase()}</div><div className="mt-1 text-[#8fb4cc]">{selected.id} · {selected.latitude.toFixed(3)}°, {selected.longitude.toFixed(3)}°</div><div className="text-[#8fb4cc]">{selected.count > 1 ? `${selected.count} objets regroupés` : "Objet individuel"}</div><button onClick={() => { selectedRef.current = null; setSelected(null); refresh(true); }} className="mt-2 border border-[#7fd4ff]/25 px-2 py-1">FERMER</button></div>}
      {selected?.kind === "satellite" && selected.id.startsWith("satellite:") && <p className="mt-1 text-[10px] text-[#8fb4cc]">Orbite illustrative synthétique · aucune éphéméride réelle.</p>}
      {error && <p role="alert" className="mt-3 text-[#ff9a86]">{error}</p>}
      {!ready && !error && <p className="mt-3 text-[#7fd4ff]">INITIALISATION CESIUM…</p>}
      <p className="mt-3 text-[9px] leading-4 text-[#4a6f88]">Natural Earth : géographie locale · Re:Earth / Mapterhorn : terrain ouvert optionnel · Synthèse déterministe pour charge uniquement.</p>
    </aside>
  </main>;
}
