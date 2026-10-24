# Fase B — Routing autorizado y conocimiento global

Fecha: 2026-10-17. Implementación offline sobre A+D0, **no promoción medida**.
No cambios de proveedor/modelo activo, prompts/DB existentes, móvil o infraestructura.

## Carga dinámica — «el mecánico» (2026-10-19)

> Reemplaza el «catálogo autorizado completo siempre» del fix 2026-10 y las ampliaciones
> K12/K24/K40 descritas más abajo. Lo demás de este documento (autoridad, índice,
> aislamiento) sigue vigente. Skill: `vendix-ai-tool-routing`.

- **Problema:** cada llamada al modelo llevaba ~220 tools (~80k tokens de prompt en
  DeepSeek vía OpenRouter, sin caché). Con top-K excluyente (antes del fix) aparecían avisos
  falsos de «sin permisos» y rondas gastadas.
- **Diseño:** núcleo fijo pequeño (`CORE_DISCOVERY` ∪ `AGENT_TOOL_CORE[agent]`, ~13) +
  herramientas cargadas por petición: prefetch semántico top-8 por mensaje (D1),
  `search_tools` carga 5 (máx. 10) (D2), regla dura (D3) y alternativas/precarga del paso
  del plan (D4). Reconstrucción por turno desde los últimos 3 turnos del historial. Tope 30.
  Orden estable `[núcleo] + [plan] + [cargadas]` para caché de prompt.
- **Regla dura:** una tool AUTORIZADA llamada sin estar cargada se carga y se ejecuta en la
  MISMA ronda, sin aviso de permisos ni ronda gastada. También en voz realtime
  (`loadUnofferedTool` + `session.update`).
- **Cascada:** cobertura < 0,9, índice vacío, error o timeout de 3 s →
  `full_catalog_fallback` (catálogo autorizado completo).
- **Rondas gratis:** hasta 3 rondas solo de descubrimiento por turno no consumen presupuesto.
- **Índice:** migración `20261020100000_agent_knowledge_embeddings_app` (INSERT idempotente
  de una fila, `-- DATA IMPACT:`), reencolado del job `index-knowledge` fallido y
  `AI_KNOWLEDGE_DAILY_TOKEN_BUDGET` = 2.000.000 por defecto en código.
- **Métricas:** span `router` con `core_count`, `loaded_count`, `retrieval_source`,
  `prefetch_hits`, `unloaded_authorized_calls`, `free_discovery_rounds` (SQL en la skill).
- **Sin feature flags.** Rollback = revertir el commit; el índice vacío ya degrada al
  catálogo completo por diseño.
- **Validación E2E:** suite `test/agentic/golden-conversations.es.jsonl` (skill
  `vendix-agent-golden-conversations`). Resultados en «Resultados E2E» abajo.

### Resultados E2E

Corrida 2026-10-19, local, `deepseek/deepseek-v4.1-flash`; baseline `a0b2daec3` con misma DB y modelo.

| Métrica | Baseline (catálogo completo) | Carga dinámica |
| --- | --- | --- |
| Prompt por llamada, mediana (9 casos pareados) | 85.674 | 14.989 (−82,5 %) |
| Tools ofrecidas por inferencia (p50) | 286–304 | 22–31 |
| Tokens de definiciones (p50) | ~68k | ~6–8k |
| Casos pareados que pasan | 3/9 | 4/9 |
| Suite completa | — | 24/30 |

Ningún caso pasa en baseline y falla en dinámico. Los 6 fallos dinámicos son de fixture, de
capacidad faltante (listar proveedores, editar dirección de cliente) o del defecto preexistente
«`PROVIDER_ERROR` en el turno que sigue a una propuesta de escritura» (también en baseline).
Gate «30/30 + pass^2» no cumplido: el saldo de OpenRouter cayó bajo el piso antes de
recorrer los casos corregidos. Con índice vacío (g30) la cascada vuelve a ~87,5k, como se espera.

> Actualización (merge de #936): las corridas full-2 y full-3 sobre `4fdd0fd76` dieron
> **30/30 con pass^2**; el baseline `a0b2daec3` da 23/30 sobre los mismos casos.
> Precisión del fallback: índice vacío o cobertura < 0,9 → catálogo autorizado completo;
> si fallan **solo los embeddings**, el turno sigue en ranking léxico (no hay cascada).

### Hotfix pendientes #936 (2026-10-20)

Rama `hotfix/vex-vexi-dinamico-pendientes` (desde `develop` 7b724d337). Cierra lo que la
re-revisión v2 (79/100) dejó abierto:

- **M1:** `search_playbooks`/`load_playbook` y `search_recipes`/`load_recipe` entran al núcleo
  dinámico solo si el turno tiene sesión de playbook/receta, siempre ∩ autoridad.
- **L1–L3:** firma de la tool ante INVALID_ARGS de la regla dura, contador
  `unloaded_authorized_calls` sin discovery, sesiones de voz de #934 normalizadas (`loaded`/`used`). _TODO orquestador: confirmar alcance final._
- **N2/N3 (F7):** un 4xx nativo de Anthropic desactiva el modo nativo y reintenta una vez con
  carga propia; probe con prueba negativa, fuera del turno y con huella de credencial en la clave.
- **N4:** `markInProcessWriteApplied` fail-closed (`{error, code}` cuenta como fallo).
- **N6:** `\set ON_ERROR_STOP on` en el fixture E2E. **Golden:** g31–g33 (playbooks y recetas
  en modo dinámico).
- **N5:** el reformateo de `purchase-orders.service.ts` (`41dfe794d`) no tiene cambios
  funcionales fuera del `where.OR` de `findAll` (sin espacios: 205+/133−; ver cuerpo del PR).
- Regla de dominio compartida guard/puente documentada en la skill `vendix-ai-tool-routing` 2.1.

## Contrato entregado

- Catálogo por `tool:<nombre canónico>:<versión>` y documento entero estable. Hash incluye
  descripción/schema/permisos/flags/aliases/deprecación/ejemplos/dependencias. Aliases no
  crean herramientas duplicadas. `getReleaseManifest()` captura el registro completo en
  `onApplicationBootstrap`, después de los registros descentralizados `onModuleInit`.
- Ejemplos exclusivamente sintéticos: AJV ya instalado + validador del registry + preflight
  **puro** opcional. Nunca ejecutar preview/handler para indexar. No formatos AJV adicionales;
  reglas de formato/negocio requieren validación pura del dueño. No prompts privados/clientes.
- Autoridad primero; router después. Permisos ∩ agente ∩ plan ∩ caller, denies al final;
  reevaluación por ronda y ejecución, antes de UI/handlers/atajos del plan. Errores de consulta
  del alcance de suscripción son fail-closed en B, sin rutas apagadas de compatibilidad.
- K12 operativas + discovery mínimo, planificación mínima antes de un plan activo. Nombres
  usados/dependencias fijados dentro del tope, orden canónico estable. `search_tools` prepara
  K24 y K40 (dos ampliaciones), nunca habilita una llamada del mismo lote. Cursor de schemas
  no consume ampliaciones. Un rechazo `AI_AGENT_TOOL_NOT_OFFERED` no marca argumentos como
  fallo de negocio de D0; la misma llamada se puede ejecutar tras habilitarse.
- Discovery no equivale a ejecución/cuota exitosa. Cada escritura continúa pasando por
  preview/token/aprobación/handler existentes; no se autoaprueba ni se repite un efecto incierto.
- Fast path nombre/alias; léxico ES local (tildes, ñ distinta de n, snake_case), PostgreSQL
  `ts_rank_cd`, coseno exacto sobre IDs autorizados y RRF. No BM25 ni nuevo índice HNSW global.
  SQL parametrizado y timeout local150ms/transacción500ms. Sin índice/vector → léxico autorizado.
- Caché5min/256 entradas por hash de query+documentos/modelo+firma de autoridad/tenant; sin
  texto crudo en claves. No otro embedding por cada ronda del mismo objetivo/consulta.
- `list_capabilities`, `explain_capability`, `list_endpoints`, `search_tools` pagan contexto por
  páginas enteras: total/has_more/cursor y campos/tipos. Cursores se invalidan con cambios de
  dataset/schema/permisos. Contratos de campos tienen su propia página. `object/array` no
  describe el DTO anidado: se exige contrato/preflight del dominio, no adivinarlo.
- GET bridge: páginas de filas JSON, upstream separado, nunca substring6000 como una página.
  Filas/objetos demasiado grandes son referencias/errores explícitos, no datos completos.
  Metadata `complete:false`; ni la última página local verifica un conjunto upstream entero.

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


## Índice y aislamiento

Migración aditiva `20261018100000_ai_tool_knowledge_catalog/migration.sql`:

- `ai_knowledge_documents`: serial/clave única, tipo/scope/tenant opcionales, contenido y
  metadata/hash/version/release, estado pending/ready/error/retired, publicación active, tsvector/GIN.
- `ai_embeddings.knowledge_scope TEXT NOT NULL DEFAULT 'store'`, índice y CHECK guardado.
  Store exige IDs>0; global exige ambos0 y tipo tool/skill/process/recipe. Unique/NOT NULL/HNSW
  previos permanecen intactos. El índice sobre embeddings vive en una migración unitaria separada para evitar transacciones implícitas del lote SQL. CHECK de embeddings NOT VALID: protege filas nuevas sin escanear ni rechazar datos históricos durante deploy. Validación posterior opcional.
- **Cero DML histórico, backfill, eliminación de constraints o SQL destructivo.** CHECK NOT VALID no escanea filas históricas durante deploy; validación posterior sólo en ventana aprobada. Nuevas FKs incondicionales a stores/orgs
  serían incompatibles con el sentinel global; no añadirlas sin rediseñar namespace.
- Selector documental: global/tenant-null, ready+active, hashes vigentes, IDs canónicos
  autorizados. Vector: global/0/0 y fingerprint idéntico. Negocio: scope store Y tienda Y org
  actuales Y cinco tipos de negocio; nunca `store=current OR store=0`.
- Solo `storeGlobalKnowledgeEmbedding` acepta escritura del índice con documento comprobado.
  No StoreEmbeddingParams0, relajación de StorePrisma ni endpoint de edición por usuarios.

Job `index-knowledge` en cola existente ai-embedding: ≤50 documentos, dos intentos/backoff3s,
IDs idempotentes por release/lote, contenido reconstruido desde código (no confiar en Redis),
barrera bootstrap en worker. Una fila por clave, léxico listo aun sin app/vector; CAS vincula únicamente vectores compatibles. Fallo de embedding conserva léxico activo y código de error genérico sin diagnósticos privados. Retiro lógico del snapshot completo, no de un lote; versiones anteriores
se retiran tras publicar nueva versión. Manifest hash se incluye en filas/jobs y diagnóstico.

Cambiar modelo/config/dimensión invalida fingerprint/caché y rechaza INSERT incompatible.
Reindexación controlada: reinicio autorizado o invocación interna `enqueueSnapshot()` tras boot.
Un job ya fallido agota sus dos intentos; revisar causa/presupuesto y reintentar explícitamente en
la cola, no crear reintentos infinitos ni un endpoint público de reindexación.

## Compatibilidad y desvíos acotados

1. **Sin discovery autorizado no se lo reañade a la fuerza.** Ese turno conserva catálogo
   legacy autorizado completo y reporta `discovery_not_authorized`; evita perder capacidades
   raras o violar un deny. K12/24/40 aplica a turnos elegibles para routing; este fallback debe
   incluirse en métricas. No se usa el atajo de planning para bridge/negocio/discovery.
2. Invariantes de IDs positivos, tipos de negocio y organización explícita se aplican siempre; ninguna consulta de negocio accede al sentinel global persistido.
3. Adaptador nativo Anthropic es **opcional y no implementado/activado**: no hay comparación
   autorizada/probe real que lo justifique. Providers genéricos e historial multirronda intactos,
   sin `defer_loading`, `tool_reference` ni protocolo nuevo activado por marca compatible.
4. Sin D1/D2/C/H/G/E/F, verificador durable ni nuevos contratos REST anidados de negocio.
   Los gaps se señalan, no se inventan schemas/wrappers ni se declara cobertura100%.

## Evidencia offline y límites

Solo specs creados/modificados, uno por proceso, secuenciales:

```sh
cd apps/backend
NODE_OPTIONS=--max-old-space-size=1536 ./node_modules/.bin/jest \
  --config test/agentic/jest.b.config.json --runInBand --runTestsByPath <spec-exacto> --silent
```

| Spec | Tests |
|---|---:|
| tools/tool-router.service.spec.ts | 27 |
| tools/tool-catalog-indexer.service.spec.ts | 11 |
| embeddings/knowledge-search.service.spec.ts | 11 |
| embeddings/knowledge-embedding.service.spec.ts | 14 |
| embeddings/embedding.service.spec.ts | 22 |
| ai-agent.service.spec.ts | 78 |
| tools/bridge/discovery-pagination.spec.ts | 7 |
| providers/anthropic-compatible.provider.spec.ts | 22 |
| test/agentic/b-routing.spec.ts | 51 |

El smoke reutiliza los50 casos A **sin modificarlos** con declaraciones reales de factories,
mock de ranking léxico y dependencias inertes; no ejecuta handlers/DB/proveedor. El manifest de
este fixture no es el manifest completo desplegado. Reporte opcional `AGENTIC_B_REPORT` a /tmp
incluye explícitamente null en recall/tokens/latencia/costo medidos. El proxy de caracteres/4 NO
certifica el gate de tokens ni una mejora de éxito del producto.

El primer ts-jest completo agotó heap2560MB antes de ejecutar tests. No se elevó memoria:
config B isolatedModules = **transpile-only**. Typecheck real focalizado de catálogo/paginación
pura (sin grafo Prisma/AIEngine), Prisma generate y singleton audit separados. Nest DI del nuevo
grafo se comprobó con fronteras mockeadas, sin init: no equivale al bootstrap completo desplegado.
Sin build/typecheck global ni suite completa. Errores iniciales de fixtures/token/field name se
corrigieron y se reejecutaron los specs correspondientes.

Replay del harness A, budget0, repeats3: **150 planned, 0 ran, 150 not_run**. Corpus hash canónico
`28ddccd89f8d222aa3918f2993d39e7b833841e315269df4341a56d4526f64b0`. Recall, completion, latencias
comparables y costo siguen **NULL**, no son resultados verdes. Medición real diferida por el dueño.

Docker backend/postgres/redis Up, pero backend monta checkout principal, **no este worktree**.
Se leyeron logs (WARN AutoNoShow/immutable_unaccent preexistentes); no se repuntó/reinició el
entorno compartido. Sin afirmación de runtime de esta rama. No migración ejecutada en ninguna DB.

## Rollout/rollback y próximos gates

1.Use the existing general Vex/Vexi control to stop operation; preserve evidence.
2. En snapshot QA autorizado, aplicar SQL **verbatim dos veces**, comprobar cero DML histórico,
   casos adversos preflight, registro global idempotente y separación de dos tiendas/organizaciones.
3. Autorizar app/presupuesto, indexar dos veces, verificar manifest/ready/error/retiradas/model drift.
4. Happy: ES/alias/rare tool/expansión/páginas/aprobación. Sad: índice/vector caído, contratos
   incompletos, cursores vencidos, timeout. Brute: tool fuera de offered, denies, permisos/plan
   revocados, job adulterado, store0/dimensión incompatible. Curl/runtime de rama autorizado;
   pruebas actuales son contratos/mocks, no este E2E.
5. Medir antes/después corpus A, holdout y ruta degradada. Hipótesis, NO satisfechas por mocks:
   mediana tokens definitions−70%, recall@12≥90%/@24≥97%, cero tool no autorizada,
   router p95 warm≤200ms/cold≤1s, costo/latencia e2e≤+10%, éxito no cae>2pp.
6. Ante incidentes usar el apagado general de Vex/Vexi; conservar
   schema, documentos/evidencias y propuestas pendientes, sin SQL inverso/destructivo.

Fuentes de diseño: [pgvector hybrid search](https://github.com/pgvector/pgvector#hybrid-search)
(propone combinar búsqueda léxica/vector y RRF) y [Tool Search](https://platform.claude.com/docs/en/agents-and-tools/tool-use/tool-search-tool)
(referencia para una futura comparación nativa, no capability habilitada aquí).

## Defaults de embeddings

`AI_KNOWLEDGE_EMBEDDING_APP_KEY=agent_knowledge_embeddings`,
`AI_KNOWLEDGE_EMBEDDING_MODEL=text-embedding-3-small` (1536 dimensiones).
`AI_KNOWLEDGE_DAILY_TOKEN_BUDGET` = 2.000.000 por defecto en código (decisión del dueño
2026-10-19; prod mapea variables una a una, no se agrega al deploy). Con 0 explícito no hay
gasto, sin impedir indexación léxica ni chat. No hay fallback a la app de productos o SDK directo.
