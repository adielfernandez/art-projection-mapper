# art-projection-mapper

A browser app that projects artwork (images and videos) onto picture frames hanging on a wall. You line up a shape on screen with each real frame, and the app warps the artwork to fit it, then cycles through your content with fades or dissolves, slow pans and zooms, and museum-style captions underneath. It can also play "wallpaper" across the wall behind the frames.

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
- **The side panel** holds all the settings. It's open when the app starts; press **X** to show or hide it. Use the **Panel Alignment: L / R** buttons under the title to dock it on the left or right, and drag its inner edge (the one facing the stage) to make it wider or narrower; double-click that edge to go back to the default width.

While the panel is open you'll also see **mapping guides**: colored outlines and dots over each frame. They disappear when you close the panel, so the audience never sees them.

**First launch.** The app opens as a new, unsaved show with two frames, and the wall and both frames showing their **test patterns** (grids of squares) so you can start mapping right away. Untick **Test pattern** in each section once you're done. You can add content straight away too (see *Content Management*); the first time you save, the app asks which folder to keep the show in.

The panel is split into sections you can expand and collapse:

| Section | What it's for |
|---|---|
| **Pause Show** (top button) | Freezes all animation and video. Press it again (or the **Space bar**) to resume. |
| **Config** | **Load Show** and **Save Show**, and choose Randomized or Manual mode. |
| **Mapping** | Line up each frame with the real wall. Add, remove and reorder frames. |
| **Assets** | Add and remove content, and edit titles, artists and other details. |
| **Animation** | How new artwork appears (Simple Fade or Noise Dissolve), timing of transitions, pan and zoom speed, and caption size and color. |

Hover over any setting whose name has a dotted underline to see what it does. The **Config** and **Assets** labels in the panel header light up when you have unsaved changes.

### Modes: Randomized vs Manual

Choose the mode under **Config → Show type**. It's saved with your project.

**Randomized** (the default): every frame draws from one shared collection of all your content.
- If you have **more items than frames**, each frame shuffles through the collection on its own. The same item never shows in two frames at once.
- If you have **as many items as frames, or fewer**, each frame shows one item and keeps it. Images stay still, and videos loop.
- Best for: a big collection where you don't mind what shows where.

**Manual**: you choose exactly what each frame plays.
- Each frame gets its own **playlist**, which you build in that frame's section under **Mapping**. Click **+ Add asset** and pick from the thumbnails, then use **↑ ↓** to reorder and **×** to remove.
- To bring in brand-new files at the same time, click **Import new files…** at the top of the thumbnails, or drag files from your computer straight onto the playlist. They're added to an asset pool (pick which one under **Into asset pool** if you have several) and to this playlist in one go.
- A playlist with **several items** plays them in order and loops.
- A playlist with **one item** shows it and keeps it (videos loop).
- An **empty playlist** leaves the frame black.
- The same item can appear in several playlists, or several times in one.
- The item currently on screen is highlighted in the playlist. Changes take effect at the frame's next transition.
- Best for: telling a story, or when a piece belongs in a specific frame.

Switching modes restarts every frame. Your playlists are kept even while you're in Randomized mode.

**Wallpaper (both modes).** The **Wall quad** section has its own **Wallpaper playlist**, which plays behind the frames whatever the show type, like wallpaper. It works exactly like a Manual playlist: one item stays up, several cycle in order, and an empty one shows just the background color. Frames are drawn on top of it. To keep a wallpaper image out of the frames, tick **Wall only** on it in the Assets section: the frames then never show it (it's left out of the Randomized shuffle, and Manual frame playlists skip it), while the wall can still use it.

### Transitions

Under **Animation → Transition-In Style**, choose how each new artwork appears:
- **Simple Fade:** the whole frame fades up from black.
- **Noise Dissolve** (the default): the artwork appears through soft, spreading blotches. **Dissolve softness** and **Noise Scale** (shown only for this style) change how soft and how large the blotches are.

Artwork always fades out to black. Hover over any setting for details.

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

The point and arrow keys only work while the mapping guides are visible, so you can't bump anything by accident during the show.

#### Steps

1. **Set up.** Hang your frames, aim the projector at the wall, launch the app on the projector's screen and go full screen (**F11**).
2. **Measure each frame.** Use a tape measure on the **visible picture area** inside the frame (the opening, not the outer moulding). Divide the **width by the height**. For example, an opening 20 inches wide and 30 inches tall gives 20 ÷ 30 = **0.6667**. A wide frame gives a number above 1, a tall one below 1.
3. **Enter the aspect ratio.** Open **Mapping → Frame 1** and type that number into **Physical aspect (w÷h)**. This keeps artwork from looking stretched, even when the projector hits the wall at an angle.
4. **Add frames.** Click **+ Add new frame** until there's one on screen for each real frame, and enter each one's aspect ratio. Each frame has its own color, and its section title shows its number and its ID in gray.
5. **Line up the corners.** Drag each colored corner dot onto the matching corner of the real frame on the wall. You can also:
   - drag inside a frame to move the whole thing at once,
   - hold **Shift** while dragging for slow, precise movement,
   - select a point (click it or press **Tab**) and nudge it with the arrow keys,
   - type exact pixel positions into the X/Y boxes in the frame's section,
   - click **↻ Rotate 90° clockwise** (under the X/Y boxes) to turn the whole frame, picture and captions included, a quarter turn around its center. If that would push a corner off screen, the frame slides back on. **Ctrl + Z** undoes it.
6. **Check your work.** Make sure **Test pattern** is ticked at the top of the frame's section (it is for a new show; it switches itself off when you add content to that frame, so tick it again to re-check). It draws a grid of squares that should look evenly spaced and truly square on the wall. If the squares look stretched, re-check your measurement. If they look bent or uneven, adjust the corners.
   If light spills onto the frame's moulding, pull the corner points in slightly until the image sits just inside the opening.
7. **Position captions (optional).** Use **Caption X offset** and **Caption Y offset** to place the title text where you want it below each frame.
8. **Layering (optional).** Where frames overlap, frames lower in the list are drawn on top. Use the **↑ ↓** buttons in a frame's header to change the order. Tick **Additive blend** on a frame showing something bright on black (fire, glowing effects): its black parts become see-through, so frames behind it show through. Hover over **Additive blend** for a reminder.
9. **The Wall quad** (under Mapping) is the whole wall area: captions are placed in it, and it can show wallpaper (see below). For most setups, line its four corners up with the edges of the projected wall area. Its **Debug color** and **Test pattern** are at the top of its section, like the frames'.
10. **Save Show** (see below), close the panel with **X**, and the show is running.

#### Saving and loading

Everything for a show lives in one **project folder**, like `macabre-show/` or `baphomet-show/` in this repo.

- **Load Show** (in **Config**) opens a project folder. Chrome will ask permission to view and edit the folder; allow it.
- **Save Show** (in **Config**) writes your mapping, mode, playlists and animation settings into `config.json` in that folder. For a new show, it first asks which folder to keep the show in (pick or create an empty one).
- **Save Asset Pool** (on each asset pool in the **Assets** section) saves that pool's content: new files, removed items, and edited titles and details. **Save All Assets** at the top of the Assets section saves every pool at once; it only appears when the show has more than one pool.
- Nothing is written to your folder until you click one of these Save buttons. The **Config** and **Assets** labels at the top of the panel light up while something is unsaved.
- **Reopen Show:** after you reload the page or restart the computer, the app starts as a new, blank show. Click the **Reopen Show: (folder name)** button in **Config** to pick up where you left off.
- **Starting a new show:** reload the page for a blank show, then save it to a new folder. There's no "Save As"; to start from an existing show, copy its project folder, rename it, and load the copy.
- If you try to leave the page with unsaved changes, the browser will warn you first.

---

## Content Management

Your content is listed in **asset pools**: small JSON text files that sit in your project folder and list each image or video. A show can use one asset pool or several (for example one for paintings and one for videos). You can manage them entirely from the **Assets** section of the panel, or edit them in any text editor (Notepad, TextEdit, VS Code).

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
   - click **+ Add files…** (inside a pool, or in the Assets section of a new show) and choose images or videos; you can select several at once,
   - drag files from a File Explorer or Finder window and drop them onto a pool (or anywhere on the Assets section of a new show),
   - in **Manual** mode, import them straight from a frame's playlist (see *Modes* above).

   In a show with no asset pool yet, the first files go into a new pool called `assets.json`. To use your own pool names instead (for example one for paintings and one for videos), type a name at the bottom of the **Assets** section and click **+ Add asset pool** first. If a pool file with that name is already in the project folder, it's added to the show as is.
2. This all works before the show has a folder: new files play straight away, and are copied into the folder when you save.
3. Fill in each item's **Title**, **Artist** and **Year** for its caption, and tick **Zoom** or **Pan** if you like.
4. Click **Save Asset Pool** (or **Save All Assets**). If you created a new pool, also click **Save Show** so the show remembers to use it. In a new show, the first save asks which folder to keep the show in.

Good to know:
- **Files from elsewhere on your computer** (Downloads, Desktop, a USB stick) are copied into a `media/` folder next to the asset pool when you save it. Until then they're marked **new**, but they already play and show thumbnails. If a file with the same name is already there, the copy gets a number, like `flame (2).mp4`.
- **Files already inside the project folder** are used where they are; nothing is copied.
- **Adding a file the pool already lists** doesn't create a second copy of it.
- **Removing an asset pool:** click the red **×** in the pool's header, then **Save Show**. The pool file and its media stay on your disk. A show always keeps at least one pool, so the **×** is hidden on the last one.
- **Removing an item:** click the **×** on it. It's removed from the show, but the file itself stays on your disk. If a Manual playlist used it, that entry shows as **missing** until you remove it from the playlist.

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
| `wallOnly` | No (`true`/`false`) | Only for wallpaper: the wall can use it, the frames never show it. The **Wall only** checkbox in the Assets section. |

Leave out `title`, `artist` and `year` entirely (or leave them empty) and no caption appears. `zoom` and `pan` only affect images; videos always play still and full-frame.

### Things to look out for

- **Paths are relative to the asset pool file**, not to the app. If `my-art.json` and `media/` sit side by side, write `"media/nightmare.jpg"`. Files must be inside the project folder; a path can't point outside it.
- **Spelling and capitals matter.** `media/Flame.mp4` and `media/flame.mp4` are different files to the app. A misspelled path shows a red **failed** badge on that item in the Assets section, and the show skips it.
- **JSON is picky about punctuation.** Put a comma between items but **not** after the last one, and use straight double quotes (`"`), not curly ones. If an asset pool won't load, the Assets section shows an error. Paste the file into a free online "JSON validator" to find the mistake.
- **Supported files.** Images: `.jpg`, `.jpeg`, `.png`, `.webp`, `.avif`. Videos: `.mp4` (H.264) or `.webm`. Avoid HEVC/H.265 videos; many computers can't play them in Chrome.
- **Everything is cropped to fill the frame.** Artwork is scaled to cover the whole frame, so parts of a picture with a very different shape will be cut off (unless `pan` is on). Choose or crop artwork close to each frame's shape for best results.
- **Video length.** A video longer than the **Cycle duration** setting plays to its end before changing. A shorter one loops until the cycle time is up.
- **Keep videos reasonable.** A frame on the wall is usually a few hundred pixels wide in the projected image, so very large or 4K videos waste power. Around 720p at a good quality setting is plenty.
- **Editing in the app.** Everything in an asset pool can be changed in the **Assets** section: add and remove items, and edit titles, artists, years, paths and the zoom/pan checkboxes. Click **Save Asset Pool** to write the changes to the file.
- **Renaming a file used in a Manual playlist?** If you change its `filepath` in the Assets section, playlists follow along automatically. If you rename it by editing the JSON instead, update the playlists too, or those entries will show as missing.
