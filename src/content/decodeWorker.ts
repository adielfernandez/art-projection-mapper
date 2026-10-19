/// <reference lib="webworker" />
/**
 * Image decode + downscale off the main thread. Receives a Blob, returns an
 * ImageBitmap (transferred) no larger than requested.
 */

export interface DecodeRequest {
  id: number;
  blob: Blob;
  /** Frame size on screen, device px. The result keeps ≤ `density`× that resolution at cover fit. */
  frameW: number;
  frameH: number;
  /** Extra magnification to budget for (e.g. zoomStart). */
  zoom: number;
  density: number;
  maxTextureSize: number;
}

export type DecodeResponse =
  | { id: number; ok: true; bitmap: ImageBitmap; sourceW: number; sourceH: number }
  | { id: number; ok: false; error: string };

const ctx = self as unknown as DedicatedWorkerGlobalScope;

ctx.onmessage = async (e: MessageEvent<DecodeRequest>) => {
  const { id, blob, frameW, frameH, zoom, density, maxTextureSize } = e.data;
  try {
    const full = await createImageBitmap(blob, { imageOrientation: 'from-image' });
    const w = full.width;
    const h = full.height;
    // Scale at which the image exactly covers the frame on screen.
    const cover = Math.max(frameW / w, frameH / h);
    let s = Math.min(1, density * cover * zoom, maxTextureSize / Math.max(w, h));
    let bitmap = full;
    if (s < 0.999) {
      s = Math.max(s, 1 / Math.max(w, h));
      bitmap = await createImageBitmap(full, {
        resizeWidth: Math.max(1, Math.round(w * s)),
        resizeHeight: Math.max(1, Math.round(h * s)),
        resizeQuality: 'high',
      });
      full.close();
    }
    const res: DecodeResponse = { id, ok: true, bitmap, sourceW: w, sourceH: h };
    ctx.postMessage(res, [bitmap]);
  } catch (err) {
    const res: DecodeResponse = { id, ok: false, error: err instanceof Error ? err.message : 'Could not decode image.' };
    ctx.postMessage(res);
  }
};
