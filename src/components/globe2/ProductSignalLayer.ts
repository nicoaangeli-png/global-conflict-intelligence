import type * as ThreeTypes from "three";
import { toEcef } from "@/lib/globe2/geo";
import type { ProductSignal } from "./productIntel";

/** One batched draw call for geographic signals, plus a persistent selected ring. */
export class ProductSignalLayer {
  readonly group: ThreeTypes.Group;
  private readonly THREE: typeof ThreeTypes;
  private readonly markers: ThreeTypes.Points;
  private readonly selected: ThreeTypes.Points;
  private readonly markerMaterial: ThreeTypes.PointsMaterial;
  private readonly selectedMaterial: ThreeTypes.PointsMaterial;
  private readonly markerTexture: ThreeTypes.CanvasTexture;
  private readonly ringTexture: ThreeTypes.CanvasTexture;

  constructor(THREE: typeof ThreeTypes, pixelRatio: number) {
    this.THREE = THREE;
    this.group = new THREE.Group();
    const markerCanvas = document.createElement("canvas");
    markerCanvas.width = markerCanvas.height = 64;
    const markerContext = markerCanvas.getContext("2d");
    if (!markerContext) throw new Error("Canvas 2D indisponible pour les signaux");
    const glow = markerContext.createRadialGradient(32, 32, 2, 32, 32, 32);
    glow.addColorStop(0, "rgba(255,255,255,1)");
    glow.addColorStop(0.26, "rgba(255,255,255,1)");
    glow.addColorStop(0.52, "rgba(255,255,255,.34)");
    glow.addColorStop(1, "rgba(255,255,255,0)");
    markerContext.fillStyle = glow; markerContext.fillRect(0, 0, 64, 64);
    this.markerTexture = new THREE.CanvasTexture(markerCanvas);
    this.markerMaterial = new THREE.PointsMaterial({ size: 14 * pixelRatio, sizeAttenuation: false,
      vertexColors: true, map: this.markerTexture, transparent: true, opacity: 0.82,
      depthTest: true, depthWrite: false });
    this.markers = new THREE.Points(new THREE.BufferGeometry(), this.markerMaterial);
    this.markers.renderOrder = 3;
    this.group.add(this.markers);
    const canvas = document.createElement("canvas");
    canvas.width = canvas.height = 64;
    const context = canvas.getContext("2d");
    if (!context) throw new Error("Canvas 2D indisponible pour la sélection");
    context.strokeStyle = "#d7f8ff"; context.lineWidth = 5;
    context.beginPath(); context.arc(32, 32, 23, 0, Math.PI * 2); context.stroke();
    this.ringTexture = new THREE.CanvasTexture(canvas);
    this.selectedMaterial = new THREE.PointsMaterial({ size: 28 * pixelRatio, sizeAttenuation: false,
      map: this.ringTexture, transparent: true, depthTest: true, depthWrite: false, color: 0xd7f8ff });
    this.selected = new THREE.Points(new THREE.BufferGeometry(), this.selectedMaterial);
    this.selected.renderOrder = 4;
    this.selected.visible = false;
    this.group.add(this.selected);
  }

  private point(signal: ProductSignal): [number, number, number] {
    const p = toEcef({ latDeg: signal.lat, lonDeg: signal.lon, heightM: 14_000, datum: "WGS84" });
    return [p.x, p.z, -p.y];
  }

  setSignals(signals: ProductSignal[]): void {
    const positions: number[] = [], colors: number[] = [];
    for (const signal of signals) {
      positions.push(...this.point(signal));
      const color = new this.THREE.Color(signal.kind === "conflict" ? 0xe95350
        : signal.kind === "critical" ? 0xff675b : 0x7fc9dd);
      colors.push(color.r, color.g, color.b);
    }
    const geometry = new this.THREE.BufferGeometry();
    geometry.setAttribute("position", new this.THREE.Float32BufferAttribute(positions, 3));
    geometry.setAttribute("color", new this.THREE.Float32BufferAttribute(colors, 3));
    this.markers.geometry.dispose();
    this.markers.geometry = geometry;
  }

  select(signal: ProductSignal | null): void {
    this.selected.visible = signal !== null;
    if (!signal) return;
    const geometry = new this.THREE.BufferGeometry();
    geometry.setAttribute("position", new this.THREE.Float32BufferAttribute(this.point(signal), 3));
    this.selected.geometry.dispose();
    this.selected.geometry = geometry;
  }

  dispose(): void {
    this.markers.geometry.dispose(); this.selected.geometry.dispose();
    this.markerMaterial.dispose(); this.selectedMaterial.dispose(); this.markerTexture.dispose(); this.ringTexture.dispose();
  }
}
