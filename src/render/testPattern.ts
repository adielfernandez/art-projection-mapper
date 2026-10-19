import * as THREE from 'three';

/**
 * Alignment test pattern, drawn in a quad's local space (width 1, height `size.y`).
 * Grid cells are square in local units, i.e. physically square on a frame whose
 * local height is 1 / physicalAspect. Line widths are in device pixels via screen-space derivatives,
 * so they stay crisp and uniform after the homography.
 */
const vertex = /* glsl */ `
  uniform vec2 uSize;
  varying vec2 vLocal;
  void main() {
    // Geometry is the unit square; the mesh is scaled to uSize, so local = position * uSize.
    vLocal = position.xy * uSize;
    gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
  }
`;

const fragment = /* glsl */ `
  uniform vec2 uSize;        // local width, height
  uniform float uCells;      // grid cells across the width
  uniform vec3 uAccent;      // quad debug color (linear)
  uniform float uLinePx;     // grid line width in device px
  uniform float uBorderPx;   // edge border width in device px
  varying vec2 vLocal;

  // Antialiased coverage of a line of width w (device px) at distance d (local units).
  float lineCov(float d, float fw, float w) {
    return 1.0 - smoothstep(0.5 * w - 0.5, 0.5 * w + 0.5, d / max(fw, 1e-6));
  }

  void main() {
    vec2 p = vLocal;
    // Local units per device pixel along each axis (gradient length, exact under rotation).
    vec2 fw = vec2(
      length(vec2(dFdx(p.x), dFdy(p.x))),
      length(vec2(dFdx(p.y), dFdy(p.y)))
    );
    float cell = uSize.x / uCells;
    // Grid anchored on the center so the crosshair lies on grid lines.
    vec2 q = (p - 0.5 * uSize) / cell;

    // Checkerboard
    vec2 ci = floor(q);
    float checker = mod(ci.x + ci.y, 2.0);
    vec3 col = mix(vec3(0.012), vec3(0.05), checker);

    // Grid lines
    vec2 dg = abs(fract(q + 0.5) - 0.5) * cell;
    float grid = max(lineCov(dg.x, fw.x, uLinePx), lineCov(dg.y, fw.y, uLinePx));
    col = mix(col, vec3(0.4), grid);

    // Center crosshair (spans 1.5 cells each way)
    vec2 dc = abs(p - 0.5 * uSize);
    float arm = 1.5 * cell;
    float xhair = max(
      lineCov(dc.x, fw.x, uLinePx * 2.0) * step(dc.y, arm),
      lineCov(dc.y, fw.y, uLinePx * 2.0) * step(dc.x, arm)
    );
    col = mix(col, uAccent, xhair);

    // Edge border, fully inside the quad so its outer edge sits exactly on the quad edge.
    vec2 de = min(p, uSize - p);
    float bx = 1.0 - smoothstep(uBorderPx - 0.5, uBorderPx + 0.5, de.x / max(fw.x, 1e-6));
    float by = 1.0 - smoothstep(uBorderPx - 0.5, uBorderPx + 0.5, de.y / max(fw.y, 1e-6));
    col = mix(col, vec3(1.0), max(bx, by));

    gl_FragColor = vec4(col, 1.0);
    #include <colorspace_fragment>
  }
`;

export function createTestPatternMaterial(accent: string): THREE.ShaderMaterial {
  return new THREE.ShaderMaterial({
    vertexShader: vertex,
    fragmentShader: fragment,
    uniforms: {
      uSize: { value: new THREE.Vector2(1, 1) },
      uCells: { value: 8 },
      uAccent: { value: new THREE.Color(accent) },
      uLinePx: { value: 1.5 },
      uBorderPx: { value: 2 },
    },
    depthTest: false,
    depthWrite: false,
  });
}
