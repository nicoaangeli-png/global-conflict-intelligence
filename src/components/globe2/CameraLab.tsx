"use client";

import { useEffect, useRef, useState } from "react";
import type * as ThreeTypes from "three";
import { CameraEngine } from "@/lib/globe2/camera";
import { ecefToRender, enuFrame, toEcef, WGS84_A_M, WGS84_B_M } from "@/lib/globe2/geo";
import type { GeoPoint } from "@/lib/globe2/geo";
import styles from "./CameraLab.module.css";

const PRESETS = [
  { name: "SPACE", distanceM: 50_000_000, latDeg: 20, lonDeg: 0 },
  { name: "PLANET", distanceM: 20_000_000, latDeg: 20, lonDeg: 0 },
  { name: "CONTINENT", distanceM: 6_000_000, latDeg: 48, lonDeg: 10 },
  { name: "COUNTRY", distanceM: 1_400_000, latDeg: 46.6, lonDeg: 2.2 },
  { name: "REGION", distanceM: 300_000, latDeg: 45.9, lonDeg: 6.8 },
  { name: "CITY", distanceM: 30_000, latDeg: 48.8566, lonDeg: 2.3522 },
  { name: "DISTRICT", distanceM: 2_000, latDeg: 48.8584, lonDeg: 2.2945 },
] as const;
const DESTINATIONS = [
  { name: "EUROPE", latDeg: 50, lonDeg: 12, distanceM: 5_000_000 },
  { name: "FRANCE", latDeg: 46.6, lonDeg: 2.2, distanceM: 1_400_000 },
  { name: "PARIS", latDeg: 48.8566, lonDeg: 2.3522, distanceM: 30_000 },
  { name: "ALPES", latDeg: 45.9, lonDeg: 6.8, distanceM: 300_000 },
  { name: "ANTIMÉRIDIEN", latDeg: 0, lonDeg: 179.7, distanceM: 2_000_000 },
  { name: "PÔLE NORD", latDeg: 89.5, lonDeg: 0, distanceM: 2_000_000 },
] as const;

type Debug = { lat: string; lon: string; height: string; target: string; fov: string; tilt: string;
  mode: string; epoch: number; rebase: number; horizon: string; span: string;
  footprint: string; fps: number; engineMs: string; command: string; revision: number };
const EMPTY: Debug = { lat: "—", lon: "—", height: "—", target: "—", fov: "—", tilt: "—", mode: "—",
  epoch: 0, rebase: 0, horizon: "—", span: "—", footprint: "—", fps: 0,
  engineMs: "—", command: "—", revision: 0 };

const metres = (n: number | null) => n === null ? "—" : n >= 1000 ? `${(n / 1000).toFixed(1)} km` : `${n.toFixed(0)} m`;

export default function CameraLab() {
  const mountRef = useRef<HTMLDivElement>(null);
  const engineRef = useRef<CameraEngine | null>(null);
  const [debug, setDebug] = useState<Debug>(EMPTY);
  const [error, setError] = useState<string | null>(null);
  const [preset, setPreset] = useState<string>("PLANET");

  useEffect(() => {
    const mount = mountRef.current;
    if (!mount) return;
    let disposed = false, raf = 0;
    let cleanup = () => {};
    const start = async () => {
      const THREE = await import("three");
      const { applyCameraToThree } = await import("./CameraThreeAdapter");
      if (disposed) return;
      const engine = new CameraEngine({ width: mount.clientWidth, height: mount.clientHeight });
      engineRef.current = engine;
      const scene = new THREE.Scene();
      scene.background = new THREE.Color(0x010409);
      const camera = new THREE.PerspectiveCamera(50, mount.clientWidth / mount.clientHeight, 1, 90_000_000);
      const renderer = new THREE.WebGLRenderer({ antialias: true, powerPreference: "high-performance", logarithmicDepthBuffer: true });
      renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
      renderer.setSize(mount.clientWidth, mount.clientHeight);
      renderer.domElement.dataset.testid = "camera-lab-canvas";
      renderer.domElement.setAttribute("aria-label", "Globe ORBITAL — laboratoire du moteur caméra");
      renderer.domElement.style.touchAction = "none";
      mount.appendChild(renderer.domElement);

      const globe = new THREE.Group();
      scene.add(globe);
      const earthGeometry = new THREE.SphereGeometry(WGS84_A_M, 256, 128);
      const earthMaterial = new THREE.MeshPhongMaterial({ color: 0x071827, emissive: 0x03101b,
        specular: 0x18445a, shininess: 8 });
      const earth = new THREE.Mesh(earthGeometry, earthMaterial);
      earth.scale.y = WGS84_B_M / WGS84_A_M;
      globe.add(earth);
      const atmosphereGeometry = new THREE.SphereGeometry(WGS84_A_M * 1.015, 96, 64);
      const atmosphereMaterial = new THREE.MeshBasicMaterial({ color: 0x2a8cae, transparent: true,
        opacity: 0.045, side: THREE.BackSide, depthWrite: false });
      const atmosphere = new THREE.Mesh(atmosphereGeometry, atmosphereMaterial);
      atmosphere.scale.y = WGS84_B_M / WGS84_A_M;
      globe.add(atmosphere);
      scene.add(new THREE.AmbientLight(0x7aa2bb, 1.3));
      const light = new THREE.DirectionalLight(0xb5e7ff, 2.2);
      light.position.set(8_000_000, 10_000_000, 14_000_000);
      scene.add(light);

      const graticuleMaterial = new THREE.LineBasicMaterial({ color: 0x36a6cf, transparent: true, opacity: 0.24 });
      const graticuleGeometry: ThreeTypes.BufferGeometry[] = [];
      for (let lat = -75; lat <= 75; lat += 15) {
        const positions: number[] = [];
        for (let lon = -180; lon <= 180; lon += 2) {
          const p = toEcef({ latDeg: lat, lonDeg: lon === 180 ? -180 : lon, heightM: 8_000, datum: "WGS84" });
          positions.push(p.x, p.z, -p.y);
        }
        const geometry = new THREE.BufferGeometry(); geometry.setAttribute("position", new THREE.Float32BufferAttribute(positions, 3));
        graticuleGeometry.push(geometry); globe.add(new THREE.Line(geometry, graticuleMaterial));
      }
      for (let lon = -180; lon < 180; lon += 15) {
        const positions: number[] = [];
        for (let lat = -90; lat <= 90; lat += 2) {
          const p = toEcef({ latDeg: lat, lonDeg: lon, heightM: 8_000, datum: "WGS84" });
          positions.push(p.x, p.z, -p.y);
        }
        const geometry = new THREE.BufferGeometry(); geometry.setAttribute("position", new THREE.Float32BufferAttribute(positions, 3));
        graticuleGeometry.push(geometry); globe.add(new THREE.Line(geometry, graticuleMaterial));
      }

      const localGridGeometry = new THREE.BufferGeometry();
      const localGridPositions = new Float32Array(42 * 2 * 3);
      localGridGeometry.setAttribute("position", new THREE.BufferAttribute(localGridPositions, 3));
      const localGrid = new THREE.LineSegments(localGridGeometry,
        new THREE.LineBasicMaterial({ color: 0x56d8e9, transparent: true, opacity: 0.36, depthTest: false }));
      localGrid.frustumCulled = false;
      scene.add(localGrid);
      let gridRevision = -1, gridEpoch = -1;
      const updateGrid = (target: GeoPoint, distanceM: number, revision: number, epoch: number) => {
        localGrid.visible = distanceM < 120_000;
        if (!localGrid.visible || (gridRevision === revision && gridEpoch === epoch)) return;
        gridRevision = revision; gridEpoch = epoch;
        const frame = enuFrame({ ...target, heightM: 20 });
        const origin = engine.getFloatingOrigin();
        const half = distanceM < 5_000 ? 6_000 : 80_000;
        const spacing = half / 10;
        let index = 0;
        const put = (east: number, north: number) => {
          const ecef = { x: frame.origin.x + frame.east.x * east + frame.north.x * north,
            y: frame.origin.y + frame.east.y * east + frame.north.y * north,
            z: frame.origin.z + frame.east.z * east + frame.north.z * north };
          const p = ecefToRender(ecef, origin);
          localGridPositions[index++] = p.x; localGridPositions[index++] = p.y; localGridPositions[index++] = p.z;
        };
        for (let i = -10; i <= 10; i++) {
          const v = i * spacing;
          put(v, -half); put(v, half);
          put(-half, v); put(half, v);
        }
        localGridGeometry.attributes.position.needsUpdate = true;
        localGridGeometry.computeBoundingSphere();
      };

      const pointers = new Map<number, { x: number; y: number }>();
      let lastPinch = 0, lastCentroidY = 0;
      const canvas = renderer.domElement;
      const onPointerDown = (event: PointerEvent) => {
        canvas.setPointerCapture(event.pointerId);
        pointers.set(event.pointerId, { x: event.clientX, y: event.clientY });
        engine.beginGesture();
        if (pointers.size === 2) {
          const p = [...pointers.values()];
          lastPinch = Math.hypot(p[0].x - p[1].x, p[0].y - p[1].y);
          lastCentroidY = (p[0].y + p[1].y) / 2;
        }
      };
      const onPointerMove = (event: PointerEvent) => {
        const previous = pointers.get(event.pointerId);
        if (!previous) return;
        pointers.set(event.pointerId, { x: event.clientX, y: event.clientY });
        if (pointers.size === 1) {
          const dx = event.clientX - previous.x, dy = event.clientY - previous.y;
          if (event.shiftKey || event.buttons === 2) engine.pan(dx, dy);
          else engine.orbit(dx, dy, Date.now(), window.matchMedia("(prefers-reduced-motion: reduce)").matches);
        } else if (pointers.size === 2) {
          const p = [...pointers.values()];
          const span = Math.hypot(p[0].x - p[1].x, p[0].y - p[1].y);
          const cy = (p[0].y + p[1].y) / 2;
          if (lastPinch > 1 && span > 1) engine.zoomBy(lastPinch / span);
          if (Math.abs(cy - lastCentroidY) > 1) engine.tilt((cy - lastCentroidY) * 0.002);
          lastPinch = span; lastCentroidY = cy;
        }
      };
      const onPointerUp = (event: PointerEvent) => {
        pointers.delete(event.pointerId);
        if (pointers.size === 0) engine.endGesture();
        else if (pointers.size === 1) { lastPinch = 0; engine.beginGesture(); }
      };
      const onWheel = (event: WheelEvent) => {
        event.preventDefault();
        if (event.shiftKey) { engine.tilt(event.deltaY * 0.002); return; }
        const rect = canvas.getBoundingClientRect();
        const x = (event.clientX - rect.left) / rect.width * 2 - 1;
        const y = 1 - (event.clientY - rect.top) / rect.height * 2;
        engine.zoomAtPointer(Math.exp(clampWheel(event.deltaY) * (event.ctrlKey ? 0.003 : 0.0015)), x, y);
      };
      const onContextMenu = (event: MouseEvent) => event.preventDefault();
      canvas.addEventListener("pointerdown", onPointerDown);
      canvas.addEventListener("pointermove", onPointerMove);
      canvas.addEventListener("pointerup", onPointerUp);
      canvas.addEventListener("pointercancel", onPointerUp);
      canvas.addEventListener("wheel", onWheel, { passive: false });
      canvas.addEventListener("contextmenu", onContextMenu);
      const resize = new ResizeObserver(() => {
        const width = Math.max(1, mount.clientWidth), height = Math.max(1, mount.clientHeight);
        engine.setViewport({ width, height }); renderer.setSize(width, height);
      });
      resize.observe(mount);

      let previousTime = performance.now(), lastReport = 0, frames = 0, fpsStart = previousTime;
      const animate = (time: number) => {
        if (disposed) return;
        const delta = Math.min(0.1, Math.max(0, (time - previousTime) / 1000));
        previousTime = time;
        const reduced = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
        const current = engine.getState();
        if (current.trackingId === "lab-synthetic-target") {
          const t = time * 0.0001;
          engine.updateTrackedTarget("lab-synthetic-target", { latDeg: 48.8566 + 0.03 * Math.sin(t), lonDeg: 2.3522 + 0.04 * Math.cos(t) });
        }
        engine.step(delta, Date.now(), reduced);
        applyCameraToThree(engine, camera, globe);
        const state = engine.getState();
        updateGrid(state.target, state.distanceM, state.revision, state.originEpoch);
        renderer.render(scene, camera);
        frames++;
        if (time - lastReport >= 160) {
          const fp = engine.getViewFootprint();
          const fps = Math.round(frames * 1000 / Math.max(1, time - fpsStart));
          frames = 0; fpsStart = time; lastReport = time;
          setDebug({ lat: state.eye.latDeg.toFixed(5), lon: state.eye.lonDeg.toFixed(5),
            height: metres(state.eye.heightM), target: `${state.target.latDeg.toFixed(4)}°, ${state.target.lonDeg.toFixed(4)}°`,
            fov: `${(state.verticalFovRad * 180 / Math.PI).toFixed(1)}°`,
            tilt: `${(state.pitchRad * 180 / Math.PI).toFixed(1)}°`, mode: state.mode,
            epoch: state.originEpoch, rebase: state.rebaseCount,
            horizon: fp.horizonVisible ? "OUI" : "NON", span: metres(fp.groundSpanM),
            footprint: fp.partial ? "PARTIEL" : "COMPLET", fps,
            engineMs: state.engineFrameMs < 0.1 ? "<0.1" : state.engineFrameMs.toFixed(2),
            command: state.activeCommandId ?? "—", revision: state.revision });
        }
        raf = requestAnimationFrame(animate);
      };
      raf = requestAnimationFrame(animate);

      cleanup = () => {
        cancelAnimationFrame(raf); resize.disconnect();
        canvas.removeEventListener("pointerdown", onPointerDown);
        canvas.removeEventListener("pointermove", onPointerMove);
        canvas.removeEventListener("pointerup", onPointerUp);
        canvas.removeEventListener("pointercancel", onPointerUp);
        canvas.removeEventListener("wheel", onWheel);
        canvas.removeEventListener("contextmenu", onContextMenu);
        earthGeometry.dispose(); earthMaterial.dispose(); atmosphereGeometry.dispose(); atmosphereMaterial.dispose();
        graticuleGeometry.forEach(g => g.dispose()); graticuleMaterial.dispose();
        localGridGeometry.dispose(); (localGrid.material as ThreeTypes.Material).dispose();
        renderer.dispose(); renderer.forceContextLoss(); canvas.remove();
        engine.dispose(); engineRef.current = null;
      };
    };
    start().catch(err => { if (!disposed) setError(err instanceof Error ? err.message : "WebGL indisponible"); });
    return () => { disposed = true; cleanup(); };
  }, []);

  const fly = (target: { latDeg: number; lonDeg: number; distanceM: number }, name: string) => {
    const engine = engineRef.current;
    if (!engine) return;
    engine.flyTo({ target, distanceM: target.distanceM, durationMs: 1600,
      id: `lab-${name.toLowerCase().replace(/\s+/g, "-")}`, source: "user" }, Date.now(),
      window.matchMedia("(prefers-reduced-motion: reduce)").matches);
    setPreset(name);
  };

  return <main className={styles.lab}>
    <div ref={mountRef} className={styles.canvas} data-testid="camera-lab-mount" />
    <header className={styles.header}><span className={styles.brand}>◉ ORBITAL <strong>LAB / CAMERA ENGINE</strong></span>
      <span className={styles.badge}>PHASE 2 · THREE.JS RENDU · MOTEUR ORBITAL</span></header>
    <section className={styles.controls} aria-label="Contrôles caméra">
      <div className={styles.label}>ÉCHELLE · {preset}</div>
      <div className={styles.buttons}>{PRESETS.map(p => <button key={p.name} type="button" data-testid={`preset-${p.name.toLowerCase()}`}
        className={preset === p.name ? styles.active : ""} onClick={() => fly(p, p.name)}>{p.name}</button>)}</div>
      <div className={styles.label}>DESTINATIONS</div>
      <div className={styles.buttons}>{DESTINATIONS.map(p => <button key={p.name} type="button" onClick={() => fly(p, p.name)}>{p.name}</button>)}</div>
      <div className={styles.label}>ORIENTATION / COMMANDE</div>
      <div className={styles.buttons}>
        <button type="button" data-testid="tilt-button" onClick={() => engineRef.current?.tilt(20 * Math.PI / 180)}>OBLIQUE +</button>
        <button type="button" onClick={() => engineRef.current?.tilt(-20 * Math.PI / 180)}>OBLIQUE −</button>
        <button type="button" onClick={() => engineRef.current?.northUp()}>NORD ↑</button>
        <button type="button" data-testid="track-button" onClick={() => {
          const engine = engineRef.current; if (!engine) return;
          engine.flyTo({ target: { latDeg: 48.8566, lonDeg: 2.3522 }, distanceM: 30_000,
            durationMs: 1000, id: "lab-track-approach" });
          window.setTimeout(() => { if (engineRef.current === engine) engine.dispatch({ id: "lab-track", source: "user", action: "track",
            issuedAt: new Date().toISOString(), payload: { target: { kind: "mobile", id: "lab-synthetic-target" }, enabled: true } }); }, 1050);
        }}>SUIVI SYNTHÉTIQUE</button>
        <button type="button" data-testid="reset-button" onClick={() => { engineRef.current?.reset(); setPreset("PLANET"); }}>RESET</button>
      </div>
      <p className={styles.hint}>Glisser : rotation · Maj + glisser : pan · Molette/pinch : zoom au pointeur · Maj + molette / deux doigts verticaux : tilt. Tout geste interrompt un fly-to.</p>
    </section>
    <aside className={styles.debug} aria-label="Debug Camera Engine" data-testid="camera-lab-debug">
      <div className={styles.label}>VIEWSTATE / DEBUG <span>FPS {debug.fps}</span></div>
      <dl>
        <dt>CAMÉRA</dt><dd data-testid="debug-camera">{debug.lat}°, {debug.lon}°</dd>
        <dt>HAUTEUR</dt><dd data-testid="debug-height">{debug.height}</dd>
        <dt>CIBLE</dt><dd data-testid="debug-target">{debug.target}</dd>
        <dt>MODE / FOV</dt><dd>{debug.mode.toUpperCase()} · {debug.fov}</dd>
        <dt>TILT</dt><dd>{debug.tilt}</dd>
        <dt>HORIZON</dt><dd>{debug.horizon}</dd>
        <dt>FOOTPRINT</dt><dd>{debug.footprint}</dd>
        <dt>GROUND SPAN</dt><dd>{debug.span}</dd>
        <dt>ORIGIN EPOCH</dt><dd data-testid="debug-epoch">{debug.epoch} · {debug.rebase} rebases</dd>
        <dt>COMMANDE</dt><dd data-testid="debug-command">{debug.command}</dd>
        <dt>ENGINE / VUE</dt><dd>{debug.engineMs} ms · r{debug.revision}</dd>
      </dl>
    </aside>
    {error && <div className={styles.error} role="alert">WebGL / Camera Lab : {error}</div>}
    <footer className={styles.footer}>LABORATOIRE LOCAL · ELLIPSOÏDE WGS84 · AUCUN TERRAIN · AUCUNE SOURCE EXTERNE</footer>
  </main>;
}

const clampWheel = (delta: number) => Math.max(-160, Math.min(160, delta));
