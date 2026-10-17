import { ApiCatalogService } from './api-catalog.service';
import { createApiBridgeTools } from './api-bridge.tools';
import { createCapabilityTools } from './capability.tools';
import { CapabilityRegistryService } from './capability-registry.service';
import { RequestContextService } from '../../../common/context/request-context.service';

describe('B bridge/capability authorized pages', () => {
  const saved = process.env.AI_TOOL_ROUTING_ENABLED;
  let catalog: ApiCatalogService;
  let tools: ReturnType<typeof createApiBridgeTools>;
  beforeEach(() => {
    process.env.AI_TOOL_ROUTING_ENABLED = 'true';
    jest.spyOn(RequestContextService, 'getContext').mockReturnValue({
      permissions: ['read'],
      access_token: 'synthetic-test-only',
      is_owner: false,
      is_super_admin: false,
    });
    catalog = new ApiCatalogService({} as any, {} as any, {} as any);
    (catalog as any).entries = Array.from({ length: 22 }, (_, id) => ({
      path: `store/things/${String(id).padStart(2, '0')}`,
      method: id % 2 ? 'PATCH' : 'GET',
      area: 'store',
      domain: 'things',
      controller: 'Things',
      handler: 'route',
      requiredPermissions: ['read'],
      bodySchema: Array.from({ length: 12 }, (_, field) => ({
        name: `field_${field}`,
        type: field === 0 ? 'object' : 'string',
        required: true,
      })),
    }));
    (catalog as any).entries.push({
      path: 'store/things/secret',
      method: 'GET',
      area: 'store',
      domain: 'things',
      requiredPermissions: ['secret'],
      summary: 'RESTRICTED ENDPOINT',
    });
    tools = createApiBridgeTools({ catalog, attachments: {} as any });
  });
  afterEach(() => {
    jest.restoreAllMocks();
    if (saved === undefined) delete process.env.AI_TOOL_ROUTING_ENABLED;
    else process.env.AI_TOOL_ROUTING_ENABLED = saved;
  });
  async function run(name: string, args: Record<string, unknown>) {
    return JSON.parse(
      await tools.find((t) => t.name === name)!.handler!(args, {}),
    );
  }
  it('pages endpoints with accurate total and no restricted schemas/descriptions', async () => {
    const first = await run('list_endpoints', { domain: 'things', limit: 3 });
    expect(first.endpoints).toHaveLength(3);
    expect(first.total).toBe(22);
    expect(first.has_more).toBe(true);
    const next = await run('list_endpoints', {
      domain: 'things',
      limit: 3,
      cursor: first.cursor,
    });
    expect(next.endpoints[0].path).toBe('store/things/03');
    expect(JSON.stringify(first)).not.toContain('RESTRICTED');
  });
  it('pages field contracts and explicitly marks nested DTOs incomplete', async () => {
    const first = await run('list_endpoints', {
      domain: 'things',
      path: 'store/things/01',
      limit: 1,
    });
    expect(first.endpoints[0].campos).toHaveLength(8);
    expect(first.endpoints[0].fields_total).toBe(12);
    expect(first.endpoints[0].contract_complete).toBe(false);
    const next = await run('list_endpoints', {
      domain: 'things',
      path: 'store/things/01',
      field_cursor: first.endpoints[0].field_cursor,
    });
    expect(next.endpoints[0].campos.map((f) => f.name)).toEqual([
      'field_8',
      'field_9',
      'field_10',
      'field_11',
    ]);
    expect(next.endpoints[0].contract_complete).toBe(false); // Nested object still needs a domain contract/preflight.
  });
  it('invalidates stale cursors after permission revocation and returns a legible error', async () => {
    const first = await run('list_endpoints', { domain: 'things' });
    jest.spyOn(RequestContextService, 'getContext').mockReturnValue({
      permissions: [],
      is_owner: false,
      is_super_admin: false,
    });
    const next = await run('list_endpoints', {
      domain: 'things',
      cursor: first.cursor,
    });
    expect(next.error_code).toBe('INVALID_DISCOVERY_PAGE');
    expect(JSON.stringify(next)).not.toContain('RESTRICTED');
  });
  it('pages capabilities rather than silently dropping operations at a fixed count', async () => {
    const capabilities = new CapabilityRegistryService(catalog);
    const factory = createCapabilityTools({ capabilities });
    const first = JSON.parse(
      await factory[0].handler!({ domain: 'things', limit: 5 }, {}),
    );
    expect(first.operaciones).toHaveLength(5);
    expect(first.total).toBe(22);
    expect(first.has_more).toBe(true);
    const next = JSON.parse(
      await factory[0].handler!(
        { domain: 'things', limit: 5, cursor: first.cursor },
        {},
      ),
    );
    expect(next.operaciones).toHaveLength(5);
    expect(next.operaciones[0].path).not.toBe(first.operaciones[0].path);
  });
  it('pages real mocked GET results without issuing another verb or character-slicing data', async () => {
    const fetchMock = jest.spyOn(global, 'fetch').mockResolvedValue({
      ok: true,
      text: async () =>
        JSON.stringify({
          data: Array.from({ length: 20 }, (_, id) => ({
            id,
            name: `complete row ${id}`,
          })),
          meta: { total: 99 },
        }),
    } as any);
    const first = await run('call_endpoint', { path: 'store/things/00' });
    expect(first.data).toHaveLength(3);
    expect(first.source_total).toBe(99);
    expect(first.has_more).toBe(true);
    expect(first.complete).toBe(false);
    expect(fetchMock.mock.calls[0][1]?.method).toBe('GET');
  });
  it('preserves HTTP200 business failure semantics instead of hiding them behind a data page', async () => {
    const body = {
      success: false,
      error_code: 'BUSINESS_REJECTED',
      message: 'Consulta rechazada',
      data: [],
    };
    jest
      .spyOn(global, 'fetch')
      .mockResolvedValue({
        ok: true,
        text: async () => JSON.stringify(body),
      } as any);
    expect(await run('call_endpoint', { path: 'store/things/00' })).toEqual(
      body,
    );
  });
  it('preserves legacy shapes and schemas with flag OFF', async () => {
    delete process.env.AI_TOOL_ROUTING_ENABLED;
    tools = createApiBridgeTools({ catalog, attachments: {} as any });
    const result = await run('list_endpoints', { domain: 'things' });
    expect(result.endpoints).toHaveLength(22);
    expect(result).not.toHaveProperty('cursor');
    expect(tools[0].parameters.properties).not.toHaveProperty('limit');
  });
});
