#!/usr/bin/env python3
"""
OpenMail icon processor.
- Crops the AI-generated landscape image to the tight square icon content
- Applies iOS squircle rounded-rect mask → transparent corners
- Saves every size as RGBA PNG (transparent corners preserved)
- Writes a proper multi-res favicon.ico (16/32/48)
- Writes openmail.icns via iconutil
"""

import io
import os
import struct
import subprocess
import shutil
from pathlib import Path
from PIL import Image, ImageDraw

SRC = Path("/Users/kaifeng/.cursor/projects/Users-kaifeng-Developer-openmail/assets/icon_3d_final.png")
PROJECT_ROOT = Path("/Users/kaifeng/Developer/openmail")
ICONS_DIR = PROJECT_ROOT / "web/public/icons"
PUBLIC_DIR = PROJECT_ROOT / "web/public"

# iOS squircle corner radius ratio (Apple's exact value)
CORNER_RADIUS_PCT = 0.2237

SIZES = {
    "favicon-16x16.png":   16,
    "favicon-32x32.png":   32,
    "favicon-48x48.png":   48,
    "apple-touch-icon.png": 180,
    "icon-192x192.png":    192,
    "icon-512x512.png":    512,
    "icon-1024x1024.png":  1024,
}


def crop_to_content(img: Image.Image) -> Image.Image:
    """
    Detect the actual icon region inside the AI-generated landscape image
    by finding the bounding box of non-background pixels, then return
    a tight square crop centered on that region.
    """
    rgba = img.convert("RGBA")
    pixels = rgba.load()
    w, h = rgba.size

    # Corner pixel = background color
    bg_r, bg_g, bg_b, _ = pixels[0, 0]
    tol = 15

    min_x, min_y = w, h
    max_x, max_y = 0, 0
    for y in range(h):
        for x in range(w):
            r, g, b, a = pixels[x, y]
            if (abs(r - bg_r) > tol or abs(g - bg_g) > tol or abs(b - bg_b) > tol) and a > 10:
                if x < min_x: min_x = x
                if y < min_y: min_y = y
                if x > max_x: max_x = x
                if y > max_y: max_y = y

    size = max(max_x - min_x, max_y - min_y)
    cx = (min_x + max_x) // 2
    cy = (min_y + max_y) // 2
    half = size // 2

    left   = max(0, cx - half)
    top    = max(0, cy - half)
    right  = min(w, left + size)
    bottom = min(h, top + size)

    return img.crop((left, top, right, bottom))


def apply_rounded_mask(img: Image.Image, radius_pct: float = CORNER_RADIUS_PCT) -> Image.Image:
    """
    Paint a rounded-rectangle alpha mask over the image.
    Everything outside the rounded rect becomes fully transparent.
    """
    img = img.convert("RGBA")
    w, h = img.size
    radius = int(min(w, h) * radius_pct)

    mask = Image.new("L", (w, h), 0)
    draw = ImageDraw.Draw(mask)
    draw.rounded_rectangle([(0, 0), (w - 1, h - 1)], radius=radius, fill=255)

    out = Image.new("RGBA", (w, h), (0, 0, 0, 0))
    out.paste(img, mask=mask)
    return out


def make_ico(sized_images: dict, output_path: Path):
    """Write a proper multi-resolution .ico (PNG-inside-ICO, RGBA)."""
    sizes_in_ico = [16, 32, 48]
    blobs = []
    metas = []

    for sz in sizes_in_ico:
        img = sized_images[sz].convert("RGBA")
        buf = io.BytesIO()
        img.save(buf, format="PNG")
        data = buf.getvalue()
        blobs.append(data)
        metas.append((img.width, img.height, len(data)))

    n = len(metas)
    header = struct.pack("<HHH", 0, 1, n)
    offset = 6 + n * 16
    dir_bytes = b""
    for w, h, dlen in metas:
        bw = w if w < 256 else 0
        bh = h if h < 256 else 0
        dir_bytes += struct.pack("<BBBBHHII", bw, bh, 0, 0, 1, 32, dlen, offset)
        offset += dlen

    with open(output_path, "wb") as f:
        f.write(header + dir_bytes)
        for blob in blobs:
            f.write(blob)


def make_icns(master: Image.Image, output_path: Path):
    """Build an .icns using macOS iconutil."""
    iconset_dir = output_path.parent / "openmail.iconset"
    iconset_dir.mkdir(exist_ok=True)

    for sz in [16, 32, 64, 128, 256, 512]:
        master.resize((sz, sz), Image.LANCZOS).save(iconset_dir / f"icon_{sz}x{sz}.png")
        master.resize((sz * 2, sz * 2), Image.LANCZOS).save(iconset_dir / f"icon_{sz}x{sz}@2x.png")

    subprocess.run(["iconutil", "-c", "icns", str(iconset_dir), "-o", str(output_path)], check=True)
    shutil.rmtree(iconset_dir)


def main():
    ICONS_DIR.mkdir(parents=True, exist_ok=True)

    print(f"→ Loading: {SRC.name}")
    raw = Image.open(SRC)
    print(f"  size={raw.size}  mode={raw.mode}")

    # Preserve raw original (untouched) for future reference
    raw.save(ICONS_DIR / "icon-source-original.png")
    print("  ✓ icon-source-original.png  (raw, untouched)")

    # 1. Crop to tight square content
    cropped = crop_to_content(raw)
    print(f"  Cropped → {cropped.size}")

    # Resize to exact 1024 master before masking
    master_rgb = cropped.convert("RGB").resize((1024, 1024), Image.LANCZOS)

    # 2. Apply transparent rounded corners (RGBA)
    master = apply_rounded_mask(master_rgb)
    master.save(ICONS_DIR / "icon-1024-clean.png", optimize=True)
    print("  ✓ icon-1024-clean.png  (1024×1024, transparent corners)")

    # 3. Generate every size — all RGBA with transparent corners
    sized: dict[int, Image.Image] = {}
    for filename, size in SIZES.items():
        img = apply_rounded_mask(
            master_rgb.resize((size, size), Image.LANCZOS)
        )
        img.save(ICONS_DIR / filename, optimize=True)
        sized[size] = img
        print(f"  ✓ {filename}  ({size}×{size}, transparent corners)")

    # Ensure 48 exists for .ico
    if 48 not in sized:
        sized[48] = apply_rounded_mask(master_rgb.resize((48, 48), Image.LANCZOS))

    # 4. favicon.ico — multi-res 16/32/48, RGBA
    ico_path = PUBLIC_DIR / "favicon.ico"
    make_ico(sized, ico_path)
    print(f"  ✓ favicon.ico  (16/32/48 multi-res, transparent corners)")

    # 5. PWA aliases
    (ICONS_DIR / "icon-192.png").write_bytes((ICONS_DIR / "icon-192x192.png").read_bytes())
    (ICONS_DIR / "icon-512.png").write_bytes((ICONS_DIR / "icon-512x512.png").read_bytes())
    print("  ✓ icon-192.png + icon-512.png  (PWA manifest aliases)")

    # 6. macOS .icns
    make_icns(master, ICONS_DIR / "openmail.icns")
    print("  ✓ openmail.icns  (macOS, all densities)")

    print(f"\n✅ Done — {ICONS_DIR}")


if __name__ == "__main__":
    main()
