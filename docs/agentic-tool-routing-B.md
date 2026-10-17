# Fase B — Routing autorizado y conocimiento global

Fecha: 2026-10-17. Implementación offline sobre A+D0, **no promoción medida**.
No cambios de proveedor/modelo activo, prompts/DB existentes, móvil o infraestructura.

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
  del alcance de suscripción son fail-closed en B, sin alterar el camino legacy OFF.
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

## Flags y configuración (ninguno activado)

| Variable | Default | Requisito/efecto |
|---|---|---|
| `AI_TOOL_ROUTING_ENABLED` | OFF | Literal `true`; requiere migración B para búsquedas negocio namespaced. |
| `AI_TOOL_KNOWLEDGE_INDEX_ENABLED` | OFF | Literal `true`; DB/cola/app de plataforma. Router sigue útil con este flag OFF. |
| `AI_KNOWLEDGE_EMBEDDING_APP_KEY` | `agent_knowledge_embeddings` | App SEPARADA de producto, categoría válida `rag_embeddings`, config explícita embedding activa. |
| `AI_KNOWLEDGE_EMBEDDING_MODEL` | `text-embedding-3-small` | Debe coincidir con config/respuesta y dimensión1536. No cambia la configuración activa. |
| `AI_KNOWLEDGE_DAILY_TOKEN_BUDGET` | 0, sin gasto | Presupuesto de plataforma aprobado explícitamente; reserva conservadora de bytes UTF8 por día UTC. |

La app de conocimiento se debe configurar, tras aprobación, apuntando a la configuración
**existente** de embeddings con modelo/dimensión compatibles; no usar el default de texto ni
la app de productos. `ai_feature_category` es NOT NULL: se conserva `rag_embeddings`, pero ALS de plataforma no tiene tienda y no consume cuota de un comercio. No se creó/actualizó ninguna aplicación/seed/config DB aquí.
Si falta, se usa léxico local/SQL; no hay fallback SDK que salte metering. Redis caído o presupuesto
agotado bloquea gasto. La reserva de seguridad incluye intentos fallidos (pueden facturarse);
**no** sustituye ni preconsume cuotas comerciales por éxito. Logs/costos se registran con
`AIEngine.runEmbedding` en ALS aislado de plataforma, sin inventar tenant0. Tracing ON usa
purpose `platform_knowledge` separado del tenant; la cobertura canónica de todos los transportes
multimodales sigue siendo una medición pendiente, no se certificó costo por mocks.

`AI_TOOL_EXECUTION_CONTRACT_ENABLED` (D0) y `AI_AGENT_TRACING_ENABLED` (A) siguen independientes,
OFF por defecto. No se ampliaron presupuestos del loop ni se tocó la política de retries del proveedor.

## Índice y aislamiento

Migración aditiva `20261018100000_ai_tool_knowledge_catalog/migration.sql`:

- `ai_knowledge_documents`: serial/clave única, tipo/scope/tenant opcionales, contenido y
  metadata/hash/version/release, estado pending/ready/error/retired, publicación active, tsvector/GIN.
- `ai_embeddings.knowledge_scope TEXT NOT NULL DEFAULT 'store'`, índice y CHECK guardado.
  Store exige IDs>0; global exige ambos0 y tipo tool/skill/process/recipe. Unique/NOT NULL/HNSW
  previos permanecen intactos. Preflight rechaza IDs/scope/columnas/FKs inesperados/conflictos.
- **Cero DML histórico, backfill, eliminación de constraints o SQL destructivo.** CHECK valida
  filas con locks: requiere ventana/snapshot QA aprobado. Nuevas FKs incondicionales a stores/orgs
  serían incompatibles con el sentinel global; no añadirlas sin rediseñar namespace.
- Selector documental: global/tenant-null, ready+active, hashes vigentes, IDs canónicos
  autorizados. Vector: global/0/0 y fingerprint idéntico. Negocio: scope store Y tienda Y org
  actuales Y cinco tipos de negocio; nunca `store=current OR store=0`.
- Solo `storeGlobalKnowledgeEmbedding` acepta escritura del índice con documento comprobado.
  No StoreEmbeddingParams0, relajación de StorePrisma ni endpoint de edición por usuarios.

Job `index-knowledge` en cola existente ai-embedding: ≤50 documentos, dos intentos/backoff3s,
IDs idempotentes por release/lote, contenido reconstruido desde código (no confiar en Redis),
barrera bootstrap en worker. Una fila por clave; CAS ready tras vector compatible, error genérico
sin diagnósticos privados. Retiro lógico del snapshot completo, no de un lote; versiones anteriores
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
2. Invariantes de IDs positivos/tipos de negocio/org explícita también se mantienen OFF
   para impedir que una desactivación deje acceder al sentinel global persistido. Llamadas
   válidas conservan la ruta SQL legacy sin requerir la columna nueva con ambos flags OFF.
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

1. Mantener flags OFF; CI compila el grafo real y revisar migración.
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
6. Rollback: apagar ambos flags y reiniciar el proceso con configuración anterior; conservar
   schema, documentos/evidencias y propuestas pendientes, sin SQL inverso/destructivo.

Fuentes de diseño: [pgvector hybrid search](https://github.com/pgvector/pgvector#hybrid-search)
(propone combinar búsqueda léxica/vector y RRF) y [Tool Search](https://platform.claude.com/docs/en/agents-and-tools/tool-use/tool-search-tool)
(referencia para una futura comparación nativa, no capability habilitada aquí).
