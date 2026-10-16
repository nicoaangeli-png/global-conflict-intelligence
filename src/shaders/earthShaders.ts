export const EarthHologramShader = {
  vertexShader: `
    varying vec3 vNormal;
    varying vec3 vPosition;
    varying vec2 vUv;

    void main() {
      vUv = uv;
      vNormal = normalize(normalMatrix * normal);
      vPosition = position;
      gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
    }
  `,
  fragmentShader: `
    uniform float uTime;
    uniform vec3 uColor;
    uniform vec3 uGlowColor;
    uniform float uOpacity;

    varying vec3 vNormal;
    varying vec3 vPosition;
    varying vec2 vUv;

    void main() {
      // Fresnel effect on silhouette
      vec3 viewDir = vec3(0.0, 0.0, 1.0);
      float fresnel = dot(vNormal, viewDir);
      float edgeIntensity = pow(1.0 - abs(fresnel), 2.2);

      // Subtle animated scanlines
      float scanline = sin(vPosition.y * 1.8 + uTime * 1.5) * 0.08 + 0.92;

      // Subtle data pulse
      float pulse = sin(uTime * 1.2) * 0.05 + 0.95;

      // Inner subtle glow + high rim glow
      vec3 finalColor = mix(uColor * 0.4, uGlowColor, edgeIntensity * 1.3) * scanline * pulse;
      float alpha = (0.12 + edgeIntensity * 0.75) * uOpacity;

      gl_FragColor = vec4(finalColor, alpha);
    }
  `,
};

export const AtmosphereShader = {
  vertexShader: `
    varying vec3 vNormal;
    void main() {
      vNormal = normalize(normalMatrix * normal);
      gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
    }
  `,
  fragmentShader: `
    uniform vec3 uAtmosphereColor;
    uniform float uPower;
    uniform float uIntensity;
    varying vec3 vNormal;

    void main() {
      // Rim lighting calculation
      float intensity = pow(0.7 - dot(vNormal, vec3(0, 0, 1.0)), uPower);
      vec3 color = uAtmosphereColor * intensity * uIntensity;
      gl_FragColor = vec4(color, intensity * 0.85);
    }
  `,
};
