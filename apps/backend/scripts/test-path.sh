#!/usr/bin/env sh
# `npm run test:path -- <ruta>` — jest acotado a una ruta, --runInBand, código de
# salida real. Sin ruta no corre: la suite completa son 401 specs (~10 h) y NO es
# compuerta de ningún paso del plan CP-pos-exclusive-tax-double-charge.
#
# OJO (medido): los posicionales de jest son regex OR-eados, no rutas. Pasar dos
# rutas y que una no exista da EXIT 0 con la otra en verde. Una ruta por invocación.
if [ "$#" -eq 0 ]; then
  echo "test:path requiere al menos una ruta. Ej: npm run test:path -- src/domains/store/payments" >&2
  exit 2
fi

# Ronda 3 (plan CP-pos-exclusive-tax-double-charge, QUI-832, G4): el comentario
# de arriba ya avisaba del OR-eado de jest, pero no lo impedía — dos rutas con
# una mala corrían la buena en verde con EXIT 0 en silencio. Valida en disco
# todo argumento que "parezca una ruta" (no empieza por "-" y contiene "/") y
# deja pasar sin tocar cualquier otra cosa (nombre de -t, flags de jest), para
# no romper usos legítimos como `-t 'algún nombre'` o varias rutas válidas.
for arg in "$@"; do
  case "$arg" in
    -*) continue ;;
  esac
  case "$arg" in
    */*)
      if [ ! -e "$arg" ]; then
        echo "test:path: la ruta '$arg' no existe (ni como archivo ni como directorio)." >&2
        exit 2
      fi
      ;;
  esac
done

exec npx jest --runInBand "$@"
