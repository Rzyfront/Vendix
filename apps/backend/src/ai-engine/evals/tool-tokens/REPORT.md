# Línea base de tokens de herramientas (T60, config 0)

Estimador: `bytes_v1` (bytes del JSON; pesimista, no es un tokenizador). Generado por `measure-tool-tokens.ts`; no edites a mano.

## Herramientas

- Declaradas (nombres únicos en el código): **390** (392 salidas de fábrica; el "~489" del plan era un grep).
- Autorizadas para owner en Vex (permisos ∩ agente − 25 `ui_*` − extranjeras − sandbox fuera de durable): **362**.
- Definiciones del catálogo completo autorizado: **350.483** tokens estimados por turno; índice del taller en el prompt: 7.813 bytes.

## Totales (entrada = suma de todas las vueltas al modelo)

### Enrutado (config 0, precarga ideal del oráculo)

| Grupo | Tareas | Entrada (tokens) | Salida est. (tokens) | Vueltas | Alcanzables |
|---|---|---|---|---|---|
| una llamada | 5 | 1.659.571 | 3.466 | 10 | 5/5 |
| multi-paso | 25 | 4.627.549 | 22.860 | 86 | 25/25 |
| todas | 30 | 6.287.120 | 26.326 | 96 | 30/30 |

### Catálogo completo (cobertura < 90 %, respaldo)

| Grupo | Tareas | Entrada (tokens) | Salida est. (tokens) | Vueltas | Alcanzables |
|---|---|---|---|---|---|
| una llamada | 5 | 3.575.723 | 3.466 | 10 | 5/5 |
| multi-paso | 25 | 31.012.681 | 22.860 | 86 | 25/25 |
| todas | 30 | 34.588.404 | 26.326 | 96 | 30/30 |

## Por tarea

| Id | Tipo | Vueltas | Herr. turno 0 (enrutado) | Def. turno 0 enrutado | Def. turno 0 completo | Entrada enrutado | Entrada completo | Salida est. | Alcanzable |
|---|---|---|---|---|---|---|---|---|---|
| t01 | multi | 3 | 18 | 23.923 | 343.074 | 115.807 | 1.073.260 | 810 | sí |
| t02 | multi | 3 | 19 | 24.527 | 343.074 | 126.880 | 1.082.521 | 904 | sí |
| t03 | multi | 4 | 20 | 25.877 | 343.074 | 169.223 | 1.438.011 | 883 | sí |
| t04 | multi | 3 | 19 | 24.492 | 343.074 | 123.085 | 1.078.831 | 811 | sí |
| t05 | una | 2 | 18 | 23.145 | 343.074 | 75.272 | 715.130 | 698 | sí |
| t06 | multi | 3 | 21 | 25.821 | 343.074 | 124.918 | 1.076.677 | 983 | sí |
| t07 | multi | 3 | 19 | 24.078 | 343.074 | 118.243 | 1.075.231 | 786 | sí |
| t08 | una | 2 | 18 | 23.755 | 343.074 | 77.212 | 715.850 | 690 | sí |
| t09 | multi | 3 | 19 | 25.501 | 343.074 | 122.473 | 1.075.192 | 786 | sí |
| t10 | multi | 3 | 19 | 24.131 | 343.074 | 117.567 | 1.074.396 | 794 | sí |
| t11 | multi | 3 | 355 | 343.074 | 343.074 | 1.074.422 | 1.074.422 | 783 | sí |
| t12 | una | 2 | 355 | 343.074 | 343.074 | 714.951 | 714.951 | 693 | sí |
| t13 | una | 2 | 355 | 343.074 | 343.074 | 714.937 | 714.937 | 693 | sí |
| t14 | una | 2 | 18 | 24.246 | 343.074 | 77.199 | 714.855 | 692 | sí |
| t15 | multi | 3 | 19 | 25.391 | 343.074 | 121.568 | 1.074.617 | 786 | sí |
| t16 | multi | 4 | 19 | 24.949 | 343.074 | 174.630 | 1.447.130 | 1.116 | sí |
| t17 | multi | 4 | 19 | 25.505 | 343.074 | 171.091 | 1.441.367 | 1.123 | sí |
| t18 | multi | 4 | 19 | 26.706 | 343.074 | 186.641 | 1.452.113 | 878 | sí |
| t19 | multi | 5 | 21 | 26.787 | 343.074 | 261.147 | 1.842.582 | 1.301 | sí |
| t20 | multi | 3 | 19 | 24.335 | 343.074 | 129.780 | 1.085.997 | 982 | sí |
| t21 | multi | 3 | 19 | 24.601 | 343.074 | 130.911 | 1.086.330 | 890 | sí |
| t22 | multi | 3 | 19 | 25.061 | 343.074 | 127.023 | 1.081.062 | 884 | sí |
| t23 | multi | 4 | 20 | 25.323 | 343.074 | 169.195 | 1.440.199 | 884 | sí |
| t24 | multi | 4 | 20 | 26.026 | 343.074 | 174.086 | 1.442.278 | 893 | sí |
| t25 | multi | 3 | 18 | 23.923 | 343.074 | 116.893 | 1.074.346 | 922 | sí |
| t26 | multi | 4 | 19 | 24.527 | 343.074 | 171.741 | 1.445.929 | 961 | sí |
| t27 | multi | 3 | 20 | 25.022 | 343.074 | 123.876 | 1.078.032 | 906 | sí |
| t28 | multi | 3 | 19 | 24.807 | 343.074 | 121.252 | 1.076.053 | 884 | sí |
| t29 | multi | 4 | 19 | 24.078 | 343.074 | 159.564 | 1.435.548 | 870 | sí |
| t30 | multi | 4 | 20 | 26.818 | 343.074 | 195.533 | 1.460.557 | 1.040 | sí |

## Método y límites

- **Estimador, no tokenizador.** `bytes_v1` cuenta bytes del JSON enviado; sobreestima. Sirve para comparar configuraciones, no para facturar. No son tokens observados del proveedor.
- **Trayectorias de oráculo escritas a mano.** `task-bank.json` fija qué herramientas llama cada tarea y en qué orden; el modelo real puede llamar otras, repetir o fallar. 15 tareas salen de las conversaciones doradas de Vex, 15 son multi-paso redactadas.
- **Resultados de muestra, no datos de producción.** `tool-result-fixtures.json` trae una fila por herramienta con la forma del handler y se repite N veces. Cada fixture declara su `fidelity`: `handler_shape` (leído del handler), `service_shape_approx` (el handler devuelve el payload crudo del servicio) o `assumed_shape` (handler sin leer; forma supuesta). El tamaño real de los resultados depende de la tienda.
- **Prompt de sistema supuesto.** Se usa un relleno de 6.000 bytes más el índice real del taller; el prompt real de Vex no se mide aquí.
- **Enrutado = mejor caso.** El ranker es un sustituto que puntúa las herramientas del oráculo, así que la precarga (máx. 8) acierta siempre; el enrutador real puede fallar y caer al catálogo completo. Una herramienta fuera de la precarga se ofrece desde la vuelta siguiente a su primera llamada (regla dura), sin vuelta extra de `search_tools`.
- **No se modela** la compactación de resultados, la caché de prompt del proveedor, la latencia ni el costo en dinero. La salida estimada son los mensajes de tool_calls más un cierre de 600 bytes.
- **Alcanzable** es una prueba estructural (todas las herramientas del oráculo existen y están autorizadas para el owner), no una tasa de éxito del modelo.
- **Pendiente:** medición en vivo con modelo (requiere backend y gasto de proveedor; fuera de alcance de T60). Config 1 y 2 las añade T70.
## Configuración 1 (T62, fichas cortas y describe_tool)

**ESTIMACIÓN determinista bytes_v1; no son tokens observados del proveedor.** Generado por `measure-tool-tokens.ts --config 1`; no edites a mano. Misma autoridad, banco, fixtures y supuestos que la config 0; compara contra su columna "enrutado".

- **Qué cambia:** con `AI_TOOL_DISCOVERY_STUBS=true` la precarga (y cada herramienta que la tarea va llamando) viaja como una línea `nombre — una línea (lee|escribe)` en un mensaje de sistema, sin esquema; `describe_tool` entra al núcleo. Apagado, el turno es idéntico al de hoy.
- **Índice del taller: se queda con nombres (decisión provisional).** Pesa 7.813 bytes (≈ 7.917 tokens estimados por vuelta, dentro del prefijo cacheable), frente a 22.654 tokens de definiciones en el turno 0 con fichas. Reducirlo a `dominio: n herramientas` bajaría a ≈ 1.700 tokens: cota superior de ahorro 596.832 tokens sobre las 96 vueltas del banco, pero quita al modelo los nombres exactos que hoy le permiten llamar sin buscar y no existe todavía una estadística de uso para elegir los "más usados". Se decide con medición en vivo; apagado el índice no cambia. La frase de ruteo nueva suma 178 bytes.
- **Dos lecturas de la misma trayectoria:** *directo* = el modelo llama la herramienta desde su ficha (optimista: un argumento errado costaría un reintento); *con describe_tool* = antes de cada grupo de llamadas pide la ficha completa de cada herramienta nueva, una vuelta extra por grupo (pesimista, es la lectura principal).

| Grupo | Tareas | Config 0 entrada | Config 1 directo | Config 1 con describe_tool | Vueltas (0 → 1) | Alcanzables |
|---|---|---|---|---|---|---|
| una llamada | 5 | 1.659.571 | 1.657.195 (-0,1 %) | 2.500.575 (50,7 %) | 10 → 15 | 5/5 |
| multi-paso | 25 | 4.627.549 | 4.475.636 (-3,3 %) | 7.879.281 (70,3 %) | 86 → 147 | 25/25 |
| todas | 30 | 6.287.120 | 6.132.831 (-2,5 %) | 10.379.856 (65,1 %) | 96 → 162 | 30/30 |

**Lectura:** el núcleo fijo (22.654 tokens de definiciones en el turno 0 con fichas) domina el costo de cada vuelta, así que quitar la precarga de definiciones solo cambia la entrada -2,5 % en la lectura directa y, si el modelo pide la ficha de cada herramienta, la entrada cambia 65,1 % por las vueltas extra que reenvían todo el contexto. Con estos supuestos la config 1 NO baja los tokens de entrada de forma útil; las 30 tareas siguen alcanzables.

Entrada = suma de todas las vueltas al modelo, en tokens estimados. Las tareas que la config 0 ya sirve con el catálogo completo (cobertura insuficiente del oráculo) no mejoran: el respaldo no usa fichas.

| Id | Tipo | Motivo catálogo completo | Def. turno 0 (0 → 1) | Fichas | Entrada config 0 | Entrada directo | Entrada con describe | Vueltas | Alcanzable |
|---|---|---|---|---|---|---|---|---|---|
| t01 | multi | — | 23.923 → 22.654 | 1 | 115.807 | 113.509 | 197.943 | 3 → 5 | sí |
| t02 | multi | — | 24.527 → 22.654 | 2 | 126.880 | 123.199 | 216.625 | 3 → 5 | sí |
| t03 | multi | — | 25.877 → 22.654 | 3 | 169.223 | 159.047 | 290.969 | 4 → 7 | sí |
| t04 | multi | — | 24.492 → 22.654 | 2 | 123.085 | 119.476 | 203.333 | 3 → 5 | sí |
| t05 | una | — | 23.145 → 22.654 | 1 | 75.272 | 75.304 | 114.387 | 2 → 3 | sí |
| t06 | multi | — | 25.821 → 22.654 | 4 | 124.918 | 118.471 | 205.579 | 3 → 5 | sí |
| t07 | multi | — | 24.078 → 22.654 | 2 | 118.243 | 115.843 | 198.872 | 3 → 5 | sí |
| t08 | una | — | 23.755 → 22.654 | 1 | 77.212 | 75.776 | 115.623 | 2 → 3 | sí |
| t09 | multi | — | 25.501 → 22.654 | 2 | 122.473 | 115.792 | 201.124 | 3 → 5 | sí |
| t10 | multi | — | 24.131 → 22.654 | 2 | 117.567 | 114.984 | 197.418 | 3 → 5 | sí |
| t11 | multi | no_evidence | 343.074 → 343.074 | 0 | 1.074.422 | 1.075.412 | 1.797.095 | 3 → 5 | sí |
| t12 | una | no_evidence | 343.074 → 343.074 | 0 | 714.951 | 715.611 | 1.077.254 | 2 → 3 | sí |
| t13 | una | no_evidence | 343.074 → 343.074 | 0 | 714.937 | 715.597 | 1.077.233 | 2 → 3 | sí |
| t14 | una | — | 24.246 → 22.654 | 1 | 77.199 | 74.907 | 116.078 | 2 → 3 | sí |
| t15 | multi | — | 25.391 → 22.654 | 2 | 121.568 | 115.262 | 199.428 | 3 → 5 | sí |
| t16 | multi | — | 24.949 → 22.654 | 2 | 174.630 | 167.686 | 305.922 | 4 → 7 | sí |
| t17 | multi | — | 25.505 → 22.654 | 2 | 171.091 | 162.387 | 297.039 | 4 → 7 | sí |
| t18 | multi | — | 26.706 → 22.654 | 2 | 186.641 | 172.953 | 322.849 | 4 → 7 | sí |
| t19 | multi | — | 26.787 → 22.654 | 4 | 261.147 | 244.822 | 470.033 | 5 → 9 | sí |
| t20 | multi | — | 24.335 → 22.654 | 2 | 129.780 | 126.726 | 213.791 | 3 → 5 | sí |
| t21 | multi | — | 24.601 → 22.654 | 2 | 130.911 | 127.047 | 217.164 | 3 → 5 | sí |
| t22 | multi | — | 25.061 → 22.654 | 2 | 127.023 | 121.662 | 210.255 | 3 → 5 | sí |
| t23 | multi | — | 25.323 → 22.654 | 3 | 169.195 | 161.323 | 293.347 | 4 → 7 | sí |
| t24 | multi | — | 26.026 → 22.654 | 3 | 174.086 | 163.986 | 296.606 | 4 → 7 | sí |
| t25 | multi | — | 23.923 → 22.654 | 1 | 116.893 | 114.595 | 199.579 | 3 → 5 | sí |
| t26 | multi | — | 24.527 → 22.654 | 2 | 171.741 | 166.833 | 313.350 | 4 → 7 | sí |
| t27 | multi | — | 25.022 → 22.654 | 3 | 123.876 | 119.358 | 204.278 | 3 → 5 | sí |
| t28 | multi | — | 24.807 → 22.654 | 2 | 121.252 | 116.830 | 207.505 | 3 → 5 | sí |
| t29 | multi | — | 24.078 → 22.654 | 2 | 159.564 | 156.364 | 286.599 | 4 → 7 | sí |
| t30 | multi | — | 26.818 → 22.654 | 3 | 195.533 | 182.069 | 332.578 | 4 → 7 | sí |

**Límites propios de la config 1:** el oráculo siempre acierta la precarga, así que las fichas cubren las herramientas necesarias; el modelo real puede pedir `describe_tool` de más o de menos, y la compactación de resultados y la caché de prompt no se modelan (cambiar de ficha a definición entre vueltas invalida el prefijo cacheado en algunos proveedores: `describe_tool` entrega la ficha como resultado de tool para no tocar la lista). La config 2 (Code Mode) llega con T70.
