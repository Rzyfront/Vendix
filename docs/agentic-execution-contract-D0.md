# D0 — resultados reales y cierre útil

## Alcance y activación

Implementación opt-in sobre el loop compartido de Vex/Vexi. Único flag nuevo:
`AI_TOOL_EXECUTION_CONTRACT_ENABLED=true`; ausente, `false`, `1` o cualquier otro
valor lo dejan **OFF**. No se modificaron proveedor/modelo, configuración persistida,
prompts de DB, cuotas comerciales, dependencias ni schema. No hay migración.

`AI_AGENT_TRACING_ENABLED` de A es independiente y sigue OFF por defecto. Rollback:
apagar D0; conservar propuestas, tokens y JSON histórico. Los lectores aceptan la
metadata opcional sin exigir encender un flag en el navegador.

Excepción mínima de copy: los dos fallbacks sin evidencia ya no piden reformular
la solicitud, incluso en el camino legacy. No cambian su control de flujo, cuotas,
autorización, propuesta/confirmación ni sus llamadas al proveedor.

## Contratos

- `executeTool()` conserva strings, aliases y la excepción `AI_AGENT_005` que
  representa una propuesta; MCP, realtime y endpoints de aplicar mantienen su ABI.
- `executeToolResult()` adapta los mismos checks/handler a `ToolExecutionResult`:
  `status`, `data`, `error_code`, `retryable`, `next_action`, `evidence_refs`,
  `resource_ids`, `pagination`, `freshness`, `effect_status`, `schema_version`.
- Estados: `ok`, `recoverable_error`, `blocked`, `pending_confirmation`,
  `needs_user_input`, `unknown_effect`. `ok` **no verifica el objetivo**.
- Solo protocolos conocidos se clasifican; no se buscan palabras en una frase ni
  se trata una columna de negocio `error` arbitraria como excepción técnica.
  Texto legacy/malformado y páginas truncadas conservan su contenido con evidencia
  insuficiente. Un cursor pendiente no es un dataset completo.
- Una excepción de write tras entrar al handler, un fallo de red que retorna
  `applied:false` sin status concluyente, o `applied:true` envolviendo un fallo
  HTTP200, son inciertos. No se repiten ni autoencadenan.
- El loop devuelve `execution` y lo adjunta al frame terminal `done`. Su
  `success` previo sigue siendo compatibilidad de transporte. D0 **nunca produce
  `completed_verified`**; la verificación independiente pertenece a D2. Abortado
  conserva silencio y outcome `cancelled`; degeneración mantiene error sin texto.
- Chat persiste `metadata.execution` y receipts por herramienta separados de texto
  truncado. Sync devuelve el mismo summary que SSE. No se persiste razonamiento.
- Eventos del worker conservan outcome. `ai_agent_tasks.status=completed` sigue
  siendo fin operativo del job; metadata/avisos/strip muestran resultado pendiente
  de revisar. El getter usa el resultado del job durante la ventana anterior al
  listener. No se introdujo otra máquina de estados ni autoridad durable.

## Cuotas, recuperación y UI

Solo `ok` estructurado observado y con evidencia/effect compatible consume una
unidad exitosa por el **mismo** request/operation ID anterior. Errores, propuestas,
texto ambiguo y UI desconocida no consumen tool success; el gasto de inferencias
sigue contado y los errores de infraestructura se distinguen en el evento de
resultado. OpenAI/Anthropic conservan metadatos estructurados de error transitorio,
sin una nueva capa de retries, proveedor o SDK.

Recovery es local al turno: argumentos canónicos hash, supresión de la misma
llamada fallida y una corrección con argumentos distintos. Una corrección exitosa
libera las consultas/páginas siguientes sin permitir repetir los args fallidos.
Bloqueos e incertidumbre detienen el lote antes del siguiente dispatch. La
ampliación de catálogo espera B; reconciliación durable espera D1/D2.

Con D0 ON, el agotamiento cierra desde receipts sin inferencia de cierre, tampoco
fuera del deadline. No se amplían presupuestos. Preguntas y propuestas conservan
su circuito humano. UI muestra estados `waiting`/`unknown` sin pasado de éxito ni
check verde; durante el acuse local espera el receipt del servidor. Las propuestas
se siguen leyendo por el mismo canal y no se duplican mecanismos de refresh.

## Evidencia offline y límites

Specs exactos nuevos/modificados, uno por proceso y secuenciales. El smoke de 50
casos usa `test/agentic/jest.d0.config.json` con `isolatedModules`, heap 1536 MB y
cero llamadas a app/DB/proveedor. Verifica contrato terminal y ausencia de falsos
`completed_verified`, **no** capacidad funcional del producto ni métricas live.

El primer intento del smoke con la configuración general de A agotó heap 4 GB
(exit 134); no se aumentó memoria. El grafo mixto web/backend se separó del
programa de typecheck. Los specs backend sí typechequean las costuras importadas;
CI debe compilar Angular/DI. No se ejecutó typecheck global ni build local.

CLI A replay sin receipts: 150 intentos planificados, 0 corridos, 150 `not_run`;
completion, latencia y costo comparables desconocidos. Corpus A sin modificar:
`28ddccd89f8d222aa3918f2993d39e7b833841e315269df4341a56d4526f64b0`.
Reporte local: `/tmp/vendix-agentic-D0-offline-20261017.json`.

- Backend Docker activo monta el checkout principal, **no este worktree**.
  Sus logs no certifican esta rama. No se repuntó, reinició ni arrancó otra app.
- Frontend local sin listener/bitácora; Playwright MCP no disponible. Sin E2E de
  esta rama. Validar Happy/Sad/Brute en entorno autorizado antes de activar.
- `zoneless:audit` global falla por deuda existente (@Input/@Output, EventEmitter,
  control flow legacy, BehaviorSubject y suscripciones). Cero nuevas ocurrencias
  de esos patrones en el diff web; no se amplió D0 para corregir archivos ajenos.
- Baseline/canary/p95/costo con proveedor o QA real esperan autorización de Rafael.
  No se atribuye una mejora medible a esta reclasificación ni se bloquea D0 por
  esa medición diferida.

## Siguiente fase

D0 deja las costuras listas para B, no lo implementa. Antes de promoción: revisión
independiente, CI, pruebas runtime con flags ON/OFF, permisos/plan revocados,
aprobación rechazada/replay, timeout de write, reload y aislamiento tenant.
