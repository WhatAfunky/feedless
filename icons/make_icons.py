import struct, zlib, os

def make_png(path, size, bg, fg):
    w = h = size
    rows = bytearray()
    cx = cy = size / 2
    r1 = size * 0.46
    r2 = size * 0.22
    for y in range(h):
        row = bytearray([0])  # filter type 0
        for x in range(w):
            dx = x - cx + 0.5
            dy = y - cy + 0.5
            d = (dx * dx + dy * dy) ** 0.5
            if d <= r1 and d >= r1 - size * 0.08:
                c = fg
            elif d <= r2:
                c = fg
            else:
                c = bg
            row.extend(c)
        rows.extend(row)

    def chunk(tag, data):
        return struct.pack(">I", len(data)) + tag + data + struct.pack(">I", zlib.crc32(tag + data) & 0xffffffff)

    sig = b"\x89PNG\r\n\x1a\n"
    ihdr = struct.pack(">IIBBBBB", w, h, 8, 2, 0, 0, 0)
    idat = zlib.compress(bytes(rows), 9)
    png = sig + chunk(b"IHDR", ihdr) + chunk(b"IDAT", idat) + chunk(b"IEND", b"")
    with open(path, "wb") as f:
        f.write(png)

bg = (20, 22, 28)
fg = (124, 92, 255)

here = os.path.dirname(__file__)
for size, name in [(192, "icon-192.png"), (512, "icon-512.png"), (180, "apple-touch-icon.png")]:
    make_png(os.path.join(here, name), size, bg, fg)
print("done")
