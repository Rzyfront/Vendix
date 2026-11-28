import { ai_model_type_enum } from '@prisma/client';

/**
 * Engine applications that only exist so super admin can see and configure
 * them (Motor de IA › Aplicaciones). All three are seeded INACTIVE and WITHOUT
 * a config: without `config_id` they stay off (their services never fall back
 * to the engine's default config), so a deploy changes nothing until someone
 * picks a model and flips the switch.
 *
 * This file must not import anything from `src/`: seeds run with tsx inside
 * the production image, which only copies a few `src/` files (see #1438).
 * `agent-guardrail.application.spec.ts` checks these defaults against the
 * services that read them.
 */

/** `VexClassifierService` (`src/ai-engine/vex-classifier.service.ts`). */
export const VEX_CLASSIFIER_APPLICATION = {
  key: 'vex_classifier',
  ai_feature_category: 'text_generation',
  name: 'Clasificador de Vex',
  description:
    'Clasificador de Vex: desempata respuestas ambiguas (un «sí/dale» frente a una tarjeta, si una capacidad ya existe antes de pedirla). Solo opina; nunca cambia el texto de Vex. Apagado o sin modelo, Vex funciona igual que siempre.',
  output_format: 'json',
  model_type: 'text' as ai_model_type_enum,
  temperature: null,
  max_tokens: null,
  is_active: false,
  // Turn cap counted in HTTP POSTs (retries and repairs included).
  rate_limit: { max_calls_per_turn: 3 },
  // `timeout_ms` bounds one POST, `total_timeout_ms` the whole logical call.
  retry_config: { timeout_ms: 800, total_timeout_ms: 1200, max_retries: 1 },
  metadata: { adapter: 'auto', criteria_version: 'v1', min_confidence: 0 },
  system_prompt: null,
  prompt_template: null,
};

/** Default scope of each agent, editable in `metadata.agents.<key>.scope`. */
export const AGENT_GUARDRAIL_DEFAULT_SCOPES = {
  vex: 'Vex es el asistente interno de la tienda en Vendix. Su alcance es la operación y administración de la tienda: ventas, pedidos, productos e inventario, clientes, compras y proveedores, caja, contabilidad, facturación, nómina, reportes, configuración, diseño de sus apps y páginas, y cómo usar Vendix.',
  vexi: 'Vexi atiende a los clientes de esta tienda en sus apps públicas. Su alcance es el proceso comercial de atención y venta de ESTA tienda: catálogo, productos y servicios, precios publicados, pedidos, reservas, envíos, horarios, peticiones, quejas y reclamos, y dudas comerciales.',
} as const;

/** `AgentGuardrailService` classifier (`src/ai-engine/guardrail`). */
export const AGENT_GUARDRAIL_APPLICATION = {
  key: 'agent_guardrail',
  // `conversations` + a non-chat key: the engine charges nothing by category;
  // the guardrail charges its tokens to the agent's own monthly counter.
  ai_feature_category: 'conversations',
  name: 'Guardarraíl de agentes (clasificador)',
  description:
    'Revisa cada mensaje antes de que Vex o Vexi lo respondan: si no tiene que ver con la tienda o es un abuso (sacar instrucciones internas, ofensas, spam), no se llama al modelo principal. Usa un modelo barato y rápido. Apagado, sin modelo o si falla, el chat sigue normal.',
  output_format: 'json',
  model_type: 'text' as ai_model_type_enum,
  temperature: 0,
  max_tokens: 60,
  is_active: false,
  rate_limit: null,
  // `maxRetries` is the engine's own retry; `timeout_ms` is the guardrail's
  // whole budget (past it the turn goes on normally).
  retry_config: { maxRetries: 0, timeout_ms: 1500 },
  metadata: {
    min_confidence: 0.6,
    strikes_before_cooldown: 3,
    cooldown_seconds: 600,
    strike_ttl_seconds: 3600,
    context_messages: 4,
    public_rate_penalty: 1,
    agents: {
      vex: { enabled: true, scope: AGENT_GUARDRAIL_DEFAULT_SCOPES.vex },
      vexi: { enabled: true, scope: AGENT_GUARDRAIL_DEFAULT_SCOPES.vexi },
    },
  },
  system_prompt: null,
  prompt_template: null,
};

/** Default replies when the responder is off, slow or invalid. */
export const AGENT_GUARDRAIL_DEFAULT_TEMPLATES = {
  vex: {
    off_topic:
      'Eso se sale de lo que puedo hacer por ti. Te ayudo con tu tienda: ventas, productos, inventario, clientes, reportes o la configuración de Vendix. ¿Qué necesitas?',
    abuse:
      'Con eso no te puedo ayudar. Si necesitas algo de tu tienda en Vendix, aquí estoy.',
    cooldown:
      'Vamos a hacer una pausa de unos minutos en este chat. Cuando vuelvas, te ayudo con lo que necesites de tu tienda.',
  },
  vexi: {
    off_topic:
      'Eso no lo manejo, pero con gusto te ayudo con nuestros productos, pedidos, reservas o cualquier duda sobre la tienda. ¿Qué estás buscando?',
    abuse:
      'Con eso no te puedo ayudar. Si quieres, te cuento sobre nuestros productos, pedidos o reservas.',
    cooldown:
      'Vamos a hacer una pausa de unos minutos. Después con gusto te ayudo con productos, pedidos o reservas de la tienda.',
  },
} as const;

/** `AgentGuardrailService` responder: short redirect in the agent's tone. */
export const AGENT_GUARDRAIL_RESPONDER_APPLICATION = {
  key: 'agent_guardrail_responder',
  ai_feature_category: 'conversations',
  name: 'Guardarraíl de agentes (respuesta)',
  description:
    'Escribe la respuesta breve y amable a quien usa el chat para algo ajeno a la tienda, llevándolo a lo que el agente sí hace. Nunca ve el mensaje original ni revela reglas internas. Apagado o sin modelo, se usa un texto fijo.',
  output_format: 'text',
  model_type: 'text' as ai_model_type_enum,
  temperature: 0.5,
  max_tokens: 120,
  is_active: false,
  rate_limit: null,
  retry_config: { maxRetries: 0, timeout_ms: 1500 },
  metadata: {
    max_chars: 400,
    templates: AGENT_GUARDRAIL_DEFAULT_TEMPLATES,
  },
  system_prompt: null,
  prompt_template: null,
};

export const AGENT_SETTINGS_ONLY_APPLICATIONS = [
  VEX_CLASSIFIER_APPLICATION,
  AGENT_GUARDRAIL_APPLICATION,
  AGENT_GUARDRAIL_RESPONDER_APPLICATION,
] as const;

/** Never auto-linked to a config by the seed: no model until super admin picks one. */
export const AGENT_SETTINGS_ONLY_APP_KEYS: ReadonlySet<string> = new Set(
  AGENT_SETTINGS_ONLY_APPLICATIONS.map((app) => app.key),
);
