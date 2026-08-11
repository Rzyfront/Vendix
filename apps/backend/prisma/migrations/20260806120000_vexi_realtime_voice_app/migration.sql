-- Migration: crea la aplicación de IA que gobierna la persona hablada de Vexi
--
-- DATA IMPACT:
--   Tabla mutada:  ai_engine_applications (INSERT de 1 fila)
--   Sentencia:     INSERT ... ON CONFLICT (key) DO NOTHING
--   Filas:         exactamente 1 en entornos donde la fila no existe; 0 en
--                  reejecuciones. Verificar después del deploy con
--                    SELECT count(*) FROM ai_engine_applications
--                    WHERE key = 'vexi_realtime_voice';
--                  Debe devolver 1.
--   Reversible:    SÍ — DELETE FROM ai_engine_applications
--                  WHERE key = 'vexi_realtime_voice'; La fila es configuración
--                  nueva, no tiene dependientes y el código cae al
--                  comportamiento anterior cuando falta (ver más abajo).
--   Sin DELETE, sin UPDATE, sin DROP, sin CASCADE, sin TRUNCATE. No se toca
--   ninguna fila existente, así que ninguna FK entrante se ve afectada.
--   Es una tabla de configuración global, no de negocio.
--
-- Por qué migración y no solo seed:
--   `ai-engine-apps.seed.ts` es create-only y documenta que no reconcilia
--   instalaciones existentes. En dev y en producción la tabla ya está poblada,
--   así que editar el seed no crearía nada: solo aplica a instalaciones nuevas.
--   Esta migración es el único camino que efectivamente crea la fila en los
--   entornos ya desplegados. Ambos artefactos están sincronizados a mano — si
--   editas uno, edita el otro o divergen en silencio.
--
-- Qué desbloquea:
--   `VexiRealtimeService.resolveVoiceSetup()` busca esta fila por `key` para
--   obtener (a) el `system_prompt` que se envía como `instructions` de la
--   sesión de voz y (b) vía `config_id`, la configuración de transporte de
--   audio. Hasta ahora las instrucciones estaban hardcoded en el bundle del
--   navegador y no había forma de editarlas sin un deploy.
--
-- `config_id` queda deliberadamente en NULL:
--   Enlazar esta aplicación a una configuración con `model_type = 'audio'` es
--   una decisión de operador que se toma desde Super Admin → AI Engine →
--   Aplicaciones. Mientras siga en NULL, el servicio cae al comportamiento
--   anterior (busca cualquier config activa de audio) y la voz sigue
--   funcionando igual que antes de esta migración.

INSERT INTO "ai_engine_applications" (
  "key",
  "name",
  "description",
  "output_format",
  "model_type",
  "is_active",
  "ai_feature_category",
  "system_prompt",
  "created_at",
  "updated_at"
)
VALUES (
  'vexi_realtime_voice',
  'Vexi — Voz en tiempo real',
  'Persona hablada de Vexi para las sesiones de voz realtime (WebRTC)',
  'text',
  'audio'::"ai_model_type_enum",
  true,
  'realtime_voice',
  'Eres Vexi, el asistente de Vendix. Ayudas al propietario y al administrador a consultar su negocio. Responde en español, breve y concreto. Usa las herramientas disponibles para responder con datos reales; nunca inventes cifras.',
  NOW(),
  NOW()
)
ON CONFLICT ("key") DO NOTHING;
