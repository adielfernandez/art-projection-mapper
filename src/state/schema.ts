/** Persisted data schemas. Bump the schemaVersion and add a migration on any breaking change. */

export const CONFIG_SCHEMA_VERSION = 2;
export const POOL_SCHEMA_VERSION = 1;

/** Canvas-normalized point: [0,1]², origin top-left, y down. */
export type NormPoint = [number, number];
/** Corners ordered TL, TR, BR, BL relative to the physical frame. */
export type Corners = [NormPoint, NormPoint, NormPoint, NormPoint];


/** A playlist entry: an asset identified by its pool (project-relative path) and filepath. */
export interface PlaylistItem {
  pool: string;
  filepath: string;
}

/** How a frame's content combines with what's behind it. 'add' adds light, so black is transparent. */
export type BlendMode = 'normal' | 'add';
export const BLEND_MODES: readonly BlendMode[] = ['normal', 'add'];

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
  /** Manual show: assets this frame plays, in order. Ignored in randomized shows. */
  playlist: PlaylistItem[];
  /** 'add': the frame adds its light to frames drawn before it, so its black is see-through. */
  blend: BlendMode;
}

export interface WallQuadConfig {
  corners: Corners;
  debugColor: string;
  /** Wallpaper: assets the wall plays behind the frames, in order, in either show type. */
  playlist: PlaylistItem[];
}

export interface DebugStyle {
  strokeWidth: number;
  pointRadius: number;
  crosshairSize: number;
}

/** How a new artwork appears: the whole frame fades up, or it appears through a noise dissolve. */
export type TransitionInStyle = 'fade' | 'noise';
export const TRANSITION_IN_STYLES: readonly TransitionInStyle[] = ['fade', 'noise'];

export interface AnimationConfig {
  transitionInStyle: TransitionInStyle;
  cycleDuration: number;
  transitionInDuration: number;
  transitionOutDuration: number;
  /** Seconds a frame stays black between artworks. */
  transitionDelay: number;
  /** Noise dissolve only: edge width, in noise units (higher = softer). */
  dissolveSoftness: number;
  /** Noise dissolve only: blob size; 1 = about five blobs across a frame, higher = larger. */
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

export type PanelSide = 'left' | 'right';

/** randomized: every playable asset is shuffled across frames. manual: each frame plays its own playlist. */
export type ShowType = 'randomized' | 'manual';
export const SHOW_TYPES: readonly ShowType[] = ['randomized', 'manual'];

export interface Config {
  schemaVersion: number;
  assetPools: string[];
  showType: ShowType;
  ui: { panelSide: PanelSide };
  global: {
    backgroundColor: string;
    debug: DebugStyle;
  };
  wallQuad: WallQuadConfig;
  frames: FrameConfig[];
  animation: AnimationConfig;
  captions: CaptionConfig;
}

export interface AssetEntry {
  title?: string;
  artist?: string;
  year?: string;
  filepath: string;
  zoom?: boolean;
  pan?: boolean;
  /** Only the wall's wallpaper playlist may use this asset; frames skip it in both show types. */
  wallOnly?: boolean;
}

export interface AssetPoolFile {
  schemaVersion: number;
  assets: AssetEntry[];
}

/**
 * In-memory form of a loaded pool. Serialized back to the AssetPoolFile shape on
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

export interface PoolRecord {
  /** Relative to the project folder root. */
  path: string;
  assets: AssetRecord[];
  /** Missing/invalid pool; such pools are never saved. */
  error: string | null;
  warnings: string[];
  dirty: boolean;
  extra: Record<string, unknown>;
}

/** Identifies a quad: a frame id, or the wall quad. */
export type QuadId = string;
export const WALL_QUAD_ID: QuadId = '__wall__';
