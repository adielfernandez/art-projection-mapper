/** Persisted data schemas. Bump the schemaVersion and add a migration on any breaking change. */

export const CONFIG_SCHEMA_VERSION = 1;
export const MANIFEST_SCHEMA_VERSION = 1;

/** Canvas-normalized point: [0,1]², origin top-left, y down. */
export type NormPoint = [number, number];
/** Corners ordered TL, TR, BR, BL relative to the physical frame. */
export type Corners = [NormPoint, NormPoint, NormPoint, NormPoint];

export interface Inset {
  top: number;
  right: number;
  bottom: number;
  left: number;
}

export interface FrameConfig {
  id: string;
  corners: Corners;
  /** Physical width ÷ height. */
  physicalAspect: number;
  debugColor: string;
  /** Caption Y offset: gap below the bottom edge, in frame widths (bottom-edge length in wall space). */
  captionSpacing: number;
  /** Caption X offset: shift of the captions' left edge from the BL corner along the bottom edge, in frame widths. */
  captionOffsetX: number;
  /** Frame-local units. */
  inset: Inset;
}

export interface WallQuadConfig {
  corners: Corners;
  debugColor: string;
}

export interface DebugStyle {
  strokeWidth: number;
  pointRadius: number;
  crosshairSize: number;
}

export interface AnimationConfig {
  cycleDuration: number;
  transitionInDuration: number;
  transitionOutDuration: number;
  /** Seconds a frame stays black between artworks. */
  transitionDelay: number;
  /** Edge width of the noise dissolve-in, in noise units (higher = softer). */
  dissolveSoftness: number;
  /** Size of the dissolve's noise blobs; 1 = about five blobs across a frame, higher = larger. */
  dissolveNoiseScale: number;
  frameStagger: number;
  zoomStart: number;
  panSpeed: number;
  panAspectThreshold: number;
  maxHoldDuration: number;
}

export interface CaptionConfig {
  titleSize: number;
  lineTwoSize: number;
  lineGap: number;
  color: string;
  fadeDuration: number;
  riseDistance: number;
  lineTwoDelay: number;
}

export type EffectParamValue = number | string | boolean;

export interface EffectLayerConfig {
  type: string;
  params: Record<string, EffectParamValue>;
}

export type PanelSide = 'left' | 'right';

export interface Config {
  schemaVersion: number;
  assetManifests: string[];
  ui: { panelSide: PanelSide };
  global: {
    backgroundColor: string;
    debug: DebugStyle;
  };
  wallQuad: WallQuadConfig;
  frames: FrameConfig[];
  animation: AnimationConfig;
  captions: CaptionConfig;
  effects: { back: EffectLayerConfig; front: EffectLayerConfig };
}

export interface AssetEntry {
  title?: string;
  artist?: string;
  year?: string;
  filepath: string;
  zoom?: boolean;
  pan?: boolean;
}

export interface AssetManifest {
  schemaVersion: number;
  assets: AssetEntry[];
}

/**
 * In-memory form of a loaded manifest. Serialized back to the AssetManifest shape on
 * Save; `uid`s are runtime-only identities.
 */
export interface AssetRecord {
  uid: string;
  entry: AssetEntry;
  /** Known keys present in the file, so optional keys keep their presence on save. */
  present: string[];
  /** Unknown fields, preserved on save. */
  extra: Record<string, unknown>;
}

export interface ManifestRecord {
  /** Relative to the project folder root. */
  path: string;
  assets: AssetRecord[];
  /** Missing/invalid manifest; such manifests are never saved. */
  error: string | null;
  warnings: string[];
  dirty: boolean;
  extra: Record<string, unknown>;
}

/** Identifies a quad: a frame id, or the wall quad. */
export type QuadId = string;
export const WALL_QUAD_ID: QuadId = '__wall__';
