"""Generate PWA icons + favicon: a cream bulleted list on the warm gradient
shared with Recipe Holder, so the two apps read as one family on the home
screen. Run: python3 tools/make_icons.py

Palette sampled directly from recipe-holder/public/icons/icon-512.png — a
vertical linear gradient, full-bleed with square corners (launchers do their own
rounding; baking corners in would double-round on Android).

The glyph is a list rather than the old checkmark: it survives 16px intact,
where ticks and checkboxes turn to mush, and it still reads as a different
object from Recipe Holder's pot at thumbnail size."""
import os, struct, zlib, math

GRAD_TOP = (240, 121, 15)     # #F0790F
GRAD_BOTTOM = (155, 53, 18)   # #9B3512
CREAM = (255, 243, 228)       # #FFF3E4 — the recipe app's ink

# Three rows of bullet + rule, as fractions of the canvas.
ROWS = (0.28, 0.50, 0.72)
DOT_X, DOT_R = 0.20, 0.055
BAR_X0, BAR_X1, BAR_T = 0.34, 0.83, 0.085

# Launchers crop maskable icons to a circle; anything outside the central 80%
# can be cut. The full-size glyph's top-right corner falls just outside it, so
# the maskable variant draws the same mark smaller rather than clipped. Verified
# by tools/make_icons.py's own report line below.
MASKABLE_SCALE = 0.84


def seg_dist(px, py, ax, ay, bx, by):
    abx, aby = bx - ax, by - ay
    apx, apy = px - ax, py - ay
    ab2 = abx * abx + aby * aby
    t = 0 if ab2 == 0 else max(0, min(1, (apx * abx + apy * aby) / ab2))
    return math.hypot(px - (ax + t * abx), py - (ay + t * aby))


def s(v, k):
    """Scale a coordinate about the canvas centre."""
    return 0.5 + (v - 0.5) * k


def coverage(size, glyph_scale=1.0):
    """Antialiased ink coverage per pixel, 0..1. A one-pixel feather: a hard
    threshold leaves visibly stepped edges on the dots."""
    k = glyph_scale
    cov = [[0.0] * size for _ in range(size)]
    # Floor the ink in device pixels. At 16px the rule is only ~1.4px tall, so
    # antialiasing spreads it across two rows and it renders as a grey smear
    # rather than a line. Below ~32px the floor takes over and keeps it solid;
    # at 180px and up it never binds.
    dot_r = max(DOT_R * k, 1.6 / size)
    bar_h = max(BAR_T * k / 2, 1.1 / size)
    for iy in range(size):
        py = (iy + 0.5) / size
        for ix in range(size):
            px = (ix + 0.5) / size
            best = 0.0
            for row in ROWS:
                ry = s(row, k)
                d_dot = math.hypot(px - s(DOT_X, k), py - ry) - dot_r
                d_bar = seg_dist(px, py, s(BAR_X0, k), ry, s(BAR_X1, k), ry) - bar_h
                d = min(d_dot, d_bar)
                v = min(1.0, max(0.0, 0.5 - d * size))
                if v > best:
                    best = v
            cov[iy][ix] = best
    return cov


def raw_png_rows(size, glyph_scale=1.0):
    cov = coverage(size, glyph_scale)
    rows = []
    for y in range(size):
        t = y / (size - 1)
        bg = [GRAD_TOP[i] + (GRAD_BOTTOM[i] - GRAD_TOP[i]) * t for i in range(3)]
        row = bytearray([0])  # PNG filter byte
        for x in range(size):
            v = cov[y][x]
            row += bytes(round(bg[i] + (CREAM[i] - bg[i]) * v) for i in range(3))
        rows.append(bytes(row))
    return b"".join(rows)


def png(width, height, raw):
    def chunk(tag, data):
        c = tag + data
        return struct.pack(">I", len(data)) + c + struct.pack(">I", zlib.crc32(c))
    return (b"\x89PNG\r\n\x1a\n"
            + chunk(b"IHDR", struct.pack(">IIBBBBB", width, height, 8, 2, 0, 0, 0))
            + chunk(b"IDAT", zlib.compress(raw, 9))
            + chunk(b"IEND", b""))


def safe_radius(glyph_scale):
    """Furthest ink from the centre, as a fraction of canvas width. Must stay
    under 0.40 for a maskable icon to survive a circular crop."""
    k = glyph_scale
    worst = 0.0
    for row in ROWS:
        ry = s(row, k)
        for x, pad in ((s(DOT_X, k), DOT_R * k),
                       (s(BAR_X0, k), BAR_T * k / 2),
                       (s(BAR_X1, k), BAR_T * k / 2)):
            for sx, sy in ((x - pad, ry - pad), (x + pad, ry + pad),
                           (x - pad, ry + pad), (x + pad, ry - pad)):
                worst = max(worst, math.hypot(sx - 0.5, sy - 0.5))
    return worst


os.makedirs("icons", exist_ok=True)
targets = [
    (192, "icon-192.png", 1.0),
    (512, "icon-512.png", 1.0),
    (180, "icon-180.png", 1.0),                    # apple-touch-icon
    (512, "icon-512-maskable.png", MASKABLE_SCALE),
    (32, "favicon-32.png", 1.0),                   # browser tab
    (16, "favicon-16.png", 1.0),
]
for size, name, glyph in targets:
    with open(f"icons/{name}", "wb") as f:
        f.write(png(size, size, raw_png_rows(size, glyph)))
    print(f"wrote icons/{name}")

print(f"maskable safe radius: {safe_radius(MASKABLE_SCALE):.3f} "
      f"(limit 0.400; full-size glyph is {safe_radius(1.0):.3f})")
