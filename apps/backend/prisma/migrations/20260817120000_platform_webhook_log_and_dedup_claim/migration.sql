-- Bitácora de webhooks de plataforma + reclamo/confirmación en el dedup.
--
-- DATA IMPACT:
-- Tables affected: platform_webhook_log (tabla NUEVA), webhook_event_dedup
--   (una columna nullable). Ninguna otra tabla se lee ni se escribe.
-- Types created: NINGUNO. No hay `ALTER TYPE ... ADD VALUE` en esta migración.
-- Columns added (1 sobre tabla existente) — nullable, SIN DEFAULT:
--   webhook_event_dedup (1):
--     - processed_at                      TIMESTAMP(6)  NULL
-- Expected row changes: NINGUNO. Cero INSERT, cero UPDATE, cero DELETE. Las
--   filas históricas de `webhook_event_dedup` nacen con `processed_at = NULL`.
--   Ver el bloque «BACKFILL DELIBERADAMENTE OMITIDO» más abajo: es una decisión,
--   no un olvido.
-- Destructive operations: none. Sin DROP TABLE, sin DROP COLUMN, sin TRUNCATE,
--   sin CASCADE, sin DELETE ni UPDATE (ni con WHERE ni sin él).
-- FK/cascade risk: none. `platform_webhook_log` NO tiene ninguna FK, a
--   propósito: es una bitácora forense y debe poder registrar un evento cuya
--   suscripción, factura o tienda no exista, esté mal referenciada o se borre
--   después. Una FK aquí convertiría «no pude identificar el evento» en «no
--   pude registrar el evento», que es exactamente el fallo que esta tabla viene
--   a cerrar.
-- Lock risk: mínimo. `CREATE TABLE` no toca nada existente. El `ADD COLUMN`
--   nullable sin DEFAULT es metadata-only en Postgres 11+ (no reescribe la
--   tabla), y `webhook_event_dedup` es además una tabla pequeña de alta
--   rotación. Los índices se crean sin CONCURRENTLY a propósito: Prisma envuelve
--   cada migración en una transacción y CONCURRENTLY no puede correr dentro.
-- Idempotency: `CREATE TABLE IF NOT EXISTS`, `CREATE INDEX IF NOT EXISTS`,
--   `ADD COLUMN IF NOT EXISTS`, `COMMENT ON` reemplaza. La migración se puede
--   reproducir entera sin efectos secundarios.
-- Approval: cierre del incidente del 17/08/2026 — documentado en chat.
-- Skill: vendix-prisma-migrations (regla anti-destructiva + idempotencia).
--
-- ============================================================================
-- CONTEXTO — el agujero que esta migración cierra
-- ============================================================================
-- El 17/08/2026 Wompi aprobó un pago SaaS de $69.900 a las 14:47:00 y entregó
-- el webhook a las 14:47:48. Nginx respondió 201 con {"received":true} y el
-- evento no dejó NINGÚN rastro: ni fila en `webhook_event_dedup`, ni log útil
-- (el despliegue de las 15:57 destruyó los logs del contenedor). A las 15:45 un
-- cron anuló la factura. El cliente había pagado.
--
-- La causa raíz del ACK vacío NO se pudo probar: la evidencia ya no existía.
-- Y no existía por dos razones que esta migración ataca por separado:
--
--   1. El controlador tenía CUATRO caminos que responden ACK sin persistir
--      nada — el flag apagado, la firma inválida, el error de proceso y el
--      camino feliz. Ninguno dejaba rastro fuera del stdout del contenedor, que
--      es exactamente lo que un despliegue borra.
--      ⇒ `platform_webhook_log`, escrita ANTES del negocio y en su propia
--        conexión, en los cuatro caminos.
--
--   2. El INSERT del dedup era el paso 1 DENTRO de la transacción de negocio.
--      Cualquier throw posterior hacía rollback y se llevaba por delante la
--      única prueba de que el evento había llegado. Esa es la hipótesis que
--      explica que fallaran a la vez el webhook y el reconciliador, ambos sin
--      dejar rastro.
--      ⇒ `webhook_event_dedup.processed_at`: la fila pasa a ser un RECLAMO
--        («llegó») que se sella aparte cuando el negocio confirma («terminó»).
--
-- ============================================================================
-- BACKFILL DELIBERADAMENTE OMITIDO
-- ============================================================================
-- Toda fila preexistente de `webhook_event_dedup` queda con `processed_at`
-- NULL, y la nueva lectura interpreta NULL como «intento previo que no terminó
-- ⇒ reprocesar». En teoría eso abre la puerta a que una reentrega de Wompi de
-- un evento YA procesado antes de esta migración vuelva a entrar al camino de
-- negocio.
--
-- No se hace `UPDATE ... SET processed_at = received_at` por dos razones:
--
--   · Es una mutación de datos productivos y las reglas del repo exigen
--     aprobación explícita + snapshot para eso. Esta migración es aditiva pura
--     justamente para poder desplegarse sin ese ritual.
--   · Es innecesaria: reprocesar es seguro por construcción. Tanto
--     `markPaymentSucceededFromWebhook` como `markPaymentFailedFromWebhook`
--     cortan en estados terminales (succeeded/failed/refunded) — la defensa en
--     profundidad que `SubscriptionWebhookService` ya documenta como invariante
--     para impedir que una reentrega promueva dos veces una `partner_commission`.
--     Un reproceso de un evento viejo entra, ve el pago terminal, y sale sin
--     escribir. Lo único que cambia es que ahora queda constancia de que entró.
--
-- Si en algún momento se quiere cerrar también la ventana teórica, el backfill
-- es un `UPDATE webhook_event_dedup SET processed_at = received_at WHERE
-- processed_at IS NULL AND received_at < '<fecha del deploy>'` — con WHERE, en
-- su propia migración, y con la aprobación que corresponde.

-- ============================================================================
-- 1. platform_webhook_log — bitácora forense del endpoint de plataforma
-- ============================================================================
-- Sin FK (ver «FK/cascade risk») y sin NOT NULL más allá de lo que el
-- controlador SIEMPRE conoce: quién es el procesador y cómo terminó el turno.
-- Todo lo demás (`event_type`, `reference`, `transaction_id`, `status`) sale del
-- cuerpo entregado y por definición puede faltar o venir basura — un cuerpo
-- irreconocible es precisamente el caso que hay que poder registrar.

CREATE TABLE IF NOT EXISTS "platform_webhook_log" (
  "id"                SERIAL       NOT NULL,
  "processor"         VARCHAR(64)  NOT NULL,
  "event_type"        VARCHAR(128),
  "reference"         VARCHAR(255),
  "transaction_id"    VARCHAR(255),
  "status"            VARCHAR(64),
  "signature_valid"   BOOLEAN,
  "validation_reason" VARCHAR(64),
  "outcome"           VARCHAR(32)  NOT NULL,
  "error_message"     TEXT,
  "raw_body"          JSONB,
  "received_at"       TIMESTAMP(6) NOT NULL DEFAULT NOW(),
  "processed_at"      TIMESTAMP(6),

  CONSTRAINT "platform_webhook_log_pkey" PRIMARY KEY ("id")
);

-- ============================================================================
-- 2. Índices de la bitácora
-- ============================================================================
-- (processor, transaction_id): la pregunta forense número uno es «¿llegó el
--   webhook de ESTA transacción de Wompi?». Sin índice esa consulta es un seq
--   scan sobre una tabla que crece con cada entrega y cada reintento.
-- (received_at DESC): la pregunta número dos es «¿qué entró en la ventana de
--   las 14:47?». El DESC importa porque toda inspección se hace desde lo más
--   reciente hacia atrás.

CREATE INDEX IF NOT EXISTS "platform_webhook_log_processor_transaction_id_idx"
  ON "platform_webhook_log" ("processor", "transaction_id");

CREATE INDEX IF NOT EXISTS "platform_webhook_log_received_at_idx"
  ON "platform_webhook_log" ("received_at" DESC);

-- ============================================================================
-- 3. webhook_event_dedup.processed_at — separar «llegó» de «terminó»
-- ============================================================================

ALTER TABLE "webhook_event_dedup"
  ADD COLUMN IF NOT EXISTS "processed_at" TIMESTAMP(6);

-- ============================================================================
-- 4. Comentarios en la propia base
-- ============================================================================
-- Para el próximo que abra psql a las 3 de la mañana sin el repo al lado, y
-- sobre todo para que nadie vuelva a leer «la fila existe» como «ya se procesó».

COMMENT ON COLUMN "webhook_event_dedup"."processed_at" IS
  'NULL = el evento LLEGO pero el negocio no termino (o el productor no usa confirmacion). NOT NULL = llego y termino. La fila sola NO significa procesado: es un RECLAMO que debe sobrevivir al rollback porque es la unica evidencia de que el evento existio. Solo processor=wompi_platform con event_type=transaction.updated lee esta columna para decidir duplicado; chargeback y wompi_sync conservan la semantica vieja (la fila sola ya descarta) a proposito, ver subscription-webhook.service.ts.';

COMMENT ON TABLE "platform_webhook_log" IS
  'Bitacora forense de TODO webhook de plataforma (SaaS) que toca POST /platform/webhooks/wompi, termine como termine. Se escribe ANTES de la transaccion de negocio y en su propia conexion, para que sobreviva a un rollback; se escribe en los cuatro caminos de ACK, incluido SAAS_WEBHOOK_ENABLED=false; y que falle nunca puede tumbar el ACK. outcome: processed | acked_invalid | acked_error | acked_disabled. OJO al leerla: el camino que procesa nace pesimista (outcome=acked_error, processed_at NULL) y solo se sella a processed cuando el negocio confirma, asi que el outcome solo es DEFINITIVO cuando processed_at NOT NULL; una fila acked_error con processed_at NULL significa "entro y nunca se supo que saliera". raw_body va saneado (payment_method.extra y checksum de firma redactados): nunca PAN, CVV ni tokens.';
