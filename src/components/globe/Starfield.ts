import * as THREE from 'three';
import { STARFIELD, rgb } from '@/lib/config/visual';

function mulberry32(seed: number) {
  return () => {
    seed = (seed + 0x6d2b79f5) >>> 0;
    let t = seed;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export class Starfield {
  public group: THREE.Group;
  private starMaterial: THREE.ShaderMaterial;
  private galaxyMaterial: THREE.ShaderMaterial;

  constructor() {
    this.group = new THREE.Group();
    const rand = mulberry32(20261016);

    const makeCloud = (count: number, radiusFn: () => number, spread = 1, tilt = 0, sizeJitter = 0.5) => {
      const positions = new Float32Array(count * 3);
      const sizes = new Float32Array(count);
      for (let i = 0; i < count; i++) {
        const u = rand() * Math.PI * 2;
        const v = Math.acos(1 - 2 * rand());
        const r = radiusFn();
        const sinV = Math.sin(v);
        let x = r * sinV * Math.cos(u);
        let y = r * Math.cos(v) * spread;
        const z = r * sinV * Math.sin(u);
        const cy = y * Math.cos(tilt) - z * Math.sin(tilt);
        const cz = y * Math.sin(tilt) + z * Math.cos(tilt);
        positions[i * 3] = x;
        positions[i * 3 + 1] = cy;
        positions[i * 3 + 2] = cz;
        sizes[i] = 1 - sizeJitter * 0.5 + rand() * sizeJitter;
      }
      const g = new THREE.BufferGeometry();
      g.setAttribute('position', new THREE.BufferAttribute(positions, 3));
      g.setAttribute('aSize', new THREE.BufferAttribute(sizes, 1));
      return g;
    };

    const starGeo = makeCloud(
      STARFIELD.count,
      () => STARFIELD.innerRadius + rand() * (STARFIELD.outerRadius - STARFIELD.innerRadius),
      1,
      0,
      0.7
    );

    const galaxyGeo = makeCloud(
      STARFIELD.galaxy.count,
      () => STARFIELD.innerRadius * 1.6 + rand() * 8,
      STARFIELD.galaxy.spread,
      STARFIELD.galaxy.tilt,
      0.9
    );

    this.starMaterial = new THREE.ShaderMaterial({
      uniforms: {
        uColor: { value: rgb(STARFIELD.color) },
        uOpacity: { value: STARFIELD.opacity },
        uSize: { value: STARFIELD.size },
        uPixelRatio: { value: typeof window !== 'undefined' ? window.devicePixelRatio : 1 },
      },
      vertexShader: `
        attribute float aSize;
        uniform float uSize;
        uniform float uPixelRatio;
        varying float vSize;
        void main() {
          vSize = aSize;
          vec4 mv = modelViewMatrix * vec4(position, 1.0);
          gl_Position = projectionMatrix * mv;
          gl_PointSize = uSize * aSize * uPixelRatio;
        }
      `,
      fragmentShader: `
        precision highp float;
        uniform vec3 uColor;
        uniform float uOpacity;
        varying float vSize;
        void main() {
          vec2 c = gl_PointCoord - 0.5;
          float d = length(c) * 2.0;
          if (d > 1.0) discard;
          float a = smoothstep(1.0, 0.0, d) * uOpacity * (0.35 + vSize * 0.65);
          gl_FragColor = vec4(uColor, a);
        }
      `,
      transparent: true,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
    });

    this.galaxyMaterial = new THREE.ShaderMaterial({
      uniforms: {
        uColor: { value: rgb(STARFIELD.galaxy.color) },
        uOpacity: { value: STARFIELD.galaxy.opacity },
        uSize: { value: STARFIELD.galaxy.size },
        uPixelRatio: { value: typeof window !== 'undefined' ? window.devicePixelRatio : 1 },
      },
      vertexShader: this.starMaterial.vertexShader,
      fragmentShader: this.starMaterial.fragmentShader,
      transparent: true,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
    });

    const starPoints = new THREE.Points(starGeo, this.starMaterial);
    const galaxyPoints = new THREE.Points(galaxyGeo, this.galaxyMaterial);
    this.group.add(starPoints);
    this.group.add(galaxyPoints);
  }

  public update(time: number): void {
    this.group.rotation.y = time * 0.0035;
    this.group.rotation.x = Math.sin(time * 0.01) * 0.01;
  }

  public dispose(): void {
    this.starMaterial.dispose();
    this.galaxyMaterial.dispose();
  }
}
