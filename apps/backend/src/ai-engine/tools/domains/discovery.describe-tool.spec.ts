import { AIToolRegistry } from '../ai-tool-registry';
import { ToolRouterService } from '../tool-router.service';
import { buildToolDeclaration } from '../tool-declaration.builder';
import { createDiscoveryTools } from './discovery.tools';
import { RegisteredTool } from '../interfaces/tool.interface';

const fixture = (name: string, extra: Partial<RegisteredTool> = {}) =>
  ({
    name,
    access: 'public',
    accessReason: 'test fixture',
    domain: 'inventory',
    description: `Herramienta ${name}.`,
    parameters: {
      type: 'object',
      properties: {
        sku: { type: 'string', description: 'Código del producto' },
        status: { type: 'string', enum: ['active', 'archived'] },
        limit: { type: 'integer', minimum: 1 },
        tags: { type: 'array', items: { type: 'string' } },
        filter: {
          type: 'object',
          properties: { from: { type: 'string' }, weird: { not: {} } },
          required: ['from'],
        },
      },
      required: ['sku'],
    },
    readOnly: true,
    handler: async () => '{}',
    ...extra,
  }) as RegisteredTool;

describe('describe_tool (F10/T61)', () => {
  const build = (env: Record<string, string> = {}) => {
    const registry = new AIToolRegistry({} as any);
    registry.registerMany(createDiscoveryTools(env));
    registry.register(
      fixture('find_coffee', {
        discovery: {
          examples: [
            { intent: 'Buscar café', arguments: { sku: 'CAFE-1', limit: 2 } },
          ],
        },
      }),
    );
    registry.register(fixture('payroll_secret', { domain: 'payroll' }));
    const router = new ToolRouterService(registry, { rank: jest.fn() } as any);
    const auth = registry
      .getAllDefinitions()
      .filter((d) => d.function.name !== 'payroll_secret');
    return { registry, router, auth };
  };

  it('is registered only with the switch on', () => {
    expect(createDiscoveryTools({}).map((t) => t.name)).not.toContain(
      'describe_tool',
    );
    expect(
      createDiscoveryTools({ AI_TOOL_DISCOVERY_STUBS: 'true' }).map(
        (t) => t.name,
      ),
    ).toContain('describe_tool');
  });

  it('returns the TypeScript signature and the declared examples', () => {
    const { router, auth } = build({ AI_TOOL_DISCOVERY_STUBS: 'true' });
    const out = JSON.parse(router.describe({ name: 'find_coffee' }, auth));
    expect(out.name).toBe('find_coffee');
    expect(out.access).toBe('read');
    expect(out.declaration).toContain('declare function find_coffee(args: {');
    expect(out.declaration).toContain('sku: string;');
    expect(out.declaration).toContain('limit?: number;');
    expect(out.declaration).toContain('status?: "active" | "archived";');
    expect(out.examples).toEqual([
      { intent: 'Buscar café', arguments: { sku: 'CAFE-1', limit: 2 } },
    ]);
  });

  it('an unauthorized tool answers «tu rol no permite» and reveals nothing else', () => {
    const { router, auth } = build();
    const denied = JSON.parse(
      router.describe({ name: 'payroll_secret' }, auth),
    );
    expect(denied.error).toMatch(/^Tu rol no permite/);
    const raw = JSON.stringify(denied);
    expect(raw).not.toContain('declaration');
    expect(raw).not.toContain('Herramienta payroll_secret');
    expect(raw).not.toContain('sku');
    const missing = JSON.parse(router.describe({ name: 'nope_tool' }, auth));
    expect(missing.error).toMatch(/^No existe/);
    expect(Object.keys(missing).sort()).toEqual(Object.keys(denied).sort());
    expect(missing.error_code).toBe(denied.error_code);
  });

  it('rejects a missing or oversized name', () => {
    const { router, auth } = build();
    for (const name of [undefined, '', 'x'.repeat(101), 5]) {
      const out = JSON.parse(router.describe({ name }, auth));
      expect(out.error_code).toBe('INVALID_ARGS');
    }
  });

  it('is a tool result: it does not change what the turn offers', async () => {
    const { router, auth } = build({ AI_TOOL_DISCOVERY_STUBS: 'true' });
    const session = router.createSession('x', 's');
    const before = session.loaded.slice();
    router.describe({ name: 'find_coffee' }, auth);
    expect(session.loaded).toEqual(before);
  });
});

describe('buildToolDeclaration', () => {
  it('is deterministic, documents fields and degrades unknown keywords', () => {
    const params = fixture('t').parameters;
    const a = buildToolDeclaration('t', params, 'Hace algo.');
    expect(buildToolDeclaration('t', params, 'Hace algo.')).toBe(a);
    expect(a).toContain('/** Hace algo. */');
    expect(a).toContain('/** Código del producto */');
    expect(a).toContain('tags?: string[];');
    expect(a).toContain('from: string;');
    expect(a).toContain('weird?: unknown;');
  });

  it('bounds the output size', () => {
    const properties = Object.fromEntries(
      Array.from({ length: 800 }, (_, i) => [
        `field_${i}`,
        { type: 'string', description: 'd'.repeat(150) },
      ]),
    );
    const out = buildToolDeclaration('big', { type: 'object', properties });
    expect(out.length).toBeLessThan(6100);
    expect(out).toContain('truncada');
  });

  it('collapses very deep schemas to unknown', () => {
    let schema: Record<string, unknown> = { type: 'string' };
    for (let i = 0; i < 12; i++)
      schema = { type: 'object', properties: { n: schema } };
    expect(buildToolDeclaration('deep', schema as any)).toContain('unknown');
  });
});
