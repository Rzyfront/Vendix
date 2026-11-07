#!/usr/bin/env bash
# Revisa el pico de audio de un tutorial Vendix exportado.
# Uso: bash revisar_niveles.sh video.mp4
set -euo pipefail
[ $# -eq 1 ] || { echo "Uso: bash revisar_niveles.sh video.mp4"; exit 1; }

pico=$(ffmpeg -hide_banner -nostats -i "$1" -af volumedetect -vn -f null - 2>&1 \
  | sed -n 's/.*max_volume: \(-\?[0-9.]*\) dB.*/\1/p')

echo "Pico: ${pico} dB (máximo permitido: -1.0 dB)"
if awk -v p="$pico" 'BEGIN{exit !(p > -1.0)}'; then
  echo "FALLA: baja la mezcla general $(awk -v p="$pico" 'BEGIN{printf "%.1f", p+1.0}') dB o más y vuelve a exportar."
  exit 1
fi
echo "OK"
