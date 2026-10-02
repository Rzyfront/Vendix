import { PrismaClient } from '@prisma/client';
import { getPrismaClient } from './shared/client';

export interface SeedAIAgentsResult {
  agentsCreated: number;
  agentsSkipped: number;
}

/**
 * AI Agents Seed (F4)
 *
 * Seeds the configurable agent catalog. `key = 'vexi'` is Vexi itself as one
 * more row: `app_key = 'chat_assistant'`, no own `system_prompt` (the prompt
 * lives in the `chat_assistant` application row), no extra tool filter and no
 * custom iteration budget — exactly the turn behavior of today. Conversations
 * without `agent_key` keep that behavior through the fallback path, so this
 * seed documents the default rather than changing it.
 *
 * `key = 'vex'` is Vex, the whole-business manager: `app_key =
 * 'vex_assistant'` (prompt v1 versioned in migration
 * `20261001120000_vex_agent_registration`, owned by the app row —
 * `system_prompt` stays null like vexi), `max_iterations = 40` for long plans
 * and `denied_tools` with all 25 `ui_*` (Vex has no screen to drive).
 *
 * Create-only: never overwrites operator edits (same contract as
 * `ai-engine-apps.seed.ts`). Depends on `seedAIEngineApps` having created
 * `chat_assistant` — the vexi row is skipped with a log line when the app is
 * missing instead of inserting a dangling reference. The vex row likewise
 * requires `vex_assistant` (inserted by its migration in every environment).
 */
export async function seedAIAgents(
  prisma?: PrismaClient,
): Promise<SeedAIAgentsResult> {
  const client = prisma || getPrismaClient();
  console.log('  Seeding AI agents...');

  const agents = [
    {
      key: 'vexi',
      name: 'Vexi',
      description:
        'Asistente empresarial de Vendix: agente conversacional por defecto con herramientas de negocio y comandos de interfaz',
      app_key: 'chat_assistant',
      system_prompt: null,
      allowed_tools: [],
      max_iterations: null,
      requires_confirmation_default: false,
      is_active: true,
    },
    {
      key: 'vex',
      name: 'Vex',
      description:
        'Gestor integral del negocio: opera ventas, cotizaciones, facturación, contabilidad, inventario, nómina y reportes de la tienda desde un chat a pantalla completa',
      app_key: 'vex_assistant',
      system_prompt: null,
      allowed_tools: [],
      // Las 25 ui_* de ui.tools.ts (mismo orden del spec G10) — ver también
      // la migración 20261001120000_vex_agent_registration. Si se agrega una
      // ui_* nueva, agregarla acá y en una migración correctiva.
      denied_tools: [
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
        'ui_explain_screen',
      ],
      max_iterations: 40,
      requires_confirmation_default: false,
      is_active: true,
    },
  ];

  let agentsCreated = 0;
  let agentsSkipped = 0;

  for (const agent of agents) {
    const existing = await client.ai_agents.findUnique({
      where: { key: agent.key },
    });

    if (existing) {
      agentsSkipped++;
      continue;
    }

    if (agent.app_key) {
      const app = await client.ai_engine_applications.findUnique({
        where: { key: agent.app_key },
        select: { id: true },
      });
      if (!app) {
        console.log(
          `    Skipped agent '${agent.key}' (app '${agent.app_key}' not seeded yet)`,
        );
        agentsSkipped++;
        continue;
      }
    }

    await client.ai_agents.create({ data: agent });
    agentsCreated++;
  }

  console.log(
    `    AI agents: ${agentsCreated} created, ${agentsSkipped} skipped`,
  );
  return { agentsCreated, agentsSkipped };
}
