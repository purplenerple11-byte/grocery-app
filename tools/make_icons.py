"""Generate PWA icons: an ivory checkmark on the clay accent, matching the
app's on-list ribbon motif. Run: python3 tools/make_icons.py"""
import os, struct, zlib, math

CLAY = (217, 119, 87)
IVORY = (250, 249, 245)

def seg_dist(px, py, ax, ay, bx, by):
    abx, aby = bx - ax, by - ay
    apx, apy = px - ax, py - ay
    ab2 = abx * abx + aby * aby
    t = max(0, min(1, (apx * abx + apy * aby) / ab2))
    cx, cy = ax + t * abx, ay + t * aby
    return math.hypot(px - cx, py - cy)

def checkmark_raw(size):
    stroke = size * 0.11
    p1 = (0.22 * size, 0.54 * size)
    p2 = (0.42 * size, 0.74 * size)
    p3 = (0.80 * size, 0.30 * size)
    rows = []
    for y in range(size):
        row = bytearray([0])  # PNG filter byte
        for x in range(size):
            d = min(
                seg_dist(x + 0.5, y + 0.5, *p1, *p2),
                seg_dist(x + 0.5, y + 0.5, *p2, *p3),
            )
            row += bytes(IVORY if d <= stroke / 2 else CLAY)
        rows.append(bytes(row))
    return b"".join(rows)

def png(width, height, raw):
    def chunk(tag, data):
        c = tag + data
        return struct.pack(">I", len(data)) + c + struct.pack(">I", zlib.crc32(c))
    return (b"\x89PNG\r\n\x1a\n"
            + chunk(b"IHDR", struct.pack(">IIBBBBB", width, height, 8, 2, 0, 0, 0))
            + chunk(b"IDAT", zlib.compress(raw))
            + chunk(b"IEND", b""))

os.makedirs("icons", exist_ok=True)
for size, name in [(192, "icon-192.png"), (512, "icon-512.png"), (180, "icon-180.png")]:
    with open(f"icons/{name}", "wb") as f:
        f.write(png(size, size, checkmark_raw(size)))
    print(f"wrote icons/{name}")
