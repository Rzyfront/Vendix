# Baseline agentic A — inventario reproducible, medición live pendiente

## Operación estándar de autonomía

A, D0, B, D1, C, D2, H, G, E y F son comportamiento estándar de Vex/Vexi,
sin interruptores de entorno ni rutas OFF. Para detenerlos se usa el apagado
general existente de Vex/Vexi, conservando objetivos, evidencias y propuestas.
No cambian autorización, consentimiento individual, proveedor ni cuotas.

El sandbox sólo está disponible con runtime Deno aislado/supervisor/configuración
reales y `AI_SANDBOX_SOURCE_KEY` válida; si faltan, informa disponibilidad ausente
y el agente continúa con herramientas normales. Nunca ejecuta código en el host API.
La minería de recetas está activa; publicar requiere revisión firmada con
`AI_RECIPE_REVIEW_KEY`; sin llave no publica y no interrumpe el chat.
El catálogo se sincroniza automáticamente al bootstrap mediante el job idempotente
existente. Sin app de embeddings, presupuesto o vectores, conserva búsqueda léxica
autorizada; no exige mapear configuración adicional en Secrets Manager.

La verificación offline histórica de este documento no certifica despliegue,
PostgreSQL real, proveedor ni QA acústica. Estos gates se reportan pendientes,
no se convierten en controles de activación por entorno.


Fecha: 2026-10-17. Corpus `agentic-es-A-v1`: **50 casos sintéticos**, 40 desarrollo / 10 holdout congelado. Sin solicitudes reales, PII, audio de usuarios, cambios de proveedor/modelo/prompt ni acceso a DB/app/proveedores. Ningún gasto autorizado o realizado por el harness offline.

## Estado y límites

**No existe aún un baseline medido de Vex/Vexi.** El evaluador está implementado; sin recibos/adaptadores, los casos se registran `not_run`, no pass. Los mocks del spec únicamente prueban contratos/grader. No se adjudican capacidades del producto desde los fixtures.

El dry-run reproducible de abajo programa **150 intentos (50 × 3 secuenciales)**. Resultado de ausencia de adaptador: 150 `not_run`, 0 ejecuciones, 0 completadas observadas; rendimiento/costo histórico/uso/tasa de éxito medidos = **desconocido/null**, no 0% de éxito ni USD0 de costo del producto. Gasto de esta ejecución offline: USD0.

| Superficie | Casos | Intentos programados | Estado sin recibos |
|---|---:|---:|---|
| Vex texto | 25 | 75 | `not_run` |
| Vexi texto | 13 | 39 | `not_run` |
| Vexi pipeline | 6 | 18 | `not_run`; sin corpus acústico |
| Vexi realtime | 6 | 18 | `not_run`; sin sesión de voz real |
| Total | 50 | 150 | ningún pass de producto |

G nuevo (47–48): informe separado del subconjunto comparable de 48 casos. Baseline expresa limitación honesta sin aplicar escritura, no consentimiento hablado implementado. Caso 41 usa clic fixture del baseline.

### Evidencia offline efectiva — 2026-10-17

Ejecución serial realizada por el orquestador, **exit 0**:

- `/tmp/vendix-agentic-baseline-A-all.json`: `planned=150`, `ran=0`, `notRun=150`, `completedVerified=0`, `completionVerifiedRate=null`, `costUsd=null`, `traceCompleteRate=null`; gasto conocido/de esta ejecución = USD0.
- `/tmp/vendix-agentic-baseline-A-vex.json`: comando con aliases del plan (`--dataset`, `--surface vex`, `--max-concurrency 1`, `--budget-usd`), `planned=75`, `ran=0`, `notRun=75`.
- Hash SHA256 canónico del corpus reportado: `28ddccd89f8d222aa3918f2993d39e7b833841e315269df4341a56d4526f64b0`.
- Spec focalizado `test/agentic/harness.spec.ts`: **43 pruebas PASS**, ejecutadas por el orquestador, no en paralelo. Son pruebas del harness, no 42 ejecuciones satisfactorias de Vex/Vexi.

Estos resultados verifican CLI/transporte y ausencia segura de adaptador. **No** satisfacen los gates live/canary/overhead ni autorizan avanzar atribuciones de mejora sin baseline observado.

## Cómo reproducir sin app ni gasto

Desde `apps/backend`, salida a ruta **nueva**:

```sh
npm run eval:agentic -- --mode replay --split all --repeats 3 --output /tmp/vendix-agentic-baseline-A.json
npm run eval:agentic -- --mode replay --agent vex --channel text --repeats 3
npm run eval:agentic -- --mode replay --agent vexi --channel text --repeats 3
npm run eval:agentic -- --mode replay --agent vexi --channel pipeline --repeats 3
npm run eval:agentic -- --mode replay --agent vexi --channel realtime --repeats 3
```

`shadow`/`live` sin adaptador también son `not_run`; el CLI nunca conecta app/proveedores/DB ni carga adaptadores externos. Extensión únicamente programática y confiable para fixtures; véase `apps/backend/test/agentic/README.md`.

## Pendiente para congelar el baseline observado

1. Implementar/revisar adaptador de entorno QA aislado, restauración por intento, captura de postcondiciones servidor/UI independientes y garantías de aprobación; DIAN/pagos solo sandbox, nunca producción.
2. Aprobación de presupuesto explícito; tres repeticiones secuenciales por caso/configuración y dos familias **solo si ya configuradas**, sin rotar modelos. Capturar versión corpus, hashes fixture/modelo/prompt/app/config/catálogo/flags y caché fría/caliente separadas.
3. Capturar recibos y auditoría de efectos reales, todos los intentos facturables (incluido error/retry), evidencia UI y voz consentida/sintética. No sustituir un faltante por éxito mock.
4. Reproducir recibos en `--records`, conservar el baseline original antes de D0 y comparar cada fase pareada por estrato. No atribuir mejora si cambian modelo/prompt/config/fixture/caché. Catálogo/flags solo como tratamiento declarado.
5. Medir e informar incertidumbre y discordancias, TTFT útil, latencias activa/wall/humana, completion elegible, outcome correcto, seguridad/duplicados y costo canónico por intento. Tokens/costo sin usage son desconocidos.

## Gates no satisfechos por una prueba unitaria

| Gate de fase A | Estado |
|---|---|
| 50 casos live correlacionables | **No medido**; hay corpus y transporte con UUID, no 50 ejecuciones de producto |
| Canary ≥99% de trazas completas | **No medido** |
| Error de costo agregado <1% cuando hay usage | **No medido en proveedor**; tests solo verifican deduplicación/unknown |
| Overhead p95 <5% on/off | **No medido** |
| Completion/latencia/costo baseline | **No medido**; ningún porcentaje de mejora afirmado |

Dependencia explícita: **D0 y posteriores requieren este baseline observado antes de adjudicar mejoras**. El baseline original no se reemplaza por resultados posteriores con adjudicación corregida. Si no se autoriza medición, conservar estado pendiente y no promover por los tests del evaluador.

## Archivos

- `apps/backend/test/agentic/requests.es.jsonl`, `fixtures.ts`, `graders.ts`: corpus/restauración/oráculos.
- `contracts.ts`, `runner.ts`, `metrics.ts`, `trace-adapter.ts`: transporte seguro, ejecución serial, métricas y mapeo explícito de trazas persistidas.
- `harness.spec.ts`, `jest.config.json`: pruebas focalizadas del evaluador, sin dependencias de app.
- `apps/backend/scripts/agentic-eval.ts`, script `eval:agentic`: CLI sin efectos externos.

## Key Learnings:

1. Ausencia de adaptador o evidencia significa `not_run`; un fixture correcto no demuestra completion de Vex/Vexi.
2. El costo se suma por intento único, no por span más log lógico; billing desconocido permanece null.
3. Comparaciones sin modelo/prompt/config/fixtures/caché equivalentes no permiten atribuir mejoras a una fase.

## Verificación final de implementación

Pruebas exactas secuenciales: agent55, engine33, logging8, trace17 y harness43: **156 PASS**. No se corrió ninguna suite global ni build/typecheck del monorepo. `prisma generate`, auditoría de singletons y `git diff --check` pasan. La generación utilizó el cliente compartido del checkout principal por el symlink autorizado; no se instalaron dependencias.

Runtime de esta rama **no verificado**: `vendix_backend` monta el checkout principal, no este worktree. No se repuntó/reinició el entorno compartido. Migración redactada/revisada, no aplicada ni probada dos veces contra una base. No hay baseline live, canary, medición de costo real ni overhead medido. Por ello el cierre medido de A permanece **bloqueado**, con código disponible; sus capacidades son estándar, pero este informe no certifica los gates live pendientes.
