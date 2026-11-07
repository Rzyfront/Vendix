#!/usr/bin/env python3
"""Ayudas para entender la grabacion antes de escribir guion y focos.

  python3 analizar.py hojas   <proy> [cada_s=4]          -> grid/hoja_XX.png (miniaturas con segundo)
  python3 analizar.py actividad <proy> [ini] [fin]       -> que cambia en pantalla cada 0,5 s (zona en px de grabacion.mp4)
  python3 analizar.py cuadricula <proy> t1,t2,...        -> grid/cuad_*.png con cuadricula de coordenadas
  python3 analizar.py frases <proy>                      -> tiempo de cada frase del guion por paso (tras generar voz)
"""
import collections, json, os, subprocess, sys
import numpy as np
from PIL import Image, ImageDraw, ImageFont

ASSETS = os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))), 'assets')
FONT = os.path.join(ASSETS, 'PlusJakartaSans.ttf')


def size(p):
    o = subprocess.check_output(['ffprobe', '-v', 'error', '-show_entries', 'stream=width,height', '-of', 'csv=p=0', p]).decode().split(',')
    return int(o[0]), int(o[1])


def hojas(P, cada=4):
    os.makedirs(f'{P}/grid', exist_ok=True)
    subprocess.run(['ffmpeg', '-v', 'error', '-y', '-i', f'{P}/grabacion.mp4', '-vf',
                    f"fps=1/{cada},scale=480:-1,drawtext=fontfile={FONT}:text='%{{eif\\:t\\:d}}s':x=380:y=4:fontsize=30:fontcolor=red:box=1:boxcolor=white,tile=4x4",
                    f'{P}/grid/hoja_%02d.png'], check=True)
    print(sorted(f for f in os.listdir(f'{P}/grid') if f.startswith('hoja_')))


def actividad(P, ini=0.0, fin=None):
    Ws, Hs = size(f'{P}/grabacion.mp4'); W, H = 480, round(480 * Hs / Ws); k = Ws / W
    args = ['ffmpeg', '-v', 'error', '-ss', str(ini)] + (['-t', str(fin - ini)] if fin else []) + \
        ['-i', f'{P}/grabacion.mp4', '-vf', f'fps=10,scale={W}:{H},format=gray', '-f', 'rawvideo', '-']
    p = subprocess.Popen(args, stdout=subprocess.PIPE)
    prev = None; i = 0; b = collections.OrderedDict()
    while True:
        x = p.stdout.read(W * H)
        if len(x) < W * H: break
        f = np.frombuffer(x, np.uint8).astype(np.int16).reshape(H, W)
        if prev is not None:
            d = np.abs(f - prev) > 12
            if d.sum() > 3:
                ys, xs = np.nonzero(d); t = round((ini + i / 10) * 2) / 2
                e = b.setdefault(t, [0, 9e9, 9e9, 0, 0]); e[0] += d.sum()
                e[1] = min(e[1], xs.min()); e[2] = min(e[2], ys.min()); e[3] = max(e[3], xs.max()); e[4] = max(e[4], ys.max())
        prev = f; i += 1
    for t, e in b.items():
        print(f"{t:6.1f} n={e[0]:6d} ({int(e[1]*k)},{int(e[2]*k)})-({int(e[3]*k)},{int(e[4]*k)})")


def cuadricula(P, ts):
    os.makedirs(f'{P}/grid', exist_ok=True)
    f = ImageFont.truetype(FONT, 18); F = ImageFont.truetype(FONT, 40)
    for t in ts:
        subprocess.run(['ffmpeg', '-v', 'error', '-y', '-ss', str(t), '-i', f'{P}/grabacion.mp4', '-frames:v', '1', f'{P}/grid/_t.png'], check=True)
        im = Image.open(f'{P}/grid/_t.png').convert('RGB'); d = ImageDraw.Draw(im); W, H = im.size
        for x in range(0, W, 100): d.line([(x, 0), (x, H)], fill=(255, 0, 0)); d.text((x + 2, 2), str(x), fill=(255, 0, 0), font=f)
        for y in range(0, H, 100): d.line([(0, y), (W, y)], fill=(0, 0, 255)); d.text((2, y + 2), str(y), fill=(0, 0, 255), font=f)
        d.text((W // 2, H - 50), f't={t}', fill=(255, 0, 0), font=F)
        im.save(f'{P}/grid/cuad_{t}.png'); print(f'{P}/grid/cuad_{t}.png')


def frases(P):
    subprocess.run([sys.executable, os.path.join(os.path.dirname(os.path.abspath(__file__)), 'render.py'), P, 'x.mp4', '-1'],
                   capture_output=True)
    t = json.load(open(f'{P}/timeline.json')); ss = t['steps']
    print('duracion del cuerpo', round(t['total'], 1), 's | pasos', [round(s['D'], 2) for s in ss])
    for a, b, c in t['subs']:
        i = max(k for k, s in enumerate(ss) if s['start'] <= a + 1e-6)
        print(f"paso {i+1}  {a - ss[i]['start']:6.2f}s  {c[:80]}")


if __name__ == '__main__':
    cmd, P = sys.argv[1], sys.argv[2]
    if cmd == 'hojas': hojas(P, float(sys.argv[3]) if len(sys.argv) > 3 else 4)
    elif cmd == 'actividad': actividad(P, *[float(x) for x in sys.argv[3:5]])
    elif cmd == 'cuadricula': cuadricula(P, [float(x) for x in sys.argv[3].split(',')])
    elif cmd == 'frases': frases(P)
