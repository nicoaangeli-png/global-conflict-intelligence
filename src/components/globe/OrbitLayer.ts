import * as THREE from 'three';
import { ORBITS } from '@/lib/config/visual';

function orbitGeometry(radius: number, inclinationDeg: number, rotationDeg = 0): THREE.BufferGeometry {
  const segments = 512;
  const positions: number[] = [];
  const inc = (inclinationDeg * Math.PI) / 180;
  const yaw = (rotationDeg * Math.PI) / 180;

  for (let i = 0; i <= segments; i++) {
    const a = (i / segments) * Math.PI * 2;
    const x = Math.cos(a) * radius;
    const z = Math.sin(a) * radius;
    const y1 = z * Math.sin(inc);
    const z1 = z * Math.cos(inc);
    const x2 = x * Math.cos(yaw) + z1 * Math.sin(yaw);
    const z2 = -x * Math.sin(yaw) + z1 * Math.cos(yaw);
    positions.push(x2, y1, z2);
  }

  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  return g;
}

function tickGeometry(radius: number, inclinationDeg: number, every: number, length: number): THREE.BufferGeometry {
  const segments = 240;
  const positions: number[] = [];
  const inc = (inclinationDeg * Math.PI) / 180;

  for (let i = 0; i < segments; i += every) {
    const a = (i / segments) * Math.PI * 2;
    const x = Math.cos(a) * radius;
    const z = Math.sin(a) * radius;
    const y1 = z * Math.sin(inc);
    const z1 = z * Math.cos(inc);
    positions.push(x * (1 - length * 0.5), y1 * (1 - length * 0.5), z1 * (1 - length * 0.5));
    positions.push(x * (1 + length * 0.5), y1 * (1 + length * 0.5), z1 * (1 + length * 0.5));
  }

  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  return g;
}

interface SatelliteRef {
  mesh: THREE.Mesh;
  radius: number;
  inclination: number;
  phase: number;
  speed: number;
}

export class OrbitLayer {
  public group: THREE.Group;
  private satellitesGroup: THREE.Group;
  private satellites: SatelliteRef[] = [];
  private lineMaterial: THREE.LineBasicMaterial;
  private tickMaterial: THREE.LineBasicMaterial;

  constructor() {
    this.group = new THREE.Group();
    this.satellitesGroup = new THREE.Group();

    this.lineMaterial = new THREE.LineBasicMaterial({
      color: new THREE.Color(ORBITS.color),
      transparent: true,
      opacity: ORBITS.opacity,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
    });

    this.tickMaterial = new THREE.LineBasicMaterial({
      color: new THREE.Color(ORBITS.color),
      transparent: true,
      opacity: ORBITS.opacity * 1.6,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
    });

    // 1. Anneaux orbitaux
    ORBITS.radius.forEach((r, i) => {
      const geo = orbitGeometry(r, ORBITS.inclination[i], i * 23);
      const line = new THREE.Line(geo, this.lineMaterial);
      this.group.add(line);

      const tGeo = tickGeometry(r * 1.004, ORBITS.inclination[i], ORBITS.tickEvery, ORBITS.tickLength);
      const tLines = new THREE.LineSegments(tGeo, this.tickMaterial);
      this.group.add(tLines);
    });

    // 2. Micro-satellites
    const sharedSatGeo = new THREE.SphereGeometry(1, 16, 12);
    ORBITS.satellites.forEach((s) => {
      const satMat = new THREE.MeshBasicMaterial({
        color: new THREE.Color(s.color),
        transparent: true,
        opacity: 0.85,
        blending: THREE.AdditiveBlending,
      });
      const satMesh = new THREE.Mesh(sharedSatGeo, satMat);
      satMesh.scale.set(s.size, s.size, s.size);
      this.satellitesGroup.add(satMesh);

      this.satellites.push({
        mesh: satMesh,
        radius: s.radius,
        inclination: s.inclination,
        phase: s.phase,
        speed: s.speed,
      });
    });

    this.group.add(this.satellitesGroup);
  }

  public update(time: number, delta: number): void {
    this.group.rotation.y += delta * ORBITS.speed;
    this.satellitesGroup.rotation.y -= delta * ORBITS.speed * 0.6;

    for (const sat of this.satellites) {
      const a = time * sat.speed * 4 + sat.phase * Math.PI * 2;
      const inc = (sat.inclination * Math.PI) / 180;
      const x = Math.cos(a) * sat.radius;
      const z = Math.sin(a) * sat.radius;
      sat.mesh.position.set(x, z * Math.sin(inc), z * Math.cos(inc));
    }
  }

  public dispose(): void {
    this.lineMaterial.dispose();
    this.tickMaterial.dispose();
  }
}
