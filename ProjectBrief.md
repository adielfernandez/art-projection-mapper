# Art Projector: Project Brief

## 1. Overview

Art Projector is a browser-based projection mapping app. A projector displays a full-screen Chrome window (16:9) onto a wall holding physical picture frames in portrait orientation. The app warps artworks (images and videos) onto each frame, cycles them randomly from one or more asset pools, shows optional captions on the wall below each frame, and can play a wallpaper playlist across the wall behind the frames. The app is focused on mapping and showing the user's content; ambient effect layers are out of scope.

The highest priority is mapping precision and mapping UX. The user must be able to align each frame's projected content tightly to a physical rectangle.

Target: desktop Chrome, full screen, FHD or 4K output. No mobile or responsive layout work beyond scaling the panel UI to stay readable at both resolutions.

---

## 2. Tech Stack

| Layer | Choice | Notes |
|---|---|---|
| Build | Vite | Dev server and production build. App served from `localhost`. |
| Language | TypeScript, `strict: true` | Config and asset pool schemas are typed. |
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

- One serializable **project state** object is the single source of truth. Saving the config means serializing the config portion of this state, and saving assets means serializing the asset pool portion.
- **Runtime-only state** is kept separate and never saved. It includes:
  - the selected control point
  - debug visibility
  - per-quad test pattern toggles
  - panel open/closed
  - dirty flags
  - playback state
- All mutations go through store actions. The renderer and the panel subscribe to the store; neither mutates state directly.
- There are two dirty flags, one for the config and one for the asset pools. Save Show clears both (each pool's flag once that pool is written).
- **No autosave.** Nothing is written to disk except by an explicit Save button press.

### 3.2 Coordinate spaces

| Space | Definition | Used for |
|---|---|---|
| Canvas-normalized | `[0,1] × [0,1]`, origin top-left, y down | Storage of all control points in config. Resolution independent. |
| Device pixels | Canvas-normalized × canvas size in device pixels (CSS px × `devicePixelRatio`) | Panel numeric display, nudging, hit testing. |
| Frame-local | Origin bottom-left, x right, y up. Width = 1, height = `1 / physicalAspect` | Artwork, test pattern. One per frame. |
| Wall-local | Origin bottom-left, x right, y up. Width = 1, height = 1 / canvas aspect | Wallpaper (the wall's playlist), captions, wall test pattern. |

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
2. **Wall**, drawn in wall space with its homography camera: the wallpaper playlist (nothing while it is empty, so the background color shows), and the wall test pattern when enabled.
3. **Frames**, each drawn in frame space with its own homography camera: artwork, transition mask, and the test pattern when enabled. Frames draw in `frames` list order, so later frames are on top where they overlap. A frame with `blend: "add"` adds its light to what's behind it instead of covering it, so its black areas are transparent.
4. **Captions**, drawn in wall space.
5. **Debug overlay**, drawn in screen space on a separate 2D canvas layered above the WebGL canvas, sized to device pixels.

Renderer setup:
- `antialias: true`
- `autoClear: false`
- pixel ratio = `devicePixelRatio`
- `outputColorSpace = SRGBColorSpace`, and every image and video texture uses `colorSpace = SRGBColorSpace`. Without this, images render washed out.

The main loop uses `requestAnimationFrame`. Clamp delta time (for example to a 100 ms maximum) so a stall does not cause animation jumps. Do not drive animation timing with `setTimeout`.

Performance target: steady 60 fps at 4K output with two frames and the wallpaper, one of them playing video.

---

## 4. Data Schemas

Bump `schemaVersion` on any breaking change and write a migration function. Ask the user before changing either schema.

### 4.1 Project folder

The user opens a **project folder** with `showDirectoryPicker`. All reads and writes go through that folder's directory handle.

- The config is always `config.json` at the folder root.
- Asset pools (JSON files listing media, section 4.3) are referenced from the config by paths relative to the folder root.
- Media `filepath` values are relative to the location of the asset pool file that lists them.
- Media is loaded via `fileHandle.getFile()` and `URL.createObjectURL()`. Revoke object URLs when the media is released.
- There is no "Save As". The user duplicates and renames project folders manually.

### 4.2 `config.json`

```json
{
  "schemaVersion": 2,
  "assetPools": ["pools/paintings.json", "pools/videos.json"],
  "showType": "randomized",
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
    "debugColor": "#0A84FF",
    "playlist": [
      { "pool": "pools/walls.json", "filepath": "media/damask.jpg" }
    ]
  },
  "frames": [
    {
      "id": "f_8k2j1",
      "title": "The Nightmare",
      "corners": [[0.20, 0.15], [0.38, 0.15], [0.38, 0.75], [0.20, 0.75]],
      "physicalAspect": 0.6571,
      "debugColor": "#FF453A",
      "captionSpacing": 0.05,
      "captionOffsetX": 0,
      "playlist": [
        { "pool": "pools/paintings.json", "filepath": "media/nightmare.jpg" }
      ],
      "cycleDuration": null,
      "transitionDelay": null,
      "blend": "normal"
    }
  ],
  "animation": {
    "transitionInStyle": "noise",
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
  }
}
```

Field notes:
- **`corners`** are in canvas-normalized coordinates, ordered TL, TR, BR, BL relative to the physical frame.
- **`title`** (per frame, default `"Untitled"`) is the user's name for the frame. The panel heading reads "Frame N: title" (just "Frame N" if it is blank). A missing title loads as `"Untitled"`; a non-string one falls back with a warning.
- **`physicalAspect`** is the physical width ÷ height. The default is `0.6571` (23″ × 35″).
- **`captionSpacing` (panel: "Caption Y offset"), `captionOffsetX` (panel: "Caption X offset"; may be negative), `titleSize`, `lineTwoSize`, `lineGap` and `riseDistance`** are in units of the frame's bottom-edge length measured in wall space (one "frame width").
- **`inset`** (per-edge masking) was removed: corrections are made with the control points. An `inset` key in an older file is ignored and dropped on the next save.
- **`showType`** is `"randomized"` (default) or `"manual"`. See 5.3.
- **`playlist`** (per frame, default `[]`) lists the assets the frame plays in a manual show, in order. Each entry names an asset by its asset pool path (`pool`, as listed in `assetPools`) and its `filepath` in that pool; if several assets share a filepath, the first is used. Duplicates are allowed, within one playlist and across frames. Entries whose asset can't be found are kept and skipped. Playlists are kept, but ignored, in a randomized show.
- **`cycleDuration`, `transitionDelay`** (per frame, default `null`): a manual-show frame's own values for `animation.cycleDuration` and `animation.transitionDelay`. `null` (or missing) uses the animation setting. An invalid value (not a number, negative, or a zero cycle duration) falls back to `null` with a warning. Ignored in a randomized show and by the wall.
- **`blend`** (per frame, `"normal"` or `"add"`, default `"normal"`). `"normal"` covers whatever is behind the frame. `"add"` adds the frame's light to it, so black (including black gaps between assets and an empty frame) is transparent and frames drawn earlier show through. Meant for bright content on black (fire, glows). Additive content only adds light, so it cannot hide what's behind it, and overlapping bright areas can clip to white.
- **`panSpeed`** is in frame widths per second.
- **Durations** are in seconds.
- **`id`** is generated once and never reused. Displayed frame numbers are list positions and may renumber after a removal; ids and settings never shift.
- **Starting values.** All numeric defaults above are starting values to tune on site.
- **Distinct default colors.** New frames get a default debug color distinct from existing frames.

**Migration from schemaVersion 1:** `assetManifests` is renamed to `assetPools`, and each playlist entry's `manifest` to `pool`. Version 1 files load normally and are written as version 2 on the next Save.

**Default project** (no `config.json` in the folder, or no folder opened yet): two frames side by side, centered vertically, each about 50% of canvas height, with corners shaped by `physicalAspect`. `config.json` is created on the first Save.

### 4.3 Asset pool

An asset pool is a JSON file listing media. A project can have several (for example one for paintings and one for videos); the config lists them in `assetPools`.

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
- `zoom`, `pan` and `wallOnly` are optional booleans and default to `false`. `wallOnly` reserves an asset for the wall's wallpaper (section 5.3). New assets added in the panel are written with all three.
- Duplicate assets, the same file in multiple asset pools or listed twice, are treated as separate assets. They may appear on screen at the same time.
- Recommend H.264 MP4 or VP9/AV1 WebM to the user in the README. HEVC support in Chrome depends on hardware.

---

## 5. Features

### 5.1 Startup and file I/O

- **On launch with a stored folder handle:** the app keeps the last project folder's directory handle in IndexedDB. This is a pointer only, not saved state. If one exists, show a "Reopen Show: <folder name>" button. Chrome requires a user gesture to re-grant permission. On grant, load `config.json` and all asset pools from disk.
- **On launch** (and when a folder without `config.json` is opened) the app shows the default project as a new show: two frames, with the wall's and every frame's test pattern on. Content can be added before the show has a folder (see *Adding content*); the first Save Show asks for a folder, confirming before overwriting any file it is about to write that already exists there, and that folder becomes the show's folder.
- **Panel Config section:**
  - **Load Show** opens a project folder.
  - **Save Show** saves everything. For each modified asset pool it copies that pool's staged files (below) into the folder and writes the pool file; then it writes `config.json`. Pools go first so the config is never saved pointing at assets that were not written. If a write fails, the pools already written stay saved and the config is not written. There is no separate pool save.
- **Adding content** (section 5.6) never writes to disk by itself, and works with or without a folder:
  - A file picked or dropped from **inside** the project folder is listed by its path relative to the pool (found with `FileSystemDirectoryHandle.resolve`). Nothing is copied.
  - A file from **outside** the folder is *staged*: held in memory under `media/<name>` next to the pool, playable and thumbnailed from memory, and copied there on that pool's next save. If the name is taken on disk or by another staged file (compared without case), the copy is numbered: `name (2).ext`. Names are checked again at save time (a new show's folder is only known then): a taken path gets the next numbered name, and playlists follow. A save never overwrites an existing media file.
  - With no pool chosen (a show with no pools yet, or the empty Assets section), files go into a new `assets.json` pool.
  - A file the pool already lists is reused instead of added twice. Unsupported types and folders are skipped with a message.
  - Loading another project discards staged files (after the usual unsaved-changes confirmation).
- **Removing content:** × on an asset removes it from its pool. The media file is never deleted. Playlist entries that used it are kept and flagged missing.
- **Removing an asset pool:** a red × in the pool's header removes it from the show and from `assetPools` (config modified). A pool with unsaved changes that lists assets asks for confirmation first; an empty pool is removed at once (nothing would be lost). The pool file and media stay on disk; playlist entries that used it are flagged missing. The × is hidden while only one pool remains.
- **New assets** are written with `filepath`, `zoom: false` and `pan: false`; `title`, `artist` and `year` once filled in.
- **Adding an asset pool:** a name typed in the Asset section becomes `<name>.json` at the project root and is added to `assetPools` (config modified). If that file exists it is loaded as is; otherwise an empty pool is created and written on the next Save Show. Pool names are compared without case, so `Art.json` and `art.json` can't both be added.
- Files dropped anywhere outside a drop zone are ignored, so the browser never navigates away from the show.
- **Unsaved changes:**
  - An indicator in the panel header for each of config and assets.
  - A `beforeunload` confirmation when either is dirty.
- **Errors:**
  - A missing or invalid asset pool shows an error in the Asset section, and the app continues with the remaining pools.
  - Media that fails to load is flagged on that asset in the panel and skipped by the scheduler.

### 5.2 Mapping

**Quads.** Each frame and the wall quad has four independently movable control points. The wall quad defaults to the canvas corners. The same mapping code and UX applies to all quads.

**Mouse:**
- Press near a control point (within hit radius) to select and drag it. Dragging a point moves only that point.
- Press inside a frame (away from its points) and drag to move the whole frame; its four points keep their relative positions in screen space. Movement starts after a 4 px dead zone, so a click never moves it. The topmost frame wins where frames overlap; the wall quad is never dragged by its body. Selection is unchanged.
- Right-click inside a frame (the topmost one where frames overlap) to rotate it 90° clockwise, the same as its Rotate button (below). The browser's context menu is suppressed while debug visuals are shown. Right-clicking outside every frame does nothing.
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
- On for every quad in a new show (see 5.1). While any test pattern is on, a newly added frame starts with its own on. Loading a show turns them all off.
- Turned off automatically when content arrives: adding an item to a frame's or the wall's playlist turns off that quad's pattern; in a randomized show, adding files to an asset pool turns off every frame's pattern (not the wall's, which only plays its own playlist).
- Rendered through the homography. It consists of:
  - a square grid that is uniform in physical units (it uses `physicalAspect`, so cells are physically square)
  - a checkerboard
  - a center crosshair
  - a 1-unit border on the frame edge
- On the wall, straight evenly spaced grid lines confirm the mapping.

**Rotating a frame:** "↻ Rotate 90° clockwise" in a frame's section turns its four points a quarter turn clockwise about their centroid, in device pixels (so the shape is kept on a 16:9 canvas). Points keep their corner slots, so the artwork and captions turn with the frame. If a point ends up off screen, the whole frame is translated back in, each axis on its own, keeping its shape; on an axis where it is larger than the viewport it is centered. One undo step.

**Adding and removing frames:**
- "Add new frame" creates a frame centered on the canvas at the default size, with the next number and a new color.
- "Remove" in a frame's section header deletes it immediately. It is undoable via the config dirty flag only; no confirmation dialog.
- ↑ ↓ in a frame's section header move it in the frame list, which is also the draw order (later frames draw on top). Frames are renumbered to match. Not undoable.

### 5.3 Content selection

**Show type** (`config.showType`, switchable live in the panel; switching restarts every frame):
- **Randomized:** the rules below. All frames share every playable asset.
- **Manual:** each frame plays its own `playlist`, in order, independently of the other frames. A frame's mode follows the number of playable entries in its playlist (entries that are missing or failed to load don't count):
  - **0:** the frame stays black.
  - **1:** static, with the same rules as static mode below.
  - **2 or more:** the cycle in 5.4, stepping through the playlist in order and looping. No exclusion between frames. `frameStagger` applies when the show starts. The frame's own `cycleDuration` and `transitionDelay` (section 3), where set, replace the animation settings for it, including in the motion rules (a video shorter than the frame's cycle duration loops until it ends, and so on).
  - **Live edits** apply at the next transition: the asset on screen finishes its cycle, then the frame continues with the updated list. The position is tracked by entry, so a moved entry keeps its place in the sequence, and removing the entry on screen plays the one that took its place next. Changes that move a frame between 0, 1 and 2+ entries apply immediately; a static frame swaps to a new single asset immediately.
  - **Asset filepath edits** in the Assets panel carry over to playlist entries (marking the config modified).

**Wallpaper** (`wallQuad.playlist`): the wall plays its own playlist in **both** show types, with the same rules as a frame in a manual show (0 entries: nothing, so the background color shows; 1: static; 2+: cycles in order with the usual transitions and timing). It is covered by frames where they overlap, gets no captions, and is not staggered. Its assets are fit to the wall quad with cover fit (pan and zoom flags apply). Switching show type doesn't restart it. In a randomized show the wallpaper doesn't exclude its asset from the frames' shuffle.

**Wall-only assets** (`wallOnly: true` in a pool, the "Wall only" checkbox in the Assets section): the wall may use any asset, but frames never show these. They are left out of the randomized shuffle (and so out of the asset count that picks static vs cycling), frame playlist pickers don't offer them, and a frame playlist entry that points at one is kept but skipped and flagged "wall only" (if the pool lists the same file again without the mark, that copy is used). Changing the mark applies like any live asset edit.

The rest of this section describes the randomized show.

**Playable assets.** The concatenation of all assets from all asset pools, minus assets that failed to load. (Not to be confused with an asset pool, which is one file.)

**Mode is determined by playable asset count vs. frame count:**
- **Assets < frames.** Static mode. Assign assets to frames in list order and wrap around. Example: assets A, B with three frames gives A, B, A.
- **Assets = frames.** Static mode. Asset *i* goes to frame *i*.
- **Assets > frames.** Cycling mode.

**Static mode:**
- No cycling and no in/out transitions.
- Captions display without animation.
- Videos loop.
- Images display at cover fit with no zoom or pan.

**Cycling mode** uses a shared shuffle bag across all frames:
- When choosing the next asset for a frame, exclude assets currently displayed or being loaded by any frame. The exclusion compares asset entries, not file paths.
- When the bag empties, reshuffle. Ensure the first draw of the new bag differs from the last draw of the previous bag.

**Recompute** mode and assignments when frames are added or removed, or when asset pools change.

Selection logic gets Vitest coverage:
- no simultaneous duplicates when assets > frames
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
- **Out:** fade to black over `transitionOutDuration`.
- **In:** over `transitionInDuration`, in the style set by `animation.transitionInStyle`:
  - `"noise"` (Noise Dissolve, the default): a noise mask, a procedural noise threshold in the fragment shader, not a texture. `dissolveSoftness` and `dissolveNoiseScale` shape it.
  - `"fade"` (Simple Fade): the whole frame fades up from black. The noise settings are ignored.
  - An unknown value falls back to `"noise"` with a warning. More styles may be added later.
- Avoid a direct crossfade between artworks.

**Fit.** All content uses **cover** fit to the frame (frame aspect = `physicalAspect`), applied as a UV transform.

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

**Edits during playback.** Changes to timing parameters apply from the next cycle, except `transitionDelay` (global or a frame's own), which is read live: the black gap is measured from when the frame went black, so a frame already black longer than the new delay brings the next artwork in at once. Changes to the playing asset's fields apply at its next appearance.

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

### 5.6 Side panel

**Confirmations** are inline, never native dialogs. They appear right below the control that asked: under a pool's header for its × (opening the pool if collapsed). Others (Load Show, Save Show) use a bar at the top of the panel.

**Toggling and placement:**
- `X` toggles the panel.
- Space pauses and resumes the show, the same as the **Pause Show** button at the top of the panel. It takes priority over a focused panel button or checkbox.
- A "Panel Alignment: L R" switch on its own line under the title moves it between the left and right edges, stored in `config.ui.panelSide`.
- The panel's inner edge (facing the stage) drags to resize it: default 27rem, minimum 90% of that, maximum 60% of the screen width; double-click restores the default. The width is in rem so it keeps its proportions at FHD and 4K. It is runtime only (resets on reload). Section headers wrap their buttons onto a second line and truncate long names with "…" when the panel is narrow.
- When open, the panel overlays the canvas and does not resize it.

**Hotkeys** (`X`, `D`, Space, arrows, Tab, Esc, undo/redo) are ignored while focus is in a text, number or color input.

**Cursor:** hidden over the canvas when the panel is closed.

**UI scaling:**
- Root `font-size: clamp(14px, 1.3vh, 32px)`. All panel dimensions are in `rem`.
- Do not scale from `devicePixelRatio`.
- Must be readable on the projected image at both FHD and 4K.

**Sections**, each with a header and collapsible:

1. **App controls:** "Art Projection Mapper" title, unsaved-change indicators and close button; below them the left/right switch.
2. **Config:** Load (open project folder), Save. Shows the current folder name. Show type switch (Randomized / Manual).
3. **Mapping:**
   - Global: background color, debug stroke width, point radius, crosshair size.
   - Wall quad (collapsible): debug color (checkbox-style swatch) and test pattern toggle at the top, then 4 control points with X/Y inputs, the convexity warning, and the "Wallpaper playlist" (section 5.3), shown in both show types.
   - Each frame (collapsible, titled "Frame N: title"):
     - ↑ ↓ (reorder) and Remove buttons right-aligned in its header
     - the frame id, read-only, in gray, just under the heading
     - "Title" text box (`title`); the heading updates as you type
     - debug color picker (a checkbox-sized swatch left of its label, lined up with the checkboxes below)
     - test pattern toggle
     - "Additive blend" checkbox (`blend`), with hover help on faking transparency and layering
     - 4 control points with X/Y inputs
     - "↻ Rotate 90° clockwise" button (section 5.2)
     - physical aspect (number input)
     - caption X offset and caption Y offset (slider and number)
     - convexity warning when applicable
     - playlist (manual show only; hidden when randomized): one row per entry with thumbnail, title, and ↑ ↓ × buttons; the entry on screen is highlighted; missing or failed entries are flagged. "+ Add asset" opens a thumbnail picker of every loaded asset, grouped by asset pool; clicking one appends it.
     - timing (manual show only): "Cycle duration" and "Transition delay" rows, each a checkbox plus a seconds field. Unticked, the field is disabled and shows the Animation value ("Animation"); ticking copies that value in as the frame's own ("own"), and unticking clears it to `null`.
     - in the playlist picker, an "Import new files…" tile (file picker) and, with several pools, an "Into asset pool" chooser. Files dropped on the playlist do the same. Imported files are added to that pool (section 5.1) and appended to this playlist. A short note ("Added 2 to this playlist.") confirms it and fades out after 4 seconds. The Assets section's own messages do the same when they are informational ("Added 1 file to assets.json…", "Saved…"); warnings and errors stay until the next message.
   - "Add new frame" button.
4. **Assets:**
   - Nested list grouped by asset pool file. Each pool's header has a count, modified/error badges and a red × (hidden for the last pool). Its body ends with "+ Add files…" (multi-select file picker), and the whole pool accepts files dropped from the OS (highlighted while dragging).
   - Each asset is collapsible, with a small preview thumbnail (or video poster), a "new" badge while its file is staged, a × remove button whose hover note says the file stays on disk (and names any frames whose playlists use it), and editable fields:
     - text inputs for `title`, `artist`, `year`, `filepath`
     - checkboxes for `zoom`, `pan`, "Wall only" (`wallOnly`)
   - A name field and "+ Add asset pool" button at the bottom.
   - Edits apply live to what plays. Load errors are flagged per asset.
5. **Animation:**
   - first, "Transition-In Style": a Style dropdown (Simple Fade, Noise Dissolve); "Dissolve softness" and "Noise Scale" show only for Noise Dissolve
   - cycle duration, transition in and out durations, transition delay, frame stagger, max hold
   - zoom start, pan speed, pan aspect threshold
   - caption sizes, color, fade duration, rise distance, line-two delay
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
- Asset pool loading (multiple), media loading via file handles, image downscaling, video textures.
- Selection logic with tests.
- Static and cycling modes, stagger, preloading, dissolve transitions.
- Motion rules in 5.4 (video, pan, zoom, static), cover fit.
- Asset panel with live editing and its own Save.
- Acceptance:
  - No visible hitch at transitions.
  - Selection tests pass.
  - Asset pool edits round-trip to disk.

**M4: Captions**
- Wall-space captions per 5.5: rotation, per-frame spacing, wrapping, sizing, animation, fonts.
- Acceptance: captions are crisp, follow the frame's bottom edge angle, and track mapping changes live.

The ambient effects milestone was dropped: the app focuses on mapping and showing the user's content.

**M5: Polish**
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
    io/         projectFolder.ts, configIO.ts, poolIO.ts, handleStore.ts
    math/       homography.ts, homography.test.ts, geometry.ts
    render/     renderer.ts, quadCamera.ts, frameRenderer.ts, wallRenderer.ts,
                testPattern.ts, transitionMaterial.ts, debugOverlay.ts
    content/    selection.ts, shuffleBag.ts, shuffleBag.test.ts, scheduler.ts,
                mediaLoader.ts, motion.ts
    captions/   captionLayout.ts, captionRenderer.ts
    ui/         panel.ts, hotkeys.ts, sections/*.ts, panel.css
  ```

---

## 8. Assumptions to confirm with the user if behavior seems wrong

These were not explicitly specified and were decided during brief writing:

1. An image with `pan = true` whose aspect does not exceed the threshold falls back to zoom if `zoom = true`, otherwise static.
2. In static mode (playable assets ≤ frames, or a manual playlist with one playable entry), images use static cover with no zoom or pan, videos loop, and captions appear without animation.
3. `maxHoldDuration` applies only to panning images, not to video.
4. The cursor stays hidden whenever the panel is closed but cursor shows when debug visuals are shown with `D`. Pressing `D` to hide debug visuals also hides cursor. 
5. Test pattern toggles are runtime only and not saved to config.
6. The default transition-in style is a noise-mask dissolve from black (`transitionInStyle: "noise"`); Simple Fade is the alternative.
