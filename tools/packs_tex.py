# Texture step of tools/packs-import.mjs: converts the Unity packs' textures (PNG, TGA, PSD) to PNG at most MAX px,
# keeping alpha. Reads a JSON list on stdin: [{"src": "...", "dst": "...", "max": 1024}], skips up-to-date outputs.
# PSD: the merged image plus the first extra channel as alpha (what Unity does; PIL drops that channel).
import json, os, struct, sys
from PIL import Image


def read_psd(path):
    d = open(path, 'rb').read()
    _, _, ch, h, w, depth, mode = struct.unpack('>4sH6xHIIHH', d[:26])
    if depth != 8 or mode != 3 or ch < 3:
        return None
    p = 26
    for _ in range(3):  # colour mode data, image resources, layer and mask info
        p += 4 + struct.unpack('>I', d[p:p + 4])[0]
    comp = struct.unpack('>H', d[p:p + 2])[0]
    p += 2
    use = min(ch, 4)
    planes = []
    if comp == 0:
        for c in range(use):
            planes.append(d[p + c * w * h:p + (c + 1) * w * h])
    elif comp == 1:
        counts = struct.unpack('>%dH' % (ch * h), d[p:p + 2 * ch * h])
        p += 2 * ch * h
        for c in range(use):
            out = bytearray()
            for r in range(h):
                n = counts[c * h + r]
                row, q, end = bytearray(), p, p + n
                while q < end:
                    b = d[q]
                    q += 1
                    if b < 128:
                        row += d[q:q + b + 1]
                        q += b + 1
                    elif b > 128:
                        row += bytes([d[q]]) * (257 - b)
                        q += 1
                out += row[:w]
                p = end
            planes.append(bytes(out))
    else:
        return None
    bands = [Image.frombytes('L', (w, h), pl) for pl in planes]
    return Image.merge('RGBA' if use == 4 else 'RGB', bands)


def convert(job):
    src, dst, mx = job['src'], job['dst'], job.get('max', 1024)
    if os.path.exists(dst) and os.path.getmtime(dst) >= max(os.path.getmtime(src), os.path.getmtime(__file__)):
        return dst, 'cached'
    im = read_psd(src) if src.lower().endswith('.psd') else None
    if im is None:
        im = Image.open(src)
        im.load()
    if im.mode not in ('RGB', 'RGBA'):
        im = im.convert('RGBA' if 'A' in im.mode or im.mode == 'P' else 'RGB')
    if im.mode == 'RGBA' and im.getchannel('A').getextrema()[0] == 255:
        im = im.convert('RGB')  # (an opaque alpha channel only costs bytes)
    if max(im.size) > mx:
        f = mx / max(im.size)
        im = im.resize((max(1, round(im.size[0] * f)), max(1, round(im.size[1] * f))), Image.LANCZOS)
    os.makedirs(os.path.dirname(dst), exist_ok=True)
    im.save(dst, optimize=True)
    return dst, 'written %dx%d %s' % (im.size[0], im.size[1], im.mode)


if __name__ == '__main__':
    for job in json.load(sys.stdin):
        print(*convert(job), sep='\t')
