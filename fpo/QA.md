# FPO QA content

Placeholder content for testing Art Projector before the real artwork is ready. Every image is a diagnostic card. Each one shows:
- the asset ID, its expected behavior, its pixel size and its aspect ratio
- a numbered grid, with the ID repeated along the middle row and middle column so you can identify any crop
- the words TOP, BOTTOM, L and R at the edges
- a yellow **TL** triangle in the top-left corner
- a center target

Videos also show:
- a running timecode
- a progress bar
- a sweep hand that turns once every 2 s, so dropped frames are easy to spot
- **START** and **END** flashes at the beginning and end

All text fields use lorem-style Latin.

Regenerate everything with `python fpo/generate.py`. This needs Pillow and ffmpeg, and it overwrites the three folders.

| Folder | Open it to test |
|---|---|
| `fpo/show/` | Cycling mode: every motion rule, every format, the caption-text variants, and all the error cases. 3 frames. |
| `fpo/static/` | Static mode: 3 frames and 2 assets, so the frames show A, B, A. |
| `fpo/tight-pool/` | Cycling with pool = frames + 1: 2 frames and 3 assets. |

Open a folder with **Load…** in the Config section. Each folder has its own `config.json` with default timing: cycle 12 s, panSpeed 0.03, maxHold 30 s and threshold 1.15. The frames are a generic layout, so remap them to the physical frames (or copy your mapped `frames` block in).

---

## 1. `fpo/show/`: loading and errors

When it opens, the **Assets** section should list 8 manifests:

| Manifest | Expected |
|---|---|
| `pools/paintings.json` | 17 assets, no errors |
| `pools/videos.json` | 6 assets, no errors |
| `pools/local/local.json` | 3 assets, no errors. Paths are relative to the manifest. Includes a filename with a space, `º` and `–`, plus a `sub dir/` |
| `pools/problems.json` | 9 assets with a **"Some entries had problems"** box listing 6 warnings. 5 assets are flagged **failed** at open (P01, P02, P05, P06, P07) |
| `pools/broken-syntax.json` | Error: not valid JSON |
| `pools/wrong-shape.json` | Error: missing an "assets" array |
| `pools/future-version.json` | Error: unsupported schemaVersion 99 |
| `pools/does-not-exist.json` | Error: file not found |

- [ ] The app keeps running and cycling despite all of the above.
- [ ] Per-asset error text in `problems.json`:

| Asset | When it fails | Error text |
|---|---|---|
| P01 | At open | `File not found` |
| P02 (`.gif`) | At open | `Unsupported file type` |
| P05 (no extension) | At open | `Unsupported file type` |
| P06 | At open | `Path escapes the project folder` |
| P07 (a folder) | At open | `Unsupported file type` |
| P03 (corrupt JPEG) | When the scheduler first picks it | `could not be decoded` |
| P04 (corrupt MP4) | When the scheduler first picks it | `Video format or codec not supported` |

- [ ] P03 and P04 are skipped after they fail, and the frame moves on to another asset without getting stuck.
- [ ] P10 and P11 (valid files) play normally.

## 2. Motion rules (frame aspect 0.6571)

Watch each asset when it comes up. The card's own text says what should happen.

| ID | File | Setup | Expected |
|---|---|---|---|
| A01 | jpg, portrait, exact frame aspect | no flags | Static for 12 s. The whole card is visible: TOP, BOTTOM, L and R all touch the edges |
| A02 | png, exact aspect | zoom | 1.15 → 1.0 over 12 s, centered on the target, with an eased start and stop |
| A03 | webp, wide (r 1.60) | pan | Horizontal pan, about **20 s** hold, edge L ↔ edge R, random start side |
| A04 | jpg panorama 6000×2000 (r 4.57) | pan | Horizontal pan **capped at 30 s**, visibly faster than A03 |
| A05 | jpg, tall (aspect 0.45) | pan | **Vertical** pan, about **23 s**, TOP ↔ BOTTOM |
| A06 | aspect 0.70 (r 1.07, below threshold) | pan + zoom | No pan. **Zooms** instead |
| A07 | aspect 0.70 | pan only | No pan and no zoom. **Static** |
| A08 | wide (r 2.28) | pan + zoom | **Pan wins**, no zoom, capped at 30 s |
| A09 | 16:9 landscape | no flags | Static cover crop. L and R are cut off, center target centered |
| A10 | 8192×5120 jpg | zoom | Loads with no visible hitch in other frames. The worker downscales it to about 3900 px |
| A11 | **AVIF** | no flags | Loads and displays |
| A12 | jpg with **EXIF orientation 6** | no flags | **Upright**: TL triangle top-left, text readable |
| A13 | `.JPEG` (uppercase extension) | no flags | Loads normally |
| A14 | PNG with alpha | no flags | Undefined case, so report what you see. The bottom hole is hot pink underneath; if pink shows, alpha is being ignored. The left third is 50% transparent |
| A15 | 197×300 tiny | no flags | Upscaled; softness is expected |

Videos:

| ID | File | Expected |
|---|---|---|
| V01 | H.264 MP4, 5 s, portrait | Loops (START flashes again at 5 s and 10 s), then is cut mid-loop at 12 s |
| V02 | **VP9 WebM**, 16 s, landscape, **has an audio track** | Plays **once**, the out-transition starts at END, and it is **silent** |
| V03 | **AV1 WebM**, 7 s | Loops and is cut at 12 s |
| V04 | H.264, **40 s** | Plays all 40 s (maxHold does not apply to video) and leaves on END |
| V05 | H.264, exactly **12 s** | Plays once and leaves on END |
| V06 | H.264, landscape, zoom + pan flags set | **No** zoom or pan; landscape cover crop |

Also watch for:
- [ ] Videos are the right way up and not mirrored; the TL triangle is top-left.
- [ ] Watch the sweep hand while other frames transition and load. It should turn smoothly, with no stutter.

## 3. Cycling behavior (`show/`)

- [ ] Stagger: the 3 frames start about 3 s apart, and transitions never line up in unison.
- [ ] In-transition is a noise dissolve from black. Out-transition is a fade to black. There is never a direct crossfade between artworks.
- [ ] The same asset is never in two frames at once, **except** these duplicate entries, which are separate assets and may appear together:
  - A01 and "Lorem Ipsum Dolor (duplicate entry)"
  - A02 and "Adipiscing Elit Sed (from local.json)"
  - A15 and "Numerus Annus"
- [ ] The same asset never appears twice in a row in one frame.
- [ ] **Add frame** (to 4) and **remove frame**: cycling continues, and the new frame starts after its stagger delay.
- [ ] Set **cycleDuration** to 5 and **transitionIn** to 3. The change applies from each frame's next cycle and does not jump.
- [ ] Insets (per frame, in Mapping): the black band hides the edges, and the artwork stays cover-fit inside it.

## 4. Assets panel editing and Save round-trip

- [ ] Each manifest group shows a count, plus a **failed** or **error** badge where it applies.
- [ ] Thumbnails load lazily when a group is opened. Video thumbnails show a poster frame, not black. A12's thumbnail is upright.
- [ ] Asset names fall back to the filename when the title is missing or blank. A13's title is three spaces, so its name should be `a13-uppercase-ext.JPEG`.
- [ ] Edit a title. The **Assets** dirty badge appears and the manifest shows **modified**.
- [ ] Change a file path to a missing file. It is flagged failed. Change it back, and the error clears and the thumbnail reloads.
- [ ] Toggle zoom on A01. It takes effect the **next** time A01 appears.
- [ ] Press **Save** (Assets). Only modified manifests are rewritten. Open the file and check:
  - In `problems.json`, the top-level `"curator"` field and P11's `"notes"` and `"custom"` fields are still there.
  - In `paintings.json`, the field order is kept, and keys that were never present were not added.
- [ ] **Load** with unsaved asset edits asks for confirmation first.
- [ ] Reload the page with unsaved edits. Chrome shows its "Leave site?" prompt.

> ⚠ **Known Save behavior, please decide:** saving `problems.json` rewrites it from what was parsed. These are **dropped** from the file:
> - the 3 entries that were skipped with warnings (P08, P09, and the non-object entry)
> - P10's invalid field values (`year: true`, `zoom: "yes"`, `pan: 1`)
>
> Also, `paintings.json` saves the numeric year `1999` as the text `"1999"`. Tell me if malformed entries should be kept verbatim instead.

## 5. Static mode (`fpo/static/`)

- [ ] Mode is static and the frames show **S-A, S-B, S-A**: a landscape image, then a looping video, then the image again.
- [ ] No transitions. S-A **does not move** even though its zoom and pan flags are set; it is a static landscape cover crop.
- [ ] The video (S-B) loops forever (START flashes every 5 s).
- [ ] Remove one frame (pool = frames): **S-A, S-B**, still static. Add two frames: the order wraps.
- [ ] Add frames until pool < frames, then remove them back below the pool size: mode recomputes each time.

## 6. Tight pool (`fpo/tight-pool/`)

- [ ] 2 frames and 3 assets: the frames never show the same T## at the same time.
- [ ] T02 zooms; T01 and T03 are static.
- [ ] Expected: occasionally a frame stays black a little longer between transitions while it waits for a free asset. It must never freeze.

## 7. Captions (M4)

- [ ] Captions sit centered below each frame's bottom edge. The title is in Source Serif 4 Italic and "artist, year" is in Public Sans, in warm off-white.
- [ ] The caption fades in and rises toward the frame once the artwork's dissolve finishes. Line 2 starts about 0.5 s after the title. Both fade out with the artwork.
- [ ] Static mode (`fpo/static/`): captions are shown immediately, with no animation.
- [ ] Drag or nudge a frame's bottom corners. The caption follows live and rotates to match the bottom edge's angle. The text re-sharpens a moment after you stop moving.
- [ ] Moving a wall-quad corner shifts captions with the wall.
- [ ] **Caption spacing** (per frame, in Mapping) moves that frame's caption away from or toward the frame.
- [ ] Caption sizes, gap, color, fade, rise and line-2 delay (in Animation) update live. Timing changes apply to the next appearance.
- [ ] Text is crisp on the projector, with no blur or blockiness.
- [ ] Editing a playing asset's title changes its caption at that asset's **next** appearance.

Text variants in `show/`, covering every case in brief §5.5:

| Case | Asset(s) |
|---|---|
| Title + artist + year | A01, A11 (title has quotes, which must render as written), A12 (diacritics, `—`, year range `1888–1891`), A14 (very long artist, Roman-numeral year), L01, V01 |
| Title only | A02, A15 |
| Artist only (line 2 in line 1's position) | A03 |
| Year only | A04 |
| Artist + year, no title | A05 |
| Title + year | A06, Numerus Annus (numeric JSON year) |
| Title + artist | A07, V02, V04 (long title) |
| Very long title (wraps to 2 lines, then scales down) | A08, V04 |
| Empty strings `""` (no caption) | A09 |
| No text keys at all (no caption) | A10, V05 |
| Whitespace-only title `"   "` + artist | A13 |
