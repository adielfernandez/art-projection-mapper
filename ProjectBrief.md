# Art Projector: Project Brief

## 1. Overview

Art Projector is a browser-based projection mapping app. A projector displays a full-screen Chrome window (16:9) onto a wall holding physical picture frames in portrait orientation. The app warps artworks (images and videos) onto each frame, cycles them randomly from one or more asset pools, shows optional captions on the wall below each frame, and plays ambient animations across the whole projected area when new artwork appears.

The highest priority is mapping precision and mapping UX. The user must be able to align each frame's projected content tightly to a physical rectangle.

Target: desktop Chrome, full screen, FHD or 4K output. No mobile or responsive layout work beyond scaling the panel UI to stay readable at both resolutions.

---

## 2. Tech Stack

| Layer | Choice | Notes |
|---|---|---|
| Build | Vite | Dev server and production build. App served from `localhost`. |
| Language | TypeScript, `strict: true` | Config and manifest schemas are typed. |
| Rendering | Three.js, `WebGLRenderer` (WebGL2) | Pin an exact version in `package.json`. Do not use WebGPURenderer. |
| UI panel | Vanilla DOM + CSS | Native `<details>/<summary>`, `<input type="color">`, `<input type="number">`, `<input type="range">`, checkboxes. No UI framework, no GUI library. |
| Captions | Canvas2D rendered into a Three.js texture | No text library. |
| Fonts | Source Serif 4 (titles, italic) and Public Sans (second line), self-hosted | Via Fontsource npm packages or WOFF2 files in `/public/fonts`. No runtime CDN requests. |
| Tests | Vitest | Required for homography math and asset selection logic. |
| File I/O | File System Access API | `showDirectoryPicker`, file handles, `createWritable`. Chrome only, which is acceptable. |

Approved dependencies are exactly: `three`, `@types/three`, `vite`, `typescript`, `vitest`, and the two Fontsource packages. Adding anything else requires asking the user first.

---

## 3. Architecture

### 3.1 State

- One serializable **project state** object is the single source of truth. Saving the config means serializing the config portion of this state, and saving assets means serializing the manifest portion.
- **Runtime-only state** is kept separate and never saved. It includes:
  - the selected control point
  - debug visibility
  - per-quad test pattern toggles
  - panel open/closed
  - dirty flags
  - playback state
- All mutations go through store actions. The renderer and the panel subscribe to the store; neither mutates state directly.
- There are two dirty flags, one for the config and one for the asset manifests. Each is cleared only by its own Save.
- **No autosave.** Nothing is written to disk except by an explicit Save button press.

### 3.2 Coordinate spaces

| Space | Definition | Used for |
|---|---|---|
| Canvas-normalized | `[0,1] × [0,1]`, origin top-left, y down | Storage of all control points in config. Resolution independent. |
| Device pixels | Canvas-normalized × canvas size in device pixels (CSS px × `devicePixelRatio`) | Panel numeric display, nudging, hit testing. |
| Frame-local | Origin bottom-left, x right, y up. Width = 1, height = `1 / physicalAspect` | Artwork, test pattern. One per frame. |
| Wall-local | Origin bottom-left, x right, y up. Width = 1, height = 1 / canvas aspect | Ambient effects (both layers), captions, wall test pattern. |

### 3.3 Warping: homography (not bilinear)

Each quad (every frame plus the wall quad) maps its local rectangle to its four control points with a **homography**, a 3×3 projective transform. This is the geometrically correct mapping for a flat surface lit by a projector.

**Computing it.** Solve for H from the four corner correspondences, local rectangle corners to quad corners in NDC (normalized device coordinates, the GPU's -1 to 1 screen space).
- Convert canvas-normalized (x, y) to NDC as `x_ndc = 2x - 1`, `y_ndc = 1 - 2y`.
- Use the closed-form square-to-quad solution (Heckbert 1989) or an 8×8 linear solve. Either is fine.

**Applying it.** Embed H in a 4×4 matrix and use it directly as the projection matrix of a plain `THREE.Camera` (not `PerspectiveCamera`). This makes the GPU perform the perspective divide, which gives perspective-correct texture interpolation with no render-to-texture pass. Three.js `Matrix4.set` takes row-major arguments:
  ```
  [ h11 h12 0 h13 ]
  [ h21 h22 0 h23 ]
  [  0   0  0  0  ]   // clip z = 0, all content is planar
  [ h31 h32 0 h33 ]
  ```
- Set `camera.projectionMatrixInverse` alongside the projection matrix.
- Never call `updateProjectionMatrix()` on these cameras.
- Set `frustumCulled = false` on every mesh drawn with a homography camera, because Three.js frustum culling assumes a standard projection.
- Depth test and depth write are off. Draw order is controlled explicitly.

**Recomputing.** Recompute H only when that quad's control points change.

**Required unit tests** (Vitest):
- The four local corners map to the four control points within 1e-9.
- The local center maps to the intersection of the quad's diagonals.
- The identity quad yields the identity transform.
- Inverting H and applying it round-trips points.

**Convexity check.** If a quad becomes non-convex or degenerate, which can happen by dragging a point past an edge, show a warning in that frame's panel section and keep the last valid H.

### 3.4 Render order (per animation frame)

1. Clear to the configured background color (default black).
2. **Back effect layer**, drawn in wall space.
3. **Frames**, each drawn in frame space with its own homography camera: artwork, transition mask, per-edge inset masking, and the test pattern when enabled.
4. **Captions**, drawn in wall space.
5. **Front effect layer**, drawn in wall space.
6. **Debug overlay**, drawn in screen space on a separate 2D canvas layered above the WebGL canvas, sized to device pixels.

Renderer setup:
- `antialias: true`
- `autoClear: false`
- pixel ratio = `devicePixelRatio`
- `outputColorSpace = SRGBColorSpace`, and every image and video texture uses `colorSpace = SRGBColorSpace`. Without this, images render washed out.

The main loop uses `requestAnimationFrame`. Clamp delta time (for example to a 100 ms maximum) so a stall does not cause animation jumps. Do not drive animation timing with `setTimeout`.

Performance target: steady 60 fps at 4K output with two frames, one playing video, and active effects.

---

## 4. Data Schemas

Bump `schemaVersion` on any breaking change and write a migration function. Ask the user before changing either schema.

### 4.1 Project folder

The user opens a **project folder** with `showDirectoryPicker`. All reads and writes go through that folder's directory handle.

- The config is always `config.json` at the folder root.
- Asset manifests are referenced from the config by paths relative to the folder root.
- Media `filepath` values are relative to the location of the manifest file that lists them.
- Media is loaded via `fileHandle.getFile()` and `URL.createObjectURL()`. Revoke object URLs when the media is released.
- There is no "Save As". The user duplicates and renames project folders manually.

### 4.2 `config.json`

```json
{
  "schemaVersion": 1,
  "assetManifests": ["pools/paintings.json", "pools/videos.json"],
  "ui": {
    "panelSide": "left"
  },
  "global": {
    "backgroundColor": "#000000",
    "debug": {
      "strokeWidth": 2,
      "pointRadius": 14,
      "crosshairSize": 22
    }
  },
  "wallQuad": {
    "corners": [[0, 0], [1, 0], [1, 1], [0, 1]],
    "debugColor": "#0A84FF"
  },
  "frames": [
    {
      "id": "f_8k2j1",
      "corners": [[0.20, 0.15], [0.38, 0.15], [0.38, 0.75], [0.20, 0.75]],
      "physicalAspect": 0.6571,
      "debugColor": "#FF453A",
      "captionSpacing": 0.05,
      "captionOffsetX": 0,
      "inset": { "top": 0, "right": 0, "bottom": 0, "left": 0 }
    }
  ],
  "animation": {
    "cycleDuration": 12,
    "transitionInDuration": 1.5,
    "transitionOutDuration": 1.0,
    "frameStagger": 3,
    "zoomStart": 1.15,
    "panSpeed": 0.03,
    "panAspectThreshold": 1.15,
    "maxHoldDuration": 30
  },
  "captions": {
    "titleSize": 0.045,
    "lineTwoSize": 0.032,
    "lineGap": 0.012,
    "color": "#F0EBE3",
    "fadeDuration": 1.2,
    "riseDistance": 0.02,
    "lineTwoDelay": 0.5
  },
  "effects": {
    "back": { "type": "placeholder", "params": {} },
    "front": { "type": "placeholder", "params": {} }
  }
}
```

Field notes:
- **`corners`** are in canvas-normalized coordinates, ordered TL, TR, BR, BL relative to the physical frame.
- **`physicalAspect`** is the physical width ÷ height. The default is `0.6571` (23″ × 35″).
- **`captionSpacing` (panel: "Caption Y offset"), `captionOffsetX` (panel: "Caption X offset"; may be negative), `titleSize`, `lineTwoSize`, `lineGap` and `riseDistance`** are in units of the frame's bottom-edge length measured in wall space (one "frame width").
- **`inset`** values are in frame-local units. They shrink the visible artwork area inward from each edge to hide light spill onto the frame molding. The inset band renders black.
- **`panSpeed`** is in frame widths per second.
- **Durations** are in seconds.
- **`id`** is generated once and never reused. Displayed frame numbers are list positions and may renumber after a removal; ids and settings never shift.
- **Starting values.** All numeric defaults above are starting values to tune on site.
- **Distinct default colors.** New frames get a default debug color distinct from existing frames.

**Default project** (no `config.json` in the folder, or no folder opened yet): two frames side by side, centered vertically, each about 50% of canvas height, with corners shaped by `physicalAspect`. `config.json` is created on the first Save.

### 4.3 Asset manifest

```json
{
  "schemaVersion": 1,
  "assets": [
    {
      "title": "The Starry Night",
      "artist": "Vincent van Gogh",
      "year": "1889",
      "filepath": "media/starry-night.jpg",
      "zoom": true,
      "pan": false
    }
  ]
}
```

- `title`, `artist` and `year` are optional. A missing value or empty string means no data.
- `filepath` is required. Media type is inferred from the extension:
  - image: `.jpg .jpeg .png .webp .avif`
  - video: `.mp4 .webm`
  - an unknown extension is treated as an asset error
- `zoom` and `pan` are optional booleans and default to `false`.
- Duplicate assets, the same file in multiple manifests or listed twice, are treated as separate assets. They may appear on screen at the same time.
- Recommend H.264 MP4 or VP9/AV1 WebM to the user in the README. HEVC support in Chrome depends on hardware.

---

## 5. Features

### 5.1 Startup and file I/O

- **On launch with a stored folder handle:** the app keeps the last project folder's directory handle in IndexedDB. This is a pointer only, not saved state. If one exists, show a "Reopen project: <folder name>" button. Chrome requires a user gesture to re-grant permission. On grant, load `config.json` and all manifests from disk.
- **On launch without a handle:** show the default project and an "Open project folder" button.
- **Panel Config section:**
  - **Load** opens a project folder.
  - **Save** writes `config.json`.
- **Panel Asset section:** has its own **Save**, which overwrites every modified manifest file.
- **Unsaved changes:**
  - An indicator in the panel header for each of config and assets.
  - A `beforeunload` confirmation when either is dirty.
- **Errors:**
  - A missing or invalid manifest shows an error in the Asset section, and the app continues with the remaining manifests.
  - Media that fails to load is flagged on that asset in the panel and skipped by the scheduler.

### 5.2 Mapping

**Quads.** Each frame and the wall quad has four independently movable control points. The wall quad defaults to the canvas corners. The same mapping code and UX applies to all quads.

**Mouse:**
- Press near a control point (within hit radius) to select and drag it. Dragging a point moves only that point.
- Press inside a frame (away from its points) and drag to move the whole frame; its four points keep their relative positions in screen space. Movement starts after a 4 px dead zone, so a click never moves it. The topmost frame wins where frames overlap; the wall quad is never dragged by its body. Selection is unchanged.
- Shift while dragging scales motion to 10% for fine placement.
- All drags are clamped to the viewport. A whole-frame drag stops flush when any corner reaches an edge, and still slides along that edge.
- The selected point renders highlighted.

**Keyboard nudging** (applies to the selected point):

| Key | Movement |
|---|---|
| Arrow | 1 device pixel |
| Shift + Arrow | 10 px |
| Alt + Arrow | 0.1 px |

**Point selection:** Tab cycles forward through all control points (frames in order, then the wall quad). Shift+Tab cycles backward. Esc deselects.

**Undo/redo:**
- Ctrl/Cmd+Z undoes and Ctrl/Cmd+Shift+Z redoes mapping edits.
- One drag is one undo step.
- A burst of nudges on the same point with no gap over 500 ms is one undo step.

**Panel numeric inputs:** per control point, show X and Y in device pixels with step 0.1. They convert to and from normalized storage.

**Debug visuals** (per quad, in that quad's color):
- a circle with crosshair at each control point
- lines connecting the points in order
- the frame number near the TL corner
- stroke width, point radius and crosshair size come from `global.debug`

**Debug visibility rules:**
- Visible when the panel is open.
- Hidden when the panel closes.
- The `D` key toggles debug visuals on or off regardless of panel state.

**Test pattern:**
- Toggled per frame (and for the wall quad) inside that quad's panel section. Runtime only, not saved.
- Rendered through the homography. It consists of:
  - a square grid that is uniform in physical units (it uses `physicalAspect`, so cells are physically square)
  - a checkerboard
  - a center crosshair
  - a 1-unit border on the frame edge
- On the wall, straight evenly spaced grid lines confirm the mapping.

**Adding and removing frames:**
- "Add new frame" creates a frame centered on the canvas at the default size, with the next number and a new color.
- "Remove" in a frame's section header deletes it immediately. It is undoable via the config dirty flag only; no confirmation dialog.

### 5.3 Content selection

**Pool.** The pool is the concatenation of all assets from all manifests, minus assets that failed to load.

**Mode is determined by pool size vs. frame count:**
- **Pool < frames.** Static mode. Assign assets to frames in list order and wrap around. Example: assets A, B with three frames gives A, B, A.
- **Pool = frames.** Static mode. Asset *i* goes to frame *i*.
- **Pool > frames.** Cycling mode.

**Static mode:**
- No cycling and no in/out transitions.
- Captions display without animation.
- Videos loop.
- Images display at cover fit with no zoom or pan.

**Cycling mode** uses a shared shuffle bag across all frames:
- When choosing the next asset for a frame, exclude assets currently displayed or being loaded by any frame. The exclusion compares asset entries, not file paths.
- When the bag empties, reshuffle. Ensure the first draw of the new bag differs from the last draw of the previous bag.

**Recompute** mode and assignments when frames are added or removed, or when manifests change.

Selection logic gets Vitest coverage:
- no simultaneous duplicates when pool > frames
- no back-to-back repeat across a reshuffle
- correct static assignments

### 5.4 Per-frame playback cycle (cycling mode)

**States:** `loading → in → hold → out → loading …`

**Stagger.** Frame *n*'s first cycle starts `n × frameStagger` seconds after startup, so frames never transition in unison.

**Preloading.** Begin loading the next asset when the current asset's hold begins.

**Images:**
- Decode with `createImageBitmap`, downscaled so the longest side is at most 2× the frame's on-screen size in device pixels, and never above `renderer.capabilities.maxTextureSize`.
- Decoding happens off the main thread. Do not decode on the main thread at transition time.

**Videos:**
- Use a `<video>` element with `muted`, `playsInline` and `preload="auto"`. Wait for `canplaythrough`.
- Render with `THREE.VideoTexture`.
- Pause, unload and dispose after the out-transition.

**Transitions:**
- **Out:** dissolve to black over `transitionOutDuration`.
- **In:** dissolve from black over `transitionInDuration` using a noise mask: a procedural noise threshold in the fragment shader, not a texture.
- Avoid a direct crossfade between artworks.
- **Effect trigger:** the start of each in-transition triggers both ambient effect layers for that frame (section 5.6).

**Fit.** All content uses **cover** fit to the frame (frame aspect = `physicalAspect`), applied as a UV transform, then masked by `inset`.

**Motion and hold duration** are measured from the end of the in-transition. Rules are evaluated in this order:

1. **Video.** Cover fit, no zoom or pan.
   - Duration ≥ `cycleDuration`: play once, `loop = false`, and start the out-transition on `ended`.
   - Duration < `cycleDuration`: `loop = true`, and start the out-transition when `cycleDuration` elapses, cutting mid-loop.
   - `maxHoldDuration` does not apply to video.
2. **Image with `pan = true` and an aspect mismatch beyond `panAspectThreshold`.** Let `r = assetAspect / frameAspect`.
   - **Direction:**
     - `r > threshold`: pan horizontally.
     - `1/r > threshold`: pan vertically.
     - Start side is random.
   - **Travel:** from one edge of the cover-fit overflow to the other.
   - **Hold:** `travel / panSpeed`, where travel is in frame widths. If that exceeds `maxHoldDuration`, hold = `maxHoldDuration` and speed increases to fit.
   - **Zoom** is ignored.
   - **Velocity:** near-constant, with short eased start and stop (ease-in/out over the first and last 10% of the motion).
3. **Image with `zoom = true`** (including `pan = true` images that did not exceed the threshold).
   - Scale goes from `zoomStart` down to 1.0 (cover) over the motion window (below).
   - Zoom is centered.
   - Velocity profile is the same as for pan.
4. **Image with neither.** Static cover for `cycleDuration`.

**Motion window.** Pan and zoom run from the start of the in-transition to the end of the out-transition (`transitionInDuration + hold + transitionOutDuration`), so motion never visibly starts or stops. The hold durations above are unchanged; the same travel or zoom is spread over the longer window, so the actual speed is slightly below `panSpeed`. Both transition durations are fixed when the in-transition starts.

**Edits during playback.** Changes to timing parameters apply from the next cycle. Changes to the playing asset's fields apply at its next appearance.

### 5.5 Captions

**When shown.** Render only when the asset has text data.
- **Line 1:** `title` in Source Serif 4 Italic, with no quotation marks.
- **Line 2:**
  - `artist, year` in Public Sans Regular.
  - If only one of the two exists, render it alone with no comma.
  - If neither exists, omit line 2.
- **Line 1 missing but line 2 data exists:** render line 2 alone in line 1's position.

**Placement** is in wall space, per frame:
- Take the frame's bottom edge (BL→BR) and transform both points to wall-local coordinates via the wall quad's inverse homography.
- Offset perpendicular to the edge, away from the frame, by `captionSpacing` (per frame).
- Rotate the caption to match the bottom edge's angle.
- Left-align the text. Its left edge sits at the BL corner, shifted along the edge by `captionOffsetX` (per frame; negative = left).

**Sizing and wrapping:**
- Size is relative to the bottom-edge length in wall space (section 4.2 units).
- Maximum width equals the bottom-edge length.
- The title wraps to at most two lines. If it still does not fit, scale both lines down uniformly.

**Rendering:**
- Draw text with Canvas2D into a texture at the caption's on-screen size in device pixels, so it stays crisp.
- Re-render when the text, the mapping or the canvas size changes. Debounce during drags.
- Await `document.fonts.load()` for both faces before the first draw.

**Animation:**
- **In:** opacity 0→1 over `fadeDuration` with a translation of `riseDistance` toward the frame. Begins when the artwork's in-transition ends.
- **Line 2 delay:** line 2 starts `lineTwoDelay` (0.5 s) after line 1.
- **Out:** both lines fade out with the artwork's out-transition.

**Color:** `captions.color`, default warm off-white `#F0EBE3`. No drop shadows; a projector cannot render them.

### 5.6 Ambient effects framework

The effect content is TBD. Build the framework and one placeholder effect to validate it.

**Layers.** Two layers, **back** (behind frames) and **front** (above captions), both drawn in wall space across the entire projected area.

**Interface:**
  ```ts
  interface EffectContext {
    group: THREE.Group;          // attached to the layer's wall-space scene
    wallSize: { w: number; h: number };
    params: Record<string, unknown>;
  }
  interface EffectTrigger {
    frameId: string;
    frameOutlineWall: [Vec2, Vec2, Vec2, Vec2]; // frame corners in wall-local coords
    transitionInDuration: number;
  }
  interface AmbientEffect {
    init(ctx: EffectContext): void;
    trigger(t: EffectTrigger): void;   // called at start of each in-transition
    update(dt: number, time: number): void;
    dispose(): void;
  }
  interface EffectDefinition {
    type: string;
    params: ParamSpec[];  // { key, label, kind: 'number'|'color'|'boolean'|'enum', min?, max?, step?, options?, default }
    create(): AmbientEffect;
  }
  ```
- Effects are content agnostic. They receive frame geometry, never the artwork.
- `ParamSpec` drives automatic generation of panel controls in the Animation section. Enum params render as dropdowns.
- An effect registry maps a `type` string to an `EffectDefinition`. `config.effects.back` and `config.effects.front` select the type and store its params.
- **Placeholder effect:** a soft light sweep that travels outward from the triggering frame's outline on the back layer, plus a brief glint along the frame edges on the front layer. Visual quality is not critical. It exists to prove triggering, both layers, wall-space alignment and the param UI.
- **Known limit:** frame faces sit a few cm in front of the wall. Wall-space effects drawn over a frame may misregister slightly from the frame content. This is accepted.

### 5.7 Side panel

**Toggling and placement:**
- `X` toggles the panel.
- A switch at the top moves it between the left and right edges, stored in `config.ui.panelSide`.
- When open, the panel overlays the canvas and does not resize it.

**Hotkeys** (`X`, `D`, arrows, Tab, Esc, undo/redo) are ignored while focus is in a text, number or color input.

**Cursor:** hidden over the canvas when the panel is closed.

**UI scaling:**
- Root `font-size: clamp(14px, 1.3vh, 32px)`. All panel dimensions are in `rem`.
- Do not scale from `devicePixelRatio`.
- Must be readable on the projected image at both FHD and 4K.

**Sections**, each with a header and collapsible:

1. **App controls:** close button, left/right switch, unsaved-change indicators.
2. **Config:** Load (open project folder), Save. Shows the current folder name.
3. **Mapping:**
   - Global: background color, debug stroke width, point radius, crosshair size.
   - Wall quad (collapsible): 4 control points with X/Y inputs, debug color, test pattern toggle.
   - Each frame (collapsible, titled "Frame N"):
     - a Remove button right-aligned in its header
     - 4 control points with X/Y inputs
     - debug color picker
     - physical aspect (number input)
     - caption spacing (slider and number)
     - per-edge inset (4 sliders)
     - test pattern toggle
     - convexity warning when applicable
   - "Add new frame" button.
4. **Assets:**
   - Save button (overwrites modified manifests).
   - Nested list grouped by manifest file.
   - Each asset is collapsible, with a small preview thumbnail (or video poster) and editable fields:
     - text inputs for `title`, `artist`, `year`, `filepath`
     - checkboxes for `zoom`, `pan`
   - Edits apply live to the pool. Load errors are flagged per asset.
5. **Animation:**
   - cycle duration, transition in and out durations, frame stagger
   - zoom start, pan speed, pan aspect threshold, max hold duration
   - caption sizes, spacing defaults, color, fade duration, rise distance, line-two delay
   - per-layer effect type dropdown and auto-generated effect params
   - Sliders paired with number inputs for precision.

---

## 6. Milestones

Complete each milestone before starting the next. Claude Code cannot see the projected output. At the end of each milestone, stop and ask the user to verify on the physical projector.

**M0: Scaffold**
- Vite + TS + Three.js project, strict TS config, Vitest configured.
- Full-window canvas at device pixel ratio.
- `npm run dev`, `npm run build` and `npm test` work.

**M1: Warp engine and mapping UX**
- Homography solver with the unit tests listed in 3.3.
- Two hardcoded default frames and the wall quad rendered with homography cameras, showing the test pattern.
- Debug overlay; mouse drag; keyboard nudging and Tab cycling; undo/redo; convexity check; `D` key toggle.
- Acceptance:
  - All homography tests pass.
  - On the projector, the test grid can be aligned to a physical frame, with straight grid lines and an edge border that sits on the frame edge.
  - Interaction stays at 60 fps while dragging.

**M2: Panel and project I/O**
- State store, panel with all sections (Assets and Animation may be stubs), `X` toggle, side switch, rem scaling.
- Project folder open/reopen, `config.json` load/save, default project, unsaved indicators, `beforeunload` guard.
- Add/remove frames, numeric point inputs, per-frame settings, cursor hiding.
- Acceptance:
  - Saving, reloading and reopening the folder reproduces the exact mapping.
  - The panel is readable at FHD and 4K.

**M3: Assets and cycling**
- Manifest loading (multiple), media loading via file handles, image downscaling, video textures.
- Selection logic with tests.
- Static and cycling modes, stagger, preloading, dissolve transitions.
- Motion rules in 5.4 (video, pan, zoom, static), cover fit, insets.
- Asset panel with live editing and its own Save.
- Acceptance:
  - No visible hitch at transitions.
  - Selection tests pass.
  - Manifest edits round-trip to disk.

**M4: Captions**
- Wall-space captions per 5.5: rotation, per-frame spacing, wrapping, sizing, animation, fonts.
- Acceptance: captions are crisp, follow the frame's bottom edge angle, and track mapping changes live.

**M5: Effects framework**
- Two layers, the interface in 5.6, registry, auto-generated param UI, placeholder effect.
- Acceptance: effects trigger on each in-transition, render on the correct layers, and stay aligned to frame outlines.

**M6: Polish**
- Any performance work needed to hit the target in 3.4.
- README covering setup, launching Chrome full screen, recommended codecs and the project folder layout.

---

## 7. Conventions for Claude Code

Copy this section into `CLAUDE.md`.

- Do not add dependencies beyond the approved list in section 2 without asking.
- Pin `three` to an exact version. Do not upgrade it without asking.
- TypeScript strict mode. No `any` in schema or state code.
- All persisted data goes through typed schemas in `src/state/schema.ts`, with defaults in `defaults.ts` and migrations in `migrate.ts`.
- Never write to disk except from an explicit Save action.
- Renderer and panel read state through store subscriptions and change it only through store actions.
- All animation timing uses the rAF delta-time clock.
- Write Vitest tests for all math and selection logic. Run `npm test` before reporting a milestone complete.
- Suggested layout:
  ```
  src/
    main.ts
    state/      store.ts, schema.ts, defaults.ts, migrate.ts
    io/         projectFolder.ts, configIO.ts, manifestIO.ts, handleStore.ts
    math/       homography.ts, homography.test.ts, geometry.ts
    render/     renderer.ts, quadCamera.ts, frameRenderer.ts, wallRenderer.ts,
                testPattern.ts, transitionMaterial.ts, debugOverlay.ts
    content/    assetPool.ts, shuffleBag.ts, shuffleBag.test.ts, scheduler.ts,
                mediaLoader.ts, motion.ts
    captions/   captionLayout.ts, captionRenderer.ts
    effects/    types.ts, registry.ts, placeholder.ts
    ui/         panel.ts, hotkeys.ts, sections/*.ts, panel.css
  ```

---

## 8. Assumptions to confirm with the user if behavior seems wrong

These were not explicitly specified and were decided during brief writing:

1. An image with `pan = true` whose aspect does not exceed the threshold falls back to zoom if `zoom = true`, otherwise static.
2. In static mode (pool ≤ frames), images use static cover with no zoom or pan, videos loop, and captions appear without animation.
3. `maxHoldDuration` applies only to panning images, not to video.
4. The cursor stays hidden whenever the panel is closed but cursor shows when debug visuals are shown with `D`. Pressing `D` to hide debug visuals also hides cursor. 
5. Test pattern toggles are runtime only and not saved to config.
6. The default transition style is a noise-mask dissolve through black.
