/** Persisted data schemas. Bump the schemaVersion and add a migration on any breaking change. */

export const CONFIG_SCHEMA_VERSION = 3;
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

/**
 * How a frame's content combines with what's behind it. 'add' adds light, so black is
 * transparent. 'alpha' (choreographed frames only) covers by the asset's own transparency.
 */
export type BlendMode = 'normal' | 'add' | 'alpha';
export const BLEND_MODES: readonly BlendMode[] = ['normal', 'add', 'alpha'];
/** The blend modes a show's mapped frames (Randomized mode) can use. */
export const FRAME_BLEND_MODES: readonly BlendMode[] = ['normal', 'add'];

export interface FrameConfig {
  id: string;
  /** User's name for the frame, shown as "Frame N: title" in the panel. */
  title: string;
  corners: Corners;
  /** Physical width ÷ height. */
  physicalAspect: number;
  debugColor: string;
  /** Caption Y offset: gap below the bottom edge, in frame widths (bottom-edge length in wall space). */
  captionSpacing: number;
  /** Caption X offset: shift of the captions' left edge from the BL corner along the bottom edge, in frame widths. */
  captionOffsetX: number;
  /** 'add': the frame adds its light to frames drawn before it, so its black is see-through. 'normal' or 'add' only. */
  blend: BlendMode;
}

/** A frame inside a choreography entry: its own mapping, asset and timing. */
export interface ChoreoFrameConfig {
  /** Unique across every frame in the show (mapped and choreographed). */
  id: string;
  title: string;
  corners: Corners;
  /** Physical width ÷ height; content is cover-fit to it. */
  physicalAspect: number;
  debugColor: string;
  /** The asset it plays, or null (draws nothing). */
  asset: PlaylistItem | null;
  blend: BlendMode;
  /** Seconds after the entry starts before this frame begins. */
  delay: number;
  /** Seconds; null: a video plays its own length, an image lasts until the entry ends. */
  duration: number | null;
  /** A video starts over when it ends, until its duration or the entry's end. */
  loop: boolean;
  fadeIn: number;
  fadeInStyle: TransitionInStyle;
  /** Seconds, ending at the frame's end. */
  fadeOut: number;
  /** 0..1 */
  opacity: number;
}

/** One scene of a choreographed show. */
export interface EntryConfig {
  id: string;
  name: string;
  /** Off: the sequence skips it (Preview still plays it). */
  enabled: boolean;
  /** Seconds the entry lasts; null: until its last frame finishes. */
  holdTime: number | null;
  /** Seconds of crossfade into this entry; null: the choreography's crossfade. */
  fadeTime: number | null;
  /** Draw order: later frames draw on top. */
  frames: ChoreoFrameConfig[];
}

export interface ChoreographyConfig {
  /** Default seconds of crossfade into each entry. */
  crossfade: number;
  /** Play order; the list loops. */
  entries: EntryConfig[];
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

/**
 * randomized: every playable asset is shuffled across the mapped frames. choreographed: the
 * choreography's entries play in order, each with its own frames.
 */
export type ShowType = 'randomized' | 'choreographed';
export const SHOW_TYPES: readonly ShowType[] = ['randomized', 'choreographed'];

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
  /** Mapped frames, used by Randomized mode. */
  frames: FrameConfig[];
  /** Used by Choreographed mode. */
  choreography: ChoreographyConfig;
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
