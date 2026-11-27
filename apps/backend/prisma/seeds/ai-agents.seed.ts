import { PrismaClient } from '@prisma/client';
import { getPrismaClient } from './shared/client';
import {
  VEXI_AGENT_KEY,
  VEXI_INTERNAL_DENIED_TOOLS,
  VEXI_PUBLIC_TOOL_CATALOG,
} from '../../src/ai-engine/tools/agent-tool-catalog';

export interface SeedAIAgentsResult {
  agentsCreated: number;
  agentsSkipped: number;
  /** Existing rows whose code-owned tool scope was reconciled (Vexi). */
  agentsReconciled: number;
}

/**
 * AI Agents Seed (F4)
 *
 * Seeds the configurable agent catalog. `key = 'vexi'` is Vexi itself as one
 * more row: `app_key = 'chat_assistant'`, no own `system_prompt` (the prompt
 * lives in the `chat_assistant` application row) and no custom iteration
 * budget. Since Vexi público F1 its tool scope is CLOSED (see
 * `src/ai-engine/tools/agent-tool-catalog.ts`): `allowed_tools` is its public
 * catalog (order, booking, request proposals) and `denied_tools` every
 * internal tool/domain. Those two columns are code-owned for Vexi, so they are
 * the only fields reconciled on an existing row (idempotent: written only when
 * they differ). Any other operator edit is preserved.
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
        'Asistente público de Vendix: ayuda al cliente final a armar pedidos, agendar citas y registrar peticiones. Sin acceso a herramientas internas del negocio',
      app_key: 'chat_assistant',
      system_prompt: null,
      allowed_tools: [...VEXI_PUBLIC_TOOL_CATALOG],
      denied_tools: [...VEXI_INTERNAL_DENIED_TOOLS],
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
  let agentsReconciled = 0;

  for (const agent of agents) {
    const existing = await client.ai_agents.findUnique({
      where: { key: agent.key },
    });

    if (existing) {
      if (
        agent.key === VEXI_AGENT_KEY &&
        (!sameList(existing.allowed_tools, agent.allowed_tools) ||
          !sameList(existing.denied_tools, agent.denied_tools))
      ) {
        await client.ai_agents.update({
          where: { key: VEXI_AGENT_KEY },
          data: {
            allowed_tools: agent.allowed_tools,
            denied_tools: agent.denied_tools,
            updated_at: new Date(),
          },
        });
        agentsReconciled++;
        continue;
      }
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
    `    AI agents: ${agentsCreated} created, ${agentsReconciled} reconciled, ${agentsSkipped} skipped`,
  );
  return { agentsCreated, agentsSkipped, agentsReconciled };
}

/** Order-insensitive equality: the seed must not rewrite an equal list. */
function sameList(current: readonly string[] | null, wanted: readonly string[]) {
  const a = [...(current ?? [])].sort();
  const b = [...wanted].sort();
  return a.length === b.length && a.every((value, i) => value === b[i]);
}
