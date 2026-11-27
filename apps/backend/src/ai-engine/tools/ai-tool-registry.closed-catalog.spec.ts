import { RequestContextService } from '@common/context/request-context.service';
import { seedAIAgents } from '../../../prisma/seeds/ai-agents.seed';
import { AIToolRegistry } from './ai-tool-registry';
import {
  AGENT_TOOL_DENIED_EVENT,
  VEXI_AGENT_KEY,
  VEXI_INTERNAL_DENIED_TOOLS,
  VEXI_PUBLIC_TOOL_CATALOG,
  closedToolCatalog,
} from './agent-tool-catalog';
import type { RegisteredTool } from './interfaces/tool.interface';
import { collectToolCatalog } from './tool-catalog.test-helper';

/**
 * Vexi público F1 — Vexi has a closed, code-owned tool catalog.
 *
 * Runs over the REAL backend catalog (every tool factory under `src/`, the
 * same collection the T13 role gate uses), with every handler and preview
 * swapped for a spy so "never executed" is observable. The caller holds every
 * permission any tool asks for: a closed catalog must not depend on the role.
 */

const OWNER_CTX = {
  user_id: 1,
  store_id: 10,
  organization_id: 100,
  roles: ['owner'],
};

/** Stand-ins for the public wrappers F2 registers (own `storefront` domain). */
function storefrontTool(name: string): RegisteredTool {
  return {
    name,
    domain: 'storefront',
    access: 'public',
    accessReason: 'Test stand-in for a public storefront proposal.',
    description: name,
    parameters: { type: 'object', properties: {} },
    readOnly: true,
    handler: jest.fn().mockResolvedValue('{"proposal":true}'),
  };
}

function build() {
  const catalog = collectToolCatalog().map(({ tool }) => ({
    ...tool,
    handler: jest.fn().mockResolvedValue('{"ran":true}'),
    ...(tool.preview ? { preview: jest.fn() } : {}),
  })) as RegisteredTool[];
  const events = { emit: jest.fn() };
  const registry = new AIToolRegistry({} as any, events as any);
  registry.registerMany(catalog);
  // F2 registers the real storefront tools (collected above); a stand-in
  // only fills a catalog name that has no real tool yet.
  for (const name of VEXI_PUBLIC_TOOL_CATALOG)
    if (!registry.get(name)) registry.register(storefrontTool(name));
  return { registry, events, allPermissions: ALL_PERMISSIONS, catalog };
}

/** Vexi's scope exactly as the seed writes it. */
const VEXI_SCOPE = {
  agent_key: VEXI_AGENT_KEY,
  allowed_tools: [...VEXI_PUBLIC_TOOL_CATALOG],
  denied_tools: [...VEXI_INTERNAL_DENIED_TOOLS],
};

const names = (defs: { function: { name: string } }[]) =>
  defs.map((d) => d.function.name).sort();

const ALL_PERMISSIONS = [
  ...new Set(
    collectToolCatalog().flatMap(({ tool }) => tool.requiredPermissions ?? []),
  ),
];

const run = <T>(fn: () => Promise<T>) =>
  RequestContextService.asyncLocalStorage.run(
    { ...OWNER_CTX, permissions: ALL_PERMISSIONS } as any,
    fn,
  );

describe('Vexi closed tool catalog (F1)', () => {
  it('vexi is a closed-catalog agent; vex is not', () => {
    expect(closedToolCatalog('vexi')).not.toBeNull();
    expect(closedToolCatalog('vex')).toBeNull();
    expect(closedToolCatalog(undefined)).toBeNull();
    expect(closedToolCatalog('toString')).toBeNull();
  });

  describe('catalog (what the model is offered)', () => {
    it('(c) Vexi sees exactly its public capabilities, even with every permission', () => {
      const { registry, allPermissions } = build();
      expect(
        names(registry.getAgentDefinitions(allPermissions, VEXI_SCOPE)),
      ).toEqual([...VEXI_PUBLIC_TOOL_CATALOG].sort());
    });

    it('(a) no accounting, payroll, fiscal or inventory tool appears for Vexi', () => {
      const { registry, allPermissions, catalog } = build();
      const offered = new Set(
        names(registry.getAgentDefinitions(allPermissions, VEXI_SCOPE)),
      );
      const internal = catalog.filter((t) =>
        ['accounting', 'payroll', 'fiscal', 'inventory'].includes(t.domain),
      );
      expect(internal.length).toBeGreaterThan(20);
      for (const tool of internal) expect(offered.has(tool.name)).toBe(false);
    });

    it('(b) call_endpoint, write_endpoint, run_code, run_readonly_script, bulk_prepare and ui_* never appear', () => {
      const { registry, allPermissions } = build();
      const offered = names(
        registry.getAgentDefinitions(allPermissions, VEXI_SCOPE),
      );
      for (const name of [
        'call_endpoint',
        'write_endpoint',
        'run_code',
        'run_readonly_script',
        'bulk_prepare',
        'ui_navigate',
        'ui_fill_form',
      ])
        expect(offered).not.toContain(name);
      expect(offered.some((n) => n.startsWith('ui_'))).toBe(false);
    });

    it('empty or missing allowed_tools means NO tools for Vexi, never the whole catalog', () => {
      const { registry, allPermissions } = build();
      expect(
        registry.getAgentDefinitions(allPermissions, {
          agent_key: VEXI_AGENT_KEY,
        }),
      ).toEqual([]);
      expect(
        registry.getAgentDefinitions(allPermissions, {
          agent_key: VEXI_AGENT_KEY,
          allowed_tools: [],
          denied_tools: [],
        }),
      ).toEqual([]);
    });

    it('the row can narrow the catalog but never widen it (internal names or domains in allowed_tools are ignored)', () => {
      const { registry, allPermissions } = build();
      expect(
        names(
          registry.getAgentDefinitions(allPermissions, {
            agent_key: VEXI_AGENT_KEY,
            allowed_tools: [
              'storefront_propose_order',
              'call_endpoint',
              'payroll',
              'create_order',
            ],
          }),
        ),
      ).toEqual(['storefront_propose_order']);
    });

    it('the seed denied list fences every domain of the real staff catalog', () => {
      const { catalog } = build();
      const denied = new Set(VEXI_INTERNAL_DENIED_TOOLS);
      // `storefront` (F2) is Vexi's own public domain: never denied to it.
      const uncovered = [...new Set(catalog.map((t) => t.domain))]
        .filter((d) => !denied.has(d) && d !== 'storefront')
        .sort();
      expect(uncovered).toEqual([]);
      expect(denied.has('storefront')).toBe(false);
    });
  });

  describe('execution gate (whatever the model asks for)', () => {
    it.each([
      'create_journal_entry',
      'call_endpoint',
      'write_endpoint',
      'run_code',
      'run_readonly_script',
      'bulk_prepare',
      'default_api.call_endpoint',
    ])(
      '(e) a direct call to internal "%s" as Vexi is refused with AI_AGENT_004, runs nothing and emits the denial event',
      async (toolName) => {
        const { registry, events } = build();
        const bare = toolName.replace(/^.*\./, '');
        const target = registry.get(bare);
        expect(target).toBeDefined();
        const warn = jest
          .spyOn((registry as any).logger, 'warn')
          .mockImplementation(() => undefined);

        await expect(
          run(() =>
            registry.executeTool(toolName, {}, { agentKey: VEXI_AGENT_KEY }),
          ),
        ).rejects.toMatchObject({
          response: expect.objectContaining({ error_code: 'AI_AGENT_004' }),
        });

        expect(target!.handler).not.toHaveBeenCalled();
        if (target!.preview) expect(target!.preview).not.toHaveBeenCalled();
        expect(events.emit).toHaveBeenCalledWith(
          AGENT_TOOL_DENIED_EVENT,
          expect.objectContaining({
            agent_key: 'vexi',
            tool: toolName,
            stage: 'execute',
            store_id: 10,
            user_id: 1,
          }),
        );
        expect(warn).toHaveBeenCalledWith(
          expect.stringContaining(`denied tool "${toolName}"`),
        );
      },
    );

    it('(e) through executeToolResult the refusal is a controlled result, not a crash', async () => {
      const { registry } = build();
      jest
        .spyOn((registry as any).logger, 'warn')
        .mockImplementation(() => undefined);
      const result = await run(() =>
        registry.executeToolResult(
          'create_journal_entry',
          {},
          { agentKey: VEXI_AGENT_KEY },
        ),
      );
      expect(result).toMatchObject({ error_code: 'AI_AGENT_004' });
      expect(registry.get('create_journal_entry')!.handler).not.toHaveBeenCalled();
    });

    it('an invented tool name is refused without suggesting internal tool names', async () => {
      const { registry } = build();
      jest
        .spyOn((registry as any).logger, 'warn')
        .mockImplementation(() => undefined);
      const error = await run(() =>
        registry.executeTool('list_payroll_runs_x', {}, {
          agentKey: VEXI_AGENT_KEY,
        }),
      ).catch((e) => e);
      expect(error.response).toMatchObject({ error_code: 'AI_AGENT_004' });
      // The open path would answer AI_AGENT_003 with the closest real names.
      expect(error.response.message).not.toMatch(/se le parecen/);
      expect(error.response.message).not.toMatch(/list_payroll_runs[^_]/);
    });

    it('(c) the public capabilities execute for Vexi', async () => {
      const { registry, events } = build();
      // Minimal valid args of the real storefront tools (F2).
      const args: Record<string, Record<string, unknown>> = {
        storefront_search_products: { query: 'camiseta' },
        storefront_propose_order: { items: [{ product_id: 1, quantity: 1 }] },
        storefront_propose_booking: { product_id: 1 },
        storefront_propose_request: {
          pqr_type: 'PETITION',
          subject: 'Consulta',
          description: 'Quiero saber el horario de atención.',
        },
      };
      for (const name of VEXI_PUBLIC_TOOL_CATALOG) {
        await expect(
          run(() =>
            registry.executeTool(name, args[name] ?? {}, {
              agentKey: VEXI_AGENT_KEY,
            }),
          ),
        ).resolves.toMatch(/"(ran|proposal)":true/);
        expect(registry.get(name)!.handler).toHaveBeenCalledTimes(1);
      }
      expect(events.emit).not.toHaveBeenCalled();
    });
  });

  it('(e) recordAgentToolDenial traces a loop-level refusal for Vexi and ignores open agents', () => {
    const { registry, events } = build();
    const warn = jest
      .spyOn((registry as any).logger, 'warn')
      .mockImplementation(() => undefined);
    RequestContextService.asyncLocalStorage.run(OWNER_CTX as any, () =>
      registry.recordAgentToolDenial('call_endpoint', VEXI_AGENT_KEY, 'turn'),
    );
    registry.recordAgentToolDenial('call_endpoint', 'vex', 'turn');
    expect(events.emit).toHaveBeenCalledTimes(1);
    expect(events.emit).toHaveBeenCalledWith(
      AGENT_TOOL_DENIED_EVENT,
      expect.objectContaining({
        agent_key: 'vexi',
        tool: 'call_endpoint',
        stage: 'turn',
        store_id: 10,
      }),
    );
    expect(warn).toHaveBeenCalledTimes(1);
  });

  describe('(d) Vex keeps its current behavior', () => {
    it('Vex catalog = every permitted tool minus its denied ui_*, identical with or without agent_key', () => {
      const { registry, allPermissions } = build();
      // Vex's seeded row denies every ui_* (ai-agents.seed.ts).
      const denied = names(registry.getAgentDefinitions(allPermissions, {}))
        .filter((n) => n.startsWith('ui_'));
      const expected = names(registry.getAvailableDefinitions(allPermissions))
        .filter((n) => !n.startsWith('ui_'));
      const withoutKey = names(
        registry.getAgentDefinitions(allPermissions, { denied_tools: denied }),
      );
      const withKey = names(
        registry.getAgentDefinitions(allPermissions, {
          agent_key: 'vex',
          denied_tools: denied,
        }),
      );
      expect(withoutKey).toEqual(expected);
      expect(withKey).toEqual(expected);
      expect(withKey).toEqual(
        expect.arrayContaining([
          'call_endpoint',
          'write_endpoint',
          'run_readonly_script',
          'create_journal_entry',
        ]),
      );
    });

    it('Vex (or a call without agentKey) still executes internal tools', async () => {
      const { registry, events } = build();
      await expect(
        run(() =>
          registry.executeTool('create_journal_entry', {}, { agentKey: 'vex' }),
        ),
      ).resolves.toBeDefined();
      await expect(
        run(() => registry.executeTool('list_endpoints', {})),
      ).resolves.toBeDefined();
      expect(events.emit).not.toHaveBeenCalled();
    });
  });
});

describe('seedAIAgents — Vexi row (F1)', () => {
  function fakeClient(vexiRow: Record<string, unknown> | null) {
    const rows = new Map<string, any>([
      ['vex', { key: 'vex', allowed_tools: [], denied_tools: ['ui_navigate'] }],
    ]);
    if (vexiRow) rows.set('vexi', vexiRow);
    return {
      ai_agents: {
        findUnique: jest.fn(async ({ where }) => rows.get(where.key) ?? null),
        update: jest.fn(async ({ where, data }) => {
          rows.set(where.key, { ...rows.get(where.key), ...data });
        }),
        create: jest.fn(async ({ data }) => rows.set(data.key, data)),
      },
      ai_engine_applications: {
        findUnique: jest.fn(async () => ({ id: 1 })),
      },
      rows,
    };
  }

  beforeEach(() => jest.spyOn(console, 'log').mockImplementation(() => undefined));
  afterEach(() => jest.restoreAllMocks());

  it('creates vexi with the public catalog and the internal deny list', async () => {
    const client = fakeClient(null);
    await seedAIAgents(client as any);
    expect(client.rows.get('vexi')).toMatchObject({
      allowed_tools: [...VEXI_PUBLIC_TOOL_CATALOG],
      denied_tools: [...VEXI_INTERNAL_DENIED_TOOLS],
    });
  });

  it('reconciles an existing open vexi row, touches only its tool scope, and is idempotent', async () => {
    const client = fakeClient({
      key: 'vexi',
      name: 'Vexi editado',
      allowed_tools: [],
      denied_tools: [],
    });
    const first = await seedAIAgents(client as any);
    expect(first.agentsReconciled).toBe(1);
    expect(client.ai_agents.update).toHaveBeenCalledTimes(1);
    expect(client.ai_agents.update.mock.calls[0][0]).toMatchObject({
      where: { key: 'vexi' },
      data: {
        allowed_tools: [...VEXI_PUBLIC_TOOL_CATALOG],
        denied_tools: [...VEXI_INTERNAL_DENIED_TOOLS],
      },
    });
    expect(Object.keys(client.ai_agents.update.mock.calls[0][0].data).sort()).toEqual(
      ['allowed_tools', 'denied_tools', 'updated_at'],
    );
    expect(client.rows.get('vexi').name).toBe('Vexi editado');

    const second = await seedAIAgents(client as any);
    expect(second.agentsReconciled).toBe(0);
    expect(client.ai_agents.update).toHaveBeenCalledTimes(1);
    expect(client.ai_agents.create).not.toHaveBeenCalled();
  });

  it('never rewrites the vex row', async () => {
    const client = fakeClient(null);
    await seedAIAgents(client as any);
    expect(client.ai_agents.update).not.toHaveBeenCalled();
    expect(client.rows.get('vex').denied_tools).toEqual(['ui_navigate']);
  });
});
