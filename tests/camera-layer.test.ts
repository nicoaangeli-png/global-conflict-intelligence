import * as THREE from "three";
import { describe, expect, it } from "vitest";
import { CameraLayer } from "@/components/globe/CameraLayer";

describe("camera globe rendering", () => {
  it("uses one cyan points layer with a restrained ring for live video", () => {
    const layer = new CameraLayer(1);
    expect(layer.group.children).toHaveLength(1);
    const points = layer.group.children[0];
    expect(points).toBeInstanceOf(THREE.Points);
    const shader = (points as THREE.Points<THREE.BufferGeometry, THREE.ShaderMaterial>).material;
    expect(shader.vertexShader).toContain("aMedia>1.5?11.0");
    expect(shader.fragmentShader).toContain("float ring=");
    expect(shader.fragmentShader).toContain("vec3(0.82,0.98,1.0)");
    expect(shader.fragmentShader).toContain("vec3(0.38,0.86,0.94)");
    expect(shader.fragmentShader).toContain("vec3(0.33,0.58,0.70)");
    expect(shader.fragmentShader).not.toContain("vec3(0.98,0.32,0.28)");
    layer.dispose();
  });
});
