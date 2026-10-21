import * as THREE from 'three';
import type { DecodeRequest, DecodeResponse } from './decodeWorker';
import type { MediaKind } from './assetPool';

/** Max image resolution relative to its on-screen cover size. */
const IMAGE_DENSITY = 2;
const VIDEO_TIMEOUT_MS = 30_000;

export interface LoadedMedia {
  kind: MediaKind;
  texture: THREE.Texture;
  /** Width ÷ height of the source. */
  aspect: number;
  /** ImageBitmap textures are not flipped on upload, so v must be inverted when sampling. */
  invertV: boolean;
  video?: HTMLVideoElement;
  /** Seconds; videos only. */
  duration?: number;
  dispose(): void;
}

export interface ImageSizing {
  frameW: number;
  frameH: number;
  zoom: number;
  maxTextureSize: number;
}

// ---------- image decoding (worker) ----------

let worker: Worker | null = null;
let nextId = 0;
const pending = new Map<number, (r: DecodeResponse) => void>();

function decoder(): Worker {
  if (!worker) {
    worker = new Worker(new URL('./decodeWorker.ts', import.meta.url), { type: 'module' });
    worker.onmessage = (e: MessageEvent<DecodeResponse>) => {
      pending.get(e.data.id)?.(e.data);
      pending.delete(e.data.id);
    };
  }
  return worker;
}

/** Decode and downscale an image off the main thread. */
export function decodeImage(blob: Blob, sizing: ImageSizing, density = IMAGE_DENSITY): Promise<ImageBitmap> {
  return new Promise((resolve, reject) => {
    const id = ++nextId;
    pending.set(id, (r) => (r.ok ? resolve(r.bitmap) : reject(new Error(r.error))));
    const req: DecodeRequest = {
      id,
      blob,
      frameW: sizing.frameW,
      frameH: sizing.frameH,
      zoom: sizing.zoom,
      density,
      maxTextureSize: sizing.maxTextureSize,
    };
    decoder().postMessage(req);
  });
}

export async function loadImage(file: File, sizing: ImageSizing, maxAnisotropy: number): Promise<LoadedMedia> {
  const bitmap = await decodeImage(file, sizing);
  const texture = new THREE.Texture(bitmap);
  texture.flipY = false; // ignored by WebGL for ImageBitmap; the shader inverts v instead
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.generateMipmaps = true;
  texture.minFilter = THREE.LinearMipmapLinearFilter;
  texture.magFilter = THREE.LinearFilter;
  texture.anisotropy = maxAnisotropy;
  texture.needsUpdate = true;
  return {
    kind: 'image',
    texture,
    aspect: bitmap.width / bitmap.height,
    invertV: true,
    dispose() {
      texture.dispose();
      bitmap.close();
    },
  };
}

// ---------- video ----------

export function loadVideo(file: File): Promise<LoadedMedia> {
  const url = URL.createObjectURL(file);
  const video = document.createElement('video');
  video.muted = true;
  video.playsInline = true;
  video.preload = 'auto';
  video.crossOrigin = 'anonymous';

  const release = () => {
    video.pause();
    video.removeAttribute('src');
    video.load();
    URL.revokeObjectURL(url);
  };

  return new Promise<LoadedMedia>((resolve, reject) => {
    const timer = window.setTimeout(() => fail('Timed out waiting for the video to buffer.'), VIDEO_TIMEOUT_MS);
    const cleanup = () => {
      window.clearTimeout(timer);
      video.removeEventListener('canplaythrough', onReady);
      video.removeEventListener('error', onError);
    };
    const fail = (msg: string) => {
      cleanup();
      release();
      reject(new Error(msg));
    };
    const onError = () => {
      const code = video.error?.code;
      fail(code === MediaError.MEDIA_ERR_SRC_NOT_SUPPORTED ? 'Video format or codec not supported.' : `Video failed to load (${video.error?.message || code}).`);
    };
    const onReady = () => {
      cleanup();
      const texture = new THREE.VideoTexture(video);
      texture.colorSpace = THREE.SRGBColorSpace;
      // Mipmaps (rebuilt each video frame) keep downscaled video smooth instead of aliased.
      texture.minFilter = THREE.LinearMipmapLinearFilter;
      texture.magFilter = THREE.LinearFilter;
      texture.generateMipmaps = true;
      resolve({
        kind: 'video',
        texture,
        aspect: video.videoWidth / video.videoHeight || 16 / 9,
        invertV: false,
        video,
        duration: video.duration,
        dispose() {
          texture.dispose();
          release();
        },
      });
    };
    video.addEventListener('canplaythrough', onReady);
    video.addEventListener('error', onError);
    video.src = url;
    video.load();
  });
}

// ---------- thumbnails ----------

/** Small preview for the panel: an image thumbnail or a video poster frame. */
export async function makeThumbnail(file: File, kind: MediaKind, height: number): Promise<HTMLCanvasElement> {
  const canvas = document.createElement('canvas');
  const draw = (src: CanvasImageSource, w: number, h: number) => {
    canvas.height = height;
    canvas.width = Math.max(1, Math.round((w / h) * height));
    canvas.getContext('2d')!.drawImage(src, 0, 0, canvas.width, canvas.height);
  };
  if (kind === 'image') {
    const bmp = await decodeImage(file, { frameW: height, frameH: height, zoom: 1, maxTextureSize: 4096 }, 1);
    draw(bmp, bmp.width, bmp.height);
    bmp.close();
    return canvas;
  }
  const url = URL.createObjectURL(file);
  const video = document.createElement('video');
  video.muted = true;
  video.preload = 'auto';
  try {
    await new Promise<void>((resolve, reject) => {
      video.addEventListener('loadeddata', () => {
        video.currentTime = Math.min(0.5, (video.duration || 1) / 10);
      }, { once: true });
      video.addEventListener('seeked', () => resolve(), { once: true });
      video.addEventListener('error', () => reject(new Error('Video failed to load.')), { once: true });
      video.src = url;
    });
    // `seeked` can fire before the frame is decoded; wait for it to be presented (bounded).
    await new Promise<void>((resolve) => {
      const timer = window.setTimeout(resolve, 500);
      video.requestVideoFrameCallback(() => {
        window.clearTimeout(timer);
        resolve();
      });
    });
    draw(video, video.videoWidth, video.videoHeight);
    return canvas;
  } finally {
    video.removeAttribute('src');
    video.load();
    URL.revokeObjectURL(url);
  }
}
