-- DATA IMPACT:
-- Tablas afectadas: ai_engine_applications (1 fila: key = 'vexi_voice_tts')
-- Cambio esperado: agrega metadata.speech.vol = 1.5 si la clave NO existe todavia
-- Operaciones destructivas: ninguna. No hay DELETE, DROP, TRUNCATE ni CASCADE.
-- Riesgo FK/cascada: ninguno. Solo se reescribe una columna jsonb de una fila.
-- Idempotencia: guardada por `NOT ... ? 'vol'`; reejecutar reporta UPDATE 0.
-- Aprobacion: plan aprobado en chat con "ejecuta"; el paso 0 pide subir el volumen y el
--             usuario fijo el valor en 1.5 (+50%) sobre el default del proveedor.
--
-- POR QUE HACE FALTA UNA MIGRACION Y NO ALCANZA LA SEMILLA
-- `ai-engine-apps.seed.ts` es create-only: salta cualquier aplicacion que ya
-- exista, asi que el `vol: 1.5` que se agrego alli solo aplica a un entorno
-- nuevo. La fila de dev y la de produccion ya existen desde
-- 20260806140000_vexi_voice_pipeline_apps y no la veria nunca.
--
-- POR QUE SE RESPETA UN VALOR YA PRESENTE
-- El campo es editable desde Super Admin -> AI Engine -> Aplicaciones. Si un
-- operador ya eligio un volumen, esta migracion no debe pisarlo: el default de
-- la plataforma solo tiene derecho a rellenar lo que nadie decidio. Es la misma
-- regla que el `AND "config_id" IS NULL` de la migracion que sembro la fila.
--
-- EFECTO COLATERAL DESEADO EN LA CACHE
-- `vol` es parte de `SpeechCacheParams` y de la clave de sintesis, asi que subir
-- el volumen invalida las entradas viejas por construccion. Sin eso, el banco de
-- muletillas —que vive en el tier `pinned`, que nunca se desaloja— habria
-- quedado sintetizado al volumen anterior para siempre y cada turno abriria bajo
-- y seguiria alto.

UPDATE "ai_engine_applications"
SET
  "metadata" = jsonb_set(
    -- `metadata` puede ser NULL y `speech` puede faltar: se normalizan las dos
    -- ausencias antes de escribir, o `jsonb_set` devolveria NULL y borraria la
    -- voz y el formato que ya estaban configurados.
    COALESCE("metadata", '{}'::jsonb),
    '{speech,vol}',
    '1.5'::jsonb,
    true
  ),
  "updated_at" = NOW()
WHERE
  "key" = 'vexi_voice_tts'
  AND NOT (COALESCE("metadata" -> 'speech', '{}'::jsonb) ? 'vol');
