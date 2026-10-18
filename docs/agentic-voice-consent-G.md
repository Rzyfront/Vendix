# Fase G — voz con propuesta exacta y consentimiento dedicado

Implementación offline, **no habilitada ni certificada en producción**. Fase G del
plan aprobado; A/D0/B/D1/C/D2/H preexistentes. No se implementan E ni F.

## Activación y límites

- `AI_VOICE_CONFIRM_ENABLED` sólo habilita con literal `true`; default OFF.
  Spoken apply requiere además D1 `AI_DURABLE_OBJECTIVES_ENABLED` y D2
  `AI_AGENT_ROBUST_EXECUTION_ENABLED`. No se habilitan automáticamente.
- No se cambiaron proveedor/modelo/configuración, DB, prompts de aplicaciones ni
  variables de entorno. Ninguna migración G. Rollback por flags, sin borrar datos.
- Voz no es biometría ni resistencia garantizada a replay acústico. No hay acceso
  más amplio por hablar. Clic sigue disponible y ninguna escritura se autoaprueba.
- Realtime nativo sigue usando su transporte existente y duración reportada;
  no se presenta como inferencia medida por AIEngine ni baseline de costo real.

## Circuito y autoridad

1. Identidad del JWT actual, ALS **sin fallback estático**, owner/admin,
   org/tienda y conversación propia/no archivada. Agent identity desde metadata,
   su toggle independiente, agente activo y gates de plan vigentes.
2. Compartir autoridad del resolver B de AIAgentService: permisos ∩ plan ∩ agent
   allowed − denies. Durante todo preview/bridge/dispatch, permisos actuales ∩
   snapshot D1 (no basta filtrar nombres). Vex conserva sus UI denies.
3. Objetivo D1 existente o `ensureForConversation` bajo lock de conversación;
   no usar createOrReplace como ensure ni crear otra memoria de procesos. Mismos
   hooks de planificación y playbooks C. Resultados se guardan en D1, no en audio.
4. Catálogo ofrecido server-side por sesión/versiones y router B. Tool fuera de
   sesión/working set o autoridad vigente se rechaza antes del handler/UI.
   Read-only no significa permiso universal. Realtime writes usan `proposalOnly`;
   incluso un token suministrado a ese modo jamás ejecuta el handler.
5. Token original Lua/canonicalJson y metadata G de preview/hash/version/tenant/
   conversación. Tokens legacy sin metadata original no se convierten en voz;
   siguen siendo utilizables en su clic existente. El registro de voz vincula
   sesión, user/org/store, agente/conversación, objetivo/step, tool/version,
   argumentos/diff canónicos y expiry. Cambio de propuesta invalida la anterior entre sesiones: fingerprint vigente
   por principal/conversación/objetivo/step incluye tool/version/args/diff/planId
   y hash del token original. Un rebind idéntico conserva esa identidad; un nuevo
   token/tarjeta no. Voz y clic reclaman atómicamente la propuesta vigente.
6. Mostrar y leer sujeto, todos los cambios/valores/cantidades, consecuencia
   irreversible y nonce. Captura PTT separada de dictado/realtime/TTS. Frase exacta
   `confirmo cambiar <sujeto/campo> codigo <nonce>`; no LLM ni “sí” genérico.
7. Audio multipart se transcribe **en servidor**. No se aceptan transcript,
   confidence, tenant, objetivo, step ni catálogo desde el body. Score desconocido,
   negación, ruido/ambigüedad, captura interrumpida/eco declarado, background,
   pérdida de foco, reconexión y expiry fallan cerrado. Una captura rechazada
   invalida su nonce, no el clic del cambio que aún es válido.
8. Revalidación de permiso/plan/estado y preview justo antes del canje Lua.
   Consentimiento atómico llama el apply existente; otro refresh de preview corre
   en el registry antes de consumir el token. Si cambió el diff, nueva propuesta.
   Una operación, no una aprobación general ni una segunda aprobación por riesgo.
9. D1 registra intent antes de dispatch y receipt después, con canal y hashes de
   consentimiento (sin audio/frase/token). D2 conserva applied != verified y
   unknown_effect exige reconciliación, jamás retry para recuperar un sonido.
   Vex usa **exactamente** `planId:step_id` como su clic; otra operationID duplicaría
   efectos. Su módulo registra resultado/card/quota con el servicio propietario.

## Transporte/API

Bajo `/store/vexi/voice/confirmations`:
- `GET capability`: disponibilidad OFF por defecto; no garantiza capacidad ASR.
- `POST session`: conversation_id, agent_key, channel; demás bindings del servidor.
- `POST challenge`: session_id + proposal_id opaco, o token/tool/arguments de una
  tarjeta textual. Vex admite sólo un paso persistido con preview original y hash
  idénticos, nunca bundle legacy. Respuesta phrase/expected_phrase, IDs, expiry,
  preview completo, consequence y action_text determinista.
- `POST transcribe`: dictado Vex con file/conversation_id/agent_key, mismos STT/chat
  y guards, sin depender de vexi.enabled ni aceptar dictado como aprobación.
- `POST consent`: file, session_id, proposal_id, challenge_id, capture JSON y speak.
  Guards actuales + gate realtime_voice **antes** de Multer/STT. Sin retries.
- `POST apply`: alternativa de **clic humano explícito** con IDs opacos. Recupera
  token privado del registro inmutable original≤60s, incluso tras cerrar la voz;
  vuelve a validar objetivo/step/autoridad/diff y usa el mismo apply. No devuelve
  secretos ni crea aprobación automática por una captura fallida.
- `POST cancel`: invalida autoridad/captura. Un cierre realtime conserva tombstone
  sólo para billing; no puede resucitar catálogo ni aceptar consentimiento.

Realtime grant añade session_id/session_expires_at y contexto del objetivo;
`tool-call` requiere session_id ON, devuelve output seguro más propuesta separada
**sin token crudo**, o ui_authorized/catalog expansion. El browser jamás devuelve
propuesta/token/nonce al proveedor. Un primer write termina el lote de voz;
hermanos quedan diferidos. Propuesta no genera audio de “aplicado”.

Una captura dedicada puede rebindear el handle a una sesión/nonce nuevos sólo
con los mismos bindings/preview y sin extender expiry original. El clic no
necesita continuar una captura cancelada. Receipts tardíos se asocian a su
conversación+propuesta, no borran otra tarjeta. Audio del acuse sólo después del
resultado observado; fallo de TTS conserva texto/estado y no reejecuta.

## ASR, expiración y cuotas

- Autoridad de sesión300s; propuesta/challenge≤60s y dentro del token300s.
  Storage3600s sólo permite cierre de billing scoped/single-use, no ejecutar.
- Transcripción dedicada pide `requireConfidence`. Compatible debe declarar
  `settings.transcription_logprobs_supported===true` explícitamente para endpoint/
  modelo existente. Sólo entonces pide JSON+include logprobs. Valida que cubran
  TODO el texto, valores finitos≤0 y score=min exp(logprob)≥0.95. Ausente/malformado
  es null→clic. No configura otro modelo ni asume soporte por nombre/host.
  [Contrato primario de transcripción](https://developers.openai.com/api/reference/resources/audio/subresources/transcriptions/methods/create).
  El umbral es un proxy conservador, **NO** aceptación acústica medida/calibrada.
- Lecturas exitosas observadas comparten unidad de cuota comercial y dedupe
  actuales. Propuestas/errores/planning/unknown no cuentan como éxito. Vex aplica
  su cuota post-success del dominio propietario. Duración conserva mecanismo
  actual, clave estable por sesión y ganador de cierre único.
- Cerrar registro→consumir cuota no es transacción distribuida: crash/outage puede
  necesitar reconciliación de metering. No se promete exactamente-una-vez de
  cobro, ni medición de costo/proveedor desde esa duración. El browser detiene
  media antes de TTL, pero cliente hostil/eco requiere QA y threat review reales.
- Playbooks realtime tienen límite persistido conservador de2000 bytes estimados
  en toda la sesión (más estricto que2000 tokens por cada uno de2 procesos C),
  además de C. No es tokenizador ni estimación de facturación; si no cabe, texto.

## Verificación y promoción

Specs exactos offline, secuenciales, heap1536: Lua model sintético, DTOs, registry,
provider fake, authority+bridge reales con HTTP sintético, realtime/controller,
D1 SQL memory transport e integración core→host→apply→efecto. No certifican Lua
Redis real, PostgreSQL locks/DI/bootstrap, Angular, audio o proveedor reales.

Frontend reducer G/D1 requiere Angular/NgRx reales; si faltan paquetes no se
sustituye por mocks. Playwright audio fixtures42–50, Happy/Sad/Brute, barge-in,
reconnect, doblePOST/permiso revocado y TTS fallido después del apply siguen gate.
El corpus A permanece congelado;47/48 no eran soportados por baseline y no se
cuentan como mejora comparable. Replay sin adaptador:150 planned/0ran/150not_run,
latencia/costo/completion comparables NULL. Ceros sin runs no prueban seguridad.

Rafael debe autorizar entorno/CI de esta rama, QA acústico con>=95% aceptación
explícita limpia y100% negativos sin writes, fixtures, presupuesto para proveedor
y canary. Mantener flagsOFF. La migración B20261018100000 valida CHECK sobre filas
existentes y exige ventana de mantenimiento; G no la cambia ni la aplica.
