# Filtro de bitácora para el `ng serve` nativo (scripts/dev-fe.sh).
#
# Reenvía TODO a stdout (tu terminal no cambia) y, en paralelo, mantiene en LOG
# ÚNICAMENTE el ciclo de compilación en curso. No acumula: el archivo se
# REESCRIBE entero en cada volcado, así que su tamaño está acotado por CAP
# líneas, no por la duración de la sesión.
#
# Por qué solo el último ciclo y no un tail del historial: leer el archivo
# entero es la trampa ya documentada con `docker logs` — errores de un ciclo
# anterior, ya corregidos, se leen como vigentes. Si el archivo ES el último
# ciclo, quien lo lea no puede equivocarse.

function volcar(   i, desde) {
    desde = (n <= CAP ? 1 : n - CAP + 1)
    for (i = desde; i <= n; i++) printf "%s\n", buf[i % CAP] > LOG
    close(LOG)          # cerrar es lo que hace que el próximo ">" trunque
    pendiente = 0
}

BEGIN { CAP = 800; n = 0; pendiente = 0 }

{
    print; fflush()

    # Inicio de ciclo: Angular anuncia el rebuild antes de compilar.
    if ($0 ~ /Changes detected|Rebuilding\.\.\.|File change detected/) n = 0

    buf[(++n) % CAP] = $0
    pendiente = 1

    # Fin de ciclo: volcado inmediato, que es cuando el veredicto importa.
    if ($0 ~ /bundle generation (complete|failed)|Watch mode enabled|ERROR|error TS[0-9]/) volcar()

    # Durante un ciclo largo, volcar cada 40 líneas para que un agente que
    # pregunte a mitad de build vea algo y no un archivo congelado.
    else if (n % 40 == 0) volcar()
}

END { if (pendiente) volcar() }
