# Fase H — streaming, contexto y resultados recuperables

Implementación **offline**, no certificación de proveedor/browser/DB.

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


## Una inferencia, un circuito

`runAgent` drena `runAgentStream`; el mismo loop conserva permisos, allowlist/deny, propuestas,
consentimiento individual, registry, verifier D2 y presupuesto D1. Engine comparte construcción
app/config/options con `run()`, gates/rate, meter durable, quota y logging. No SDK sin medidor.
No retries/fallback después de texto ni JSON parcial ejecutable. Providers ensamblan por ID/index,
validan el lote completo y schema soportado antes del terminal; registry/DTO siguen validando.
`stop` con llamadas completas sigue válido; length/max_tokens/conflicto/incompleto falla cerrado.

El motor consume texto incremental real. El loop NO pinta prosa del modelo como hecho de negocio
antes de verificarla: `progress` fijo y eventos de tool son estado separado de respuesta final.
Propuestas/unknown/needs-input conservan narración autoritativa; ninguna tarjeta equivale a aplicado.
El primer frame vacío de transporte/heartbeat **no es TTFT útil**. Es una restricción intencional,
no una promesa de texto final token-a-token cuando la evidencia todavía no está disponible.

## Reconexión y cancelación

Intent Redis permanece single-use (sin prompt URL). Handshake H publica replay_enabled; cada frame
lleva stream_id/sequence, y objective_id/checkpoint cuando existe D1. Reconectar a la MISMA sesión
con after_sequence nunca vuelve a ejecutar el prompt. Buffer transport-only por worker:32 sesiones,
256 frames/2MB por sesión, TTL5min terminado; principal store/org/user/conversation revalidado.
Cursors adelantados/gaps/worker reiniciado/ventana expirada -> reconciliar objetivo/transcript,
NO nuevo intent automático. Callbacks de socket cerrado están fenced; UI calls se deduplican.

Disconnect cierra EventSource y aborta cooperativamente H, incluido el camino buffered por capability.
El productor backend drena a persistencia para conservar receipts/efectos inciertos. Cancelación
NO prueba rollback. Si faltó done legado, H emite terminal sólo después de persistir, sin usage falso.
`metadata.stream_id` impide reconciliar una respuesta vieja como si fuera este turno.

No se resucitan tokens/tarjetas cacheadas en replay: se preserva secuencia pero se solicita lectura
canónica. Vex puede recargar plan persistido; **Vexi puede requerir rechazo/repropuesta explícitos**
si perdió una tarjeta single-step: no se promete recuperar token que transcript no persiste.
El apply vigente sigue single-use/owner/permissions y no toma autoridad del replay.

## Contexto y caché

Base system estable + tools en orden canónico dentro del working set autorizado; instrucciones
runtime/tenant permanecen. Hash/version1.1 y contadores cache reales, nunca catálogo completo para
fabricar un hit. Anthropic hints base/última tool no garantizan hits; OpenAI no recibe parámetros
cache/usage desconocidos. Costo usa tokens fresh/cache separados sin doble conteo.

Ventana explícita en settings.agent_context_window_tokens o context_window_tokens. Fallback32768
queda marcado, NO certifica ventana real. Reserva salida configurada y safety max(1024,10%).
Estimador pesimista byte-fallback+overhead, **no tokenizer ni bytes=tokens observados**. Sólo prosa
assistant antigua marcada dispensable se omite con índice/hash; últimos dos textos, todas reglas,
user/goal, autoridad/propuesta/objetivo/IDs/recibos/evidencia y pares tool_use/result quedan.
Overflow requerido falla antes SDK. Imágenes/audio remoto sin contador se rechazan en este camino;
se usan referencias a adjuntos. Comparar con usage real antes rollout.

H logs guardan observed nullable incluso con tracing A OFF; `cost_usd=0` legacy no significa gratis:
leer usage_known/billable/cost_measurement/estimated_cost_microusd. Estimación usa precios configurados
+ reserva input/output, sólo metadata marcada; sin precios permanece unknown. Nunca se usa como cuota.
No nuevo cache de datos de negocio/aprobación ni autoridad congelada.

## Compactación recuperable

Helper común guarda snapshot íntegro tenant+user ANTES de compactar (D1 result o bloque Vex real).
Sin sink durable no pierde el raw. H bridge no trunca JSON6k ni repagina lectores bounded. Compact
summary estructural, IDs, campos solicitados, source-pagination, units/evidence, complete:false.
Guards/propuestas/errores se conservan enteros. Transcript H conserva el JSON/envelope completo:
el slice1000 legacy ya no destruye artifact_ref al reabrir.

Readers idempotentes con presupuesto serializado, hash snapshot+query, total/has_more/cursor/complete,
units y marcador histórico/no-reusable-for-write. D1 artifact_cursor es distinto del UUID list cursor;
seguir next_query. Vex markdown/text existente se preserva OFF y H soporta texto escapado íntegro.
Una fila gigante se entrega como texto explícito; concatenar antes JSON.parse, nunca usar un prefijo.
Proyección por campos directos/allowlist, agregación numérica determinista sin expresiones: rechaza
Decimalstrings/missing/no-finite, no suma subset para fingir complete. End cursor!=whole dataset.
Owner/tenant ajeno responde404; ALS ausente no usa tenant estático.

Límites heredados: D1 snapshots saneados máximo2MB, bloques5000filas/100porconversación; se usan
páginas upstream para volúmenes mayores, no se eliminan límites de seguridad. Los artefactos conservan
redacción de credenciales/D1; no son una vía de exfiltración ni evidencia viva para nuevos writes.

## Verificación y gates pendientes

Specs exactos secuenciales, heap1536, config D1 transpile-only. Tsc semántico focal de helpers puros,
syntax-only de TS editados y prisma-singleton audit no sustituyen build/DI/plantillas. Detalle y
resultados finales en progress.md del brief. Corpus A intacto replay budget0:150planned/0ran/150not_run;
NULL TTFT/tokens/costo/completion, no mejora empírica demostrada.

- CI/build/bootstrap de ESTA rama, Angular/NgRx y specs state D1/H (dependencias ausentes).
- Dev frontend no está vivo; no Playwright MCP disponible. Vex/dock Happy/Sad/Brute pendientes.
- Zoneless audit global falla por deuda previa, sin nuevos patrones prohibidos en diff H.
- Docker postgres tiene error periódico preexistente unaccent dictionary missing en analyze;
  backend WARN AutoNoShow previo. No corregir infra ajena para atribuir salud a esta rama.
- Migración B20261018100000 CHECK valida filas existentes/lock: requiere ventana mantenimiento.
- Rafael: aprobar QA/snapshot/gasto para baseline/canary warm/cold con mismo corpus y config.
  Gate objetivo: TTFTútil p95<2s si provider permite, contexto mediano -40%, costo/completada -20%.
  No contabilizar heartbeats, fixtures, costo estimado ni replay sin runs como medición real.
