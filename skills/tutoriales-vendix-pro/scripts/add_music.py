#!/usr/bin/env python3
"""Mezcla la musica oficial de los tutoriales Vendix bajo un video ya montado.

Uso: python3 add_music.py <dir_proyecto> <entrada.mp4> <salida.mp4>
- Pista: Fondo tutoriales Vendix.mp3 (MD5 08c77fefdbc1748d278a07a411d38cdf), en bucle.
- Ducking de -12 dB mientras habla la voz (voz_final.wav del proyecto, desplazada por la entrada).
- Mas alta en titulo/cierre (donde no hay voz), fundido de 1 s al final del logo.
- Pico final <= -1 dB bajando la mezcla general (sin comprimir la voz).
"""
import hashlib, json, os, subprocess, sys
import numpy as np

SR = 48000
INTRO_OFFSET = 6.0 - 0.5          # el cuerpo empieza aqui (entrada de marca de 6 s menos el fundido)
MUSICA = os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))), 'assets', 'Fondo tutoriales Vendix.mp3')
BASE_DB, DUCK_DB = 0.0, -12.0     # nivel sin voz y reduccion con voz


def leer(path, ch=2):
    raw = subprocess.check_output(['ffmpeg', '-v', 'error', '-i', path, '-f', 's16le', '-ac', str(ch),
                                   '-ar', str(SR), '-'])
    return np.frombuffer(raw, np.int16).astype(np.float32).reshape(-1, ch) / 32768


def suavizar(x, ataque, caida):
    out = np.empty_like(x); v = 0.0
    a, r = np.exp(-1 / (ataque * 100)), np.exp(-1 / (caida * 100))
    for i, s in enumerate(x):
        c = a if s > v else r
        v = c * v + (1 - c) * s
        out[i] = v
    return out


def main():
    proj, src, dst = sys.argv[1:4]
    assert hashlib.md5(open(MUSICA, 'rb').read()).hexdigest() == '08c77fefdbc1748d278a07a411d38cdf'
    mezcla = leer(src)
    n = len(mezcla)
    mus = leer(MUSICA)
    mus = np.tile(mus, (n // len(mus) + 1, 1))[:n]
    # actividad de voz cada 10 ms
    voz = leer(os.path.join(proj, 'voz_final.wav'), 1)[:, 0]
    hop = SR // 100
    rms = np.sqrt(np.add.reduceat(voz ** 2, np.arange(0, len(voz), hop)) / hop)
    activo = (rms > 0.01).astype(np.float32)
    # cerrar huecos cortos entre frases (< 0.6 s) para que la musica no suba entre palabras
    k = 60
    activo = np.convolve(activo, np.ones(k), 'same') > 0
    act = np.zeros(int(n / hop) + 1, np.float32)
    o = int(INTRO_OFFSET * 100)
    act[o:o + len(activo)] = activo[:len(act) - o]
    env = suavizar(act, 0.12, 0.45)               # entrada ~0,4 s suave
    g_db = BASE_DB + DUCK_DB * env
    g = 10 ** (g_db / 20)
    g = np.repeat(g, hop)[:n]
    if len(g) < n:
        g = np.pad(g, (0, n - len(g)), mode='edge')
    mus = mus * g[:, None]
    # fundido final de 1 s
    f = SR
    mus[-f:] *= np.linspace(1, 0, f)[:, None]
    out = mezcla + mus
    pico = 20 * np.log10(np.abs(out).max() + 1e-9)
    ajuste = min(0.0, -1.2 - pico)
    out *= 10 ** (ajuste / 20)
    pcm = (np.clip(out, -1, 1) * 32767).astype(np.int16).tobytes()
    p = subprocess.Popen(['ffmpeg', '-v', 'error', '-y', '-i', src, '-f', 's16le', '-ac', '2', '-ar', str(SR), '-i', '-',
                          '-map', '0:v', '-map', '1:a', '-c:v', 'copy', '-c:a', 'aac', '-b:a', '192k',
                          '-movflags', '+faststart', dst], stdin=subprocess.PIPE)
    p.communicate(pcm)
    print(f'{os.path.basename(dst)}: pico previo {pico:.1f} dB, ajuste general {ajuste:.1f} dB')


if __name__ == '__main__':
    main()
