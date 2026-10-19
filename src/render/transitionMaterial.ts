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
  varying vec2 vLocal;

  float hash(vec2 p) {
    p = fract(p * vec2(123.34, 456.21));
    p += dot(p, p + 45.32);
    return fract(p.x * p.y);
  }
  float vnoise(vec2 p) {
    vec2 i = floor(p);
    vec2 f = fract(p);
    vec2 u = f * f * (3.0 - 2.0 * f);
    return mix(mix(hash(i), hash(i + vec2(1, 0)), u.x), mix(hash(i + vec2(0, 1)), hash(i + vec2(1, 1)), u.x), u.y);
  }
  float fbm(vec2 p) {
    float v = 0.0;
    float a = 0.5;
    for (int i = 0; i < 4; i++) {
      v += a * vnoise(p);
      p = p * 2.03 + 17.1;
      a *= 0.5;
    }
    return v / 0.9375;
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
      float n = clamp((fbm(p * 5.0 + uSeed) - 0.25) / 0.5, 0.0, 1.0);
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
    },
    depthTest: false,
    depthWrite: false,
  });
}
