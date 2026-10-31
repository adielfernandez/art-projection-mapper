# Choreographed Mode: Porting Brief

This brief replaces Art Projector's **Manual** show type with a **Choreographed** show type. It ports the timeline playlist built for Ossuary Wall (a sibling project forked from this repo at `69f4f2c`): a looping list of **entries**, each a timed scene of **frames** placed anywhere on the wall, every frame with its own corners, asset, delay, duration, fades and blend.

Read `ProjectBrief.md` and `CLAUDE.md` in this repo first. This brief adds to them and, where it says so, overrides them. **It is the user's approval for the schema change and migration described in §5**; ask before any other schema change.

---

## 0. Reference source

Ossuary Wall's code is the reference implementation. If it is on disk, it sits at `../OssuaryWall/ossuary-wall/wall/` relative to this repo. **Read these before writing code** and port their logic, leaving out everything this brief lists as out of scope (§9):

| Ossuary file | What to take |
|---|---|
| `src/content/playlistEngine.ts`, `.test.ts` | The engine: entries, entry clock, frame ("region") timelines, crossfades, preview, transport, live edits by id. DOM-free. |
| `src/content/validation.ts`, `.test.ts` | Entry warnings. |
| `src/content/scheduler.ts` | Media slots per region: load for the entries on screen and the next one, park video on frame 0, start it when its region starts, dispose, pause/resume. |
| `src/ui/sections/playlistSection.ts` | Transport, entry sections, region editor, asset slot. |
| `src/state/store.ts` (entry and region actions), `defaults.ts`, `schema.ts` | Actions, factories and types. |
| `src/render/transitionMaterial.ts`, `render/quadLayer.ts` | The `alpha` blend and fade handling. |

Ossuary calls a frame inside an entry a **region**. Here it is a **frame**, and the existing per-show frames stay as they are for Randomized mode. Where this brief says "choreographed frame" it means a frame inside an entry.

If the Ossuary repo isn't available, this brief is the spec on its own.

---

## 1. Summary of the change

- `showType` becomes `"randomized"` (unchanged) or `"choreographed"` (replaces `"manual"`).
- **Randomized** is untouched. It keeps using the show's mapped `frames`, captions, motion and the shuffle bag.
- **Choreographed** ignores the show's mapped `frames`. It plays `choreography.entries` in order and loops. Each entry holds its own **choreographed frames**, each with its own corners (canvas-normalized, like every quad here), asset and timing.
- **The wallpaper** (`wallQuad.playlist`) plays in both modes, exactly as now, under everything.
- **No captions** in Choreographed mode.
- **Pan / zoom motion** and the **Noise Dissolve** fade-in apply to choreographed frames (§4.4, §4.5).
- **A third blend mode, `alpha`**, is added for choreographed frames (§4.6).
- Old Manual shows are converted on load (§5.3).

---

## 2. Concepts

- **Entry:** one scene. It lasts its `holdTime` if set, otherwise until its last frame finishes. Moving to the next entry crossfades.
- **Choreographed frame:** a quad that plays one asset during its entry, starting `delay` seconds after the entry starts, for `duration` (or the asset's own length), with its own fade in and fade out. Later frames in an entry draw on top.
- **Entry clock:** seconds since the entry started. It drives `holdTime` and frame delays. It freezes while the show is paused (Pause Show) and otherwise runs in real time. (Ossuary's HOLD, which paused the entry clock for guest activity, is out of scope.)

---

## 3. Schema

`schemaVersion` goes from 2 to **3**.

### 3.1 Show level

```json
{
  "schemaVersion": 3,
  "showType": "choreographed",
  "choreography": {
    "crossfade": 2.0,
    "entries": [ ... ]
  },
  "frames": [ ... ],
  "wallQuad": { ... },
  "animation": { ... },
  "captions": { ... }
}
```

| Field | Default | Meaning |
|---|---|---|
| `showType` | `"randomized"` | `"randomized"` or `"choreographed"` |
| `choreography.crossfade` | 2.0 | Default seconds of crossfade into each entry |
| `choreography.entries` | `[]` | The entries, in play order |

`frames` (the show's mapped frames) remains and is used only by Randomized mode. Their per-frame `playlist` field is removed (§5.3).

### 3.2 Entry

| Field | Default | Meaning |
|---|---|---|
| `id` | generated | `e_` plus 5 random characters, never reused (the `generateFrameId` pattern) |
| `name` | `"Entry"` | Panel label: "Entry N: name" |
| `enabled` | `true` | Off: the sequence skips it (Preview still plays it) |
| `holdTime` | `null` | Seconds. `null`: lasts until its last frame finishes |
| `fadeTime` | `null` | Seconds of crossfade *into* this entry. `null`: `choreography.crossfade` |
| `frames` | `[]` | Choreographed frames, in draw order (later on top) |

**`holdTime` semantics:**
- **Set:** the entry lasts exactly `holdTime`. Frames with `loop: true` loop until then. Any frame still playing at `holdTime` is cut by the crossfade.
- **`null`:** the entry lasts until the maximum of `delay + duration` over its playable frames. `loop` is treated as false, with a validation warning. An image frame with no `duration` lasts **10 s** (`IMAGE_FALLBACK_DURATION`), with a warning.

### 3.3 Choreographed frame

The existing `FrameConfig` mapping fields, minus the caption fields and `playlist`, plus timing:

| Field | Default | Meaning |
|---|---|---|
| `id` | generated | `f_` plus 5 characters, unique across **all** frames in the show (mapped and choreographed) |
| `title` | `"Untitled"` | Panel heading "Frame N: title" |
| `corners` | see §6.3 | TL, TR, BR, BL, canvas-normalized |
| `physicalAspect` | see §6.3 | Width ÷ height; content is cover-fit to it |
| `debugColor` | next free colour | `FRAME_COLORS` / `nextFrameColor`, distinct within the entry |
| `asset` | `null` | `{ pool, filepath }` (the existing `PlaylistItem`). `null` draws nothing |
| `blend` | `"normal"` | `"normal"`, `"add"` or `"alpha"` |
| `delay` | 0 | Seconds after the entry starts before this frame begins |
| `duration` | `null` | Seconds. `null`: a video plays its own length; an image lasts until the entry ends |
| `loop` | `false` | A video starts over when it ends, until its duration or the entry's end |
| `fadeIn` | 0.5 | Seconds |
| `fadeInStyle` | `"noise"` | `"noise"` (Noise Dissolve) or `"fade"` |
| `fadeOut` | 0.5 | Seconds, ending at the frame's end |
| `opacity` | 1.0 | 0–1 |

Fields left out of a file load as their defaults. Save writes every field.

### 3.4 Example

```json
"choreography": {
  "crossfade": 2.0,
  "entries": [
    {
      "id": "e_k2j9a", "name": "Triptych", "enabled": true, "holdTime": 40, "fadeTime": null,
      "frames": [
        { "id": "f_a1b2c", "title": "Left", "corners": [[0.08,0.2],[0.3,0.2],[0.3,0.8],[0.08,0.8]],
          "physicalAspect": 0.6571, "debugColor": "#FF453A",
          "asset": { "pool": "pools/paintings.json", "filepath": "media/nightmare.jpg" },
          "blend": "normal", "delay": 0, "duration": null, "loop": false,
          "fadeIn": 1.5, "fadeInStyle": "noise", "fadeOut": 1.0, "opacity": 1 },
        { "id": "f_d3e4f", "title": "Smoke", "corners": [[0,0],[1,0],[1,1],[0,1]],
          "physicalAspect": 1.7778, "debugColor": "#30D158",
          "asset": { "pool": "pools/videos.json", "filepath": "media/smoke.mp4" },
          "blend": "add", "delay": 4, "duration": 20, "loop": true,
          "fadeIn": 2, "fadeInStyle": "fade", "fadeOut": 2, "opacity": 0.8 }
      ]
    }
  ]
}
```

---

## 4. Playback

### 4.1 Sequencing

- The engine starts on the first playable entry, fading in from black over its fade time.
- When an entry ends, the next playable entry starts and the two **crossfade** over the incoming entry's fade time: the outgoing entry fades out while the incoming fades in. The outgoing entry keeps advancing during the crossfade (its playing frames keep playing), but nothing new starts in it.
- The list **loops**. A single playable entry crossfades into itself each time it ends.
- **Playable entry:** enabled, with at least one frame whose asset resolves, isn't `wallOnly` and hasn't failed.
- If nothing is playable, the current entry fades to black and the frames area stays empty (the wallpaper still plays).
- **Snapshot on start:** an entry's config is copied when it starts. Its timing (`holdTime`, delays, durations, fades, `loop`, `fadeInStyle`) applies from that snapshot until its next start. Mapping and look are read live (§4.7).

### 4.2 A frame's timeline

States: `pending → playing → done`.

- **pending → playing** when the entry clock reaches `delay` **and** its media is ready. While due but still loading it waits; after **15 s** waiting (`REGION_LOAD_TIMEOUT`), or if its media fails, it is `done` without playing.
- **Length once playing:**
  - `duration` set: that many seconds.
  - Entry has `holdTime`: a looping video, or an image, lasts until the entry ends; a non-looping video lasts its own length.
  - Entry has no `holdTime`: a video lasts its own length (loop ignored); an image lasts 10 s.
  - A video's length becomes known once it has loaded; until then its end is open.
- **Envelope:** `min(t / fadeIn, (end − t) / fadeOut)`, clamped to 0–1 (1 for a zero fade). An open end doesn't fade out.
- **Drawn alpha** = envelope × the entry's crossfade alpha × `opacity`.
- **Video transport:** when a frame starts playing, set `loop` (only if the frame loops **and** the entry has a `holdTime`), set `currentTime = 0` and play. When it is done, pause it.

### 4.3 Media

Keep this repo's loading patterns (`mediaLoader.ts`, `prepareTexture`, object URLs, revocation):

- Media is held in a **slot per choreographed frame id**. Load slots for every frame of the entries on screen (current and outgoing) and of the **upcoming** entry (the next playable one, or the previewed one). Dispose every other slot.
- The upcoming entry's media starts loading as soon as the current entry starts, so it is normally ready before its crossfade.
- A loaded video is paused and parked on frame 0 until its frame starts.
- Images are downscaled to at most 2× the frame's on-screen size: the bounding box of its corners in device pixels, capped at `maxTextureSize`.
- A slot whose asset changes is disposed and reloaded. A **failed** slot is kept (and its asset flagged) so it isn't retried every frame.
- **Pause Show** freezes the choreography clock and pauses the videos that were playing; Resume restarts only those still in use.
- A frame whose asset is `missing`, `error` or `wallOnly` is skipped.

### 4.4 Pan and zoom

Choreographed frames honour the asset's `zoom` and `pan` flags with Randomized mode's rules (`content/motion.ts`), adapted to a fixed timeline:

- **Video:** no motion (as in Randomized).
- **Image with `pan` and an aspect mismatch beyond `panAspectThreshold`:** pans from one edge of the cover-fit overflow to the other, direction from the aspect, start side random. **Image with `zoom`** (or `pan` within the threshold): `zoomStart` to 1.0, centred.
- **Motion window:** the frame's whole visible span, from the start of its fade in to the end of its fade out (`0` to `end` on its timeline), with the same eased start and stop. The travel or zoom is spread over that span, so its speed follows the frame's length; `panSpeed` and `maxHoldDuration` don't apply.
- **Open end:** an image whose end is the entry's end uses `holdTime − delay` as its span. (An image always has a known span: with no `holdTime` it is `duration` or the 10 s fallback.)
- `zoomStart` and `panAspectThreshold` come from the existing **Animation** settings.

### 4.5 Fade-in style

- `fadeInStyle: "noise"` uses the existing Noise Dissolve: the procedural noise threshold, driven by the frame's fade-in progress, with the show's `dissolveSoftness` and `dissolveNoiseScale`. `"fade"` is a plain fade.
- The style shapes only the frame's own fade in. Its fade out and the entry crossfade are plain fades.
- An unknown value falls back to `"noise"` with a load warning.

### 4.6 Blend

| Mode | Three.js | Shader output (k = fade × opacity × dissolve mask) |
|---|---|---|
| `normal` | `NormalBlending`, **`transparent: true`** | `rgb`, alpha `k` |
| `add` | `AdditiveBlending` | `rgb × k`, alpha 1 |
| `alpha` | `NormalBlending`, **`transparent: true`** | `rgb`, alpha `texture.a × k` |

- **`transparent: true` is required** for `normal` and `alpha` in three r186, or Three.js switches blending off.
- **Fades reveal what's behind.** A choreographed frame fading out (or not yet started) shows the wallpaper and earlier frames through it, not black. This differs from Randomized frames, which cover their area with black between assets; it's what lets entries layer and crossfade.
- `alpha` is for content with transparency: PNG, or WebM VP9 with alpha. Confirm on this machine, with a pixel readback or a visual check, that a VP9-alpha video texture keeps its alpha in Chrome. Ossuary confirmed it; record the result in the README.
- Randomized frames keep `normal` / `add` only.

### 4.7 Render order

1. Clear to the background colour.
2. Wall: wallpaper and wall test pattern (unchanged).
3. **Choreographed mode:** each entry on screen, outgoing first, then current; within an entry, its frames in list order. **Randomized mode:** the mapped frames, as now.
4. Captions (Randomized only).
5. Debug overlay.

Each choreographed frame draws through its own homography camera from its live corners, with cover fit to its `physicalAspect`. **Mapping (corners, aspect), blend and opacity are read live** from the store by frame id, so edits show immediately even on the entry playing. Timing comes from the entry's snapshot.

---

## 5. Show type, migration and load

### 5.1 Switching show type

- The Config section's **Show type** control reads **Randomized | Choreographed**.
- Switching restarts the frames: Choreographed starts from its first playable entry; Randomized restarts its frames as it does now. The wallpaper is not restarted.
- Both modes' settings are kept in the file whichever is active.

### 5.2 Validation on load

Follow `io/configIO.ts`: invalid values fall back to defaults and are listed as warnings under the Config section. Ids that are missing or duplicated get fresh ones, with a warning.

### 5.3 Migration from schemaVersion 2

- `showType: "manual"` becomes `"choreographed"`. The show's mapped frames and their playlists are converted into **one entry**, named "Converted from Manual", with `holdTime: 60`:
  - one choreographed frame per mapped frame, copying its `title`, `corners`, `physicalAspect`, `debugColor` and `blend`, with a new id;
  - its asset is the **first item** of that frame's playlist (none if empty); `loop: true`; the other timing fields at their defaults;
  - a load warning lists, per frame, the playlist items that were dropped.
- In every show, each mapped frame's `playlist` field is dropped. If a Randomized show had non-empty ones, a warning says they were removed (Randomized never used them).
- Version 2 files load normally and are written as version 3 on the next Save Show.
- Add migration tests: a manual show converts as above; a randomized show keeps its frames and drops their playlists; a version 3 file round-trips unchanged.

---

## 6. Panel

### 6.1 Sections by show type

- **Choreographed:** a **Choreography** section shows (below). The Mapping section keeps the wall quad and global settings; the mapped frames' subsections are hidden behind a note, "Frames are used by Randomized mode", and the mapped frames aren't drawn or handled on the canvas.
- **Randomized:** unchanged. The Choreography section is hidden.
- The **Animation** section stays. In Choreographed mode its help text says which settings apply there (`zoomStart`, `panAspectThreshold`, dissolve softness and noise scale); the rest are Randomized only.

### 6.2 Choreography section

Built from Ossuary's `playlistSection.ts`:

**Transport** (open by default):
- "Now playing: Entry N: name" ("Previewing: …" during a preview), and a progress bar across the entry's duration (empty while it isn't known).
- **⏮ Previous**, **Next ⏭** and a **Jump to entry…** dropdown: crossfade to that entry now.
- **Resume playlist**, shown only during a preview.
- The transport refreshes on a 250 ms timer while the panel is open; playback doesn't emit store events.

**Fields:** Crossfade (s), slider 0–10.

**Entries:** one collapsible section each.
- **Header:** colour swatch (grey when disabled) and "Entry N: name"; ↑ ↓, Duplicate and Remove right-aligned. The entry on screen is highlighted. Remove is immediate, with no confirmation, as for frames.
- **Body:** id in grey; **Preview** button; inline warnings (§6.5); Name; Enabled; **Hold time (s)** (a checkbox enables it; unset reads "until the last frame ends"); **Fade in (s)** (unset reads "playlist default"); then the frame editor.
- **Preview** jumps to the entry and keeps it on screen, restarting it each time it ends, until Resume playlist. The sequence then continues after it.
- **Duplicate** copies the entry, with new ids for it and every frame, just below it.
- **+ Add entry** at the end of the list.

### 6.3 Frame editor

Each entry lists its frames as collapsible subsections, built from the existing frame section (`mappingSection.ts`), as Ossuary's region editor is:

- **Header:** colour swatch and "Frame N: title"; ↑ ↓ (draw order), Duplicate and Remove right-aligned; the id in grey below.
- **Fields, in the existing frame order:** Title; Debug colour; Test pattern; **Blend** dropdown (Normal / Additive / Alpha; keep the Additive checkbox's hover help on the Additive option); the four control points (X/Y in device px, step 0.1); ↻ Rotate 90° clockwise; Physical aspect with a **Match asset** button (sets it to the loaded asset's own aspect); the convexity warning.
- **Asset:** one slot showing the thumbnail and name (with a `missing` / `failed` / `wall only` badge), opening the existing asset picker (grouped by pool, with Import new files… and Into asset pool). The picker doesn't offer `wallOnly` assets. Files dropped on the slot import and assign. × clears the asset.
- **Then:** Delay (s); Duration (s) (a checkbox enables it; unset reads "video: its own length; image: until the entry ends"); Loop; Fade in (s); Fade-in style (Noise Dissolve / Simple Fade); Fade out (s); Opacity slider; **Solo** (runtime only: draw only this frame while mapping it).
- **+ Add frame** creates a frame with the existing "Add new frame" geometry (centred on the canvas at the default size), the next free colour, and the defaults of §3.3. **Duplicate** copies a frame with a new id and colour, just below it.

### 6.4 Mapping on the canvas

- **The edited entry** is the most recently opened entry section. Only its frames get handles, debug outlines and Tab stops. Closing that section clears it.
- The existing interactions all apply to the edited entry's frames: drag a point; drag inside a frame to move it (topmost wins); Shift for fine motion; right-click to rotate; arrow-key nudging; numeric inputs; undo/redo, with the same step rules. Tab cycles through the edited entry's frame points, then the wall quad.
- **Test patterns** work as now: per frame, runtime only. A new frame starts with its pattern on while any test pattern is on; assigning an asset turns it off.
- Debug labels read "Frame N" within the edited entry.

### 6.5 Validation

Shown inline in the entry's section, in the existing warning style:

- A frame with no asset, or with an asset that is `missing`, `failed` or `wall only` ("skipped").
- No playable frame: "this entry is skipped".
- A looping frame in an entry with no Hold time ("plays once").
- An image frame with no Duration in an entry with no Hold time ("lasts 10 s").
- More than two video frames playing at once (from delays, durations and Hold time; a video with no Duration is assumed to run to the entry's end): "may stutter".
- A non-convex quad (the existing warning; the last valid mapping is kept).

### 6.6 Keys

- `N`: next entry (Choreographed only).
- Everything else as now (Space pauses, D toggles debug, Tab / Shift+Tab, Esc, arrows, Ctrl+Z).

---

## 7. Live edits

The existing Manual-mode rules, applied to entries:

- **Frame mapping, blend and opacity** apply immediately, including on the entry playing.
- **Timing** (`holdTime`, `fadeTime`, `delay`, `duration`, fades, `loop`, `fadeInStyle`) applies from the entry's next start.
- **Asset changes** on a frame of the entry playing: the slot reloads and the frame shows the new asset once it has loaded.
- **Adding, removing, reordering, enabling or disabling entries** applies at the next transition. Position is tracked by entry `id`: moving the entry on screen keeps its place in the sequence, and removing it continues with the entry that took its place.
- **Removing an asset** from a pool keeps the frames that use it and flags them missing. **Editing an asset's filepath** in the Assets section carries over to every frame that references it (marking the config modified). The Assets section's usage notes name "Entry N: name → Frame M" for choreographed frames.
- The config dirty flag covers every choreography edit.

---

## 8. Tests

Vitest, DOM-free logic, ported from Ossuary's tests where they exist:

- **Engine:** first entry fades in from black; `holdTime` then crossfade over the incoming fade time; loops, skipping disabled and unplayable entries; no `holdTime` → lasts until the last frame (delay + video length); delays and per-frame envelopes; a looping frame plays to the entry's end; a frame waits for media, and is dropped if it fails or never loads; timing edits apply from the next start; follows the entry on screen through a reorder; continues with the entry that took a removed one's place; next / previous / jump; preview restarts until resume; upcoming entry for preloading; a single entry crossfades into itself.
- **Motion:** the pan / zoom window equals the frame's span; open-ended images use `holdTime − delay`; videos never move.
- **Validation:** each warning in §6.5.
- **Store:** add / duplicate / remove / move entries and frames, ids unique across mapped and choreographed frames, colours distinct within an entry, test pattern rules, filepath carry-over, edited-entry rules, Tab order.
- **Config:** defaults for missing fields, invalid values warn, `fadeInStyle` fallback, the migrations of §5.3.

Run `npm test` before reporting. Add to the QA notes what can only be checked by eye: the noise dissolve on a choreographed frame, alpha WebM transparency, a crossfade between two entries, pan / zoom pacing on a long and a short image frame.

---

## 9. Out of scope

Ossuary features that do **not** come across:

- The `glow` and `pause` entry types, and the sweep / breathe / pause-noise materials.
- HOLD (guest activity pausing the entry clock), the pause-look fallback, and Manual hold.
- Layers (`background` / `bones` / `overlay`), the matte, the SDF and all masks.
- The colour flood.
- Wall-pixel coordinates and the master warp: frames here stay canvas-normalized, mapped directly.
- Ossuary's 500 × 500 wall-px "Add region" size: use this repo's Add new frame geometry.
- Captions in Choreographed mode.
- Anything networked (phones, server, ghosts, blood, seance, LEDs).

---

## 10. Decisions taken in this brief

Review these; each was a choice between reasonable options:

1. **Fade-in style default is `"noise"`**, matching Art Projector's look. Ossuary only had plain fades.
2. **Default blend for a new choreographed frame is `"normal"`** (Art Projector's frame default). Ossuary defaulted to `"add"` because its content was light on black bone.
3. **Fades reveal what's behind** (§4.6), rather than fading to black as Randomized frames do.
4. **Pan / zoom speed follows the frame's length** (§4.4); `panSpeed` and `maxHoldDuration` are ignored in Choreographed mode.
5. **Migration makes one 60 s entry** that crossfades into itself every minute. A converted show will visibly re-fade once a minute until the user sets a longer Hold time or adds entries.
6. **Config key `choreography`**, not `playlist`, so it doesn't collide with the wallpaper's `wallQuad.playlist` or the old per-frame `playlist`.
