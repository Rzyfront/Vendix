-- =====================================================
-- Vex: registro del agente en el AI Engine
-- =====================================================
-- DATA IMPACT: 0 filas modificadas; 2 filas insertadas
-- - Tablas afectadas:
--     ai_agents              ADD COLUMN denied_tools + INSERT 1 fila (vex)
--     ai_engine_applications INSERT 1 fila (vex_assistant)
-- - Cambios de filas esperados: 0 UPDATE, 0 DELETE, 2 INSERT (solo si las
--   claves no existen). Re-ejecución -> 0 filas (ON CONFLICT DO NOTHING +
--   ADD COLUMN IF NOT EXISTS).
-- - La columna nueva es NOT NULL con DEFAULT '{}': las filas existentes
--   (vexi) quedan con denied_tools vacío = sin exclusiones = comportamiento
--   idéntico al de hoy. Ningún valor existente cambia.
-- - Operaciones destructivas: NINGUNA. Sin DELETE / TRUNCATE / DROP / CASCADE.
--   No hay UPDATE sin WHERE (no hay ningún UPDATE).
-- - FK/cascade risk: ninguno. `app_key` no es FK a propósito (se valida en
--   servicio con AI_APP_001); la columna nueva no referencia nada.
-- - Idempotencia:
--     * ADD COLUMN IF NOT EXISTS.
--     * INSERT ... ON CONFLICT (key) DO NOTHING en ambas tablas: jamás
--       sobrescribe ediciones de operador (prompt, modelo, max_tokens).
-- - Approval: plan docs/plans/vex-agent-plan.md, paso 1
-- - Reversibility: SÍ —
--     DELETE FROM ai_agents WHERE key = 'vex';
--     DELETE FROM ai_engine_applications WHERE key = 'vex_assistant';
--     ALTER TABLE ai_agents DROP COLUMN IF EXISTS denied_tools;
--   (Solo si ningún turno de Vex corrió sobre esas filas; las conversaciones
--   existentes no referencian al agente por FK.)
-- =====================================================
--
-- Por qué el prompt vive en la APLICACIÓN y el agente lleva system_prompt NULL:
-- `AIChatService.resolveAgentLoopArgs()` ignora el prompt propio del agente
-- cuando la fila (o la conversación) enlaza una app ("the app owns the prompt
-- and system_prompt is ignored"). Vexi usa el mismo patrón: prompt en
-- `chat_assistant`, agente `vexi` con system_prompt NULL. Superadmin edita el
-- prompt de Vex en AI Engine -> Aplicaciones -> vex_assistant.
--
-- Vex system prompt v1 (2026-10-01). Los {{placeholders}} los interpola el
-- engine con el snapshot del turno (mismo snapshot de Vexi sin `ui_context`).

BEGIN;

-- Columna de exclusión de herramientas por agente (paso 1 del plan).
ALTER TABLE "ai_agents"
  ADD COLUMN IF NOT EXISTS "denied_tools" TEXT[] NOT NULL DEFAULT '{}';

-- Aplicación del agente: acá viven prompt, modelo, max_tokens y temperatura,
-- editables desde superadmin sin deploy.
INSERT INTO "ai_engine_applications" (
  "key",
  "name",
  "description",
  "output_format",
  "model_type",
  "temperature",
  "max_tokens",
  "is_active",
  "ai_feature_category",
  "config_id",
  "system_prompt",
  "prompt_template",
  "metadata",
  "created_at",
  "updated_at"
)
VALUES (
  'vex_assistant',
  'Vex — Gestor integral del negocio',
  'Agente Vex: opera todo el negocio de la tienda (ventas, cotizaciones, facturación, contabilidad, inventario, nómina, reportes) desde un chat a pantalla completa, con bloques UI manipulables',
  'markdown',
  'text'::"ai_model_type_enum",
  0.7,
  4096,
  true,
  'conversations',
  NULL,
  $vexprompt$Eres Vex, el gestor integral del negocio en Vendix: el agente más potente del comercio, que opera ventas, cotizaciones, facturación electrónica DIAN, contabilidad, inventario, nómina, caja, cartera y reportes desde esta conversación.

Respondes SIEMPRE en español. Tuteas siempre. Hablas claro y directo, con el rigor de un gerente: no exageras, no adulas y no prometes lo que no puedes hacer.

## Con quién hablas
Solo el dueño o un administrador del comercio pueden usarte. Actúas con la sesión y los permisos de esa persona: lo que ella puede ver o hacer en Vendix, tú también; lo que ella no puede, tú tampoco. Cuando choques con ese límite, dilo con claridad en vez de rodearlo.

## Alcance: esta tienda
Solo operas sobre la tienda de la conversación activa. Nunca mezcles datos de otras tiendas ni supongas que existen. Si te piden algo de otra tienda, dilo y sigue con esta.

## Contexto del comercio
{{store_profile}}

Métricas del negocio:
{{business_metrics}}

Quién te usa:
{{user_identity}}

Fecha y hora actual (zona horaria de la tienda):
{{current_datetime}}

## Cómo trabajas
Antes de escribir cualquier cosa (crear, actualizar, enviar, anular, borrar), formula tu plan completo: qué vas a hacer, en qué orden y qué va a cambiar en cada paso. Presentas el plan entero de una vez para una sola aprobación; lo irreversible (facturas DIAN, pagos y reembolsos, nómina, cierres, anulaciones, borrados) siempre pide su propia confirmación aunque el plan esté aprobado.
Encadena lecturas y verificaciones sin detenerte. Si la persona cambia la tarea a mitad de camino, ajusta y sigue; lo ya aplicado no se reescribe.
No navegas pantallas ni das instrucciones de clics: no tienes comandos de interfaz. Todo lo haces con herramientas de negocio sobre los datos reales.

## Cómo muestras datos
Cuando la respuesta incluye datos tabulares, comparativas, evoluciones o resúmenes numéricos, no los pegues como texto plano: muéstralos con las herramientas `vex_render_*` (tabla, gráfico, KPI, imagen o archivo) para que la persona los vea y siga trabajando sobre ellos. El texto acompaña al bloque, no lo reemplaza.

## Cifras
Nunca inventas cifras: todo número que afirmes viene de una herramienta que acabas de ejecutar en este turno. Si un dato no se pudo leer, dilo y no lo estimes. Los montos usan la moneda de la tienda.$vexprompt$,
  NULL,
  '{"agent_enabled": true}'::jsonb,
  NOW(),
  NOW()
)
ON CONFLICT ("key") DO NOTHING;

-- El agente: 40 iteraciones para planes largos, sin comandos de interfaz
-- (las 25 `ui_*` de `ui.tools.ts`, mismo orden del spec G10).
INSERT INTO "ai_agents" (
  "key",
  "name",
  "description",
  "app_key",
  "system_prompt",
  "allowed_tools",
  "denied_tools",
  "max_iterations",
  "requires_confirmation_default",
  "is_active",
  "created_at",
  "updated_at"
)
VALUES (
  'vex',
  'Vex',
  'Gestor integral del negocio: opera ventas, cotizaciones, facturación, contabilidad, inventario, nómina y reportes de la tienda desde un chat a pantalla completa',
  'vex_assistant',
  NULL,
  '{}',
  ARRAY[
    'ui_list_modules',
    'ui_explain_module',
    'ui_why_hidden',
    'ui_navigate',
    'ui_pos_add_item',
    'ui_pos_remove_item',
    'ui_pos_set_customer',
    'ui_pos_read_cart',
    'ui_pos_checkout',
    'ui_refresh',
    'ui_read_screen',
    'ui_list_actions',
    'ui_fill_form',
    'ui_set_filter',
    'ui_export',
    'ui_click_action',
    'ui_open_modal',
    'ui_wait_for',
    'ui_list_tours',
    'ui_start_tour',
    'ui_reset_tour',
    'ui_close_modal',
    'ui_confirm_dialog',
    'ui_read_selection',
    'ui_explain_screen'
  ],
  40,
  false,
  true,
  NOW(),
  NOW()
)
ON CONFLICT ("key") DO NOTHING;

COMMIT;
