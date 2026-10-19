# Evaluaciones agentic — fase A

Este directorio **no ejecuta Vendix, Prisma, Nest ni un proveedor**. El corpus es sintético, versionado y no contiene PII ni credenciales. No es un baseline de rendimiento. Los mocks de `harness.spec.ts` prueban el evaluador, **no** prueban que Vex/Vexi resuelvan esos casos.

## Corpus congelado

- `requests.es.jsonl`: 50 peticiones y oráculos independientes; versión `agentic-es-A-v1`.
- Desarrollo 40 / holdout 10. Holdout: **04, 10, 17, 24, 28, 35, 37, 42, 46, 49**. Ambos splits contienen texto/pipeline/realtime y lectura/escritura/UI/seguridad; estratificación de cobertura, no proporcional exacta por subestrato.
- 25 Vex texto; 13 Vexi texto; 6 Vexi pipeline; 6 Vexi realtime.
- Los casos 47–48 son el subconjunto nuevo de G, reportado separado; en baseline su oráculo es limitación honesta sin escribir. No se suma como completada una limitación.
- `fixtures.ts`: dos tiendas de una organización y una ajena; owner/admin/operador, permisos revocados, plan bloqueado, reloj fijo en límite de día UTC/Bogotá, inventario, fiscalidad/pagos sandbox, UI/sesión/aprobaciones. Cada intento recibe copia nueva y hash SHA256 del estado + escenario; modificar fixture exige nueva versión/hashes.
- Canal de voz: solo referencia textual sintética; **no hay corpus acústico ni verificación STT/TTS real**. Caso 41 usa consentimiento por clic de baseline, no implementa consentimiento hablado de G.
- El brief autoriza corpus enteramente sintético; no se reemplazaron 20 peticiones por solicitudes reales porque no hay exportación autorizada desidentificada. No se afirma representatividad estadística de tráfico real.

## CLI segura

Desde `apps/backend`:

```sh
npm run eval:agentic -- --mode replay --split all --repeats 3 --output /tmp/baseline-A.json
npm run eval:agentic -- --mode replay --agent vex --channel text --repeats 3
npm run eval:agentic -- --mode replay --agent vexi --channel text --repeats 3
npm run eval:agentic -- --mode replay --agent vexi --channel pipeline --repeats 3
npm run eval:agentic -- --mode replay --agent vexi --channel realtime --repeats 3
```

Sin `--records` todos los intentos son `not_run: adapter_absent`. No se genera una respuesta desde el oráculo ni se falsifican ejecuciones. `--output` crea archivo nuevo (`wx`) y no sobrescribe evidencia. Opciones desconocidas, duplicadas, valores no finitos/negativos, repeats fuera de 1–10 y budgets incompatibles fallan.

Comando del plan admitido sin ejecución real: `npm run eval:agentic -- --dataset test/agentic/requests.es.jsonl --surface vex --mode live --repeats 3 --max-concurrency 1 --budget-usd 0`. `--surface` es alias de `--agent`, `--budget-usd` de `--max-cost-usd`; usar ambos nombres de un alias se rechaza. `--max-concurrency` solo admite **1**. `--dataset` se valida mediante el contrato de 50 casos/versión/split; predetermina este corpus. Aunque se apruebe un budget total, `--max-case-cost-usd` predetermina 0 y un adaptador programático no podrá iniciar una ejecución real sin techo por caso positivo.

```sh
# Tras obtener recibos SINTÉTICOS de un adaptador confiable, nunca de un modelo:
npm run eval:agentic -- --mode replay --records /tmp/synthetic-openai-cold.jsonl --repeats 3 --output /tmp/report-openai-cold.json
npm run eval:agentic -- --mode replay --records /tmp/synthetic-anthropic-cold.jsonl --repeats 3 --output /tmp/report-anthropic-cold.json
npm run eval:agentic -- --mode replay --records /tmp/candidate.jsonl --compare /tmp/report-openai-cold.json
# Solo si catálogo/flags SON el tratamiento explícito de la fase:
npm run eval:agentic -- --records /tmp/candidate.jsonl --compare /tmp/report-openai-cold.json --allow-treatment flags,catalog
```

Dos familias se ejecutan **por separado**, solo donde ya estén configuradas; no se cambia proveedor/modelo actual. Repetir cold y warm en archivos separados. Un recibo solo sirve para su `caseId:repeat`; faltante nunca se recicla. Loops secuenciales, sin workers ni `Promise.all`. Replay no gasta tokens: su budget de ejecución es 0, aunque conserva el costo histórico observado en los recibos.

`shadow` y `live` están reconocidos pero **no tienen adaptador CLI**; devuelven `not_run`, incluso con budget positivo. No hay `require`/import arbitrario ni endpoint configurable. La única extensión es la API programática `EvalAdapter` de `runner.ts` (módulo local confiable); exige `fixtureOnly` y `noProductionWrites`, NO garantiza aislamiento de código no confiable. Antes de usarla con un sistema real se debe implementar y revisar restauración/lecturas independientes, aislamiento de fixtures, abort/deadline y reserva del costo de cada llamada. Un budget CLI por sí solo **no autoriza gasto**.

El runner reserva conservadoramente el techo por caso antes de iniciar otro caso, transmite el techo restante y se detiene si costo desconocido/error de adaptador. No puede matar una llamada externa de un adaptador arbitrario; el adaptador debe hacer cumplir el techo antes de cada intento facturable. No hay tal adaptador conectado en A. Si viola budget se conserva costo/evidencia, se marca violación y se detiene. Costos desconocidos no se convierten en 0.

## Adjudicación y métricas

`contracts.ts` describe cada recibo. Evidencias `server`/`ui`/`guard` se recolectan por un adaptador de confianza **independiente del texto del agente** y después se comparan contra postcondiciones explícitas del corpus. `finalFacts` es extracción determinista/verificada de la respuesta final, no el objeto que el modelo declare exitoso. Los archivos replay son evidencia de confianza de fixtures: JSONL no es una firma criptográfica ni un verificador servidor. Nunca aceptar evidencia autocertificada del agente.

El grader requiere mismo trace/fixture/tenant/usuario, observación dentro del intervalo, estado coherente completo, valores finales exactos, cero efectos duplicados/no autorizados/sin consentimiento/excesivos y trazas cerradas con padre alcanzable desde raíz. Cada intento de proveedor se correlaciona con su span y llamada lógica. `success:true`, HTTP200, evento tool despachada, `awaiting_approval` y bloqueo correcto **no** prueban completion. Sin objetivo durable legacy, `objectiveId` permanece `null` (D1), no se inventa.

`trace-adapter.ts` mapea explícitamente filas snake_case a transporte camelCase: IDs, `started_at`/`ended_at` a ms, `duration_ms` como duración transporte opcional, `prompt_tokens` a `inputTokens`, `completion_tokens` a `outputTokens`, cache y decimal `cost_usd`. Kinds runtime `provider_call`→`provider_request`, `provider_retry`→`retry` y legacy `UI_wait`→`ui_wait`. Solo `kind=provider_attempt` aporta costo; no se suma costo del log lógico/root. El mapper no abre DB ni transforma status en evidencia. El consumidor debe aportar fingerprint/config y evidencia del dominio/UI por separado. Filas de sistema/tenants mezclados son rechazadas.

Métricas incluyen:

- `completed_verified/eligible` y `outcome_correct/total`, cobertura de ejecución/capacidades, exactitud, falsos éxitos, duplicados y seguridad. `eligiblePlanned` se conserva aunque un caso no corra; se muestra también tasa entre ejecutados. Sin ejecuciones, tasas de desempeño son `null`, no un baseline de 0%.
- Intentos facturables únicos por `attemptId`, llamadas lógicas, tools y repeticiones; tokens fresh/input, output, cache read/create. El contrato `inputTokens` significa **fresh input**, separado de cache. Mapper predetermina semántica desconocida y fresh=null, conserva `reportedInputTokens` original. Un adaptador revisado puede declarar `fresh_only`, `includes_cache_read` o `includes_cache_read_and_create`; resta cache solo con todos los valores necesarios conocidos y rechaza inconsistencias. No presupone semántica de una familia por el nombre del modelo.
- Costo canónico por intento, costo conocido y cantidad de desconocidos, costo por caso intentado/completado. `billable:null` conserva incertidumbre. Exportar dos veces un intento no duplica gasto; registros contradictorios fallan.
- TTFT de **contenido útil**, tiempo a propuesta/completion, p50/p95 wall y activo. UI/aprobación se resta por unión de intervalos, no doble suma; heartbeat no es TTFT. Completion time solo se incluye para completion verificada.
- Recall@K, expansiones y recetas si el adaptador los midió; si no, `null`.
- Estratos agente/canal/riesgo y grupos por fingerprint completo. Totales mezclados son diagnósticos, no atribución de mejora. Comparación pareada exige mismo corpus/split/repeats/fixtures/modelo/prompt/app/config/cache; unknown cache impide comparabilidad. Solo catálogo/flags pueden declararse tratamiento explícito, queda listado en `controlledDifferences`. Discordancias e incertidumbre se reportan; tres repeticiones no prueban significancia estadística.

## Verificación focalizada

Solo este spec y **sin paralelo con otras pruebas**:

```sh
cd apps/backend
npx jest --config test/agentic/jest.config.json --runInBand --runTestsByPath test/agentic/harness.spec.ts
```

No ejecutar suites globales. E2E real, canary ≥99%, cobertura correlación de 50 casos live, error costo <1% y overhead p95 <5% requieren mediciones posteriores autorizadas; el harness no las infiere desde sus tests.
