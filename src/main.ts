import './style.css';
import { Scheduler } from './content/scheduler';
import { ProjectController } from './io/projectController';
import { DebugOverlay } from './render/debugOverlay';
import { Renderer } from './render/renderer';
import { defaultConfig } from './state/defaults';
import { Store } from './state/store';
import { attachHotkeys } from './ui/hotkeys';
import { Panel } from './ui/panel';
import { attachPointerMapping } from './ui/pointerMapping';

const MAX_DT = 0.1; // seconds; clamp so a stall doesn't cause animation jumps

const stage = document.getElementById('stage') as HTMLDivElement;
const glCanvas = document.getElementById('gl') as HTMLCanvasElement;
const overlayCanvas = document.getElementById('overlay') as HTMLCanvasElement;

const dpr = window.devicePixelRatio;
const viewport = { w: Math.round(window.innerWidth * dpr), h: Math.round(window.innerHeight * dpr) };
const store = new Store(defaultConfig(viewport.w / viewport.h), viewport);
const renderer = new Renderer(glCanvas, store);
const overlay = new DebugOverlay(overlayCanvas, store);
const project = new ProjectController(store);
const scheduler = new Scheduler(store, {
  getMediaFile: (manifestPath, filepath) => project.getMediaFile(manifestPath, filepath),
  prepareTexture: (tex) => renderer.prepareTexture(tex),
  maxTextureSize: renderer.gl.capabilities.maxTextureSize,
  maxAnisotropy: renderer.gl.capabilities.getMaxAnisotropy(),
});
renderer.setVisualSource((id, aspect) => scheduler.visual(id, aspect));
renderer.setCaptionSource((id) => scheduler.captionState(id));
const panel = new Panel(store, project, scheduler);
document.body.append(panel.el);

attachPointerMapping(stage, glCanvas, store);
attachHotkeys(store, { togglePanel: () => store.setPanelOpen(!store.runtime.panelOpen) });

// Dev builds only: handle for debugging and automated checks from the console.
if (import.meta.env.DEV) Object.assign(window, { __app: { store, project, scheduler, renderer } });

// Start with the panel open so Load / Reopen are visible.
store.setPanelOpen(true);
void project.init();

// Cursor: hidden over the canvas unless the panel is open or debug visuals are shown.
const syncCursor = () => {
  const show = store.runtime.panelOpen || store.runtime.debugVisible;
  stage.style.cursor = show ? 'crosshair' : 'none';
};
store.subscribe(syncCursor);
syncCursor();

// Unsaved-changes guard. Nothing is ever written automatically.
window.addEventListener('beforeunload', (e) => {
  if (store.runtime.configDirty || store.runtime.assetsDirty) {
    e.preventDefault();
    e.returnValue = '';
  }
});

const onResize = () => {
  renderer.resize();
  overlay.invalidate();
};
window.addEventListener('resize', onResize);
// devicePixelRatio changes (e.g. moving the window to the 4K projector) don't always fire resize.
const watchDpr = () => {
  matchMedia(`(resolution: ${window.devicePixelRatio}dppx)`).addEventListener(
    'change',
    () => {
      onResize();
      watchDpr();
    },
    { once: true },
  );
};
watchDpr();

let last = performance.now();
const loop = (now: number) => {
  const dt = Math.min((now - last) / 1000, MAX_DT);
  last = now;
  scheduler.update(dt);
  renderer.render();
  overlay.update();
  requestAnimationFrame(loop);
};
requestAnimationFrame(loop);
