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
 * Create-only: never overwrites operator edits (same contract as
 * `ai-engine-apps.seed.ts`). Depends on `seedAIEngineApps` having created
 * `chat_assistant` — the vexi row is skipped with a log line when the app is
 * missing instead of inserting a dangling reference.
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
