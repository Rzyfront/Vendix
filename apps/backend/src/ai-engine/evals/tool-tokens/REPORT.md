# Línea base de tokens de herramientas (T60, config 0)

Estimador: `bytes_v1` (bytes del JSON; pesimista, no es un tokenizador). Generado por `measure-tool-tokens.ts`; no edites a mano.

## Herramientas

- Declaradas (nombres únicos en el código): **389** (391 salidas de fábrica; el "~489" del plan era un grep).
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
