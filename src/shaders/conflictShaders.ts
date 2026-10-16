export const BeaconShader = {
  vertexShader: `
    varying vec2 vUv;
    varying vec3 vPosition;

    void main() {
      vUv = uv;
      vPosition = position;
      gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
    }
  `,
  fragmentShader: `
    uniform vec3 uColor;
    uniform float uTime;
    uniform float uIntensity;
    varying vec2 vUv;

    void main() {
      // Vertical fade: intense at base (vUv.y = 0), fades to 0 at top (vUv.y = 1)
      float verticalFade = pow(1.0 - vUv.y, 2.0);
      
      // Horizontal cylindrical falloff
      float horizontalFalloff = sin(vUv.x * 3.14159);

      // Light beam pulsation
      float pulse = sin(uTime * 3.0) * 0.15 + 0.85;

      float alpha = verticalFade * horizontalFalloff * pulse * uIntensity;
      gl_FragColor = vec4(uColor, alpha);
    }
  `,
};

export const ShockwaveShader = {
  vertexShader: `
    varying vec2 vUv;
    void main() {
      vUv = uv;
      gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
    }
  `,
  fragmentShader: `
    uniform vec3 uColor;
    uniform float uProgress; // 0 to 1 cycle
    uniform float uRingCount;
    varying vec2 vUv;

    void main() {
      // Distance from center (0 to 0.5)
      vec2 center = vec2(0.5, 0.5);
      float dist = length(vUv - center) * 2.0;

      // Expand outward
      float ring = sin((dist - uProgress) * 3.14159 * uRingCount);
      float sharpness = pow(clamp(ring, 0.0, 1.0), 4.0);

      // Fade out towards edge
      float edgeFade = 1.0 - smoothstep(0.7, 1.0, dist);
      float alpha = sharpness * edgeFade * (1.0 - uProgress);

      gl_FragColor = vec4(uColor, alpha);
    }
  `,
};
