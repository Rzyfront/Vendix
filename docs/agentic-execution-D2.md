# D2 — ejecución robusta Vex/Vexi

Implementación offline del paso D2 aprobado. No es certificación de runtime,
completion del modelo, PostgreSQL concurrente, proveedor, gasto ni promoción.

## Activación y rollback

| Flag | Predeterminado | Uso |
|---|---|---|
| `AI_AGENT_ROBUST_EXECUTION_ENABLED` | OFF | Recovery, verificación servidor, deadline y contrato DAG; necesita sesión D1 |
| `AI_PARALLEL_READS_ENABLED` | OFF | Lecturas explícitamente auditadas; también requiere D2+D1 en el loop |

Ninguna activa dependencias automáticamente. Verificación necesita el release C
inicializado/empaquetado (`AI_AGENT_PLAYBOOKS_ENABLED`); router B mantiene su flag
independiente. Rollback conserva tablas/evidencias/propuestas y nunca reactiva
metadata legacy de un objetivo ya migrado. No cambian modelo/proveedor/suscripción.

## Implementación

- `tasks/agent-verifier.service.ts`: allowlist de workflows C, relecturas por
  registry, permiso/snapshot/plan/caller vigentes, causalidad contra ledger,
  identidad exacta y datos completos/frescos. Las lecturas cuentan en budget D1;
  el loop conserva cuota semántica y eventos por cada relectura observada.
- `agent-verification-capability.ts`: prueba opaca de un uso/30s, no serializable
  ni fabricable desde JSON. Liga contratos fijos (inputs económicos + step IDs),
  owner/objetivo/version/generación. Todas las relecturas finales tienen edad
  acotada. `commitVerified` vuelve a comprobar fence, receipts y efectos pendientes
  dentro de transacción antes del único `completed_verified` de la fase.
- Plan interno: bloques3–7 con DAG, entrada/salida, herramientas candidatas,
  aprobación individual y verificador. Consulta simple conserva fast path.
  `verify_deliverables` aporta selectores reales `agent-result:UUID`; los contratos
  no cambian allí. `verified:true`/prosa no verifican nada. Inserción técnica remapea
  aristas por identidad y no cambia el objetivo económico.
- Recovery: estado técnico acotado/hash-only en resultados D1 internos, último
  checkpoint elegido por versión CAS, excluido de páginas/contexto públicos.
  No otra tabla/máquina/LLM. Una corrección de schema, lookup alternativo sólo con
  dato determinista probado, cursor explícito, read429/5xx con jitter; permiso/plan
  no reintenta. Unknown write detiene; nunca re-dispatch para conseguir evidencia.
  Por defecto2replans/2expansiones acumulados; límites0–8 por
  `AI_AGENT_MAX_TECHNICAL_REPLANS`/`AI_AGENT_MAX_CATALOG_EXPANSIONS`.
  Reservar una estrategia no duplica el cargo de expansión real.
- Deadlines: señal/epoch a Engine/OpenAI/Anthropic y bridge fetch **incluido body**.
  SDK abort no agrega retries. Pared limitada también por lease/TTL, activo sin
  espera UI y reserva de cierre. Fences dentro de continuaciones, antescheckpoint;
  resultado tardío sólo auditoría stale. Apply usa deadline dentro de su lease90s,
  contabiliza tiempo activo y abort en vuelo sigue unknown, no rollback.
- Scheduler: lote entero validado antes dispatch, resultados correlacionados en
  orden estable, errores independientes y checkpoints por completion seriales.
  Concurrencia3/objetivo, heavy1/tienda, global6/worker, acotada por pool; variables
  `AI_PARALLEL_READS_OBJECTIVE_CAP`, `AI_PARALLEL_READS_GLOBAL_CAP`,
  `DATABASE_POOL_MAX`. Recursos con templates de argumentos primitivos y ALS
  clonado explícito. Sólo `get_product` opta hoy por metadata auditada; el resto
  sigue serial. UI/plan/bloques/write/proposal/dependientes nunca se paralelizan.
  Una lectura no cooperativa no retiene el turno después del deadline: el batch
  cierra, pero el permiso real NO se libera hasta terminar el handler. Si todos
  cuelgan se agota capacidad acotada; no se crean conexiones ilimitadas. Su
  completion tardía sólo entra por `onLateResult` a auditoría, no nuevo estado.

## Cobertura y gaps explícitos

`AgentVerifierService.coverage(authorizedToolNames)` mapea cada herramienta al
workflow/verifier o devuelve `unsupported_capability` con módulo/acción. Bridge
sólo cubre rutas fijas del contrato; lo demás es gap, no soporte REST universal.

20 workflows C: **14 potencialmente completables según receipts/shape/permisos**,
no14E2E ejecutados; cuatro gaps causales fijos y dos preparación-only:

- recibir-compra / trasladar-inventario: las tools actuales no prueban movimiento
  causal con referencia+ubicación+variante. Recibo parcial nunca equivale al total;
  incluso cantidades correctas no verifican ese objetivo integral.
- devolucion-reembolso: retorno processed no prueba operación de reembolso.
- venta-cobro: saldo/total no prueban cierre integral de pago+stock/mesa.
- crear-producto-inventario / mesa-cocina-cobro: preparación-only heredada C.
- Pago de proveedor/cartera requiere ID de operación en el MISMO receipt causal;
  no se elige un pago histórico. PO compara multiset de líneas esperadas. Documento
  cliente se compara completo, no sufijo. Cambio de precio de variante sin contrato
  específico queda gap. Un efecto legacy ambiguo sigue sin verificar.

No se amplían dominios económicos, preview faltante, DTOs ni permisos para cerrar
esos gaps; requieren seam de dominio aprobado, no un `verified:true` más permisivo.

## Verificación realizada

11specs exactos, uno por proceso/secuenciales, config
`test/agentic/jest.d1.config.json`, `--runInBand --runTestsByPath`, heap1536:

| Spec | PASS |
|---|---:|
| ai-engine/ai-agent.service.spec.ts |86|
| ai-engine/ai-engine.service.spec.ts |41|
| providers/openai-compatible.provider.spec.ts |55|
| providers/anthropic-compatible.provider.spec.ts |26|
| tasks/agent-deadline.spec.ts |13|
| tasks/agent-recovery.service.spec.ts |17|
| tasks/agent-verifier.service.spec.ts |70|
| tools/bridge/internal-http.spec.ts |6|
| tools/tool-scheduler.service.spec.ts |25|
| test/agentic/d2-execution.spec.ts |9|
| test/agentic/d2-verification.spec.ts |17|

Total365PASS. Son transpile-only; no equivalen a build/DI global. Typecheck
semántico focal de deadline/recovery/flags/scheduler y capability, heap1024,
strictNullChecks: PASS. Syntax-only34TS: PASS. Prisma-singleton y diff checks: PASS.
Repositorio/sesión/hook/registry/loop/verifier reales integrados sobre transporte
SQLmemory y dominios/proveedor simulados, no PostgreSQL/DIAN/Redis/modelo reales.

Fixture: ocho reads100ms pasan800→300ms con reloj virtual (-62.5%); cuatro
continuaciones del mismo error producen1dispatch, no5 (-80%). Superan sólo las
metas aritméticas del fixture; no demuestran p95/costo/completion del modelo.

Replay A budget0: `/tmp/vendix-agentic-D2-offline-20261017.json`,150planned,
0ran,150not_run; tasas/latencia/tokens/costo NULL, no éxito empírico ni baseline0.

## Límites y gates siguientes

- CI debe compilar/bootstrapping de ESTA rama y sus assets. Docker local monta el
  checkout principal, no este worktree; sus WARN AutoNoShow no certifican D2.
- QA Happy/Sad/Brute y pruebas PostgreSQL reales con corte tras commit/ACK quedan
  pendientes de entorno autorizado. Los fixtures no certifican locks ni exactamente
  una vez distribuido. Provider/QA remoto/gasto/baseline/canary requieren Rafael.
- Los deadlines son cancelación cooperativa y fences del proceso, NO un kill del
  motor DB. Transacciones D1 conservan timeout10s/maxWait5s; persistencia/cleanup
  pueden añadir overhead al plazo de dispatch. Medir y ajustar reserva/p95 en QA;
  no se promete rollback ni parada OS de un driver no cooperativo.
- Audio/imagen/video/rerank/embedding y jobs separados no se rediseñan en D2.
  Hooks internos/fábricas adicionales deben adoptar el signal cooperativo; sus
  efectos inciertos se siguen reconciliando antes de cualquier nuevo intento.
- Nota del orquestador: migración B `20261018100000` valida filas existentes al
  añadir CHECK a ai_embeddings: requiere ventana de mantenimiento. D2 no crea ni
  aplica migración alguna.
- Spec frontend D1 `vexi-objective.state.spec.ts` sigue gate pendiente por
  dependencias ausentes. D2 no toca frontend; no instalar paquetes ni presentar
  helper puro como prueba NgRx/DI/E2E. Fases H/G/E/F no adelantadas.
