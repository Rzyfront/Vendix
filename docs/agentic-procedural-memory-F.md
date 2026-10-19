# F — memoria procedimental revisada (OFF por defecto)

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


## Alcance y frontera

Engram del equipo no participa en runtime. El factory `createProceduralRecipeTools`
NO es `createRecipeTools` de recetas gastronómicas. No cambios mobile, proveedor,
modelo, configuración de aplicación, política económica o unidad de cuota.

## Flujo implementado

1. Loop termina con `completed_verified` D2; encola identidad de objetivo/owner/org/store.
   Falla de encolado no cambia el negocio verificado; un operador puede reencolar el ID.
   Cola `ai-recipe-miner`, concurrency1, dos intentos con backoff, sin bearer/datos.
2. Worker reconsulta objetivo propio, postcondiciones/refs observadas, ausencia de efectos
   pendientes/desconocidos, pin C exacto y permisos/membresía vigentes ∩ snapshot D1.
   No candidate para partial/pending/unknown/exit0. Reejecución no duplica ni reinicia estado.
3. Minería **determinista conservadora**: reconstruye sólo la proyección release C
   (inputs simbólicos, pasos/DAG/aprobaciones, dependencias, verificadores, precondiciones
   y fallos conocidos). Nunca extrae texto libre del modelo ni valores de argumentos,
   saldos, stock, precios, IDs comerciales, nombres/contactos, ejemplos tenant o tokens.
   Ejemplos publicados sólo indican tipo/resultado esperado sintético, no valores.
   Trazas A, objetivo, receipts y hasta dos referencias de scripts E quedan PRIVADOS.
4. Candidata -> reviewed -> approved mediante dos atestaciones humanas firmadas y CAS
   de status/hash; no herramienta ni endpoint de publicación. Se conserva review_history.
   Un éxito aislado sólo crea candidata, jamás una receta ofrecida al modelo.
5. Búsqueda por objetivo: resumen compatible con catálogo autorizado actual∩inicial,
   permisos DB∩ALS, industria, release C/schema/tool/verifier/policy y firma/TTL. Fallback
   léxico local; B añade ranking global y privado separados. Hasta100 candidatas por scope,
   búsqueda acotada/no inventario exhaustivo; máximo5 resúmenes. El modelo recibe datos,
   nunca una instrucción de sistema derivada de una traza.
6. `load_recipe(id,version,hash,section?)` carga sección ENTERA, presupuesto acumulado
   4000 bytes UTF-8/turno, sin recortar JSON/pasos. Cada entrada/setup/stock/precio/saldo/
   estado fiscal se consulta otra vez. Preview y consentimiento NUEVOS por escritura;
   sólo el registry vigente aplica y D2 verifica. F no ejecuta un workflow ni un macro.
   Pins históricos se conservan owner-scoped; no adoptar reemplazo silencioso dentro del
   objetivo. Ante retirada/deriva: playbook manual y lecturas actuales.
7. D1 persiste resultado antes de compacción; contexto durable/historia pareada omiten
   cuerpos de load_recipe incluso OFF, conservando id/versión/hash. Fallo real del verifier
   llama observador servidor: falla/quarantine sólo del pin del workflow cuyo predicado realmente
   falló. Requests malformados, workflows inventados, permisos/infra o procesos ajenos no
   son señales de calidad ni pueden retirar recetas globales. No verdict del modelo.

## Revisión humana y operación segura

`AI_RECIPE_REVIEW_KEY`: 32 bytes HEX, sin default. Autoridad de atestación OFFLINE;
no entregarla a herramientas/modelos/browser/jobs/logs. Proteger por operador y por
identidad humana real; HMAC autentica al atestador, **no prueba por sí solo que se
corrieron fixtures ni es no-repudio de dos personas**. El proceso operativo debe
verificar identidad/independencia y evidencia. No existe API de firma en Vendix.

Una consola de mantenimiento ya autenticada obtiene el servicio
`ProceduralMemoryService` del contenedor Nest EN EJECUCIÓN. No iniciar otra app,
worker o DB para operarlo. Usar `RequestContextService.runIsolated` con principal
validado: para privada owner/store/org positivos, reviewer_id igual al usuario;
para global plataforma explícita `is_super_admin=true`, usuario real y SIN store.
Nunca reconstruir autoridad a partir de valores del JSON del modelo o del job.

- Leer candidata privada con repositorio owner-scoped (no entregarla a otra tienda).
- Evaluador independiente corre fixtures y control con configuración congelada;
  registra IDs hash de fixture, split replay/holdout disjunto, tenant sintético,
  familia de proveedor y fingerprint de modelo, costes y llamadas observados.
- Mínimo5 replays+3 variantes holdout exitosas, cero violaciones/duplicados,
  completion no inferior (todos los controles/casos del gate verificados), comparación
  on/off explícita, exploración y coste total >=20% inferiores. Coste/control desconocido,
  cero sin observación, valores negativos/no finitos y evidencia incompleta no promueven.
  Estos mínimos NO prueban seguridad universal. Ninguna medición real en esta fase.
- JSON `RecipeReview`: stage, recipe_id, content_hash, reviewer_id, process_owner exacto
  C, reviewed_at UTC (<=24h), expires_at UTC, evaluation_version, on_off_comparable:true,
  runs y signature. Esquema exacto, sin campos extra ni referencias tenant en evidencia
  compartida. Firma cubre todos los campos salvo signature con stableJson canónico.
- Humano autorizado, después de validar evidencia, firma OFFLINE sin DB/proveedor:
  `node scripts/agent-recipe-sign-review.cjs < reviewed-evidence.json > attestation.json`
  (clave por entorno seguro; nunca literal en shell/log/repo). El helper **NO ejecuta
  fixtures ni valida su verdad**; backend valida esquema, firma, quality, TTL y CAS.
- Consola llama `applyReview(id,reviewedAttestation)`, luego NUEVA atestación stage
  approved y `applyReview`. Sin reviewed previo falla. No SQL directo para aprobar.
  Encola indexación sólo después del CAS aprobado. Reencolado explícito permite recuperar
  indisponibilidad de índice sin repetir escrituras comerciales.
- Global: plataforma llama `prepareGlobal(privateApprovedId)`. Devuelve NUEVO ID candidato,
  sólo template/hash; source refs/tenant/review no se copian ni se exponen. Revisar ese ID
  global con stage reviewed y luego stage global por DOS revisores globales distintos;
  dos tiendas sintéticas y ambas familias soportadas (openai-compatible/anthropic-compatible,
  cuatro combinaciones). Nunca promover referencias o ejemplos privados por cambiar scope.
- Retirar por `RecipeRepository.retire` (reason deprecated) desde mantenimiento autorizado
  con scope visible. Ante incidentes usar el apagado general de Vex/Vexi. Sin eliminación histórica.

TTL máximo inicial30d; `AI_RECIPE_REVIEW_TTL_DAYS` permite reducirlo (1–30). Expiración
se excluye/quarantines al consultar. Renovar por evidencia humana NUEVA reviewed+approved
sólo para causa expired; se conserva historial/métricas. Un verifier fallido, incidente
seguridad o cambio de contrato requiere contenido/version corregidos, no reset de métricas.
Rotar clave sin migrar atestaciones hace fallar firma y retira guía: preparar operación de
revisión/rotación explícita antes de habilitar; no existe fallback a unsigned.

## Persistencia, namespaces, embeddings y privacidad

Migración nueva `20261018130000_ai_agent_recipes`: tablas `ai_agent_recipes` y
`ai_agent_recipe_events`, índices/checks idempotentes, cero DML/backfill histórico,
sin cascadas/FKs de negocio. Unique por scope/owner/key/version, identidad hash;
Prisma no representa el índice SQL de expresiones COALESCE. No se aplicó a ninguna DB.

Privadas: scope store y owner/store/org positivos, StorePrisma registra ambos modelos;
raw SQL siempre incluye los tres. Globales: sólo repositorio controlado de sistema,
tenant/owner NULL y arrays de fuentes obligatoriamente VACÍOS por CHECK. Eventos de
uso incluso de globals permanecen store/org/user privados. No API de traces global.

`ai_embeddings` privado usa entity_type recipe, scope store, IDs tenant reales y owner
metadata/hash. No ampliar semantic_search ni StoreEmbeddingParams. Global: docs B recipe
aprobados con ID estable y embedding global0/0. Ranking sólo sobre IDs autorizados;
validación de aprobación/hash/firma actual DESPUÉS de esperas. Candidatos jamás entran
al manifest estático B; snapshots tool/process no retiran recetas runtime por accidente.

Index necesita flag B, app separada y presupuesto B (default0), metering/plataforma
existente, vector1536/fingerprint. No gasto real ni cambio de app/proveedor aquí. SQL
privado con statement timeout150ms; embedding fallido deja índice no listo, guía léxica
permanece con las mismas autorizaciones. Política de permisos revocados falla cerrado.

Hashes fijan schema/permisos/flags de tool, C completo, bytes del verifier C/D2 empaquetado
y política F. Cambio de código/bundle puede invalidar conservadoramente recetas y exigir
nueva revisión; no adaptar silently versiones históricas. Dependencias/contratos de dominio
no expresados en esas versiones deben versionarse y revisarse por sus owners.

## Métricas y verificaciones honestas

Eventos usados/success/failure deduplicados por owner+objetivo+receta/hash+tipo; evento y
contador en la misma transacción. Uso significa entrega de guía, NO negocio completado.
Success sólo desde completed_verified D2. Fallos/verifier/invalidations quedan aunque luego
se complete el objetivo; reuse@success requiere analizar eventos por versión y cohortes,
no interpretar número de recetas como beneficio. No inferir coste cero sin receipt.

Pruebas exactas seriales `NODE_OPTIONS=--max-old-space-size=1536 ./node_modules/.bin/jest
--config test/agentic/jest.d1.config.json --runInBand --runTestsByPath <spec> --silent` desde
backend. Es transpile-only. Specs F cubren quality, SQL/contracts, cola, index, firma CLI,
DI aislada y loop+registry+D1 reales con transportes/modelo/dominio sintéticos. No prueban
PostgreSQL/locks, Redis real, UI, proveedor o beneficio del modelo. `f-holdout.es.jsonl`
son ocho ESCENARIOS sintéticos pendientes de evaluación, NO resultados ni firmas reales.
A permanece congelado; replay sin observaciones =150planned/0ran/150not_run, métricas NULL.

Antes de ON: CI/build/boot de ESTA rama, migraciones double-apply verbatim en snapshot
QA autorizado y auditoría de scope/CAS/unique/concurrencia; revisión humana de datos/clave,
holdout/modelo/control por tenant, coste/canary y gates de seguridad. **B20261018100000**
añade CHECK que valida filas existentes y requiere ventana de mantenimiento. Pendiente D1
frontend Angular/NgRx no resuelto aquí (F no toca frontend). Backend Docker monta otro
checkout; sus logs no certifican esta rama. No inventar runtime verde.

Scripts reutilizables siguen deshabilitados por esquema: E requiere aislamiento Linux y
revisión independiente aún pendientes; F conserva refs privadas, nunca autoaprueba código.
Rollback: F OFF, conservar tablas/historial/propuestas y circuitos de autorización actuales.
