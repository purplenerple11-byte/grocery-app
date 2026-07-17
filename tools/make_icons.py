"""Generate solid-color PWA icons. Run: python3 tools/make_icons.py"""
import os, struct, zlib

def png(width, height, rgb):
    raw = b"".join(b"\x00" + bytes(rgb) * width for _ in range(height))
    def chunk(tag, data):
        c = tag + data
        return struct.pack(">I", len(data)) + c + struct.pack(">I", zlib.crc32(c))
    return (b"\x89PNG\r\n\x1a\n"
            + chunk(b"IHDR", struct.pack(">IIBBBBB", width, height, 8, 2, 0, 0, 0))
            + chunk(b"IDAT", zlib.compress(raw))
            + chunk(b"IEND", b""))

CLAY = (217, 119, 87)
os.makedirs("icons", exist_ok=True)
for size, name in [(192, "icon-192.png"), (512, "icon-512.png"), (180, "icon-180.png")]:
    with open(f"icons/{name}", "wb") as f:
        f.write(png(size, size, CLAY))
    print(f"wrote icons/{name}")
