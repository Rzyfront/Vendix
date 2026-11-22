# Línea base de tokens de herramientas (F10 / T60)

Banco offline para medir cuánto cuesta, en tokens estimados, que Vex lleve sus herramientas al modelo. Sirve de punto de partida para comparar las configs 1 (T62) y 2 (T70). No usa modelo, base de datos, red ni servidor.

## Archivos

- `task-bank.json`: 30 tareas. `t01`-`t15` salen de `test/agentic/golden-conversations.es.jsonl` (agente `vex`, campo `source`); `t16`-`t30` son multi-paso redactadas. Cada tarea trae `oracle.groups`: grupos secuenciales de llamadas paralelas con nombres reales del registro y filas esperadas (`rows`).
- `tool-result-fixtures.json`: una fila de muestra por herramienta, con la forma del resultado del handler y su `fidelity` (`handler_shape`, `service_shape_approx`, `assumed_shape`).
- `tool-token-metrics.ts` (+ spec): funciones puras (trayectoria, vueltas, éxito estructural, totales, validación del banco).
- `measure-tool-tokens.ts`: CLI determinista. Construye el registro real desde el código, autoriza como owner en Vex y mide cada tarea con el enrutador actual y con el catálogo completo.
- `baseline.config-0.json`, `baseline.config-1.json`, `baseline.config-2.json` y `REPORT.md`: salida generada; no se editan a mano. Cada corrida reescribe solo su sección de `REPORT.md` y conserva las demás.

## Uso

Desde `apps/backend`, una sola invocación a la vez:

```
npx ts-node --transpile-only --project tsconfig.json -r tsconfig-paths/register \
  src/ai-engine/evals/tool-tokens/measure-tool-tokens.ts --config 0
```

`--config 0` es el enrutador actual. `--config 1` (T62; correr antes la 0) mide fichas cortas + `describe_tool` y añade su sección a `REPORT.md` y `baseline.config-1.json`; `--config 2` (T70; correr antes la 0) mide `run_code` (Code Mode) sobre la config 0, añade su sección y `baseline.config-2.json` y deja escrita la compuerta N14 de scripts (la pata de éxito queda pendiente de una corrida en vivo). Sale con código 1 si alguna tarea usa una herramienta inexistente o no autorizada.

## Reglas del banco

- `single`: un solo grupo con una llamada. `multi_step`: dos o más grupos secuenciales.
- Toda herramienta del oráculo debe tener fixture; si falta, el CLI falla nombrándola.
- Al cambiar el banco o un fixture, regenera con el CLI y commitea ambas salidas.

La config 2 lee la lista blanca generada (`sandbox/codemode-allowlist.generated.ts`), los límites de `codemode-protocol.interface.ts`, la definición real de `run_code` y el texto de `CODE_MODE_ROUTING_RULE` de `ai-agent.service.ts`; si cambian, regenera y revisa el diff.

Límites del método: ver "Método y límites" en `REPORT.md`.
