import * as THREE from 'three';

/**
 * Frame content shader, in frame-local space (width 1, height 1/physicalAspect):
 * cover-fit/zoom/pan via a UV view rect, a noise-mask dissolve in from black,
 * a fade out to black, and per-edge inset masking (the inset band is black).
 */
const vertex = /* glsl */ `
  uniform vec2 uSize;
  varying vec2 vLocal;
  void main() {
    vLocal = position.xy * uSize;
    gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
  }
`;

const fragment = /* glsl */ `
  uniform sampler2D uTex;
  uniform float uHasTex;
  uniform vec2 uSize;     // local width, height
  uniform vec4 uInset;    // top, right, bottom, left (local units)
  uniform vec4 uView;     // texture-space center (xy) and span (zw), v up
  uniform float uInvertV;
  uniform float uReveal;  // 0..1 dissolve-in progress
  uniform float uFade;    // 1 visible .. 0 black
  uniform float uSeed;
  uniform float uSoftness; // dissolve edge width in noise units
  uniform float uNoiseScale; // blob size; 1 = about five blobs per frame width
  varying vec2 vLocal;

  // Unit gradient for a lattice point (sin-free hash, stable at large coordinates).
  vec2 grad(vec2 p) {
    vec3 p3 = fract(p.xyx * vec3(0.1031, 0.1030, 0.0973));
    p3 += dot(p3, p3.yzx + 33.33);
    vec2 g = fract((p3.xx + p3.yz) * p3.zy) * 2.0 - 1.0;
    return g * inversesqrt(max(dot(g, g), 1e-8));
  }
  // 2D simplex gradient noise, about -1..1. Triangular lattice, no flat square cells.
  float snoise(vec2 p) {
    const float K1 = 0.366025404; // (sqrt(3) - 1) / 2
    const float K2 = 0.211324865; // (3 - sqrt(3)) / 6
    vec2 i = floor(p + (p.x + p.y) * K1);
    vec2 a = p - i + (i.x + i.y) * K2;
    vec2 o = a.x > a.y ? vec2(1.0, 0.0) : vec2(0.0, 1.0);
    vec2 b = a - o + K2;
    vec2 c = a - 1.0 + 2.0 * K2;
    vec3 h = max(0.5 - vec3(dot(a, a), dot(b, b), dot(c, c)), 0.0);
    vec3 n = h * h * h * h * vec3(dot(a, grad(i)), dot(b, grad(i + o)), dot(c, grad(i + 1.0)));
    return dot(n, vec3(70.0));
  }
  // Each octave is rotated ~37 degrees so lattice directions never line up across octaves.
  float fbm(vec2 p) {
    const mat2 R = mat2(1.6, -1.2, 1.2, 1.6) * 1.015; // rotate and scale by 2.03
    float v = 0.0;
    float a = 0.5;
    for (int i = 0; i < 4; i++) {
      v += a * snoise(p);
      p = R * p + 17.1;
      a *= 0.5;
    }
    return v / 0.9375; // about -0.45..0.45 for 2nd..98th percentile
  }

  void main() {
    vec2 p = vLocal;
    vec3 col = vec3(0.0);

    if (uHasTex > 0.5) {
      vec2 fuv = p / uSize;
      vec2 tuv = uView.xy + (fuv - 0.5) * uView.zw;
      if (uInvertV > 0.5) tuv.y = 1.0 - tuv.y;
      col = texture2D(uTex, tuv).rgb;

      // Noise-mask dissolve in. Noise is in physical units so blobs are round on any frame.
      float n = clamp(0.5 + fbm(p * (5.0 / max(uNoiseScale, 0.01)) + uSeed) * 1.1, 0.0, 1.0);
      float feather = max(uSoftness, 0.01);
      float t = uReveal * (1.0 + feather);
      float reveal = smoothstep(n, n + feather, t);
      col *= reveal * uFade;
    }

    // Inset mask, antialiased over one device pixel.
    vec2 px = vec2(length(vec2(dFdx(p.x), dFdy(p.x))), length(vec2(dFdx(p.y), dFdy(p.y))));
    px = max(px, vec2(1e-6));
    float m = clamp((p.x - uInset.w) / px.x + 0.5, 0.0, 1.0)
            * clamp((uSize.x - uInset.y - p.x) / px.x + 0.5, 0.0, 1.0)
            * clamp((p.y - uInset.z) / px.y + 0.5, 0.0, 1.0)
            * clamp((uSize.y - uInset.x - p.y) / px.y + 0.5, 0.0, 1.0);
    col *= m;

    gl_FragColor = vec4(col, 1.0);
    #include <colorspace_fragment>
  }
`;

export function createFrameMaterial(): THREE.ShaderMaterial {
  return new THREE.ShaderMaterial({
    vertexShader: vertex,
    fragmentShader: fragment,
    uniforms: {
      uTex: { value: null },
      uHasTex: { value: 0 },
      uSize: { value: new THREE.Vector2(1, 1) },
      uInset: { value: new THREE.Vector4(0, 0, 0, 0) },
      uView: { value: new THREE.Vector4(0.5, 0.5, 1, 1) },
      uInvertV: { value: 0 },
      uReveal: { value: 1 },
      uFade: { value: 1 },
      uSeed: { value: 0 },
      uSoftness: { value: 0.5 },
      uNoiseScale: { value: 1 },
    },
    depthTest: false,
    depthWrite: false,
  });
}
