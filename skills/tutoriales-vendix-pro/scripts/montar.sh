#!/usr/bin/env bash
# Render completo + entrada de marca con tags + logo final + musica + control de niveles.
# Uso: bash montar.sh <proyecto> <salida.mp4>
set -euo pipefail
P="$(cd "$1" && pwd)"; OUT="$2"
SK="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$P"
python3 "$SK/scripts/render.py" "$P" 2>&1 | grep -v "Broken pipe" | grep -E "^frames|Traceback|Error:" || true
[ -f video_sin_audio.mp4 ] || { echo "Fallo el render"; exit 1; }
python3 "$SK/scripts/intro_tags.py" "$P"
python3 - "$P" "$SK" <<'PY'
import json, subprocess, sys
P, SK = sys.argv[1:3]
t = json.load(open(f'{P}/timeline.json'))
ins, fil = [], []
for i, s in enumerate(t['steps']):
    ins += ['-i', f'{P}/voz/v{i+1}.wav']; ms = int(round((s['start'] + 0.25) * 1000))
    fil.append(f'[{i}]aresample=48000,aformat=channel_layouts=stereo,adelay={ms}|{ms}[a{i}]')
n = len(t['steps'])
if t.get('fin'):                       # despedida sobre el cierre
    ins += ['-i', f"{P}/{t['fin']['voz']}"]; ms = int(round(t['fin']['start'] * 1000))
    fil.append(f'[{n}]aresample=48000,aformat=channel_layouts=stereo,adelay={ms}|{ms}[a{n}]'); n += 1
fc = ';'.join(fil) + ';' + ''.join(f'[a{i}]' for i in range(n)) + f"amix=inputs={n}:normalize=0,apad,atrim=0:{t['total']:.3f}[o]"
subprocess.run(['ffmpeg', '-v', 'error', '-y', *ins, '-filter_complex', fc, '-map', '[o]', '-c:a', 'pcm_s16le', f'{P}/voz_final.wav'], check=True)
IN, X = 6.0, 0.5                       # entrada de marca (6 s) y fundido hacia el cuerpo
o1 = IN - X; o2 = o1 + t['total'] - 0.3
fc = (f"[0:v]scale=1920:1080:flags=lanczos,fps=30,setsar=1[i0];[i0][4:v]overlay=0:0:format=auto,format=yuv420p,settb=1/30[iv];"
      f"[1:v]fps=30,format=yuv420p,setsar=1,settb=1/30[bv];"
      f"[2:v]setpts=PTS/1.5,scale=1920:1080:flags=lanczos,fps=30,format=yuv420p,setsar=1,settb=1/30[lv];"
      f"[iv][bv]xfade=transition=fade:duration={X}:offset={o1}[v1];[v1][lv]xfade=transition=fade:duration=0.3:offset={o2:.3f}[v];"
      f"[0:a]aresample=48000,aformat=channel_layouts=stereo,atrim=0:{IN}[ia];"
      f"[3:a]aresample=48000,aformat=channel_layouts=stereo[ba];"
      f"[2:a]atempo=1.5,aresample=48000,aformat=channel_layouts=stereo,afade=t=out:st=5.67:d=1[la];"
      f"[ia][ba]acrossfade=d={X}:c1=tri:c2=tri[a1];[a1][la]acrossfade=d=0.3:c1=tri:c2=tri[a]")
subprocess.run(['ffmpeg', '-v', 'error', '-y', '-i', f'{SK}/assets/intro_vendix.mp4', '-i', f'{P}/video_sin_audio.mp4',
                '-i', f'{SK}/assets/Vendix Logo Reveal.mp4', '-i', f'{P}/voz_final.wav', '-framerate', '30', '-i', f'{P}/tags/%04d.png',
                '-filter_complex', fc, '-map', '[v]', '-map', '[a]', '-c:v', 'libx264', '-preset', 'medium', '-crf', '18', '-r', '30',
                '-c:a', 'aac', '-b:a', '192k', '-movflags', '+faststart', f'{P}/sin_musica.mp4'], check=True)
PY
python3 "$SK/scripts/add_music.py" "$P" "$P/sin_musica.mp4" "$OUT"
ffprobe -v error -show_entries format=duration -of csv=p=0 "$OUT"
bash "$SK/scripts/revisar_niveles.sh" "$OUT"
