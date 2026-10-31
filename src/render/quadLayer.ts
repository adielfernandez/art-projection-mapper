import * as THREE from 'three';
import type { FrameVisual } from '../content/scheduler';
import type { Quad } from '../math/homography';
import type { BlendMode } from '../state/schema';
import { QuadCamera } from './quadCamera';
import { createTestPatternMaterial } from './testPattern';
import { createFrameMaterial } from './transitionMaterial';

/** Unit square [0,1]², origin bottom-left. Meshes scale it to their local size. */
const UNIT_SQUARE = new THREE.PlaneGeometry(1, 1).translate(0.5, 0.5, 0);

/**
 * One mapped quad: its own scene in local space (width 1, height localH) rendered
 * through a homography camera. Frames carry a content mesh; the wall does not.
 */
export class QuadLayer {
  readonly scene = new THREE.Scene();
  readonly quadCam = new QuadCamera();
  readonly testPattern: THREE.Mesh<THREE.PlaneGeometry, THREE.ShaderMaterial>;
  readonly content: THREE.Mesh<THREE.PlaneGeometry, THREE.ShaderMaterial> | null;
  localW = 1;
  localH = 1;

  /** Show nothing (not black) while there is no content: the wall's background stays visible. */
  private readonly hideWhenEmpty: boolean;

  constructor(accent: string, opts: { content: boolean; hideWhenEmpty?: boolean }) {
    this.content = opts.content ? this.addMesh(createFrameMaterial(), 0) : null;
    this.hideWhenEmpty = opts.hideWhenEmpty ?? false;
    this.testPattern = this.addMesh(createTestPatternMaterial(accent), 1);
    // three draws opaque meshes before transparent ones; the pattern (alpha 1) must stay on
    // top of content that is transparent, so it renders in the transparent pass too.
    this.testPattern.material.transparent = true;
  }

  private addMesh(material: THREE.ShaderMaterial, renderOrder: number): THREE.Mesh<THREE.PlaneGeometry, THREE.ShaderMaterial> {
    const mesh = new THREE.Mesh(UNIT_SQUARE, material);
    mesh.frustumCulled = false;
    mesh.renderOrder = renderOrder;
    this.scene.add(mesh);
    return mesh;
  }

  /** Returns whether the quad is valid (convex, non-degenerate). The last valid mapping is kept otherwise. */
  setMapping(localW: number, localH: number, cornersNorm: Quad, viewport: { w: number; h: number }): boolean {
    this.localW = localW;
    this.localH = localH;
    for (const mesh of [this.testPattern, this.content]) {
      if (!mesh) continue;
      mesh.scale.set(localW, localH, 1);
      mesh.material.uniforms.uSize!.value.set(localW, localH);
    }
    return this.quadCam.update(localW, localH, cornersNorm, viewport);
  }

  setAccent(color: string): void {
    (this.testPattern.material.uniforms.uAccent!.value as THREE.Color).set(color);
  }

  setTestPatternVisible(v: boolean): void {
    this.testPattern.visible = v;
  }

  /**
   * How the content combines with what's behind it, and its opacity. Additive: black adds no
   * light, so frames drawn earlier show through it. `revealBehind` (choreographed frames):
   * normal fades show what's behind instead of black. Normal and alpha then need
   * `transparent`, or three r186 switches blending off.
   */
  setBlend(mode: BlendMode, revealBehind = false, opacity = 1): void {
    if (!this.content) return;
    const m = this.content.material;
    m.blending = mode === 'add' ? THREE.AdditiveBlending : THREE.NormalBlending;
    const code = mode === 'add' || !revealBehind ? 0 : mode === 'alpha' ? 2 : 1;
    m.transparent = code !== 0;
    m.uniforms.uBlend!.value = code;
    m.uniforms.uOpacity!.value = opacity;
  }

  setVisual(v: FrameVisual): void {
    if (!this.content) return;
    this.content.visible = !this.hideWhenEmpty || v.texture !== null;
    const u = this.content.material.uniforms;
    u.uTex!.value = v.texture;
    u.uHasTex!.value = v.texture ? 1 : 0;
    u.uInvertV!.value = v.invertV ? 1 : 0;
    u.uDecodeSRGB!.value = needsShaderDecode(v.texture) ? 1 : 0;
    u.uView!.value.set(v.view.cx, v.view.cy, v.view.sx, v.view.sy);
    u.uReveal!.value = v.reveal;
    u.uFade!.value = v.fade;
    u.uSeed!.value = v.seed;
    u.uSoftness!.value = v.softness;
    u.uNoiseScale!.value = v.noiseScale;
    u.uSimpleFade!.value = v.simpleFade ? 1 : 0;
  }

  render(renderer: THREE.WebGLRenderer): void {
    if (!this.quadCam.homography) return;
    renderer.render(this.scene, this.quadCam.camera);
  }

  dispose(): void {
    this.testPattern.material.dispose();
    this.content?.material.dispose();
  }
}

/**
 * sRGB video textures are uploaded without hardware sRGB decoding (three.js forces linear
 * RGBA8 for video), so the frame shader must decode them itself. Images are decoded by the GPU.
 */
function needsShaderDecode(texture: THREE.Texture | null): boolean {
  return !!texture && (texture as THREE.VideoTexture).isVideoTexture === true && texture.colorSpace === THREE.SRGBColorSpace;
}
