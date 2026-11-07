#!/usr/bin/env bash
# Crea la carpeta de un tutorial y normaliza la grabacion.
# Uso: bash nuevo_proyecto.sh <carpeta_proyecto> <grabacion(.mp4|.mov) | enlace de Google Drive>
set -euo pipefail
P="$1"; SRC="$2"
mkdir -p "$P/voz" "$P/grid" "$P/prev"
if [[ "$SRC" == *drive.google.com* ]]; then
  ID=$(echo "$SRC" | sed -E 's#.*/d/([^/]+).*#\1#; s#.*[?&]id=([^&]+).*#\1#')
  curl -sSL -D "$P/drive_headers.txt" -o "$P/original" "https://drive.usercontent.google.com/download?id=$ID&export=download&confirm=t"
  grep -io 'filename="[^"]*"' "$P/drive_headers.txt" || true
  SRC="$P/original"
fi
file "$SRC" | grep -qiE "ISO Media|QuickTime|video" || { echo "No es un video (¿enlace sin permiso publico?)"; exit 1; }
# 30 fps; ancho 1960 conservando proporcion (las grabaciones Retina de Mac llegan a 2940x1846)
ffmpeg -v error -y -i "$SRC" -vf "fps=30,scale=1960:-2:flags=lanczos" -an -c:v libx264 -preset fast -crf 14 "$P/grabacion.mp4"
ffprobe -v error -show_entries stream=width,height:format=duration -of compact "$P/grabacion.mp4"
echo "Proyecto listo en $P"
