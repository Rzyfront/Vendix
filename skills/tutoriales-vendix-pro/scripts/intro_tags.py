#!/usr/bin/env python3
"""Tags animados (motion graphics) sobre la entrada de marca 'Vendix · Tu Multitienda Digital'.
Uso: python3 intro_tags.py <dir_proyecto>  -> <dir>/tags/0001.png ... (6 s a 30 fps, RGBA)"""
import json, os, sys
from PIL import Image, ImageDraw, ImageFont
D = sys.argv[1]; t = json.load(open(f'{D}/timeline.json'))
W, H, FPS, DUR = 1920, 1080, 30, 6.0
BRAND = (31, 163, 79)


def font(sz, wg):
    f = ImageFont.truetype(os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))), 'assets', 'PlusJakartaSans.ttf'), sz); f.set_variation_by_axes([wg]); return f


def ease(x):
    x = min(max(x, 0.0), 1.0); return 1 - (1 - x) ** 3


F1, F2, F3 = font(26, 800), font(34, 800), font(26, 700)
num = t['sup'].replace('TUTORIAL', '').strip()
tags = [('TUTORIAL ' + num, F1, BRAND + (255,), (255, 255, 255), None),
        (t['titulo'], F2, (8, 30, 17, 225), (255, 255, 255), (74, 222, 128)),
        (f"{t['pasos']} pasos", F3, (255, 255, 255, 30), (220, 255, 230), (220, 255, 230))]
padx, hh, gap = 26, 58, 16
ws = [f.getlength(s) + 2 * padx for s, f, *_ in tags]
x = (W - sum(ws) - gap * (len(tags) - 1)) / 2
pos = []
for w_ in ws: pos.append(x); x += w_ + gap
y = 868
os.makedirs(f'{D}/tags', exist_ok=True)
for fr in range(int(DUR * FPS)):
    tt = fr / FPS
    im = Image.new('RGBA', (W, H), (0, 0, 0, 0)); d = ImageDraw.Draw(im)
    for k, ((s, f, bg, fg, ol), x0, w_) in enumerate(zip(tags, pos, ws)):
        a = ease((tt - 3.45 - k * 0.22) / 0.45)
        if a <= 0: continue
        yy = y + (1 - a) * 34
        fill = bg[:3] + (int(bg[3] * a),)
        d.rounded_rectangle([x0, yy, x0 + w_, yy + hh], hh // 2, fill=fill,
                            outline=(ol + (int(200 * a),)) if ol else None, width=2)
        d.text((x0 + w_ / 2, yy + hh / 2), s, font=f, fill=fg + (int(255 * a),), anchor='mm')
    # linea de acento que se dibuja bajo los tags
    a = ease((tt - 4.3) / 0.6)
    if a > 0:
        lw = 220 * a
        d.rounded_rectangle([W / 2 - lw / 2, y + hh + 26, W / 2 + lw / 2, y + hh + 32], 3, fill=BRAND + (255,))
    im.save(f'{D}/tags/{fr + 1:04d}.png')
print('tags', D)
