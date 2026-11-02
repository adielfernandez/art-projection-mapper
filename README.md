# Art Projection Mapper

A browser app that projects artwork (images and videos) onto picture frames hanging on a wall. You line up a shape on screen with each real frame, and the app warps the artwork to fit it exactly. It then cycles through your content with fades or dissolves, slow pans and zooms, and museum-style captions under each frame. It can also play "wallpaper" across the wall behind the frames.

## Technical stack

- **Runs in the browser.** Use **Google Chrome** or **Microsoft Edge**. Other browsers can't open project folders.
- **Built with** TypeScript, [Three.js](https://threejs.org/) for the graphics, and [Vite](https://vite.dev/) to run it.
- **You need [Node.js](https://nodejs.org/)** (version 20.19 or newer) installed on your computer.

### Launching the app

Open a terminal in this folder and run:

```bash
npm install        # first time only: downloads what the app needs
npm run dev        # starts the app
```

Then open **http://localhost:5173/** in Chrome. Drag the browser window onto the projector's screen and press **F11** for full screen.

For the actual show, use the faster version instead:

```bash
npm run build      # prepares an optimized copy
npm run preview    # serves it at http://localhost:4173/
```

To stop the app, go back to the terminal and press **Ctrl + C**.

---

## How To Use

### The Interface

The app has two parts:

- **The canvas** fills the whole screen. This is what the projector shows.
- **The side panel** holds all the settings. It's open when the app starts; press **X** to show or hide it.
  - **Panel Alignment: L / R** (under the title) docks it on the left or right of the screen.
  - Drag the panel's inner edge (the one next to the projected image) to make it wider or narrower. Double-click that edge to return to the default width. The width resets when you reload the page.

While the panel is open you'll also see **mapping guides**: colored outlines and dots over each frame. They disappear when you close the panel, so the audience never sees them.

**First launch.** The app opens as a new, unsaved show with two frames, and the wall and both frames show their **test patterns** (grids of squares), so you can start mapping right away. A frame's test pattern switches off by itself when you add content to it. You can add content before saving anything (see *Content Management*); the first time you save, the app asks which folder to keep the show in.

The panel is split into sections you can expand and collapse:

| Section | What it's for |
|---|---|
| **Pause Show** (top button) | Freezes all animation and video. Press it again, or the **Space bar**, to resume. You can still change settings while paused. |
| **Config** | **Load Show**, **Save Show**, and choosing Randomized or Manual mode. |
| **Mapping** | The background color, the **Wall quad** (including its wallpaper), and each frame: lining it up with the wall, its playlist, and adding, removing and reordering frames. |
| **Assets** | Adding and removing content, and editing titles, artists and other details. |
| **Animation** | How new artwork appears, timing, pan and zoom, and caption size and color. |

Hover over any setting whose name has a dotted underline to see what it does. The **Config** and **Assets** labels in the panel header light up when you have unsaved changes.

### Modes: Randomized vs Manual

Choose the mode under **Config → Show type**. It's saved with your show.

**Randomized** (the default): every frame draws from one shared collection of all your content (except items marked **Wall only**, see *Wallpaper* below).
- If you have **more items than frames**, each frame shuffles through the collection on its own. The same item never shows in two frames at once.
- If you have **as many items as frames, or fewer**, each frame shows one item and keeps it. Images stay still, and videos loop.
- Best for: a big collection where you don't mind what shows where.

**Manual**: you choose exactly what each frame plays.
- Each frame gets its own **playlist**, which you build in that frame's section under **Mapping**. Click **+ Add asset** and pick from the thumbnails, then use **↑ ↓** to reorder and **×** to remove.
- To bring in brand-new files at the same time, click **Import new files…** at the top of the thumbnails, or drag files from your computer straight onto the playlist. They're added to an asset pool and to this playlist in one go. If you have several pools, choose which one under **Into asset pool**.
- A playlist with **several items** plays them in order and loops.
- A playlist with **one item** shows it and keeps it (videos loop).
- An **empty playlist** leaves the frame black.
- The same item can appear in several playlists, or several times in one.
- The item currently on screen is highlighted in the playlist. Changes take effect at the frame's next transition.
- **Timing per frame:** under its playlist, each frame has **Cycle duration** and **Transition delay**. Unticked, they follow the **Animation** settings (shown greyed out). Tick one to give this frame its own value, for example a longer hold for a frame that plays one slow video. Untick it to go back to the Animation setting.
- Best for: telling a story, or when a piece belongs in a specific frame.

Switching modes restarts every frame. Your playlists are kept even while you're in Randomized mode.

**Wallpaper (both modes).** The **Wall quad** section (under **Mapping**) has its own **Wallpaper playlist**. It plays across the whole wall behind the frames, whichever mode you're in, and keeps playing when you switch modes.
- It works like a Manual playlist: one item stays up, several cycle in order using the same timing as the frames, and an empty one shows just the background color (set under **Mapping → Global → Background**).
- Frames are drawn on top of it. Wallpaper has no captions.
- To keep a wallpaper image out of the frames, tick **Wall only** on it in the **Assets** section. The frames then never show it: it's left out of the Randomized shuffle, Manual frame playlists skip it, and the frames' **+ Add asset** list doesn't offer it. The wall can still use it.

### Mapping to your wall

"Mapping" means telling the app where each real picture frame sits in the projector's image, so the artwork lands exactly inside it.

#### Hotkeys

| Key | What it does |
|---|---|
| **Space bar** | Pause or resume the show |
| **X** | Show or hide the side panel |
| **D** | Show or hide the mapping guides (even with the panel closed) |
| **Tab** / **Shift + Tab** | Select the next / previous corner point |
| **Esc** | Deselect the point |
| **Arrow keys** | Move the selected point 1 pixel |
| **Shift + Arrow keys** | Move it 10 pixels |
| **Alt + Arrow keys** | Move it 0.1 pixel (very fine) |
| **Ctrl + Z** | Undo the last mapping change |
| **Ctrl + Shift + Z** | Redo |

On a Mac, use **Cmd** instead of Ctrl, and **Option** instead of Alt. Hotkeys don't fire while you're typing in a text or number box. Moving points (with the mouse or the keys) only works while the mapping guides are visible, so nothing can be bumped by accident during the show.

#### Steps

1. **Set up.** Hang your frames, aim the projector at the wall, launch the app on the projector's screen and go full screen (**F11**).
2. **Measure each frame.** Use a tape measure on the **visible picture area** inside the frame (the opening, not the outer moulding). Divide the **width by the height**. For example, an opening 20 inches wide and 30 inches tall gives 20 ÷ 30 = **0.6667**. A wide frame gives a number above 1, a tall one below 1.
3. **Enter the aspect ratio.** Open **Mapping → Frame 1** and type that number into **Physical aspect (w÷h)**. This keeps artwork from looking stretched, even when the projector hits the wall at an angle.
4. **Add frames.** Click **+ Add new frame** until there's one on screen for each real frame, and enter each one's aspect ratio. Each frame has its own color (change it with **Debug color** at the top of its section), and its section title shows its number and title, like **Frame 3: Untitled**. Its ID (used in `config.json`) is shown in gray just under the title. Type a name into **Title** to tell frames apart (for example the painting's name). **Remove** in a frame's header deletes it straight away.
5. **Line up the corners.** Drag each colored corner dot onto the matching corner of the real frame on the wall. You can also:
   - drag inside a frame to move the whole thing at once,
   - hold **Shift** while dragging for slow, precise movement,
   - select a point (click it or press **Tab**) and nudge it with the arrow keys,
   - type exact pixel positions into the X/Y boxes in the frame's section,
   - click **↻ Rotate 90° clockwise** (under the X/Y boxes), or right-click inside the frame, to turn the whole frame, picture and captions included, a quarter turn around its center. If that would push a corner off screen, the frame slides back on. **Ctrl + Z** undoes it.
6. **Check your work.** Tick **Test pattern** at the top of the frame's section (it's already on in a new show). It draws a grid of squares that should look evenly spaced and truly square on the wall.
   - If the squares look stretched, re-check your measurement.
   - If they look bent or uneven, adjust the corners.
   - If light spills onto the frame's moulding, pull the corner points in slightly until the image sits just inside the opening.
7. **Position captions (optional).** Use **Caption X offset** and **Caption Y offset** to place the title text where you want it below each frame.
8. **Layering (optional).** Where frames overlap, frames lower in the list are drawn on top. Use the **↑ ↓** buttons in a frame's header to change the order. Tick **Additive blend** on a frame showing something bright on a black background (fire, smoke, glowing effects): its black parts become see-through, so the frames and wallpaper behind it show through. Hover over **Additive blend** for a reminder.
9. **The Wall quad** (under **Mapping**) is the whole wall area: the captions are placed in it, and it shows the wallpaper (see *Wallpaper* above). For most setups, line its four corners up with the edges of the projected wall area. Like the frames, it has **Debug color** and **Test pattern** at the top of its section.
10. **Save Show** (see below), close the panel with **X**, and the show is running.

#### Saving and loading

Everything for a show lives in one **project folder**, like `macabre-show/` or `baphomet-show/` in this repo.

- **Load Show** (in **Config**) opens a project folder. Chrome asks permission to view and edit the folder; allow it. If you have unsaved changes, the app asks before discarding them.
- **Save Show** (in **Config**) saves everything: your mapping, mode, playlists, wallpaper and animation settings go into `config.json`, and every changed asset pool is saved too (new files, removed items, and edited titles and details). For a new show, it first asks which folder to keep the show in; pick or create an empty one.
- Nothing is written to your folder until you click **Save Show**. The **Config** and **Assets** labels at the top of the panel light up while something is unsaved, and the browser warns you if you try to leave the page with unsaved changes.
- **Reopen Show:** after you reload the page or restart the computer, the app starts as a new, blank show. Click the **Reopen Show: (folder name)** button in **Config** to pick up where you left off (Chrome may ask for permission again).
- **Starting a new show:** reload the page for a blank show, then save it to a new folder. There's no "Save As"; to start from an existing show, copy its project folder, rename it, and load the copy.

### Transitions and timing

These settings are in the **Animation** section.

**Transition-In Style** sets how each new artwork appears:
- **Simple Fade:** the whole frame fades up from black.
- **Noise Dissolve** (the default): the artwork appears through soft, spreading blotches. **Dissolve softness** and **Noise Scale** (shown only for this style) set how soft and how large the blotches are.

Artwork always fades out to black.

| Setting | What it does |
|---|---|
| **Cycle duration** | How long each artwork stays fully visible before changing. |
| **Transition in / out** | How long the appearing and fading out take. |
| **Transition delay** | How long a frame stays black between two artworks. |
| **Frame stagger** | Delay between frames when the show starts, so they don't all change at once. |
| **Max hold (pan)** | The longest a panning image may stay up. |
| **Zoom start**, **Pan speed**, **Pan aspect threshold** | How far zooming images start zoomed in, how fast panning images move, and how different an image's shape must be from the frame before it pans. |
| **Captions** | Text sizes, spacing, color and how the captions fade in. |

In **Manual** mode a frame can override **Cycle duration** and **Transition delay** with its own values (see *Modes* above). Timing changes apply from each frame's next artwork, except **Transition delay**, which applies at once (shortening it while a frame is black brings the next artwork in straight away); the transition style, noise settings and caption look change right away. Hover over any setting for details.

---

## Content Management

Your content is listed in **asset pools**: small JSON text files in your project folder that list each image or video. A show can use one asset pool or several (for example one for paintings and one for videos). You can manage them entirely from the **Assets** section of the panel, or edit them in any text editor (Notepad, TextEdit, VS Code).

### A typical project folder

```
my-show/
  config.json        ← created by the app when you Save Show
  my-art.json        ← your asset pool (you can have more than one)
  media/
    nightmare.jpg
    flame.mp4
```

### Adding content in the app

1. **Add files**, any of these ways:
   - click **+ Add files…** at the bottom of a pool (or in the Assets section of a new show) and choose images or videos; you can select several at once,
   - drag files from a File Explorer or Finder window and drop them onto a pool (or anywhere on the Assets section of a new show),
   - in **Manual** mode, or for the wallpaper, import them straight from a playlist (see *Modes* above).

   In a show with no asset pool yet, the first files go into a new pool called `assets.json`. To use your own pool names instead (for example one for paintings and one for videos), type a name at the bottom of the **Assets** section and click **+ Add asset pool** first. If a pool file with that name is already in the project folder, it's added to the show as it is.
2. This all works before the show has a folder: new files play straight away, and are copied into the folder when you save.
3. Fill in each item's **Title**, **Artist** and **Year** for its caption, and tick **Zoom**, **Pan** or **Wall only** if you like.
4. Click **Save Show**. In a new show, the first save asks which folder to keep the show in.

Good to know:
- **Files from elsewhere on your computer** (Downloads, Desktop, a USB stick) are copied into a `media/` folder next to the asset pool when you click **Save Show**. Until then they're marked **new**, but they already play and show thumbnails. If a file with the same name is already there, the copy gets a number, like `flame (2).mp4`.
- **Files already inside the project folder** are used where they are; nothing is copied. Picking one the pool already lists doesn't add it twice.
- **Removing an item:** click the **×** on it, then **Save Show**. It's removed from the show, but the file itself stays on your disk. If a playlist used it, that entry shows as **missing** until you remove it from the playlist. Hover over the **×** to see which playlists use it.
- **Removing an asset pool:** click the red **×** in the pool's header, then **Save Show**. The pool file and its media stay on your disk. A show always keeps at least one pool, so the **×** is hidden on the last one.
- Short confirmation messages in the Assets section ("Added 1 file…") fade away after a few seconds. Warnings, such as a file that couldn't be added, stay until the next message. The result of **Save Show** ("Saved config.json, my-art.json…") appears in the **Config** section.

### Adding content by hand

You can also edit an asset pool in a text editor:

1. Copy your image or video files into the project's `media/` folder.
2. Open your asset pool (for example `my-art.json`) and add an entry for each file inside the `assets` list:

```json
{
  "schemaVersion": 1,
  "assets": [
    {
      "title": "The Nightmare",
      "artist": "Henry Fuseli",
      "year": "1781",
      "filepath": "media/nightmare.jpg",
      "zoom": true,
      "pan": true
    },
    {
      "filepath": "media/flame.mp4"
    }
  ]
}
```

3. Make sure the asset pool is listed in `config.json` under `assetPools`, for example `"assetPools": ["my-art.json"]`. (**+ Add asset pool** in the app does this for you.)
4. In the app, click **Reopen Show** or **Load Show** again to pick up the changes.

### Settings for each item

| Setting | Required? | What it does |
|---|---|---|
| `filepath` | **Yes** | Where the file is, relative to the asset pool file. |
| `title` | No | First caption line, shown in italics. |
| `artist` | No | Second caption line. |
| `year` | No | Added after the artist, e.g. "Henry Fuseli, 1781". Write it as text in quotes, e.g. `"1820–23"`. |
| `zoom` | No (`true`/`false`) | Slowly zooms out while the image is on screen. |
| `pan` | No (`true`/`false`) | Slowly glides across an image whose shape is much wider or taller than the frame, so the whole picture is seen. Images too close to the frame's shape zoom instead (if `zoom` is on) or hold still. |
| `wallOnly` | No (`true`/`false`) | For wallpaper only: the wall can use it, the frames never show it. Same as the **Wall only** checkbox. |

Leave out `title`, `artist` and `year` entirely (or leave them empty) and no caption appears. `zoom` and `pan` only affect images; videos always play still and fill the frame.

### Things to look out for

- **Paths are relative to the asset pool file**, not to the app. If `my-art.json` and `media/` sit side by side, write `"media/nightmare.jpg"`. Files must be inside the project folder; a path can't point outside it.
- **Spelling and capitals matter.** `media/Flame.mp4` and `media/flame.mp4` are different files to the app. A misspelled path shows a red **failed** badge on that item in the Assets section, and the show skips it.
- **JSON is picky about punctuation.** Put a comma between items but **not** after the last one, and use straight double quotes (`"`), not curly ones. If an asset pool won't load, the Assets section shows an error. Paste the file into a free online "JSON validator" to find the mistake.
- **Supported files.** Images: `.jpg`, `.jpeg`, `.png`, `.webp`, `.avif`. Videos: `.mp4` (H.264) or `.webm`. Avoid HEVC/H.265 videos; many computers can't play them in Chrome.
- **Everything is cropped to fill the frame.** Artwork is scaled to cover the whole frame (or the whole wall, for wallpaper), so parts of a picture with a very different shape are cut off unless `pan` is on. Choose or crop artwork close to each frame's shape for best results.
- **Video length.** A video longer than **Cycle duration** plays to its end before changing. A shorter one loops until the cycle time is up.
- **Keep videos reasonable.** A frame on the wall is usually a few hundred pixels wide in the projected image, so very large or 4K videos waste power. Around 720p at a good quality setting is plenty for a frame; wallpaper covers the whole wall, so it can use the full projector resolution.
- **Editing in the app.** Everything in an asset pool can be changed in the **Assets** section: add and remove items, and edit titles, artists, years, paths and the Zoom, Pan and Wall only checkboxes. Click **Save Show** to write the changes to the file.
- **Renaming a file used in a playlist?** If you change its `filepath` in the Assets section, playlists follow along automatically. If you rename it by editing the JSON instead, update the playlists too, or those entries will show as missing.

---

## What's in this repo

| Folder | What it is |
|---|---|
| `src/` | The app (see *For developers* below). |
| `macabre-show/` | A Randomized show: 2 frames shuffling public-domain macabre artwork with captions (`macabre.json`). |
| `baphomet-show/` | A Manual show: 8 frames with their own playlists of looping videos, two of them using **Additive blend** (`baphomet.json`). |
| `fpo/` | Test content for checking the app on a projector. `python fpo/generate.py` builds three test shows (`fpo/show/`, `fpo/static/`, `fpo/tight-pool/`; not stored in git), and `fpo/QA.md` is the checklist that goes with them. |
| `ProjectBrief.md` | The full specification of how the app behaves, plus the history of design decisions (§9) and unfinished work (§10). |
| `CLAUDE.md` | Working rules for Claude Code in this repo. |

The two show folders are real shows from the Halloween 2026 party. Their mapping only fits the wall they were made for, so expect to re-map them on another wall.

## Project status

Finished and used for the Halloween 2026 party. Everything described above is on the `main` branch.

## Choreographed mode (experimental, unfinished)

Choreographed mode was an attempt at a more flexible content system: layered, sequenced compositions built from assets, put together in a playlist style. Instead of each frame cycling on its own, a show would be a list of **entries** played in order. Each entry is a composition of mapped regions, and each region has its own asset, start delay, duration, looping, fades, opacity and blend (including real transparency for PNG and WebM). Entries crossfade from one to the next, with Previous / Next / Jump controls to step through the sequence. It was meant to replace Manual mode.

There wasn't enough time before the party to flesh it out properly and make it robust enough for general use, so it was set aside and **is not part of the app on `main`**. The work in progress is on the `feature/choreography-mode` branch, along with its spec (`Choreographed-Mode-Porting.md`). It has a known problem that was never diagnosed, and it predates the last changes on `main`. If you pick it up, read `ProjectBrief.md` §10 first.

## For developers

```bash
npm test           # unit tests (Vitest)
npm run build      # typecheck + production build
npm run typecheck  # typecheck only
```

Read `ProjectBrief.md` for how everything is meant to behave, and `CLAUDE.md` for the conventions (approved dependencies only, every saved setting goes through the typed schema, nothing is written to disk except by Save Show). When behavior changes, update the README (user guide), the brief (spec and §9 history) and `fpo/QA.md` (on-projector checks) together.

**How it fits together:**

| Part | Files | What it does |
|---|---|---|
| State | `src/state/` | `schema.ts` (types for `config.json` and asset pools), `defaults.ts`, `migrate.ts` (older files), `store.ts` (the single store: every change is a store action, and the renderer and panel subscribe to it; also undo). |
| File I/O | `src/io/` | `projectController.ts` (open, reopen, Save Show, adding files and pools), `configIO.ts` and `poolIO.ts` (validate and write the JSON; bad fields fall back to defaults with a warning), `projectFolder.ts` (File System Access helpers), `handleStore.ts` (remembers the last folder in IndexedDB). |
| Math | `src/math/` | `homography.ts` (four corners to a 3×3 projective transform), `geometry.ts` (convexity, hit testing, rotation). |
| Rendering | `src/render/` | `quadCamera.ts` (a homography used as a Three.js camera's projection matrix), `quadLayer.ts` (one mapped quad: content, test pattern, blend), `transitionMaterial.ts` (the shader: cover fit, pan and zoom, noise dissolve, fades), `renderer.ts` (draw order), `testPattern.ts`, `debugOverlay.ts` (the 2D mapping guides). |
| Playback | `src/content/` | `scheduler.ts` (each frame's loading → in → hold → out cycle), `selection.ts` and `shuffleBag.ts` (Randomized picking with no duplicates on screen), `playlist.ts` (Manual and wallpaper playlists), `motion.ts` (pan and zoom plans and hold times), `mediaLoader.ts` and `decodeWorker.ts` (images decoded and downscaled off the main thread, videos). |
| Captions | `src/captions/` | `captionLayout.ts` (placement along a frame's bottom edge, wrapping and sizing), `captionRenderer.ts` (Canvas2D text drawn into a texture). |
| Panel | `src/ui/` | `panel.ts`, `sections/*.ts` (one file per panel section), `controls.ts` (small DOM helpers bound to the store), `pointerMapping.ts` (dragging points and frames), `hotkeys.ts`, `helpTooltip.ts`, `dropZone.ts`, `thumbnails.ts`. |

**Pieces worth reusing in another project:**
- **Projection mapping with a homography camera** (`math/homography.ts` + `render/quadCamera.ts`): perspective-correct warping of any quad, with no render-to-texture pass. Works with any Three.js content.
- **Mapping UX** (`ui/pointerMapping.ts`, the nudging in `ui/hotkeys.ts`, undo in `state/store.ts`): drag points or whole quads, 1 / 10 / 0.1 px nudges, Shift for fine control, Tab through points, undo that groups a burst of nudges.
- **Noise dissolve and cover fit shader** (`render/transitionMaterial.ts`).
- **Physically square test pattern** (`render/testPattern.ts`): checks a mapping by eye.
- **Shuffle bag with no repeats across frames** (`content/shuffleBag.ts`, `content/selection.ts`), with tests.
- **Captions that follow a tilted edge** (`captions/`).
- **Browser "project folder" I/O** (`io/`): open a local folder, remember it across reloads, stage new files in memory, and write only on Save. Tolerant JSON loading with warnings and versioned migrations.

