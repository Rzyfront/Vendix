#!/usr/bin/env python3
"""Render del cuerpo de un tutorial Vendix (pasos + cierre). Uso: python3 render.py <proyecto> [x.mp4 t1,t2,... para previsualizar PNG]"""
import json, os, re, subprocess, sys
import numpy as np
from PIL import Image, ImageDraw, ImageFilter, ImageFont

BASE = sys.argv[1] if len(sys.argv) > 1 else '.'
OUT = sys.argv[2] if len(sys.argv) > 2 else f'{BASE}/borrador.mp4'
PREVIEW = [float(x) for x in sys.argv[3].split(',')] if len(sys.argv) > 3 else None  # tiempos de salida a exportar como PNG

FPS = 30
W, H = 1920, 1080
SRC_W, SRC_H = 1960, 1230   # se sobreescribe en cfg.py
GREEN = (58, 226, 115)
BG = (11, 20, 16)
VO_OFFSET = 0.25   # la voz entra 0,25 s despues del inicio del paso
STEP_TAIL = 0.25   # aire tras la voz
TITLE_D, CLOSE_D = 0.0, 3.5   # sin tarjeta de titulo: la entrada de marca con tags ya presenta el video
ASSETS = os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))), 'assets')
FONT = os.path.join(ASSETS, 'PlusJakartaSans.ttf')


def font(size, wght):
    f = ImageFont.truetype(FONT, size)
    f.set_variation_by_axes([wght])
    return f

# (src_ini, src_fin, rect fuente (x0,y0,x1,y1), etiqueta, zoom|None)
exec(open(f'{BASE}/cfg.py', encoding='utf-8').read())
N = len(STEPS)
CW0 = min(SRC_W, SRC_H * 16 / 9)                       # ancho de la ventana 16:9 sin zoom
CX0 = globals().get('CX0', SRC_W / 2)
CY0 = globals().get('CY0', SRC_H / 2)
PAN = globals().get('PAN', True)                       # focos sin zoom tambien centran la vista
TITULO_LARGO = globals().get('TITULO_LARGO', TITULO)


def dur(path):
    return float(subprocess.check_output(['ffprobe', '-v', 'error', '-show_entries', 'format=duration',
                                          '-of', 'csv=p=0', path]).decode())


def pausas(path):
    err = subprocess.run(['ffmpeg', '-nostats', '-i', path, '-af', 'silencedetect=n=-38dB:d=0.12', '-f', 'null', '-'],
                         capture_output=True, text=True).stderr
    return [float(e) - float(d) / 2 for e, d in re.findall(r'silence_end: ([0-9.]+) \| silence_duration: ([0-9.]+)', err)]

# ---------- tiempos ----------
def desde_anclas(anchors, cuts, D):
    """anclas (seg_fuente, seg_salida): la accion de la grabacion en seg_fuente se ve en seg_salida."""
    an = [(sf, D if sl == 'END' else sl) for sf, sl in anchors]
    tr = []
    for (sa, la), (sb, lb) in zip(an, an[1:]):
        od = lb - la
        if od <= 0:
            continue
        if sb == sa:
            tr.append((sa, sa + 0.001, od, True)); continue
        piezas, x = [], sa
        for c0, c1 in sorted(cuts):
            if c1 <= x or c0 >= sb: continue
            if c0 > x: piezas.append((x, c0))
            x = max(x, c1)
        if x < sb: piezas.append((x, sb))
        K = sum(p1 - p0 for p0, p1 in piezas)
        for p0, p1 in piezas:
            tr.append((p0, p1, od * (p1 - p0) / K, False))
    return tr

textos = open(f'{BASE}/vo.txt', encoding='utf-8').read().strip().split('\n\n')
assert len(textos) == N
t = TITLE_D
for i, st in enumerate(STEPS):
    st['voz'] = f'{BASE}/voz/v{i+1}.wav'
    st['vd'] = dur(st['voz'])
    st['D'] = VO_OFFSET + st['vd'] + STEP_TAIL
    st['start'] = t
    st['L'] = sum((s[2] if s[0] == 'H' else s[1] - s[0]) for s in st['segs'])
    fijo = sum(s[2] for s in st['segs'] if s[0] != 'H' and len(s) == 3)
    libre = sum((s[2] if s[0] == 'H' else s[1] - s[0]) for s in st['segs'] if s[0] == 'H' or len(s) == 2)
    st['tramos'] = []  # (src_a, src_b, out_dur, es_hold)
    for sg in st['segs']:
        if sg[0] == 'H':
            st['tramos'].append((sg[1], sg[1] + sg[2], sg[2] * (st['D'] - fijo) / libre, True))
        elif len(sg) == 3:
            st['tramos'].append((sg[0], sg[1], sg[2], False))
        else:
            st['tramos'].append((sg[0], sg[1], (sg[1] - sg[0]) * (st['D'] - fijo) / libre, False))
    if 'anchors' in st:
        st['tramos'] = desde_anclas(st['anchors'], st.get('cuts', []), st['D'])
    t += st['D']
# despedida opcional sobre el cierre (despedida.txt + voz/vfin.wav)
import os as _os
DESPEDIDA = open(f'{BASE}/despedida.txt', encoding='utf-8').read().strip() if _os.path.exists(f'{BASE}/despedida.txt') else ''
FIN_VOZ = f'{BASE}/voz/vfin.wav' if (DESPEDIDA and _os.path.exists(f'{BASE}/voz/vfin.wav')) else None
FIN_OFF = 0.9                                   # la voz entra cuando ya se ve "Asi de facil"
if FIN_VOZ:
    FIN_DUR = dur(FIN_VOZ)
    CLOSE_D = max(CLOSE_D, FIN_OFF + FIN_DUR + 0.8)
FIN_START = t + FIN_OFF
TOTAL = t + CLOSE_D


def src_to_local(st, s):
    """tiempo fuente -> tiempo de salida dentro del paso"""
    # primero tramos normales; las pausas (hold) solo si ningun tramo normal contiene s
    for solo_hold in (False, True):
        cum = 0.0
        for a, b, od, hold in st['tramos']:
            if hold == solo_hold and a <= s <= b:
                return cum + (s - a) * od / (b - a)
            cum += od
    cum = 0.0
    for a, b, od, hold in st['tramos']:
        if not hold and s < a:
            return cum
        cum += od
    return st['D']

# ---------- subtitulos (estilo Tutorial 01: una linea, palabra actual en verde) ----------
F_SUB = font(46, 700)
SUB_BG = (18, 49, 32)
SUB_HL = (74, 222, 128)


def frases(txt):
    out = []
    for s_ in re.split(r'(?<=[.!?])\s+', txt.strip()):
        out.append(s_)
    return out


SUBS = []      # (ini, fin, texto) por frase, para timeline.json
WORDS = []     # (ini, fin, palabra, id_trozo)
CHUNKS = []    # (ini, fin, [indices de WORDS])
def bloque_subs(texto, voz, vd, base):
    ch = frases(texto)
    n = [len(c) for c in ch]
    tot = sum(n)
    pz = [p for p in pausas(voz) if 0.4 < p < vd - 0.4]
    bounds, acc = [0.0], 0
    for k in n[:-1]:
        acc += k
        b_ = acc / tot * vd
        near = [p for p in pz if abs(p - b_) < 0.9]
        if near:
            b_ = min(near, key=lambda p: abs(p - b_))
        bounds.append(b_)
    bounds.append(vd)
    for j, c in enumerate(ch):
        a0 = base + bounds[j]; a1 = base + bounds[j + 1]
        SUBS.append((a0, a1, c))
        ws = c.split()
        pesos = [len(w) + 2 for w in ws]
        T = sum(pesos); tt_ = a0
        # trozos de hasta ~6 palabras / 40 caracteres, cortando preferentemente tras coma
        grupo, gl = [], 0
        for k, w in enumerate(ws):
            d_ = (a1 - a0) * pesos[k] / T
            WORDS.append((tt_, tt_ + d_, w)); tt_ += d_
            grupo.append(len(WORDS) - 1); gl += len(w) + 1
            corte = (gl >= 26 and w.endswith((',', ':', ';'))) or gl >= 38 or len(grupo) >= 7
            if corte and k < len(ws) - 1 and len(ws) - 1 - k >= 2:
                CHUNKS.append(grupo); grupo, gl = [], 0
        if grupo:
            CHUNKS.append(grupo)


for i, st in enumerate(STEPS):
    bloque_subs(textos[i], st['voz'], st['vd'], st['start'] + VO_OFFSET)
if FIN_VOZ:
    bloque_subs(DESPEDIDA, FIN_VOZ, FIN_DUR, FIN_START)
CHUNKS = [(WORDS[g[0]][0], WORDS[g[-1]][1], g) for g in CHUNKS]
T_HOLD = -1.0   # sin titulo sobre el saludo (evita doble entrada)
CHUNKS = [(a0, (CHUNKS[k + 1][0] if k + 1 < len(CHUNKS) and CHUNKS[k + 1][0] - a1 < 0.6 else a1 + 0.25), g)
          for k, (a0, a1, g) in enumerate(CHUNKS)]


def sub_layer(g, cur):
    ws = [WORDS[k][2] for k in g]
    sp = F_SUB.getlength(' ')
    widths = [F_SUB.getlength(w) for w in ws]
    tw = sum(widths) + sp * (len(ws) - 1)
    bw, bh = tw + 44, 76
    img = Image.new('RGBA', (int(bw) + 2, bh + 2), (0, 0, 0, 0))
    d = ImageDraw.Draw(img)
    d.rounded_rectangle([0, 0, bw, bh], 10, fill=SUB_BG + (240,))
    x = 22
    for k, w in enumerate(ws):
        d.text((x, bh / 2 + 1), w, font=F_SUB, fill=(SUB_HL if g[k] == cur else (255, 255, 255)), anchor='lm')
        x += widths[k] + sp
    return img

# ---------- elementos fijos (estilo Tutorial 01) ----------
DARK = (9, 40, 23)
ICON_BG = (1, 35, 21)   # fondo del icono segun el imagotipo oficial (Light Mint Strong)
BRAND = (31, 163, 79)
DIM = (9, 40, 23)
F_LABEL = font(34, 800)
F_PILL_B, F_PILL_T = font(26, 800), font(28, 700)
LOGO_ICON = Image.open(os.path.join(ASSETS, 'logo_icon.png')).convert('RGBA')
LOGO_FULL = Image.open(os.path.join(ASSETS, 'logo_full.png')).convert('RGBA')


def caja_logo(size):
    box = Image.new('RGBA', (size, size), (0, 0, 0, 0))
    ImageDraw.Draw(box).rounded_rectangle([0, 0, size - 1, size - 1], int(size * 0.2), fill=ICON_BG + (255,))
    w = int(size * 0.66)
    ic = LOGO_ICON.resize((w, round(LOGO_ICON.height * w / LOGO_ICON.width)), Image.LANCZOS)
    box.paste(ic, ((size - ic.width) // 2, (size - ic.height) // 2), ic)
    return box


LOGO_BOX = caja_logo(58)


def ease(x):
    x = min(max(x, 0.0), 1.0)
    return x * x * (3 - 2 * x)


F_MK1, F_MK2 = font(29, 800), font(22, 700)
_MK_IC = LOGO_ICON.resize((40, round(LOGO_ICON.height * 40 / LOGO_ICON.width)), Image.LANCZOS)
MK_TAG = (79, 194, 134)   # verde de 'Tu Multitienda Digital' segun la referencia
MARCA_CICLO = 7.0   # s por ciclo: Vendix -> titulo del video


def tarjeta_marca(img, gt):
    """Contramarca: logo + texto que alterna entre la marca y el titulo del video."""
    textos = [('Vendix', 'Tu Multitienda Digital'), (TITULO, f'Tutorial · {N} pasos')]
    fase = (gt % (2 * MARCA_CICLO)) / MARCA_CICLO
    k = int(fase); u = fase - k                     # u: avance dentro del bloque actual
    T = 0.45 / MARCA_CICLO                          # duracion de la transicion
    def ancho(j):
        return max(F_MK1.getlength(textos[j][0]), F_MK2.getlength(textos[j][1]))
    w_act, w_sig = ancho(k), ancho(1 - k)
    tr = ease((u - (1 - T)) / T)                    # 0..1 al final del bloque
    w = w_act + (w_sig - w_act) * tr
    y0, h = 12, 72
    cw = 12 + 50 + 14 + w + 22
    x0 = int(W - 16 - cw)          # esquina superior derecha: no tapa el logo del sidebar
    ov = Image.new('RGBA', (int(cw) + 4, h + 4), (0, 0, 0, 0))
    d = ImageDraw.Draw(ov)
    d.rounded_rectangle([0, 0, cw, h], 14, fill=(13, 35, 23, 240))
    d.rounded_rectangle([10, 8, 62, h - 8], 11, fill=ICON_BG + (255,), outline=(38, 92, 62, 255), width=1)
    ov.paste(_MK_IC, (16, (h - _MK_IC.height) // 2), _MK_IC)
    # texto: el actual sube y se desvanece, el siguiente entra desde abajo
    txt = Image.new('RGBA', (int(max(w_act, w_sig)) + 4, h), (0, 0, 0, 0))
    dt = ImageDraw.Draw(txt)
    for j, off, a in ((k, -tr * 26, 1 - tr), (1 - k, (1 - tr) * 26, tr)):
        if a <= 0.01: continue
        t1, t2 = textos[j]
        dt.text((0, 26 + off), t1, font=F_MK1, fill=(255, 255, 255, int(255 * a)), anchor='lm')
        dt.text((0, 52 + off), t2, font=F_MK2, fill=MK_TAG + (int(255 * a),), anchor='lm')
    m = Image.new('L', txt.size, 0); ImageDraw.Draw(m).rectangle([0, 4, int(w) + 2, h - 4], fill=255)
    txt.putalpha(Image.fromarray(np.minimum(np.asarray(txt.getchannel('A')), np.asarray(m))))
    ov.alpha_composite(txt, (76, 0))
    img.paste(ov, (x0, y0), ov)


def header(img, i, lt, gt):
    d = ImageDraw.Draw(img, 'RGBA')
    tarjeta_marca(img, gt)
    titulos = globals().get('STEP_TITLES') or [''] * N
    badge = f'Paso {i+1} de {N}'
    bw = F_PILL_B.getlength(badge) + 28
    tw = F_PILL_T.getlength(titulos[i])
    dash, gap = 26, 6
    dw = N * dash + (N - 1) * gap
    pw = 12 + bw + 18 + tw + 20 + dw + 22
    x0 = min((W - pw) / 2, W - 16 - 420 - pw - 16); y0, ph = 16, 58
    d.rounded_rectangle([x0, y0, x0 + pw, y0 + ph], 12, fill=(8, 30, 17, 245))
    d.rounded_rectangle([x0 + 10, y0 + 9, x0 + 10 + bw, y0 + ph - 9], 8, fill=BRAND)
    d.text((x0 + 10 + bw / 2, y0 + ph / 2), badge, font=F_PILL_B, fill=(255, 255, 255), anchor='mm')
    d.text((x0 + 10 + bw + 18, y0 + ph / 2), titulos[i], font=F_PILL_T, fill=(255, 255, 255), anchor='lm')
    xd = x0 + 10 + bw + 18 + tw + 20
    for k in range(N):
        col = (58, 200, 110) if k <= i else (70, 92, 80)
        d.rounded_rectangle([xd, y0 + ph / 2 - 3, xd + dash, y0 + ph / 2 + 3], 3, fill=col)
        xd += dash + gap
    # barra de progreso global inferior
    d.rectangle([0, H - 6, W, H], fill=(9, 40, 23, 160))
    d.rectangle([0, H - 6, W * min(gt / TOTAL, 1), H], fill=BRAND)

# ---------- pistas de foco/zoom por paso ----------
def smooth(a, win):
    k = np.ones(win) / win
    for _ in range(2):
        p = np.pad(a, (win // 2, win - 1 - win // 2), mode='edge')
        a = np.convolve(p, k, mode='valid')
    return a


def pistas(st):
    nf = int(round(st['D'] * FPS))
    z = np.ones(nf); cx = np.full(nf, float(CX0)); cy = np.full(nf, float(CY0))
    al = np.zeros(nf); rect = np.full((nf, 4), np.nan); lab = [None] * nf
    prev_fb = None
    for (a, b, r, l, zz) in st['foci']:
        fa, fb = int(src_to_local(st, a) * FPS), int(src_to_local(st, b) * FPS)
        cambio = prev_fb is not None and fa - prev_fb <= 3  # foco contiguo: fundido corto entre ambos
        prev_fb = fb
        for f in range(max(fa, 0), min(fb, nf)):
            al[f] = 1; rect[f] = r; lab[f] = l
            if zz:
                z[f] = zz
            if zz or PAN:
                cx[f] = (r[0] + r[2]) / 2; cy[f] = (r[1] + r[3]) / 2
        if cambio:
            al[max(fa - 5, 0):min(fa + 4, nf)] = 0
    # rect/label donde no hay foco: mantener el mas cercano para que se desvanezca sin saltar
    idx = np.where(~np.isnan(rect[:, 0]))[0]
    if len(idx):
        for f in range(nf):
            if np.isnan(rect[f, 0]):
                j = idx[np.argmin(np.abs(idx - f))]
                rect[f] = rect[j]; lab[f] = lab[j]
    win = int(0.22 * FPS)
    z = smooth(z, win); cx = smooth(cx, win); cy = smooth(cy, win)
    al = smooth(al, int(0.15 * FPS))
    return nf, z, cx, cy, al, rect, lab


def frames_fuente(st, nf):
    parts, n = [], 0
    for a, b, od, hold in st['tramos']:
        if hold:
            parts.append(f"[0:v]trim=start={a-0.05}:duration=0.05,setpts=PTS-STARTPTS,tpad=stop_mode=clone:stop_duration={od:.4f},trim=duration={od:.4f},setpts=PTS-STARTPTS[s{n}]")
        else:
            parts.append(f"[0:v]trim={a}:{b},setpts=(PTS-STARTPTS)*{od/(b-a):.6f}[s{n}]")
        n += 1
    fil = ';'.join(parts) + ';' + ''.join(f'[s{k}]' for k in range(n)) + \
        f"concat=n={n}:v=1,fps={FPS},format=rgb24[o]"
    p = subprocess.Popen(['ffmpeg', '-v', 'error', '-i', f'{BASE}/grabacion.mp4', '-filter_complex', fil,
                         '-map', '[o]', '-f', 'rawvideo', '-'], stdout=subprocess.PIPE)
    sz = SRC_W * SRC_H * 3
    last = None
    for _ in range(nf):
        b = p.stdout.read(sz)
        if len(b) == sz:
            last = np.frombuffer(b, np.uint8).reshape(SRC_H, SRC_W, 3)
        yield last
    p.stdout.close(); p.wait()


def rec_frame(src, z, cx, cy, a, r, l):
    z = max(z, 1.0)
    cw, ch = CW0 / z, CW0 * 9 / 16 / z
    x0 = max(min(max(cx - cw / 2, 0), SRC_W - cw), 0)
    y0 = max(min(max(cy - ch / 2, 0), SRC_H - ch), 0)
    im = Image.fromarray(src).resize((W, H), Image.BILINEAR, box=(x0, y0, x0 + cw, y0 + ch))
    if a > 0.01 and not np.isnan(r[0]):
        s_ = W / cw
        pad = 10
        rx0, ry0 = (r[0] - x0) * s_ - pad, (r[1] - y0) * s_ - pad
        rx1, ry1 = (r[2] - x0) * s_ + pad, (r[3] - y0) * s_ + pad
        rx0, ry0, rx1, ry1 = max(rx0, 6), max(ry0, 80), min(rx1, W - 6), min(ry1, H - 12)
        if rx1 - rx0 < 8 or ry1 - ry0 < 8:
            return im
        m = Image.new('L', (W, H), int(255 * 0.55 * a))
        ImageDraw.Draw(m).rounded_rectangle([rx0, ry0, rx1, ry1], 16, fill=0)
        im.paste(DIM, (0, 0), m)
        ov = Image.new('RGBA', (W, H), (0, 0, 0, 0))
        d = ImageDraw.Draw(ov)
        d.rounded_rectangle([rx0, ry0, rx1, ry1], 16, fill=(74, 222, 128, int(28 * a)),
                            outline=BRAND + (int(255 * a),), width=5)
        if l:
            tw = F_LABEL.getlength(l)
            bw, bh = tw + 44, 62
            bx = min(max(rx0, 10), W - bw - 10)
            by = ry0 - bh - 12 if ry0 - bh - 12 > 84 else ry1 + 12
            if by + bh > H - 110:
                by = ry1 - bh - 10
            d.rounded_rectangle([bx, by, bx + bw, by + bh], 12, fill=BRAND + (int(255 * a),))
            d.text((bx + 22, by + bh / 2), l, font=F_LABEL, fill=(255, 255, 255, int(255 * a)), anchor='lm')
        im = Image.alpha_composite(im.convert('RGBA'), ov).convert('RGB')
    return im


def con_sub(img, tt):
    for a0, a1, g in CHUNKS:
        if a0 <= tt < a1:
            cur = next((k for k in g if WORDS[k][0] <= tt < WORDS[k][1]), None)
            lay = sub_layer(g, cur)
            img.paste(lay, (int((W - lay.width) / 2), 918), lay)
            break
    return img

# ---------- titulo y cierre (estilo Tutorial 01) ----------
F_T2, F_T3 = font(80, 800), font(36, 500)
F_C1, F_C2, F_C3 = font(78, 800), font(42, 600), font(44, 700)


def fondo_marca():
    img = Image.new('RGB', (W, H), DARK)
    ImageDraw.Draw(img).rectangle([0, 0, 13, H], fill=BRAND)
    return img


def con_alpha(lay, a):
    lay = lay.copy(); lay.putalpha(lay.getchannel('A').point(lambda v: int(v * a))); return lay


BOX_T = caja_logo(128)


def titulo(tt):
    a = ease(tt / 0.4)
    img = fondo_marca().convert('RGBA')
    img.alpha_composite(con_alpha(BOX_T, a), (int(W / 2 - 64), int(370 + (1 - a) * 16)))
    ov = Image.new('RGBA', (W, H), (0, 0, 0, 0)); d = ImageDraw.Draw(ov)
    d.text((W / 2, 596 + (1 - a) * 16), TITULO_LARGO, font=F_T2, fill=(255, 255, 255, int(255 * a)), anchor='mm')
    d.text((W / 2, 688 + (1 - a) * 16), f'Tutorial en {N} pasos', font=F_T3, fill=(255, 255, 255, int(235 * a)), anchor='mm')
    return Image.alpha_composite(img, ov).convert('RGB')


BOX_C = caja_logo(110)


def cierre(tt):
    img = fondo_marca().convert('RGBA')
    img.alpha_composite(con_alpha(BOX_C, ease(tt / 0.4)), (1760, 40))
    ov = Image.new('RGBA', (W, H), (0, 0, 0, 0)); d = ImageDraw.Draw(ov)
    a = ease(tt / 0.4)
    d.text((220, 405), 'Así de fácil', font=F_C1, fill=(255, 255, 255, int(255 * a)), anchor='lm')
    items = globals().get('CHECKS') or STEP_TITLES
    paso = 78 if len(items) <= 4 else 66
    for k, it in enumerate(items):
        b_ = ease((tt - 0.35 - k * 0.22) / 0.3)
        if b_ <= 0: continue
        y = 520 + k * paso + (1 - b_) * 10
        cxy = (242, y)
        d.ellipse([cxy[0] - 22, y - 22, cxy[0] + 22, y + 22], fill=BRAND + (int(255 * b_),))
        d.line([(231, y + 1), (239, y + 9), (254, y - 8)], fill=(255, 255, 255, int(255 * b_)), width=5, joint='curve')
        d.text((290, y), it, font=F_C2, fill=(255, 255, 255, int(255 * b_)), anchor='lm')
    c_ = 0 if FIN_VOZ else ease((tt - 0.9) / 0.4)   # con despedida, la frase la dice la voz con subtitulos
    d.text((W / 2, 958), CIERRE, font=F_C3, fill=(74, 222, 128, int(255 * c_)), anchor='mm')
    return Image.alpha_composite(img, ov).convert('RGB')

# ---------- render ----------
def main():
    json.dump(dict(fin=(dict(start=FIN_START, voz='voz/vfin.wav') if FIN_VOZ else None), sup=TITULO_SUP, titulo=TITULO, titulo_largo=TITULO_LARGO, pasos=N, total=TOTAL, steps=[dict(start=s['start'], D=s['D'], vd=s['vd']) for s in STEPS], subs=SUBS),
              open(f'{BASE}/timeline.json', 'w'), ensure_ascii=False, indent=1)
    if PREVIEW is None:
        enc = subprocess.Popen(['ffmpeg', '-v', 'error', '-y', '-f', 'rawvideo', '-pix_fmt', 'rgb24', '-s', f'{W}x{H}',
                                '-r', str(FPS), '-i', '-', '-c:v', 'libx264', '-preset', 'medium', '-crf', '18',
                                '-pix_fmt', 'yuv420p', f'{BASE}/video_sin_audio.mp4'], stdin=subprocess.PIPE)
        put = lambda im: enc.stdin.write(im.tobytes())
    want = set(int(round(p * FPS)) for p in (PREVIEW or []))
    gf = 0

    def emit(im):
        nonlocal gf
        if PREVIEW is None:
            put(im)
        elif gf in want:
            im.save(f'{BASE}/prev_{gf/FPS:07.2f}.png')
        gf += 1

    for f in range(int(round(TITLE_D * FPS))):
        emit(titulo(f / FPS) if (PREVIEW is None or gf in want) else None)
    for i, st in enumerate(STEPS):
        nf, z, cx, cy, al, rect, lab = pistas(st)
        lo, hi = int(round(st['start'] * FPS)), int(round(st['start'] * FPS)) + nf
        if PREVIEW is not None and not any(lo <= w < hi for w in want):
            gf += nf
            continue
        for f, src in enumerate(frames_fuente(st, nf)):
            if PREVIEW is not None and gf not in want:
                gf += 1
                continue
            gt = gf / FPS
            img = rec_frame(src, z[f], cx[f], cy[f], al[f], rect[f], lab[f])
            if i == 0 and gt < T_HOLD + 0.4:
                k = ease((gt - T_HOLD) / 0.4)
                img = Image.blend(titulo(gt), img, k) if k > 0 else titulo(gt)
            if not (i == 0 and gt < T_HOLD + 0.2):
                header(img, i, f / FPS, gt)
            emit(con_sub(img, gf / FPS))
        print(f'paso {i+1} listo', flush=True)
    for f in range(int(round(CLOSE_D * FPS))):
        emit(con_sub(cierre(f / FPS), gf / FPS) if (PREVIEW is None or gf in want) else None)
    if PREVIEW is None:
        enc.stdin.close(); enc.wait()
    print('frames', gf, 'total', TOTAL)


if __name__ == '__main__':
    main()
