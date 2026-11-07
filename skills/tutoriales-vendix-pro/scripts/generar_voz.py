#!/usr/bin/env python3
"""Voz Erinome (OpenRouter, google/gemini-3.8-flash-tts) por paso, a x1,3 y sin pausas > 0,3 s.

Uso: python3 generar_voz.py <proyecto> [paso ... | fin]   (sin argumentos: todos los bloques de vo.txt + la despedida)
Escribe <proyecto>/voz/v<N>.wav y, para despedida.txt, <proyecto>/voz/vfin.wav. Solo regenera los pasos indicados (la voz cuesta creditos).

OPENROUTER_API_KEY: en sesiones cloud la inyecta el proxy (exporta cualquier valor, p. ej. 'proxy-injected').
Nota: Gemini TTS en OpenRouter solo acepta response_format="pcm" (24 kHz, 16 bit, mono); "wav" y "mp3" dan 400.
"""
import json, os, re, subprocess, sys, tempfile, urllib.request, wave
import numpy as np

MODELO, VOZ, VELOCIDAD = 'google/gemini-3.8-flash-tts', 'Erinome', 1.3
URL = 'https://openrouter.ai/api/v1/audio/speech'


def tts(texto, destino):
    req = urllib.request.Request(URL, data=json.dumps({'model': MODELO, 'voice': VOZ, 'input': texto,
                                                       'response_format': 'pcm'}).encode(),
                                 headers={'Authorization': f"Bearer {os.environ.get('OPENROUTER_API_KEY', 'proxy-injected')}",
                                          'Content-Type': 'application/json'})
    with urllib.request.urlopen(req, timeout=300) as r:
        open(destino, 'wb').write(r.read())


def posprocesar(pcm, salida):
    filtros = ','.join(['silenceremove=stop_periods=-1:stop_duration=0.15:stop_threshold=-40dB:stop_silence=0.15:detection=peak',
                        f'atempo={VELOCIDAD}', 'alimiter=limit=0.89:level=false',
                        'silenceremove=stop_periods=-1:stop_duration=0.25:stop_threshold=-36dB:stop_silence=0.25:detection=peak'])
    subprocess.run(['ffmpeg', '-y', '-loglevel', 'error', '-f', 's16le', '-ar', '24000', '-ac', '1', '-i', pcm,
                    '-af', filtros, '-ar', '48000', salida], check=True)


def recortar_pausas(p, maximo=0.29, deja=0.24):
    """Recorta a mano cualquier silencio interno que siga pasando de 0,3 s."""
    err = subprocess.run(['ffmpeg', '-nostats', '-i', p, '-af', f'silencedetect=n=-38dB:d={maximo}', '-f', 'null', '-'],
                         capture_output=True, text=True).stderr
    ss = [(float(a), float(b)) for a, b in re.findall(r'silence_start: ([0-9.]+)[\s\S]*?silence_end: ([0-9.]+)', err)]
    w = wave.open(p); sr, ch = w.getframerate(), w.getnchannels()
    a = np.frombuffer(w.readframes(w.getnframes()), np.int16).reshape(-1, ch); w.close()
    keep = np.ones(len(a), bool)
    for s, e in ss:
        if e - s > maximo and s > 0.05 and e < len(a) / sr - 0.05:
            m, cut = (s + e) / 2, (e - s) - deja
            keep[int((m - cut / 2) * sr):int((m + cut / 2) * sr)] = False
    o = wave.open(p, 'wb'); o.setnchannels(ch); o.setsampwidth(2); o.setframerate(sr); o.writeframes(a[keep].tobytes()); o.close()


def main():
    P = sys.argv[1]
    bloques = open(f'{P}/vo.txt', encoding='utf-8').read().strip().split('\n\n')
    hay_fin = os.path.exists(f'{P}/despedida.txt')
    pasos = sys.argv[2:] or [str(i) for i in range(1, len(bloques) + 1)] + (['fin'] if hay_fin else [])
    os.makedirs(f'{P}/voz', exist_ok=True)
    for i in pasos:
        texto = open(f'{P}/despedida.txt', encoding='utf-8').read().strip() if i == 'fin' else bloques[int(i) - 1].strip()
        open(f'{P}/voz/p{i}.txt', 'w', encoding='utf-8').write(texto)
        with tempfile.TemporaryDirectory() as tmp:
            tts(texto, f'{tmp}/crudo.pcm')
            posprocesar(f'{tmp}/crudo.pcm', f'{P}/voz/v{i}.wav')
        recortar_pausas(f'{P}/voz/v{i}.wav')
        dur = float(subprocess.check_output(['ffprobe', '-v', 'error', '-show_entries', 'format=duration', '-of', 'csv=p=0', f'{P}/voz/v{i}.wav']))
        err = subprocess.run(['ffmpeg', '-nostats', '-i', f'{P}/voz/v{i}.wav', '-af', 'silencedetect=n=-38dB:d=0.08', '-f', 'null', '-'],
                             capture_output=True, text=True).stderr
        mx = max([float(x) for x in re.findall(r'silence_duration: ([0-9.]+)', err)] or [0])
        print(f'paso {i}: {dur:.2f} s, pausa maxima {mx:.2f} s')


if __name__ == '__main__':
    main()
