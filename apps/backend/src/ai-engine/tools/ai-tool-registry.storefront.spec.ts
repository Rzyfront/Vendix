import { RequestContextService } from '@common/context/request-context.service';
import { AIToolRegistry } from './ai-tool-registry';
import {
  VEXI_AGENT_KEY,
  VEXI_INTERNAL_DENIED_TOOLS,
  VEXI_PUBLIC_TOOL_CATALOG,
} from './agent-tool-catalog';
import type { RegisteredTool } from './interfaces/tool.interface';
import { collectToolCatalog } from './tool-catalog.test-helper';

/**
 * Vexi público F2 — the storefront tools over the REAL backend catalog, from
 * the point of view of an anonymous visitor (no user, no roles, no
 * permissions), which is exactly the context `VexiPublicService` builds.
 * Links to F1: the closed catalog is what keeps internal tools out.
 */

const ANON_CTX = {
  store_id: 10,
  organization_id: 100,
  roles: [] as string[],
  permissions: [] as string[],
  is_super_admin: false,
  is_owner: false,
};
const STAFF_CTX = {
  user_id: 1,
  store_id: 10,
  organization_id: 100,
  roles: ['owner'],
  is_super_admin: false,
  is_owner: true,
};

function build() {
  const catalog = collectToolCatalog().map(({ tool }) => ({
    ...tool,
    handler: jest.fn().mockResolvedValue('{"ran":true}'),
    ...(tool.preview ? { preview: jest.fn() } : {}),
  })) as RegisteredTool[];
  const registry = new AIToolRegistry({} as any, { emit: jest.fn() } as any);
  registry.registerMany(catalog);
  return { registry, catalog };
}

const ALL_PERMISSIONS = [
  ...new Set(
    collectToolCatalog().flatMap(({ tool }) => tool.requiredPermissions ?? []),
  ),
];
const names = (defs: { function: { name: string } }[]) =>
  defs.map((d) => d.function.name).sort();
const run = <T>(ctx: object, fn: () => Promise<T>) =>
  RequestContextService.asyncLocalStorage.run(ctx as any, fn);

const VEXI_PUBLIC_SCOPE = {
  agent_key: VEXI_AGENT_KEY,
  allowed_tools: [...VEXI_PUBLIC_TOOL_CATALOG],
  denied_tools: [...VEXI_INTERNAL_DENIED_TOOLS],
};

describe('storefront tools (Vexi público F2)', () => {
  it('every catalog name has a real storefront tool registered', () => {
    const { registry } = build();
    for (const name of VEXI_PUBLIC_TOOL_CATALOG) {
      expect(registry.get(name)?.domain).toBe('storefront');
      expect(registry.get(name)?.access).toBe('public');
      expect(registry.get(name)?.readOnly).toBe(true);
    }
  });

  it('an anonymous visitor turn is offered exactly the storefront catalog', () => {
    const { registry } = build();
    expect(names(registry.getAgentDefinitions([], VEXI_PUBLIC_SCOPE))).toEqual(
      [...VEXI_PUBLIC_TOOL_CATALOG].sort(),
    );
  });

  it.each([
    'create_order',
    'call_endpoint',
    'write_endpoint',
    'run_code',
    'search_tools',
    'ui_navigate',
    'search_help',
  ])(
    'an anonymous visitor (Vexi) cannot execute the internal tool %s',
    async (name) => {
      const { registry } = build();
      const tool = registry.get(name);
      await expect(
        run(ANON_CTX, () =>
          registry.executeTool(name, {}, { agentKey: VEXI_AGENT_KEY }),
        ),
      ).rejects.toMatchObject({ response: { error_code: 'AI_AGENT_004' } });
      if (tool?.handler) expect(tool.handler).not.toHaveBeenCalled();
    },
  );

  it('staff turns (Vex or no agent) never see storefront tools', () => {
    const { registry } = build();
    const storefront = new Set(VEXI_PUBLIC_TOOL_CATALOG);
    for (const defs of [
      registry.getAvailableDefinitions(ALL_PERMISSIONS),
      registry.getReadOnlyDefinitions(ALL_PERMISSIONS),
      registry.getAgentDefinitions(ALL_PERMISSIONS, {}),
      registry.getAgentDefinitions(ALL_PERMISSIONS, { agent_key: 'vex' }),
      registry.getAgentDefinitions(ALL_PERMISSIONS, {
        agent_key: 'vex',
        allowed_tools: [...VEXI_PUBLIC_TOOL_CATALOG],
      }),
    ])
      expect(names(defs).filter((n) => storefront.has(n))).toEqual([]);
  });

  it('a storefront tool never executes outside a closed-catalog turn', async () => {
    const { registry } = build();
    const tool = registry.get('storefront_search_products')!;
    for (const options of [undefined, { agentKey: 'vex' }]) {
      await expect(
        run(STAFF_CTX, () =>
          registry.executeTool(
            'storefront_search_products',
            { query: 'x' },
            options,
          ),
        ),
      ).rejects.toMatchObject({ response: { error_code: 'AI_AGENT_004' } });
    }
    expect(tool.handler).not.toHaveBeenCalled();
  });

  it('an anonymous visitor executes a storefront tool with no user in context', async () => {
    const { registry } = build();
    await expect(
      run(ANON_CTX, () =>
        registry.executeTool(
          'storefront_search_products',
          { query: 'camiseta' },
          { agentKey: VEXI_AGENT_KEY },
        ),
      ),
    ).resolves.toBe('{"ran":true}');
  });
});
