"""
Generate FPO (for placement only) QA project folders for Art Projector.

    python fpo/generate.py

Writes three self-contained project folders next to this script:
    fpo/show/        cycling mode: every motion rule, caption variant, format and error case
    fpo/static/      static mode: 3 frames, 2 assets (A, B, A)
    fpo/tight-pool/  cycling with assets = frames + 1

Requires Pillow (with AVIF support) and ffmpeg on PATH. Re-running overwrites the folders.
"""

from __future__ import annotations

import json
import math
import random
import shutil
import subprocess
from pathlib import Path

from PIL import Image, ImageDraw, ImageFont

ROOT = Path(__file__).resolve().parent
FRAME_ASPECT = 0.6571  # physicalAspect default (23" x 35")
CANVAS_ASPECT = 16 / 9
FONTS = Path("C:/Windows/Fonts")
FPS = 24


def font(size: int, bold: bool = False) -> ImageFont.FreeTypeFont:
    return ImageFont.truetype(str(FONTS / ("arialbd.ttf" if bold else "arial.ttf")), max(8, int(size)))


def hsl(h: float, s: float, l: float) -> tuple[int, int, int]:
    import colorsys

    r, g, b = colorsys.hls_to_rgb(h % 1, l, s)
    return int(r * 255), int(g * 255), int(b * 255)


# ---------------------------------------------------------------- images


def placeholder(w: int, h: int, ident: str, hue: float, lines: list[str]) -> Image.Image:
    """Diagnostic card: gradient, numbered grid, edge labels, TL marker, center target, info block."""
    a, b = hsl(hue, 0.55, 0.22), hsl(hue + 0.08, 0.6, 0.45)
    grad = Image.linear_gradient("L").rotate(45, expand=True).resize((w, h))
    img = Image.composite(Image.new("RGB", (w, h), b), Image.new("RGB", (w, h), a), grad)
    d = ImageDraw.Draw(img)
    short = min(w, h)
    step = short / 10
    line_c = hsl(hue, 0.3, 0.75)
    lw = max(1, short // 400)
    small = font(step * 0.22)

    # Numbered grid; the ID repeats along the middle so any crop identifies the asset.
    cols, rows = int(w / step) + 1, int(h / step) + 1
    for i in range(cols):
        x = i * step
        d.line([(x, 0), (x, h)], fill=line_c, width=lw)
        d.text((x + 4, 4), str(i), fill=line_c, font=small)
        d.text((x + 4, h - step * 0.3), str(i), fill=line_c, font=small)
        d.text((x + 4, h / 2 + 4), f"{ident}·x{i}", fill=line_c, font=small)
    for j in range(rows):
        y = j * step
        d.line([(0, y), (w, y)], fill=line_c, width=lw)
        d.text((4, y + 4), str(j), fill=line_c, font=small)
        d.text((w - step * 0.35, y + 4), str(j), fill=line_c, font=small)
        d.text((w / 2 + 4, y + 4), f"{ident}·y{j}", fill=line_c, font=small)

    # Edge labels and a yellow top-left triangle for orientation.
    edge = font(step * 0.6, bold=True)
    white = (255, 255, 255)
    d.text((w / 2, step * 0.55), "TOP", fill=white, font=edge, anchor="mm")
    d.text((w / 2, h - step * 0.55), "BOTTOM", fill=white, font=edge, anchor="mm")
    d.text((step * 0.6, h / 2), "L", fill=white, font=edge, anchor="mm")
    d.text((w - step * 0.6, h / 2), "R", fill=white, font=edge, anchor="mm")
    d.polygon([(0, 0), (step * 1.2, 0), (0, step * 1.2)], fill=(255, 214, 10))
    d.text((step * 0.15, step * 0.1), "TL", fill=(0, 0, 0), font=font(step * 0.3, bold=True))
    border = max(2, short // 150)
    d.rectangle([0, 0, w - 1, h - 1], outline=white, width=border)

    # Center target (zoom must stay centered on it).
    cx, cy = w / 2, h / 2
    for r in (0.1, 0.2):
        R = short * r
        d.ellipse([cx - R, cy - R, cx + R, cy + R], outline=white, width=lw * 2)
    d.line([(cx - short * 0.25, cy), (cx + short * 0.25, cy)], fill=white, width=lw * 2)
    d.line([(cx, cy - short * 0.25), (cx, cy + short * 0.25)], fill=white, width=lw * 2)

    # Info block, sized to the part that stays visible when cover-fit into a portrait frame.
    vis_w = min(w, h * FRAME_ASPECT)
    cx, cy = w / 2, h / 2
    big = font(vis_w * 0.22, bold=True)
    size = vis_w * 0.05
    while size > 6 and max(d.textlength(t, font=font(size)) for t in lines + [""]) > vis_w * 0.86:
        size *= 0.92
    info = font(size)
    box_w = min(vis_w * 0.94, max(max(d.textlength(t, font=info) for t in lines + [""]), d.textlength(ident, font=big)) + vis_w * 0.06)
    line_h = size * 1.3
    box_h = vis_w * 0.26 + len(lines) * line_h + vis_w * 0.03
    top = cy - min(h * 0.42, box_h + short * 0.05)
    d.rectangle([cx - box_w / 2, top, cx + box_w / 2, top + box_h], fill=(0, 0, 0))
    d.text((cx, top + vis_w * 0.02), ident, fill=white, font=big, anchor="ma")
    for k, t in enumerate(lines):
        d.text((cx, top + vis_w * 0.26 + k * line_h), t, fill=(230, 230, 230), font=info, anchor="ma")
    return img


def save_image(img: Image.Image, path: Path, **kw) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    img.save(path, **kw)


# ---------------------------------------------------------------- videos


def make_video(path: Path, w: int, h: int, seconds: float, ident: str, hue: float, lines: list[str],
               codec: str, audio: bool = False) -> None:
    """Timecode, progress bar and a rotating sweep (for spotting hitches). START/END flash at the ends."""
    bg = placeholder(w, h, ident, hue, lines)
    n = round(seconds * FPS)
    short = min(w, h)
    vis_w = min(w, h * FRAME_ASPECT)
    flash_font = font(vis_w * 0.2, bold=True)
    path.parent.mkdir(parents=True, exist_ok=True)

    cmd = ["ffmpeg", "-y", "-hide_banner", "-loglevel", "error",
           "-f", "rawvideo", "-pix_fmt", "rgb24", "-s", f"{w}x{h}", "-r", str(FPS), "-i", "-"]
    if audio:
        cmd += ["-f", "lavfi", "-i", f"sine=frequency=220:duration={seconds}"]
    if codec == "h264":
        cmd += ["-c:v", "libx264", "-preset", "fast", "-crf", "22", "-pix_fmt", "yuv420p", "-movflags", "+faststart"]
    elif codec == "vp9":
        cmd += ["-c:v", "libvpx-vp9", "-b:v", "0", "-crf", "34", "-row-mt", "1", "-deadline", "realtime",
                "-cpu-used", "8", "-pix_fmt", "yuv420p"]
    elif codec == "av1":
        cmd += ["-c:v", "libsvtav1", "-preset", "10", "-crf", "40", "-pix_fmt", "yuv420p", "-svtav1-params", "log-level=0"]
    if audio:
        cmd += ["-c:a", "libopus" if path.suffix == ".webm" else "aac", "-shortest"]
    cmd.append(str(path))

    proc = subprocess.Popen(cmd, stdin=subprocess.PIPE)
    assert proc.stdin
    bar_y = h - short * 0.06
    tc_top = bar_y - short * 0.13
    R = short * 0.13
    cx, cy = w / 2, tc_top - R - short * 0.03
    tc_font = font(min(short * 0.08, vis_w * 0.075), bold=True)
    for i in range(n):
        t = i / FPS
        f = bg.copy()
        d = ImageDraw.Draw(f)
        ang = t * 2 * math.pi / 2  # one turn per 2 s
        d.ellipse([cx - R, cy - R, cx + R, cy + R], fill=(0, 0, 0), outline=(255, 255, 255), width=3)
        d.line([(cx, cy), (cx + R * math.sin(ang), cy - R * math.cos(ang))], fill=(255, 214, 10), width=max(3, short // 120))
        d.rectangle([cx - vis_w * 0.45, tc_top, cx + vis_w * 0.45, bar_y], fill=(0, 0, 0))
        d.text((cx, tc_top + short * 0.02), f"{t:05.2f} / {seconds:.1f}s", fill=(255, 255, 255), font=tc_font, anchor="ma")
        d.rectangle([0, bar_y, w, h], fill=(0, 0, 0))
        d.rectangle([0, bar_y, w * (i + 1) / n, h], fill=(255, 214, 10))
        if t < 0.75:
            d.text((cx, h * 0.62), "START", fill=(48, 209, 88), font=flash_font, anchor="mm", stroke_width=4, stroke_fill=(0, 0, 0))
        elif t > seconds - 0.75:
            d.text((cx, h * 0.62), "END", fill=(255, 69, 58), font=flash_font, anchor="mm", stroke_width=4, stroke_fill=(0, 0, 0))
        proc.stdin.write(f.tobytes())
    proc.stdin.close()
    if proc.wait() != 0:
        raise RuntimeError(f"ffmpeg failed for {path}")


# ---------------------------------------------------------------- project files


def frame(fid: str, cx: float, color: str) -> dict:
    hh = 0.25  # half of 50% canvas height
    hw = hh * FRAME_ASPECT / CANVAS_ASPECT
    return {
        "id": fid,
        "corners": [[cx - hw, 0.5 - hh], [cx + hw, 0.5 - hh], [cx + hw, 0.5 + hh], [cx - hw, 0.5 + hh]],
        "physicalAspect": FRAME_ASPECT,
        "debugColor": color,
        "captionSpacing": 0.05,
    }


def config(pools: list[str], frames: list[dict]) -> dict:
    return {
        "schemaVersion": 2,
        "assetPools": pools,
        "ui": {"panelSide": "left"},
        "global": {"backgroundColor": "#000000", "debug": {"strokeWidth": 2, "pointRadius": 14, "crosshairSize": 22}},
        "wallQuad": {"corners": [[0, 0], [1, 0], [1, 1], [0, 1]], "debugColor": "#0A84FF"},
        "frames": frames,
        "animation": {
            "cycleDuration": 12, "transitionInDuration": 1.5, "transitionOutDuration": 1.0, "frameStagger": 3,
            "zoomStart": 1.15, "panSpeed": 0.03, "panAspectThreshold": 1.15, "maxHoldDuration": 30,
        },
        "captions": {
            "titleSize": 0.045, "lineTwoSize": 0.032, "lineGap": 0.012, "color": "#F0EBE3",
            "fadeDuration": 1.2, "riseDistance": 0.02, "lineTwoDelay": 0.5,
        },
        "effects": {"back": {"type": "placeholder", "params": {}}, "front": {"type": "placeholder", "params": {}}},
    }


def write_json(path: Path, data: object) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(data, indent=2, ensure_ascii=False) + "\n", encoding="utf-8")


def size_for(aspect: float, long_side: int) -> tuple[int, int]:
    return (long_side, round(long_side / aspect)) if aspect >= 1 else (round(long_side * aspect), long_side)


def r_label(aspect: float) -> str:
    return f"aspect {aspect:.3f} · r = {aspect / FRAME_ASPECT:.2f}"


# ---------------------------------------------------------------- show


def build_show() -> None:
    out = ROOT / "show"
    img_dir = out / "media" / "images"
    vid_dir = out / "media" / "videos"

    # (id, file, aspect, long side, hue, expectation lines, asset pool entry text fields + flags, save kwargs)
    images = [
        ("A01", "a01-portrait-static.jpg", FRAME_ASPECT, 2000, 0.00, ["STATIC · no zoom, no pan", "fills frame exactly"],
         {"title": "Lorem Ipsum Dolor", "artist": "Sit Amet Consectetur", "year": "1889"}),
        ("A02", "a02-portrait-zoom.png", FRAME_ASPECT, 2000, 0.07, ["ZOOM 1.15 → 1.0 over 12 s", "centered on target"],
         {"title": "Adipiscing Elit Sed", "zoom": True}),
        ("A03", "a03-wide-pan.webp", 1.05, 2100, 0.14, ["PAN horizontal · ~20 s hold", "edge L ↔ edge R"],
         {"artist": "Eiusmod Tempor", "pan": True}),
        ("A04", "a04-panorama-pan-capped.jpg", 3.0, 6000, 0.21, ["PAN horizontal · capped at 30 s", "faster than A03"],
         {"year": "1901", "pan": True}),
        ("A05", "a05-tall-pan-vertical.jpg", 0.45, 2400, 0.28, ["PAN vertical · ~23 s hold", "TOP ↔ BOTTOM"],
         {"artist": "Incididunt Ut Labore", "year": "c. 1650", "pan": True}),
        ("A06", "a06-near-aspect-pan-zoom.jpg", 0.70, 2000, 0.35, ["pan=true but r < 1.15 → ZOOM", "(no pan)"],
         {"title": "Et Dolore Magna", "year": "1923", "pan": True, "zoom": True}),
        ("A07", "a07-near-aspect-pan-only.jpg", 0.70, 2000, 0.42, ["pan=true but r < 1.15 → STATIC", "(no zoom, no pan)"],
         {"title": "Aliqua Ut Enim", "artist": "Ad Minim Veniam", "pan": True}),
        ("A08", "a08-wide-pan-and-zoom.jpg", 1.5, 3000, 0.49,
         ["pan + zoom, r > 1.15 → PAN wins", "zoom ignored · capped 30 s"],
         {"title": "Quis Nostrud Exercitation Ullamco Laboris Nisi Ut Aliquip Ex Ea Commodo Consequat Duis Aute Irure Dolor",
          "artist": "Reprehenderit In Voluptate", "year": "1777", "pan": True, "zoom": True}),
        ("A09", "a09-landscape-static-crop.jpg", 16 / 9, 3840, 0.56, ["STATIC · landscape cover crop", "L and R edges cut off"],
         {"title": "", "artist": "", "year": ""}),
        ("A10", "a10-huge-8k-zoom.jpg", 1.6, 8192, 0.63, ["8192 px source · worker downscale", "ZOOM · watch for hitch"],
         {"zoom": True}),
        ("A11", "a11-avif.avif", FRAME_ASPECT, 2000, 0.70, ["AVIF format", "STATIC"],
         {"title": "Velit \"Esse\" Cillum", "artist": "Dolore Eu Fugiat", "year": "1912"}),
        ("A12", "a12-exif-rotated.jpg", FRAME_ASPECT, 2000, 0.77, ["EXIF orientation 6", "must appear UPRIGHT (TL top-left)"],
         {"title": "Nulla Pariatur — Æterna Señora", "artist": "Excepteur Sînt Occaecat", "year": "1888–1891"}),
        ("A13", "a13-uppercase-ext.JPEG", FRAME_ASPECT, 2000, 0.84, ["UPPERCASE .JPEG extension", "should load normally"],
         {"title": "   ", "artist": "Cupidatat Non Proident"}),
        ("A14", "a14-transparent.png", FRAME_ASPECT, 2000, 0.91,
         ["PNG with alpha", "hole + left third 50% transparent", "pink = alpha ignored"],
         {"title": "Sunt In Culpa", "artist": "Qui Officia Deserunt Mollitia Animi Id Est Laborum Et Dolorum Fuga",
          "year": "MDCCLXXVI"}),
        ("A15", "a15-tiny.jpg", FRAME_ASPECT, 300, 0.95, ["300 px tiny source", "upscaled (soft is OK)"],
         {"title": "Minimus"}),
    ]

    entries = []
    for ident, name, aspect, long_side, hue, lines, fields in images:
        w, h = size_for(aspect, long_side)
        img = placeholder(w, h, ident, hue, lines + [f"{w}×{h} · {r_label(aspect)}", name])
        path = img_dir / name
        if ident == "A12":
            from PIL import Image as _I

            exif = _I.Exif()
            exif[0x0112] = 6  # display = rotate stored pixels 90° clockwise
            save_image(img.rotate(90, expand=True), path, quality=90, exif=exif)
        elif ident == "A14":
            rgba = img.convert("RGBA")
            mask = Image.new("L", (w, h), 255)
            md = ImageDraw.Draw(mask)
            md.rectangle([0, 0, w // 3, h], fill=128)
            R = min(w, h) * 0.12
            md.ellipse([w / 2 - R, h * 0.75 - R, w / 2 + R, h * 0.75 + R], fill=0)
            # Fully transparent pixels carry hot pink so "alpha ignored" is unmistakable.
            pink = Image.new("RGBA", (w, h), (255, 0, 170, 255))
            rgba = Image.composite(rgba, pink, mask.point(lambda v: 255 if v > 0 else 0))
            rgba.putalpha(mask)
            save_image(rgba, path)
        elif name.lower().endswith(".avif"):
            save_image(img, path, quality=70)
        elif name.lower().endswith(".webp"):
            save_image(img, path, quality=85)
        elif name.lower().endswith(".png"):
            save_image(img, path, optimize=True)
        else:
            save_image(img, path, quality=88)
        entries.append({**{k: v for k, v in fields.items() if k in ("title", "artist", "year")},
                        "filepath": f"../media/images/{name}",
                        **{k: v for k, v in fields.items() if k in ("zoom", "pan")}})

    # Duplicate entry of A01 in the same asset pool: may appear in two frames at once.
    entries.append({"title": "Lorem Ipsum Dolor (duplicate entry)", "artist": "Sit Amet Consectetur", "year": "1889",
                    "filepath": "../media/images/a01-portrait-static.jpg"})
    # Numeric year in JSON: accepted and shown as text.
    entries.append({"title": "Numerus Annus", "year": 1999, "filepath": "../media/images/a15-tiny.jpg"})
    write_json(out / "pools" / "paintings.json", {"schemaVersion": 1, "assets": entries})

    # ---- videos
    videos = [
        ("V01", "v01-loop-5s-h264.mp4", (1080, 1644), 5, 0.10, "h264", False,
         ["H.264 MP4 · 5 s < cycle", "LOOPS, cut at 12 s mid-loop"],
         {"title": "Video Lorem Breve", "artist": "Ipsum Motus", "year": "2024"}),
        ("V02", "v02-once-16s-vp9-audio.webm", (1920, 1080), 16, 0.30, "vp9", True,
         ["VP9 WebM · 16 s ≥ cycle · has audio", "PLAYS ONCE, out on END (must be silent)"],
         {"title": "Longior Pellicula", "artist": "Dolor Cinematica"}),
        ("V03", "v03-loop-7s-av1.webm", (1080, 1644), 7, 0.50, "av1", False,
         ["AV1 WebM · 7 s", "LOOPS, cut at 12 s"],
         {"year": "2025"}),
        ("V04", "v04-long-40s-h264.mp4", (1280, 720), 40, 0.70, "h264", False,
         ["H.264 · 40 s > maxHold 30", "PLAYS ALL 40 s (maxHold ignored)"],
         {"title": "Pellicula Longissima Quae Non Finitur Ante Quadraginta Secundas", "artist": "Tempus Fugit"}),
        ("V05", "v05-exact-12s-h264.mp4", (1080, 1644), 12, 0.85, "h264", False,
         ["H.264 · exactly 12 s = cycle", "PLAYS ONCE, out on END"],
         {}),
        ("V06", "v06-flags-ignored-h264.mp4", (1920, 1080), 4, 0.95, "h264", False,
         ["zoom + pan flags set", "must NOT zoom or pan (video)"],
         {"title": "Motus Ignoratus", "zoom": True, "pan": True}),
    ]
    ventries = []
    for ident, name, (w, h), secs, hue, codec, audio, lines, fields in videos:
        print(f"  encoding {name} …", flush=True)
        make_video(vid_dir / name, w, h, secs, ident, hue, lines + [f"{w}×{h} · {r_label(w / h)}"], codec, audio)
        ventries.append({**{k: v for k, v in fields.items() if k in ("title", "artist", "year")},
                         "filepath": f"../media/videos/{name}",
                         **{k: v for k, v in fields.items() if k in ("zoom", "pan")}})
    write_json(out / "pools" / "videos.json", {"schemaVersion": 1, "assets": ventries})

    # ---- asset pool in a subfolder with media next to it (paths relative to the pool file)
    local_art = out / "pools" / "local" / "art"
    for ident, name, hue, fields in [
        ("L01", "Cripta nº1 – lorem ipsum.jpg", 0.60, {"title": "Locus Proximus", "artist": "Via Relativa", "year": "1955"}),
        ("L02", "sub dir/l02-nested.webp", 0.65, {"title": "Profundus", "zoom": True}),
    ]:
        w, h = size_for(FRAME_ASPECT, 1600)
        save_image(placeholder(w, h, ident, hue, ["pool: pools/local/local.json", f"file: art/{name}",
                                                  "spaces / unicode / subfolder"]), local_art / name, quality=88)
    write_json(out / "pools" / "local" / "local.json", {"schemaVersion": 1, "assets": [
        {"title": "Locus Proximus", "artist": "Via Relativa", "year": "1955", "filepath": "art/Cripta nº1 – lorem ipsum.jpg"},
        {"title": "Profundus", "filepath": "art/sub dir/l02-nested.webp", "zoom": True},
        # Same file as A02, listed from another asset pool (deep ../ path).
        {"title": "Adipiscing Elit Sed (from local.json)", "filepath": "../../media/images/a02-portrait-zoom.png", "zoom": True},
    ]})

    # ---- problems: per-asset errors, warnings and preserved unknown fields
    pdir = out / "media" / "problems"
    pdir.mkdir(parents=True, exist_ok=True)
    rnd = random.Random(13)
    (pdir / "p03-corrupt.jpg").write_bytes(bytes(rnd.randrange(256) for _ in range(20000)))
    (pdir / "p04-corrupt.mp4").write_bytes(bytes(rnd.randrange(256) for _ in range(50000)))
    placeholder(400, 600, "P02", 0.0, ["GIF is not supported"]).save(pdir / "p02-unsupported.gif")
    (pdir / "README").write_text("Not media. Used as a no-extension filepath.\n", encoding="utf-8")
    w, h = size_for(FRAME_ASPECT, 1600)
    save_image(placeholder(w, h, "P10", 0.12, ["VALID file", "pool had bad field types", "(warnings, still plays)"]),
               pdir / "p10-valid-bad-types.jpg", quality=88)
    save_image(placeholder(w, h, "P11", 0.22, ["VALID file", "unknown fields must survive Save"]),
               pdir / "p11-valid-extra-fields.jpg", quality=88)
    write_json(out / "pools" / "problems.json", {
        "schemaVersion": 1,
        "curator": "Unknown top-level field — must survive Save",
        "assets": [
            {"title": "P01 Missing File", "artist": "Absens", "filepath": "../media/problems/p01-does-not-exist.jpg"},
            {"title": "P02 Unsupported GIF", "filepath": "../media/problems/p02-unsupported.gif"},
            {"title": "P03 Corrupt JPEG", "filepath": "../media/problems/p03-corrupt.jpg"},
            {"title": "P04 Corrupt MP4", "filepath": "../media/problems/p04-corrupt.mp4"},
            {"title": "P05 No Extension", "filepath": "../media/problems/README"},
            {"title": "P06 Escapes Project Folder", "filepath": "../../../outside.jpg"},
            {"title": "P07 Is A Directory", "filepath": "../media/problems"},
            {"title": "P08 No Filepath (skipped with warning)"},
            {"title": "P09 Empty Filepath (skipped with warning)", "filepath": "   "},
            "P09b not an object (skipped with warning)",
            {"title": "P10 Bad Field Types", "year": True, "zoom": "yes", "pan": 1,
             "filepath": "../media/problems/p10-valid-bad-types.jpg"},
            {"title": "P11 Extra Fields", "artist": "Conservator", "filepath": "../media/problems/p11-valid-extra-fields.jpg",
             "notes": "Lorem ipsum dolor sit amet — keep me", "custom": {"tags": ["alpha", "beta"], "rating": 4}},
        ],
    })

    # ---- broken asset pools (each shows an error; the app continues)
    (out / "pools" / "broken-syntax.json").write_text('{ "schemaVersion": 1, "assets": [ { "filepath": "x.jpg", } ', encoding="utf-8")
    write_json(out / "pools" / "wrong-shape.json", {"schemaVersion": 1, "items": []})
    write_json(out / "pools" / "future-version.json", {"schemaVersion": 99, "assets": []})

    write_json(out / "config.json", config(
        ["pools/paintings.json", "pools/videos.json", "pools/local/local.json", "pools/problems.json",
         "pools/broken-syntax.json", "pools/wrong-shape.json", "pools/future-version.json", "pools/does-not-exist.json"],
        [frame("f_fpo01", 0.25, "#FF453A"), frame("f_fpo02", 0.50, "#30D158"), frame("f_fpo03", 0.75, "#FFD60A")],
    ))


# ---------------------------------------------------------------- static / tight pool


def build_static() -> None:
    out = ROOT / "static"
    w, h = size_for(1.5, 3000)
    save_image(placeholder(w, h, "S-A", 0.0, ["STATIC MODE · asset A", "zoom + pan flags set → must NOT move",
                                              "landscape → cover crop, no transitions"]), out / "media" / "s-a.jpg", quality=88)
    shutil.copy(ROOT / "show" / "media" / "videos" / "v01-loop-5s-h264.mp4", out / "media" / "s-b-loop.mp4")
    write_json(out / "pools" / "static.json", {"schemaVersion": 1, "assets": [
        {"title": "Immobilis Imago", "artist": "Statica", "year": "1900", "filepath": "../media/s-a.jpg", "zoom": True, "pan": True},
        {"title": "Video In Aeternum", "filepath": "../media/s-b-loop.mp4"},
    ]})
    write_json(out / "config.json", config(["pools/static.json"], [
        frame("f_sta01", 0.25, "#FF453A"), frame("f_sta02", 0.50, "#30D158"), frame("f_sta03", 0.75, "#FFD60A")]))


def build_tight() -> None:
    out = ROOT / "tight-pool"
    entries = []
    for i, hue in enumerate((0.0, 0.33, 0.66), start=1):
        w, h = size_for(FRAME_ASPECT, 1600)
        name = f"t{i:02d}.jpg"
        save_image(placeholder(w, h, f"T{i:02d}", hue, ["TIGHT POOL · 3 assets, 2 frames",
                                                        "never same asset in both frames"]), out / "media" / name, quality=88)
        entries.append({"title": f"Arta {i}", "artist": "Paucitas", "year": str(2000 + i), "filepath": f"../media/{name}", "zoom": i == 2})
    write_json(out / "pools" / "tight.json", {"schemaVersion": 1, "assets": entries})
    write_json(out / "config.json", config(["pools/tight.json"], [frame("f_tig01", 1 / 3, "#FF453A"), frame("f_tig02", 2 / 3, "#30D158")]))


if __name__ == "__main__":
    for d in ("show", "static", "tight-pool"):
        shutil.rmtree(ROOT / d, ignore_errors=True)
    print("show/"); build_show()
    print("static/"); build_static()
    print("tight-pool/"); build_tight()
    print("done")
