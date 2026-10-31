# Art Projection Mapper

A browser app that projects artwork (images and videos) onto picture frames hanging on a wall. You line up a shape on screen with each real frame, and the app warps the artwork to fit it exactly. It can then shuffle your content through the frames with fades or dissolves, slow pans and zooms, and museum-style captions, or play a **choreography**: timed scenes you design, each placing artwork anywhere on the wall. It can also play "wallpaper" across the wall behind everything.

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
| **Config** | **Load Show**, **Save Show**, and choosing Randomized or Choreographed mode. |
| **Mapping** | The background color, the **Wall quad** (including its wallpaper), and, for Randomized mode, each frame: lining it up with the wall, and adding, removing and reordering frames. |
| **Choreography** | Choreographed mode only: the scenes ("entries") and their frames, and controls to skip between them. |
| **Assets** | Adding and removing content, and editing titles, artists and other details. |
| **Animation** | How new artwork appears, timing, pan and zoom, and caption size and color. |

Hover over any setting whose name has a dotted underline to see what it does. The **Config** and **Assets** labels in the panel header light up when you have unsaved changes.

### Modes: Randomized vs Choreographed

Choose the mode under **Config → Show type**. It's saved with your show.

**Randomized** (the default): the frames you map under **Mapping** draw from one shared collection of all your content (except items marked **Wall only**, see *Wallpaper* below), with captions underneath.
- If you have **more items than frames**, each frame shuffles through the collection on its own. The same item never shows in two frames at once.
- If you have **as many items as frames, or fewer**, each frame shows one item and keeps it. Images stay still, and videos loop.
- Best for: a big collection on real picture frames, where you don't mind what shows where.

**Choreographed**: you design the show as a list of **entries** (scenes) that play in order and loop.
- Each entry has its own **frames**: shapes you place anywhere on the wall, each playing one image or video. A frame can start later than the others, last a set time, fade in and out, and sit on top of other frames.
- When an entry ends, the next one **crossfades** in.
- There are no captions in this mode, and the frames under **Mapping** aren't used (they're kept for Randomized mode).
- Best for: telling a story, effects layered over the wall, or anything that needs exact timing. See *Building a choreography* below.

Switching modes restarts the frames (Choreographed starts from its first entry). Both modes' settings are kept in your show, so you can switch back and forth.

**Wallpaper (both modes).** The **Wall quad** section (under **Mapping**) has its own **Wallpaper playlist**. It plays across the whole wall behind everything else, whichever mode you're in, and keeps playing when you switch modes.
- Click **+ Add asset** and pick from the thumbnails, then use **↑ ↓** to reorder and **×** to remove. To bring in brand-new files at the same time, click **Import new files…** at the top of the thumbnails, or drag files from your computer straight onto the playlist.
- One item stays up; several cycle in order using the **Animation** timing; an empty playlist shows just the background color (set under **Mapping → Global → Background**). The item on screen is highlighted.
- Everything else is drawn on top of it. Wallpaper has no captions.
- To keep a wallpaper image out of the frames, tick **Wall only** on it in the **Assets** section. The frames then never show it: it's left out of the Randomized shuffle, and a choreographed frame can't choose it. The wall can still use it.

**Opening an older show.** Shows saved before Choreographed mode existed may use the old **Manual** mode. They open as Choreographed: your frames become one entry called "Converted from Manual" that lasts 60 seconds, and each frame plays the **first** item of its old playlist (the Config section lists anything that was left out). The entry crossfades into itself every minute until you set a longer **Hold time** or add more entries. Click **Save Show** to keep the converted version.

### Mapping to your wall

"Mapping" means telling the app where each real picture frame sits in the projector's image, so the artwork lands exactly inside it.

#### Hotkeys

| Key | What it does |
|---|---|
| **Space bar** | Pause or resume the show |
| **N** | Choreographed mode: skip to the next entry |
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

These steps map the frames for **Randomized** mode. In **Choreographed** mode, each entry's frames are mapped the same way (see *Building a choreography*).

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
- **Save Show** (in **Config**) writes your mapping, mode, choreography, wallpaper and animation settings into `config.json` in that folder. For a new show, it first asks which folder to keep the show in; pick or create an empty one.
- **Save Asset Pool** (in each asset pool's header, in the **Assets** section) saves that pool's content: new files, removed items, and edited titles and details. **Save All Assets** at the top of the Assets section saves every pool at once; it only appears when the show has more than one pool.
- Nothing is written to your folder until you click one of these Save buttons. The **Config** and **Assets** labels at the top of the panel light up while something is unsaved, and the browser warns you if you try to leave the page with unsaved changes.
- **Reopen Show:** after you reload the page or restart the computer, the app starts as a new, blank show. Click the **Reopen Show: (folder name)** button in **Config** to pick up where you left off (Chrome may ask for permission again).
- **Starting a new show:** reload the page for a blank show, then save it to a new folder. There's no "Save As"; to start from an existing show, copy its project folder, rename it, and load the copy.

### Building a choreography

Switch **Config → Show type** to **Choreographed**. The **Choreography** section appears.

1. **Add an entry.** Click **+ Add entry** at the bottom of the section. Give it a **Name**.
2. **Add frames to it.** Open the entry and click **+ Add frame**. Each new frame appears in the middle of the screen with its test pattern on (while you're mapping). Frames lower in the list are drawn on top.
3. **Place each frame.** Only the frames of the entry you opened last have corner dots on the screen, so you can map one scene at a time. Map them just like Randomized frames (see *Mapping to your wall*): drag the corners or the whole frame, nudge with the arrow keys, type X/Y positions, **↻ Rotate 90° clockwise** or right-click. Set **Physical aspect (w÷h)** to the shape you want; **Match asset** sets it to the chosen image or video's own shape (available while the entry is playing or up next). Tick **Solo** to hide the entry's other frames while you work on one.
4. **Choose what it plays.** Click **Choose asset…** and pick a thumbnail, or click **Import new files…**, or drop a file onto the **Asset** box. Assigning an asset turns the frame's test pattern off. **×** clears it.
5. **Set its timing** (all in seconds):
   - **Delay**: how long after the entry starts this frame begins.
   - **Duration**: how long it plays. Leave it unticked and a video plays its whole length, while an image stays until the entry ends.
   - **Loop**: a video starts over each time it ends (needs the entry's **Hold time**).
   - **Fade in** and **Fade-in style** (**Noise Dissolve** or **Simple Fade**), and **Fade out**.
   - **Opacity**: 1 is solid, 0.5 is half see-through.
6. **Set the entry's timing.**
   - **Hold time**: tick it to make the entry last exactly that long; looping frames loop until then. Unticked, the entry lasts until its last frame finishes (an image with no Duration then lasts 10 seconds).
   - **Fade in**: tick it to give this entry its own crossfade length. Unticked, it uses **Crossfade** at the top of the section.
   - **Enabled**: untick it to skip the entry without deleting it.
7. **Order the entries** with **↑ ↓** in their headers. **Duplicate** copies an entry (or a frame) just below it; **Remove** deletes it straight away.

**Blend** (on each frame) decides how it combines with what's behind it:
- **Normal**: covers what's behind it. While it fades, what's behind shows through (not black).
- **Additive**: adds its light, so black parts are see-through. Use it for fire, smoke, sparks or glows shot on black.
- **Alpha**: uses the file's own transparency: a PNG with a transparent background, or a WebM video saved with transparency (VP9 with alpha). Tested in Chrome 155 on Windows: both kept their transparency.

**Warnings.** Each entry lists problems at the top of its section, such as a frame with no asset, a missing file, a looping frame in an entry with no Hold time, or more than two videos playing at once (which may stutter). An entry with nothing it can play is skipped.

**Watching and testing** (at the top of the section, under **Transport**):
- **Now playing** names the entry on screen, with a bar showing how far through it is.
- **⏮ Previous**, **Next ⏭** (or the **N** key) and **Jump to entry…** crossfade to another entry straight away.
- **Preview** (in an entry) jumps to it and repeats it until you click **Resume playlist**; the show then carries on after it.

Changes to a frame's position, shape, blend and opacity show immediately, even on the entry playing. Timing changes apply the next time the entry starts. A new asset on a playing frame appears once it has loaded.

### Transitions and timing

These settings are in the **Animation** section. In **Choreographed** mode, each frame sets its own timing and fade-in style, so only **Dissolve softness**, **Noise Scale**, **Zoom start** and **Pan aspect threshold** apply there; a zooming or panning image moves across the frame's whole time on screen.

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

Timing changes apply from each frame's next artwork; the transition style, noise settings and caption look change right away. Hover over any setting for details.

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
   - import them straight from the wallpaper playlist, or from a choreographed frame's **Asset** box (see above).

   In a show with no asset pool yet, the first files go into a new pool called `assets.json`. To use your own pool names instead (for example one for paintings and one for videos), type a name at the bottom of the **Assets** section and click **+ Add asset pool** first. If a pool file with that name is already in the project folder, it's added to the show as it is.
2. This all works before the show has a folder: new files play straight away, and are copied into the folder when you save.
3. Fill in each item's **Title**, **Artist** and **Year** for its caption, and tick **Zoom**, **Pan** or **Wall only** if you like.
4. Click **Save Asset Pool** (or **Save All Assets**). If you created a new pool, also click **Save Show** so the show remembers to use it. In a new show, the first save asks which folder to keep the show in.

Good to know:
- **Files from elsewhere on your computer** (Downloads, Desktop, a USB stick) are copied into a `media/` folder next to the asset pool when you save it. Until then they're marked **new**, but they already play and show thumbnails. If a file with the same name is already there, the copy gets a number, like `flame (2).mp4`.
- **Files already inside the project folder** are used where they are; nothing is copied. Picking one the pool already lists doesn't add it twice.
- **Removing an item:** click the **×** on it, then **Save Asset Pool**. It's removed from the show, but the file itself stays on your disk. If the wallpaper or a choreographed frame used it, that shows as **missing** until you change it. Hover over the **×** to see what uses it.
- **Removing an asset pool:** click the red **×** in the pool's header, then **Save Show**. The pool file and its media stay on your disk. A show always keeps at least one pool, so the **×** is hidden on the last one.
- Short confirmation messages ("Added 1 file…", "Saved…") fade away after a few seconds. Warnings, such as a file that couldn't be added, stay until the next message.

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
| `wallOnly` | No (`true`/`false`) | For wallpaper only: the wall can use it, the frames (in either mode) never show it. Same as the **Wall only** checkbox. |

Leave out `title`, `artist` and `year` entirely (or leave them empty) and no caption appears. `zoom` and `pan` only affect images; videos always play still and fill the frame.

### Things to look out for

- **Paths are relative to the asset pool file**, not to the app. If `my-art.json` and `media/` sit side by side, write `"media/nightmare.jpg"`. Files must be inside the project folder; a path can't point outside it.
- **Spelling and capitals matter.** `media/Flame.mp4` and `media/flame.mp4` are different files to the app. A misspelled path shows a red **failed** badge on that item in the Assets section, and the show skips it.
- **JSON is picky about punctuation.** Put a comma between items but **not** after the last one, and use straight double quotes (`"`), not curly ones. If an asset pool won't load, the Assets section shows an error. Paste the file into a free online "JSON validator" to find the mistake.
- **Supported files.** Images: `.jpg`, `.jpeg`, `.png`, `.webp`, `.avif`. Videos: `.mp4` (H.264) or `.webm`. Avoid HEVC/H.265 videos; many computers can't play them in Chrome.
- **Everything is cropped to fill the frame.** Artwork is scaled to cover the whole frame (or the whole wall, for wallpaper), so parts of a picture with a very different shape are cut off unless `pan` is on. Choose or crop artwork close to each frame's shape for best results.
- **Video length (Randomized).** A video longer than **Cycle duration** plays to its end before changing. A shorter one loops until the cycle time is up. In Choreographed mode, a frame's **Duration** and **Loop** decide instead.
- **Transparency.** Only the **Alpha** blend (Choreographed mode) uses a file's transparency. For a video with a transparent background, export a WebM with the VP9 codec and an alpha channel; MP4 can't carry transparency.
- **Keep videos reasonable.** A frame on the wall is usually a few hundred pixels wide in the projected image, so very large or 4K videos waste power. Around 720p at a good quality setting is plenty for a frame; wallpaper covers the whole wall, so it can use the full projector resolution.
- **Editing in the app.** Everything in an asset pool can be changed in the **Assets** section: add and remove items, and edit titles, artists, years, paths and the Zoom, Pan and Wall only checkboxes. Click **Save Asset Pool** to write the changes to the file.
- **Renaming a file the show uses?** If you change its `filepath` in the Assets section, the wallpaper playlist and choreographed frames follow along automatically. If you rename it by editing the JSON instead, update those too, or they'll show as missing.
