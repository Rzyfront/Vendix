# Fase D1 — objetivos y checkpoints durables

Implementación estándar del plan aprobado de autonomía Vex/Vexi. No implementa
playbooks C, verificador/scheduler D2, streaming H, voz G, sandbox E ni recetas F.

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


## Autoridad y estado

`AgentObjectiveRepository` usa el singleton StorePrisma con transacciones/raw SQL
parametrizados y scope explícito **store + organization + owner** en cada consulta.
ALS ausente falla cerrado aunque exista un `currentContext` estático de otro
request. Foreign/missing dan el mismo404. No `withoutScope`, clientes Prisma
nuevos, store0 ni credenciales persistidas.

Un objetivo puede abarcar muchos turnos; no es un job. Se mantiene AgentPlan y
su hook: lazy import bloquea/relee conversación y usa identidad legacy única,
instalando puntero atómico sin perder hashes/propuestas/metadata ajena. No hay
importación masiva. Revisar o reproponer el mismo goal mantiene identidad y
presupuesto; un nuevo goal humano puede sustituirlo. Una continuación automática
no puede resetear presupuesto mediante otro `propose_plan`: usa `revise_plan`.

Loop y hook comparten `{objective,lease}` mutable. CAS exige version, generación,
lease vivo y TTL. Una ejecución concurrente con lease vivo devuelve409: no toma
control silencioso. Expirado no significa completado. Solo actualización válida
del plan renueva TTL de actividad24h; open/lecturas/continuación no lo renuevan.
La selección explícita de un objetivo vencido renueva la ventana, no sus hechos,
permisos ni presupuesto. Un objetivo pausado/bloqueado necesita selección explícita
antes de ejecutar; otro trabajo puede abrirse en una conversación nueva.

Los resultados tardíos se conservan como audit stale, sin avanzar el plan nuevo.
El uso/costo observado de proveedor tardío se acumula sin adoptar el fence nuevo.
Tras proveedor se comprueba el fence antes de emitir texto o ejecutar tools.
El snapshot público se genera después de liberar lease para que expected_version
sirva para la siguiente selección/rechazo.

## Hechos y artifacts

Se captura el resultado normalizado **completo antes** de compactar. La identidad
almacenada del call incluye namespace de turno: proveedores pueden repetir
`call_0` entre requests; los IDs originales del protocolo del proveedor no cambian.
Se guardan receipt, versión de tool, args hash, IDs explícitos y procedencia,
paginación/frescura, data y referencia de resultado. Texto del modelo no crea IDs.

Contexto factual JSON acotado (10k caracteres del builder; máximo interno24k),
ventana de20 mensajes secundaria. Datos calculados pequeños entran enteros; se
omiten registros completos con contadores/cursors, no fragmentos JSON. Artifacts
≤2 MB UTF-8; exceso pide upstream bounded page. Resultados grandes de Vexi usan
artifact_ref sin publicar bloques Vex; Vex conserva su block sink existente.

GET de artifact pagina arrays/envelopes comunes anidados como registros enteros,
y diferencia has_more de dataset completo. No es una lectura viva de inventario,
precio, saldo o situación fiscal: artifact:true/reusable_for_write:false. Un
artifact releído no puede convertirse en evidencia independiente. Hechos sin
TTL/version o volátiles se revalidan antes de proponer/aplicar. Se scrubbean
credenciales, tokens, signed URLs, audio crudo y razonamiento privado.

## Efectos y consentimiento

1. Preview sin ejecución y token de confirmación vigente, como antes.
2. Antes de mostrar tarjeta: ledger **proposed** con hash canónico y step_id.
3. Apply: misma autoridad/registry/DTO/servicio de dominio; approved→applying se
   guarda **antes** de dispatch. Ninguna aprobación textual ni autoaprobación.
4. Guardar receipt/ID del dominio, después resultado/checkpoint. Applied no es
   verified; D1 nunca declara completed_verified.
5. Corte sin respuesta: unknown/applying bloquea replay/nueva ejecución. Sin
   contrato de reconciliación del dominio no se promete exactly-once.
6. Corte tras recibo aplicado conocido pero antes del checkpoint: recuperar
   únicamente lifecycle partial + IDs del ledger, sin repetir dispatch, resetear
   presupuesto/TTL ni ignorar propuestas posteriores. No es un verificador D2.

Rechazo explícito usa CAS antes de ocultar la tarjeta; marca propuestas existentes
failed, sin aplicar ni gastar inferencias. Incluso otro token no puede repetir
ese efecto. Un efecto failed idéntico exige revisar propuesta/objetivo, no retry
ciego. Tokens de plan legacy dentro del loop durable preparan tarjeta para el
endpoint con ledger, no otro camino de dispatch. Llamadas sin sesión durable
mantienen ABI legacy.

## Superficies, workers y presupuestos

Sync y SSE usan el mismo builder/contexto/hook. Vex conserva approvals y bloques;
Vexi recibe ninguno de esos hooks Vex-only. APIs bajo **ambas** superficies:

- GET `/store/{vexi|vex}/objectives/:id`
- POST `/:id/resume` con `{expected_version,confirm_expired?}`
- POST `/:id/reject-proposal` con `{expected_version}`
- GET `/:id/results?cursor&limit` y `/:id/results/:resultId?offset&limit`

Cada prefijo conserva SU switch/guards: Vex funciona con Vexi OFF. Ninguna API
GET/resume/reject inicia inferencia. Resume no libera awaiting_approval ni unknown.
Frontend mantiene cap3 de continuaciones, progreso y tarjeta si falla el rechazo;
respuestas atrasadas/versiones antiguas no pisan una selección nueva. No cambia
el task strip, slot de un job activo ni convierte BullMQ completed en negocio
verificado.

Workers restauran contexto explícito por runIsolated y revalidan usuario,
organización/tienda/membresía/roles, permiso granted vigente ∩ snapshot del job ∩
snapshot del objetivo, settings/agente y gates actuales. Un snapshot vacío no
cae a roles owner. No bearer almacenado; bridge autenticado/bulk_prepare se
excluyen del worker; writes directos siguen proponiendo, nunca aplicando solos.

No aumentan límites por turno. Acumulados por objetivo: intentos del proveedor y
SDK (también subagentes visión), tokens/costo observado, tools, runtime activo,
intentos de ampliación y correcciones. Espera humana no gasta runtime. Guardas
acumuladas:240 intentos,1000 tools,30min activos; no se renuevan en plan_continue.
Uso/precio ausente deja costo desconocido, no ahorro inventado.

## Verificación y límites

Specs exactos, secuenciales, un proceso Jest cada vez y heap1536MB; config D1
isolatedModules es **transpile-only**. Dos interfaces/meter puros sí tuvieron
TypeScript semántico focalizado, heap1024MB; no typecheck/build global. El helper
SQL en memoria ejercita wiring real chat→loop→sesión→hook→repositorio, pero NO
certifica aislamiento/locks ni doble aplicación de PostgreSQL.

Smoke50 casos del corpus A intacto prueba scope/storage, no50 tareas de negocio.
Fixture de25 mensajes y5 continuaciones reduce lookups redundantes5→0; es política
determinista sintética, no benchmark de modelo. Corte/replay/recibo previo a
checkpoint/rechazo/owner ajeno están cubiertos sin ejecutar writes reales.

Harness replay budget0:150 planned,0 ran,150 not_run; completion/costo/tokens y
latencias comparables permanecen NULL. No se sustituyó baseline A ni se promovió
ningún flag. QA/proveedor/canary y presupuesto requieren aprobación del dueño.

Frontend instalado en este entorno carece de @ngrx/store y @angular/compiler;
helper puro sí corre, reducer spec queda sin ejecutar. No se instalaron paquetes.
Watcher web caído y Docker backend monta checkout principal, no esta rama: logs
no certifican runtime/DI de D1. Pendientes CI, bootstrap/migración double-apply en
snapshot autorizado y E2E Happy/Sad/Brute de esta rama, sin tocar sesiones ajenas.

### Resultado offline de cierre

415 PASS en16 specs exactos, ejecutados secuencialmente y sin suites completas.
Incluye58 del repositorio,84 del loop,54 del wiring chat y55 del smoke/fixtures.
El spec nuevo de reducer web no ejecutó casos por dependencias Angular/NgRx
faltantes; no se incluye en415. Se corrigieron fixtures ALS, mock del wrapper
legacy, metadata explícita de IDs y un run iniciado antes de estar disponible la
API de recuperación; las corridas finales focalizadas quedaron verdes.

`prisma generate` PASS (schema final con onUpdate:Restrict), singleton audit PASS,
`git diff --check` PASS, syntax-only de TS cambiado PASS. La auditoría zoneless
general sigue fallando por deuda preexistente:1 @Input/@Output,2 EventEmitter,
1 template legacy,3 BehaviorSubject y25 subscribe; diff D1 introduce0 de esos
patrones. No se corrigió deuda ajena ni se levantó/reinició el dev compartido.
