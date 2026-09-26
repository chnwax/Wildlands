"""Build foliage-cluster sprites for broadleaf trees.

Left half  (1024x1024): broadleaf twig cluster made of Poly Haven's scanned island_tree_02 leaves (CC0).
Right half (1024x1024): cherry-blossom (sakura) cluster — five-petal flowers painted along twigs, a few bronze young leaves.
Output: assets/gen/leaf_cluster_diff.png (RGBA, colour bled into transparent texels), assets/gen/leaf_cluster_nor.png
Twig base is at the bottom edge (v=0); clusters spread upward/outward.
"""
import os, math, random
import numpy as np
from PIL import Image, ImageDraw, ImageFilter
from scipy import ndimage

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
TEX, OUT, S = os.path.join(ROOT, 'assets', 'tex'), os.path.join(ROOT, 'assets', 'gen'), 1024

diff = Image.open(os.path.join(TEX, 'island_tree_02_leaves_diff_1k.jpg')).convert('RGB')
alpha = Image.open(os.path.join(TEX, 'island_tree_02_leaves_alpha_1k.jpg')).convert('L')
nor = Image.open(os.path.join(TEX, 'island_tree_02_leaves_nor_gl_1k.jpg')).convert('RGB')
A = np.asarray(alpha) > 100
lab, n = ndimage.label(A)
leaves = []
for i, sl in enumerate(ndimage.find_objects(lab)):
    h, w = sl[0].stop - sl[0].start, sl[1].stop - sl[1].start
    if h < 80: continue
    box = (sl[1].start, sl[0].start, sl[1].stop, sl[0].stop)
    m = Image.fromarray(((lab[sl] == i + 1) * np.asarray(alpha)[sl]).astype(np.uint8))
    leaves.append((diff.crop(box), m, nor.crop(box)))
print('leaves:', len(leaves))


class Canvas:
    def __init__(self):
        self.rgb = Image.new('RGB', (S, S)); self.a = Image.new('L', (S, S)); self.n = Image.new('RGB', (S, S), (128, 128, 255))

    def paste(self, img, mask, nimg, x, y, ang, scale, tint=(1, 1, 1), anchor_bottom=True):
        w, h = max(2, int(img.width * scale)), max(2, int(img.height * scale))
        img, mask, nimg = img.resize((w, h), Image.LANCZOS), mask.resize((w, h), Image.LANCZOS), nimg.resize((w, h), Image.LANCZOS)
        arr = np.asarray(img).astype(np.float32) * np.array(tint, np.float32)
        img = Image.fromarray(np.clip(arr, 0, 255).astype(np.uint8))
        pad = max(w, h) * 2
        def centred(im, fill):
            c = Image.new(im.mode, (pad, pad), fill); c.paste(im, (pad // 2 - w // 2, pad // 2 - (h if anchor_bottom else h // 2))); return c.rotate(ang, resample=Image.BICUBIC)
        ri, rm, rn = centred(img, (0, 0, 0)), centred(mask, 0), centred(nimg, (128, 128, 255))
        # rotate the normal vectors along with the pixels
        na = np.asarray(rn).astype(np.float32) / 255 * 2 - 1; th = math.radians(ang)
        nx, ny = na[..., 0] * math.cos(th) - na[..., 1] * math.sin(th), na[..., 0] * math.sin(th) + na[..., 1] * math.cos(th)
        rn = Image.fromarray(np.clip((np.dstack([nx, ny, na[..., 2]]) * 0.5 + 0.5) * 255, 0, 255).astype(np.uint8))
        pos = (int(x - pad // 2), int(y - pad // 2))
        self.rgb.paste(ri, pos, rm); self.n.paste(rn, pos, rm)
        a2 = Image.new('L', (S, S)); a2.paste(rm, pos, rm); self.a = Image.fromarray(np.maximum(np.asarray(self.a), np.asarray(a2)))

    def twig(self, pts, w0, w1, col):
        d = ImageDraw.Draw(self.rgb); da = ImageDraw.Draw(self.a)
        for i in range(len(pts) - 1):
            w = int(w0 + (w1 - w0) * i / max(1, len(pts) - 2))
            d.line([pts[i], pts[i + 1]], fill=col, width=w); da.line([pts[i], pts[i + 1]], fill=255, width=w)


def twig_path(rng, x0, y0, ang, length, bend, segs=8):
    pts = [(x0, y0)]; a = ang
    for i in range(segs):
        a += rng.uniform(-bend, bend); l = length / segs
        x0 += math.sin(a) * l; y0 -= math.cos(a) * l; pts.append((x0, y0))
    return pts


def broadleaf(seed):
    rng = random.Random(seed); C = Canvas()
    main = twig_path(rng, S / 2, S - 4, rng.uniform(-0.1, 0.1), S * 0.8, 0.12)
    C.twig(main, 9, 3, (72, 56, 40))
    subs = []
    for k in range(9):
        t = 0.15 + 0.8 * k / 9; i = int(t * (len(main) - 1)); p = main[i]
        side = 1 if k % 2 else -1
        sp = twig_path(rng, p[0], p[1], side * rng.uniform(0.6, 1.1), S * rng.uniform(0.25, 0.42) * (1 - t * 0.4), 0.15, 5)
        C.twig(sp, 5, 2, (78, 60, 44)); subs.append(sp)
    for path in [main] + subs:
        for j in range(1, len(path)):
            for side in (-1, 1):
                if rng.random() < 0.25: continue
                lf = rng.choice(leaves); p = path[j]
                base_ang = math.degrees(math.atan2(path[j][0] - path[j - 1][0], -(path[j][1] - path[j - 1][1])))
                g = rng.uniform(0.75, 1.05)
                C.paste(*lf, p[0], p[1], -base_ang + side * rng.uniform(35, 75), rng.uniform(0.28, 0.42), (g * rng.uniform(0.85, 1.0), g, g * rng.uniform(0.7, 0.9)))
    tip = main[-1]
    for a in (-25, 0, 25): C.paste(*rng.choice(leaves), tip[0], tip[1] + 20, a + rng.uniform(-10, 10), 0.36)
    return C


def blossom_img(rng, r):
    size = int(r * 2.6); im = Image.new('RGBA', (size, size)); d = ImageDraw.Draw(im); c = size / 2
    base = np.array([255, 222, 230]) * rng.uniform(0.94, 1.0)
    for k in range(5):
        a = k / 5 * math.tau + rng.uniform(-0.1, 0.1)
        px, py = c + math.cos(a) * r * 0.55, c + math.sin(a) * r * 0.55
        pr = r * 0.52
        col = tuple(int(v) for v in base)
        d.ellipse([px - pr, py - pr, px + pr, py + pr], fill=col + (255,))
        # notch at the petal tip (sakura petals are cleft)
        nx, ny = c + math.cos(a) * r * 1.05, c + math.sin(a) * r * 1.05
        d.ellipse([nx - r * 0.12, ny - r * 0.12, nx + r * 0.12, ny + r * 0.12], fill=(0, 0, 0, 0))
    d.ellipse([c - r * 0.28, c - r * 0.28, c + r * 0.28, c + r * 0.28], fill=(214, 110, 150, 255))
    for k in range(8):
        a = k / 8 * math.tau; d.point((c + math.cos(a) * r * 0.35, c + math.sin(a) * r * 0.35), fill=(240, 205, 90, 255))
    return im.filter(ImageFilter.GaussianBlur(0.6))


def sakura(seed):
    rng = random.Random(seed); C = Canvas()
    main = twig_path(rng, S / 2, S - 4, rng.uniform(-0.15, 0.15), S * 0.82, 0.18)
    C.twig(main, 10, 3, (58, 40, 36))
    paths = [main]
    for k in range(8):
        t = 0.12 + 0.82 * k / 8; p = main[int(t * (len(main) - 1))]; side = 1 if k % 2 else -1
        sp = twig_path(rng, p[0], p[1], side * rng.uniform(0.5, 1.1), S * rng.uniform(0.25, 0.4) * (1 - t * 0.35), 0.2, 5)
        C.twig(sp, 5, 2, (62, 44, 38)); paths.append(sp)
    rgb, a = C.rgb, C.a
    for path in paths:
        for j in range(1, len(path)):
            p = path[j]
            for _ in range(rng.randint(3, 6)):     # umbel of 3–6 flowers on short stalks
                fx, fy = p[0] + rng.uniform(-38, 38), p[1] + rng.uniform(-38, 30)
                ImageDraw.Draw(rgb).line([p, (fx, fy)], fill=(90, 60, 50), width=2)
                b = blossom_img(rng, rng.uniform(15, 23)).rotate(rng.uniform(0, 360))
                pos = (int(fx - b.width / 2), int(fy - b.height / 2))
                rgb.paste(b, pos, b); am = Image.new('L', (S, S)); am.paste(b.split()[3], pos); a = Image.fromarray(np.maximum(np.asarray(a), np.asarray(am)))
            if rng.random() < 0.3:
                C.rgb, C.a = rgb, a
                lf = rng.choice(leaves); C.paste(*lf, p[0], p[1], rng.uniform(-80, 80), rng.uniform(0.14, 0.2), (1.25, 0.8, 0.55))
                rgb, a = C.rgb, C.a
    C.rgb, C.a = rgb, a
    return C


def bleed(rgb, a):
    rgb = rgb.astype(np.float32); filled = a > 8
    for _ in range(24):
        if filled.all(): break
        acc = np.zeros_like(rgb); cnt = np.zeros(a.shape, np.float32)
        for dy, dx in ((1, 0), (-1, 0), (0, 1), (0, -1)):
            m = np.roll(filled, (dy, dx), (0, 1)); acc += np.roll(rgb, (dy, dx), (0, 1)) * m[..., None]; cnt += m
        new = (~filled) & (cnt > 0); rgb[new] = acc[new] / cnt[new][..., None]; filled |= new
    rgb[~filled] = rgb[filled].mean(0)
    return rgb


L, R = broadleaf(3), sakura(9)
rgb = np.concatenate([bleed(np.asarray(L.rgb), np.asarray(L.a)), bleed(np.asarray(R.rgb), np.asarray(R.a))], 1)
a = np.concatenate([np.asarray(L.a), np.asarray(R.a)], 1)
nrm = np.concatenate([np.asarray(L.n), np.asarray(R.n)], 1)
os.makedirs(OUT, exist_ok=True)
Image.fromarray(np.dstack([np.clip(rgb, 0, 255).astype(np.uint8), a]), 'RGBA').save(os.path.join(OUT, 'leaf_cluster_diff.png'))
Image.fromarray(nrm, 'RGB').save(os.path.join(OUT, 'leaf_cluster_nor.png'))
prev = Image.new('RGB', (2 * S, S), (180, 195, 210)); prev.paste(Image.fromarray(np.clip(rgb, 0, 255).astype(np.uint8)), (0, 0), Image.fromarray(a))
prev.resize((1024, 512)).save(os.path.join(OUT, '_leaf_preview.jpg'))
print('coverage', (a > 128).mean())
