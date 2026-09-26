"""Composite Poly Haven's scanned fir twigs (fir_tree_01 twig atlas, CC0) into branch sprites for tree cards.

Output: assets/gen/fir_branch_diff.png (RGBA, colour bled into transparent texels)
        assets/gen/fir_branch_nor.png  (OpenGL tangent-space normals, twig normals rotated with each twig)
Atlas layout: two 1024x1024 variants side by side - left: long side branch, right: short dense crown/tip branch.
Branch base is at the bottom edge (v=0), tip at the top.
"""
import os, math, random
import numpy as np
from PIL import Image, ImageDraw
from scipy import ndimage

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
TEX = os.path.join(ROOT, 'assets', 'tex')
OUT = os.path.join(ROOT, 'assets', 'gen')
S = 1024

diff = np.asarray(Image.open(os.path.join(TEX, 'fir_tree_01_twig_diff_2k.jpg')).convert('RGB')).astype(np.float32) / 255
alpha = np.asarray(Image.open(os.path.join(TEX, 'fir_tree_01_twig_alpha_2k.jpg')).convert('L')).astype(np.float32) / 255
nor = np.asarray(Image.open(os.path.join(TEX, 'fir_tree_01_twig_nor_gl_2k.jpg')).convert('RGB')).astype(np.float32) / 255
H, W = alpha.shape

# find individual twigs in the atlas (skip the bark strip on the left and the bare stems at the bottom)
lab, n = ndimage.label(ndimage.binary_dilation(alpha > 0.4, iterations=6))
twigs = []
for i, sl in enumerate(ndimage.find_objects(lab)):
    ys, xs = sl
    h, w = ys.stop - ys.start, xs.stop - xs.start
    if xs.start < W * 0.09 or ys.stop > H * 0.8 or h < H * 0.05:
        continue
    m = (lab[sl] == i + 1).astype(np.float32) * alpha[sl]
    twigs.append({'rgb': diff[sl], 'a': m, 'n': nor[sl], 'h': h, 'w': w})
twigs.sort(key=lambda t: -t['h'])
print('twigs found:', len(twigs), [(t['w'], t['h']) for t in twigs])
big = twigs[:4]
small = twigs[4:] or twigs


def to_img(arr, mode):
    return Image.fromarray(np.clip(arr * 255, 0, 255).astype(np.uint8), mode)


def paste(acc, twig, cx, cy, angle_deg, scale, rng):
    """Alpha-over a twig rotated by angle (CCW, degrees) with its base at (cx, cy)."""
    h, w = int(twig['h'] * scale), int(twig['w'] * scale)
    if h < 8 or w < 8:
        return
    rgb = to_img(twig['rgb'], 'RGB').resize((w, h), Image.LANCZOS)
    a = to_img(twig['a'], 'L').resize((w, h), Image.LANCZOS)
    nm = to_img(twig['n'], 'RGB').resize((w, h), Image.LANCZOS)
    # pad so the base (bottom-centre) sits at the rotation centre
    pad = max(w, h) * 2
    def centre(im, fill):
        c = Image.new(im.mode, (pad, pad), fill)
        c.paste(im, (pad // 2 - w // 2, pad // 2 - h))
        return c.rotate(angle_deg, resample=Image.BICUBIC)
    rgb_r = np.asarray(centre(rgb, (0, 0, 0))).astype(np.float32) / 255
    a_r = np.asarray(centre(a, 0)).astype(np.float32) / 255
    n_r = np.asarray(centre(nm, (128, 128, 255))).astype(np.float32) / 255
    # rotate tangent-space normal xy by the same angle (y up)
    th = math.radians(angle_deg)
    nx, ny = n_r[..., 0] * 2 - 1, n_r[..., 1] * 2 - 1
    rx, ry = nx * math.cos(th) - ny * math.sin(th), nx * math.sin(th) + ny * math.cos(th)
    n_r = np.stack([rx * .5 + .5, ry * .5 + .5, n_r[..., 2]], -1)
    tint = np.array([1 + rng.uniform(-.08, .05), 1 + rng.uniform(-.05, .05), 1 + rng.uniform(-.1, .05)], np.float32) * rng.uniform(0.8, 1.05)
    x0, y0 = int(cx - pad // 2), int(cy - pad // 2)
    xa, ya, xb, yb = max(0, x0), max(0, y0), min(acc['a'].shape[1], x0 + pad), min(acc['a'].shape[0], y0 + pad)
    if xa >= xb or ya >= yb:
        return
    s = (slice(ya - y0, yb - y0), slice(xa - x0, xb - x0))
    d = (slice(ya, yb), slice(xa, xb))
    al = a_r[s][..., None]
    acc['rgb'][d] = rgb_r[s] * tint * al + acc['rgb'][d] * (1 - al)
    acc['n'][d] = n_r[s] * al + acc['n'][d] * (1 - al)
    acc['a'][d] = al[..., 0] + acc['a'][d] * (1 - al[..., 0])


def stem(acc, x0, y0, x1, y1, w0, w1):
    im = Image.new('L', (S, S), 0)
    dr = ImageDraw.Draw(im)
    steps = 40
    for i in range(steps):
        t0, t1 = i / steps, (i + 1) / steps
        dr.line([(x0 + (x1 - x0) * t0, y0 + (y1 - y0) * t0), (x0 + (x1 - x0) * t1, y0 + (y1 - y0) * t1)],
                fill=255, width=max(1, int(w0 + (w1 - w0) * t0)))
    m = np.asarray(im).astype(np.float32)[..., None] / 255
    acc['rgb'] = np.array([0.24, 0.18, 0.12], np.float32) * m + acc['rgb'] * (1 - m)
    acc['n'] = np.array([0.5, 0.5, 1.0], np.float32) * m + acc['n'] * (1 - m)
    acc['a'] = np.maximum(acc['a'], m[..., 0])


def branch(seed, length, spread, density, tip_scale):
    rng = random.Random(seed)
    acc = {'rgb': np.zeros((S, S, 3), np.float32), 'n': np.zeros((S, S, 3), np.float32) + [0.5, 0.5, 1.0], 'a': np.zeros((S, S), np.float32)}
    base_y, top_y = S - 4, S - 4 - length
    stem(acc, S / 2, base_y, S / 2 + rng.uniform(-8, 8), top_y + 40, 9, 3)
    count = int(14 * density)
    for i in range(count):
        t = 0.06 + 0.86 * i / count + rng.uniform(-0.02, 0.02)
        y = base_y - (base_y - top_y) * t
        side = 1 if i % 2 else -1
        ang = side * rng.uniform(38, 62) * spread
        sc = (1.05 - 0.55 * t) * rng.uniform(0.85, 1.1) * (S / 2048) * 1.55
        paste(acc, rng.choice(big if t < 0.6 else twigs), S / 2 + side * rng.uniform(0, 6), y, ang, sc, rng)
    for i in range(int(8 * density)):  # fill-in layer
        t = rng.uniform(0.1, 0.85)
        side = rng.choice((-1, 1))
        paste(acc, rng.choice(small), S / 2, base_y - (base_y - top_y) * t, side * rng.uniform(15, 70) * spread, (S / 2048) * rng.uniform(0.9, 1.3), rng)
    paste(acc, big[0], S / 2, top_y + 60, rng.uniform(-6, 6), (S / 2048) * 1.5 * tip_scale, rng)
    return acc


def bleed(rgb, a, iters=24):
    """Push colour into transparent texels so mip-mapping doesn't pull in black fringes."""
    rgb = rgb.copy(); filled = a > 0.02
    for _ in range(iters):
        if filled.all():
            break
        acc = np.zeros_like(rgb); cnt = np.zeros(a.shape, np.float32)
        for dy, dx in ((1, 0), (-1, 0), (0, 1), (0, -1)):
            m = np.roll(filled, (dy, dx), (0, 1)); acc += np.roll(rgb, (dy, dx), (0, 1)) * m[..., None]; cnt += m
        new = (~filled) & (cnt > 0)
        rgb[new] = acc[new] / cnt[new][..., None]
        filled |= new
    rgb[~filled] = rgb[filled].mean(0)
    return rgb


os.makedirs(OUT, exist_ok=True)
A = branch(11, S - 60, 1.0, 1.6, 1.0)
B = branch(23, int(S * 0.6), 0.8, 1.9, 0.75)
rgb = np.concatenate([bleed(A['rgb'], A['a']), bleed(B['rgb'], B['a'])], 1)
a = np.concatenate([A['a'], B['a']], 1)
n = np.concatenate([A['n'], B['n']], 1)
Image.fromarray(np.clip(np.dstack([rgb, a[..., None]]) * 255, 0, 255).astype(np.uint8), 'RGBA').save(os.path.join(OUT, 'fir_branch_diff.png'))
Image.fromarray(np.clip(n * 255, 0, 255).astype(np.uint8), 'RGB').save(os.path.join(OUT, 'fir_branch_nor.png'))
prev = Image.new('RGB', (2 * S, S), (200, 205, 210)); prev.paste(Image.fromarray((rgb * 255).astype(np.uint8)), (0, 0), Image.fromarray((a * 255).astype(np.uint8)))
prev.resize((1024, 512)).save(os.path.join(OUT, '_preview.jpg'))
print('coverage', a.mean())
