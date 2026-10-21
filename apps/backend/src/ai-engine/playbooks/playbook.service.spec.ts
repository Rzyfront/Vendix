import fs = require('fs');
import { join } from 'path';
import {
  RequestContextService,
  type RequestContext,
} from '../../common/context/request-context.service';
import { AIToolRegistry } from '../tools/ai-tool-registry';
import type { RegisteredTool } from '../tools/interfaces/tool.interface';
import { createPlaybookTools } from '../tools/domains/playbook.tools';
import { catalogHash } from '../tools/tool-catalog';
import { PlaybookLoaderService } from './playbook-loader.service';
import {
  PlaybookService,
  type PlaybookSession,
  type LoadedPlaybook,
} from './playbook.service';
import type { PlaybookDocument } from './playbook.interface';
import * as validator from './playbook-validator';

const context: RequestContext = {
  organization_id: 3,
  store_id: 7,
  user_id: 11,
  permissions: ['inventory:read', 'orders:create'],
  is_super_admin: false,
  is_owner: false,
};
const scope = { organization_id: 3, store_id: 7, user_id: 11 };
const scoped = <T>(
  callback: () => T,
  overrides: Partial<RequestContext> = {},
) => RequestContextService.runIsolated({ ...context, ...overrides }, callback);
const read = (): RegisteredTool => ({
  name: 'read_stock',
  version: '1',
  domain: 'inventory',
  description: 'Leer stock',
  requiredPermissions: ['inventory:read'],
  readOnly: true,
  parameters: { type: 'object', properties: {} },
  handler: async () => '{}',
});
const write = (): RegisteredTool => ({
  name: 'write_order',
  version: '1',
  domain: 'orders',
  description: 'Proponer orden',
  requiredPermissions: ['orders:create'],
  requiresConfirmation: true,
  parameters: { type: 'object', properties: {} },
  handler: async () => '{}',
});
function document(id = 'reponer-inventario'): PlaybookDocument {
  const steps = [
    {
      id: 'read',
      section: 'steps',
      instruction: 'Lee read_stock.',
      tool: 'read_stock',
      depends_on: [],
      approval: 'none' as const,
    },
    {
      id: 'write',
      section: 'steps',
      instruction: 'Propón write_order.',
      tool: 'write_order',
      depends_on: ['read'],
      approval: 'individual' as const,
    },
    {
      id: 'verify',
      section: 'steps',
      instruction: 'Verifica recibo.',
      depends_on: ['write'],
      approval: 'none' as const,
    },
  ];
  return {
    id,
    name: 'Reposición café',
    description:
      'Preparar inventario y propuesta de reposición sin compra automática.',
    source: `${id}.md`,
    hash: catalogHash(id),
    metadata: {
      version: '1',
      workflow_key: id,
      owner: 'inventory',
      industry: ['retail'],
      tool_contracts: [
        { name: 'read_stock', version: '1' },
        { name: 'write_order', version: '1' },
      ],
      required_permissions: ['inventory:read', 'orders:create'],
      verifier_ids: ['stock-proposal'],
    },
    contract: {
      schema_version: '1',
      mode: 'executable',
      gaps: [],
      inputs: [
        {
          key: 'warehouse',
          required: true,
          source: 'user',
          description: 'Bodega elegida.',
        },
      ],
      steps,
      examples: [],
    },
    body: 'Activación.\nLee read_stock.\nPropón write_order.\nVerifica recibo.',
    sections: [
      {
        id: 'activation',
        title: 'Activación',
        body: 'Preparación; no comprar automáticamente.',
        steps: [],
      },
      {
        id: 'steps',
        title: 'Pasos',
        body: 'Lee read_stock.\nPropón write_order.\nVerifica recibo.',
        steps,
      },
    ],
  };
}

describe('PlaybookService C: knowledge is not authority', () => {
  let registry: AIToolRegistry;
  let documents: PlaybookDocument[];
  let service: PlaybookService;
  let loader: { getPlaybooks: jest.Mock };
  let api: { find: jest.Mock };
  beforeEach(() => {
    registry = new AIToolRegistry({} as any);
    registry.registerMany([read(), write(), ...createPlaybookTools()]);
    documents = [
      document(),
      document('facturar-venta'),
      document('cerrar-caja'),
    ];
    loader = { getPlaybooks: jest.fn(() => structuredClone(documents)) };
    api = { find: jest.fn() };
    service = new PlaybookService(loader as any, registry, api as any);
  });
  afterEach(() => {
    jest.restoreAllMocks();
  });
  afterAll(() => {});
  const session = (
    service: PlaybookService,
    registry: AIToolRegistry,
    names?: string[],
  ) =>
    service.createSession({
      scope,
      authorizedDefinitions: registry
        .getAllDefinitions()
        .filter(
          (definition) => !names || names.includes(definition.function.name),
        ),
    });

  it('search returns only matching titles/inputs/cost/availability, never bodies or steps', () =>
    scoped(() => {
      documents[1].name = 'Factura de venta';
      documents[1].description = 'Facturar orden existente';
      const result = service.search(session(service, registry), {
        query: 'CAFÉ',
        limit: 1,
      });
      expect(result).toMatchObject({
        results: [
          {
            id: 'cerrar-caja',
            title: 'Reposición café',
            inputs: [{ key: 'warehouse' }],
          },
        ],
      });
      expect(JSON.stringify(result)).not.toContain('automáticamente');
      expect(JSON.stringify(result)).not.toContain('instruction');
      expect(result).toHaveProperty('has_more', true);
      expect(result).toMatchObject({
        results: [
          {
            sections: [
              { id: 'activation', title: 'Activación' },
              { id: 'steps', title: 'Pasos' },
            ],
          },
        ],
      });
    }));
  it('loads only one requested release section and not another playbook body', () =>
    scoped(() => {
      const result = service.load(session(service, registry), {
        id: documents[0].id,
        version: '1',
        section: 'steps',
      }) as LoadedPlaybook;
      expect(result.section.id).toBe('steps');
      expect(result.section.steps.map((step) => step.id)).toEqual([
        'read',
        'write',
        'verify',
      ]);
      expect(result.section.body).not.toContain('Activación');
      expect(JSON.stringify(result)).not.toContain('facturar-venta');
      expect(result.authority).toBe(
        'guidance_only_current_tools_and_individual_approval',
      );
      expect(result.metadata.verifier_ids).toEqual(['stock-proposal']);
    }));
  it('uses first relevant section by default, not the complete body', () =>
    scoped(() => {
      const result = service.load(session(service, registry), {
        id: documents[0].id,
        version: '1',
      }) as LoadedPlaybook;
      expect(result.section.id).toBe('activation');
      expect(result.section.body).not.toContain('write_order');
    }));
  it('permits at most two active workflows without silently evicting an earlier pin', () =>
    scoped(() => {
      const handle = session(service, registry);
      for (const doc of documents.slice(0, 2))
        expect(
          service.load(handle, { id: doc.id, version: '1' }),
        ).toHaveProperty('hash');
      expect(
        service.load(handle, { id: documents[2].id, version: '1' }),
      ).toMatchObject({ error_code: 'PLAYBOOK_ACTIVE_LIMIT' });
      expect(service.getActivePins(handle).map((pin) => pin.id)).toEqual(
        documents.slice(0, 2).map((doc) => doc.id),
      );
    }));
  it('keeps active limits local to each opaque turn session', () =>
    scoped(() => {
      const first = session(service, registry);
      const second = session(service, registry);
      service.load(first, { id: documents[0].id, version: '1' });
      expect(service.getActivePins(second)).toEqual([]);
    }));
  it('refreshAuthorization narrows to current definitions intersected with the initial turn catalog', () =>
    scoped(() => {
      const initial = session(service, registry, ['read_stock']);
      service.refreshAuthorization(initial, registry.getAllDefinitions());
      const result = service.load(initial, {
        id: documents[0].id,
        version: '1',
        section: 'steps',
      }) as LoadedPlaybook;
      expect(result.section.steps.map((step) => step.id)).toEqual(['read']);
      const pins = service.getActivePins(initial);
      service.refreshAuthorization(initial, []);
      expect(service.getActivePins(initial)).toEqual(pins);
      expect(
        service.search(initial, { query: 'café', limit: 1 }),
      ).toMatchObject({
        results: [
          expect.objectContaining({
            availability: expect.objectContaining({ available_steps: 0 }),
          }),
        ],
      });
    }));
  it('authorization refresh never resets an active pin or the cumulative token budget', () =>
    scoped(() => {
      const initial = session(service, registry);
      const first = service.load(initial, {
        id: documents[0].id,
        version: '1',
      }) as LoadedPlaybook;
      service.refreshAuthorization(initial, registry.getAllDefinitions());
      const next = service.load(initial, {
        id: documents[0].id,
        version: '1',
      }) as LoadedPlaybook;
      expect(next.budget.remaining_tokens).toBeLessThan(
        first.budget.remaining_tokens,
      );
      expect(service.getActivePins(initial)).toHaveLength(1);
    }));
  it('offers routing dependencies only from exact active sections and the current authorized intersection', () =>
    scoped(() => {
      const handle = session(service, registry);
      expect(service.getActiveToolDependencies(handle)).toEqual([]);
      service.load(handle, {
        id: documents[0].id,
        version: '1',
        section: 'steps',
      });
      expect(service.getActiveToolDependencies(handle)).toEqual([
        'read_stock',
        'write_order',
      ]);
      service.refreshAuthorization(
        handle,
        registry
          .getAllDefinitions()
          .filter((definition) => definition.function.name === 'read_stock'),
      );
      expect(service.getActiveToolDependencies(handle)).toEqual(['read_stock']);
      documents[0].hash = 'changed-release';
      expect(service.getActiveToolDependencies(handle)).toEqual([]);
    }));
  it('restored pins expose no dependencies from unrelated sections', () =>
    scoped(() => {
      const handle = service.createSession({
        scope,
        authorizedDefinitions: registry.getAllDefinitions(),
        activePins: [
          {
            id: documents[0].id,
            version: '1',
            hash: documents[0].hash,
            section: 'activation',
          },
        ],
      });
      expect(service.getActiveToolDependencies(handle)).toEqual([]);

      expect(service.getActiveToolDependencies(handle)).toEqual([]);
    }));
  it('prunes unauthorized structured steps plus transitive dependents and matching prose', () =>
    scoped(() => {
      const result = service.load(session(service, registry, ['read_stock']), {
        id: documents[0].id,
        version: '1',
        section: 'steps',
      }) as LoadedPlaybook;
      expect(result.section.steps.map((step) => step.id)).toEqual(['read']);
      expect(result.section.body).not.toContain('write_order');
      expect(result.section.body).not.toContain('Verifica recibo');
      expect(result.gaps).toEqual(
        expect.arrayContaining([
          'tool_unavailable:write:write_order',
          'dependency_unavailable:verify:write',
        ]),
      );
      expect(result.mode).toBe('preparation_only');
      expect(write().handler).toBeDefined(); // Registry handlers were never invoked.
    }));
  it('does not grant a tool when a release requests extra permissions', () =>
    scoped(() => {
      const handle = session(service, registry);
      return scoped(
        () => {
          const result = service.load(handle, {
            id: documents[0].id,
            version: '1',
            section: 'steps',
          }) as LoadedPlaybook;
          expect(result.section.steps.map((step) => step.id)).toEqual(['read']);
        },
        { permissions: ['inventory:read'] },
      );
    }));
  it('never suggests writes from a preparation-only release even when actor tools allow them', () =>
    scoped(() => {
      documents[0].contract.mode = 'preparation_only';
      documents[0].contract.gaps = ['preview_missing:write_order'];
      const result = service.load(session(service, registry), {
        id: documents[0].id,
        version: '1',
        section: 'steps',
      }) as LoadedPlaybook;
      expect(result.section.steps.map((step) => step.id)).toEqual(['read']);
      expect(result.section.body).not.toContain('write_order');
      expect(result.gaps).toContain('preparation_only_write:write:write_order');
    }));
  it('prunes inaccessible bridge route even when the bridge itself is authorized', () =>
    scoped(() => {
      documents[0].contract.steps[0].bridge = {
        method: 'GET',
        path: 'store/inventory/levels',
      };
      api.find.mockReturnValue({ requiredPermissions: ['inventory:admin'] });
      const result = service.load(session(service, registry), {
        id: documents[0].id,
        version: '1',
        section: 'activation',
      }) as LoadedPlaybook;
      expect(result.gaps).toContain(
        'endpoint_unavailable:read:GET:store/inventory/levels',
      );
      expect(result.mode).toBe('preparation_only');
    }));
  it('rejects exact version/hash mismatch including a same-version changed release', () =>
    scoped(() => {
      const handle = session(service, registry);
      expect(
        service.load(handle, { id: documents[0].id, version: '2' }),
      ).toMatchObject({ error_code: 'PLAYBOOK_VERSION_MISMATCH' });
      expect(
        service.load(handle, {
          id: documents[0].id,
          version: '1',
          hash: 'not-release-hash',
        }),
      ).toMatchObject({ error_code: 'PLAYBOOK_HASH_MISMATCH' });
      expect(
        service.load(handle, { id: documents[0].id, version: '1' }),
      ).toHaveProperty('hash');
      documents[0].hash = catalogHash('changed-without-version');
      expect(
        service.load(handle, { id: documents[0].id, version: '1' }),
      ).toMatchObject({ error_code: 'PLAYBOOK_HASH_MISMATCH' });
    }));
  it('restores only exact pins and keeps a stale historical hash fail-closed', () =>
    scoped(() => {
      const handle = service.createSession({
        scope,
        authorizedDefinitions: registry.getAllDefinitions(),
        activePins: [
          {
            id: documents[0].id,
            version: '1',
            hash: 'previous-release',
            section: 'steps',
          },
        ],
      });
      expect(
        service.load(handle, { id: documents[0].id, version: '1' }),
      ).toMatchObject({ error_code: 'PLAYBOOK_HASH_MISMATCH' });
      expect(service.search(handle, { query: 'reponer' })).toMatchObject({
        restored_pin_errors: [`PLAYBOOK_PIN_STALE:${documents[0].id}`],
      });
    }));
  it('restores matching pins from D1 without restoring body, grants, or spent budget', () =>
    scoped(() => {
      const initial = session(service, registry);
      service.load(initial, {
        id: documents[0].id,
        version: '1',
        section: 'steps',
      });
      const pins = service.getActivePins(initial);
      const restored = service.createSession({
        scope,
        activePins: pins,
        authorizedDefinitions: registry
          .getAllDefinitions()
          .filter((definition) => definition.function.name === 'read_stock'),
      });
      const result = service.load(restored, {
        id: documents[0].id,
        version: '1',
        section: 'steps',
      }) as LoadedPlaybook;
      expect(result.section.steps.map((step) => step.id)).toEqual(['read']);
      expect(result.hash).toBe(pins[0].hash);
    }));

  it('charges complete UTF8 JSON conservatively and never exceeds 2000 cumulative tokens per workflow', () =>
    scoped(() => {
      documents[0].sections[0].body = Array(700).fill('áéíóú 🚚').join('\n');
      const handle = session(service, registry);
      const result = service.load(handle, {
        id: documents[0].id,
        version: '1',
      }) as LoadedPlaybook;
      expect(
        Buffer.byteLength(JSON.stringify(result), 'utf8'),
      ).toBeLessThanOrEqual(2000);
      expect(result.budget.estimated_tokens).toBeGreaterThanOrEqual(
        Buffer.byteLength(JSON.stringify(result), 'utf8'),
      );
      expect(result.omitted_body_lines).toBeGreaterThan(0);
      expect(result.mode).toBe('preparation_only');
      expect(
        service.load(handle, {
          id: documents[0].id,
          version: '1',
          section: 'steps',
        }),
      ).toMatchObject({ error_code: 'PLAYBOOK_BUDGET_EXHAUSTED' });
    }));
  it.each(['store_id', 'organization_id', 'user_id'] as const)(
    'rejects another %s with the same opaque handle',
    (key) =>
      scoped(() => {
        const handle = session(service, registry);
        expect(() =>
          scoped(() => service.search(handle, { query: 'café' }), {
            [key]: 99,
          }),
        ).toThrow('PLAYBOOK_SCOPE_MISMATCH');
      }),
  );
  it('rejects missing/zero scope and a forged handle', () => {
    expect(() =>
      service.createSession({ scope, authorizedDefinitions: [] }),
    ).toThrow('PLAYBOOK_SCOPE_MISMATCH');
    expect(() =>
      scoped(() =>
        service.createSession({
          scope: { ...scope, store_id: 0 },
          authorizedDefinitions: [],
        }),
      ),
    ).toThrow('PLAYBOOK_SCOPE_MISMATCH');
    expect(() =>
      scoped(() =>
        service.search({ session_kind: 'playbook-turn' }, { query: 'café' }),
      ),
    ).toThrow('PLAYBOOK_SESSION_REQUIRED');
  });
  it('never adopts RequestContext static fallback outside ALS', () => {
    let handle: PlaybookSession;
    RequestContextService.run(context, () => {
      handle = session(service, registry);
    });
    expect(RequestContextService.getContext()?.store_id).toBe(context.store_id);
    expect(() => service.search(handle!, { query: 'café' })).toThrow(
      'PLAYBOOK_SCOPE_MISMATCH',
    );
  });
  it.each([
    { query: '' },
    { query: 'a'.repeat(501) },
    { query: 'café', limit: 11 },
    { query: 'café', limit: 1.5 },
  ])('validates search bounds in service, not only schema %j', (args) =>
    scoped(() => {
      expect(service.search(session(service, registry), args)).toMatchObject({
        error_code: 'PLAYBOOK_SEARCH_INVALID',
      });
    }),
  );
  it('rejects traversal/unknown section without spending an active slot', () =>
    scoped(() => {
      const handle = session(service, registry);
      expect(
        service.load(handle, { id: '../secret', version: '1' }),
      ).toMatchObject({ error_code: 'PLAYBOOK_LOAD_INVALID' });
      expect(
        service.load(handle, {
          id: documents[0].id,
          version: '1',
          section: 'missing',
        }),
      ).toMatchObject({ error_code: 'PLAYBOOK_SECTION_NOT_FOUND' });
      expect(service.getActivePins(handle)).toEqual([]);
    }));
  it('produces stable process-section B manifests and invalidates on content/hash changes', () => {
    const manifest = service.getKnowledgeManifest();
    expect(manifest.documents).toHaveLength(6);
    expect(manifest.documents[0].key).toMatch(/^process:[a-z-]+:1:activation$/);
    expect(
      manifest.documents.every(
        (entry) => entry.metadata.entity_type === 'process',
      ),
    ).toBe(true);
    expect(service.getKnowledgeManifest()).toEqual(manifest);
    documents[0].sections[0].body += '\nNueva condición';
    documents[0].hash = catalogHash('new-release');
    expect(service.getKnowledgeManifest().hash).not.toBe(manifest.hash);
    expect(JSON.stringify(service.getKnowledgeManifest())).not.toContain(
      'store_id',
    );
  });
  it('uses B process retrieval for semantic intent and reconstructs only release summaries', async () =>
    scoped(async () => {
      const rank = jest.fn(async (..._args: unknown[]) => ({
        names: [
          'facturar-venta:steps',
          'facturar-venta:activation',
          'injected:steps',
        ],
        degraded: [],
        cacheHit: false,
      }));
      service = new PlaybookService(
        loader as any,
        registry,
        api as any,
        { rank } as any,
      );
      const result = await service.searchHybrid(session(service, registry), {
        query: 'necesito comprobante electrónico',
      });
      expect(rank).toHaveBeenCalledTimes(1);
      const call = rank.mock.calls[0];
      expect(call[0]).toBe('necesito comprobante electrónico');
      expect(Array.isArray(call[1])).toBe(true);
      expect(typeof call[2]).toBe('string');
      expect(call[3]).toBeUndefined();
      expect(call[4]).toBe('process');
      expect(result).toMatchObject({ results: [{ id: 'facturar-venta' }] });
      expect(JSON.stringify(result)).not.toContain('instruction');
      expect(JSON.stringify(result)).not.toContain('automáticamente');
    }));
  it('filters hybrid candidates by current tool/permission scope and catches knowledge failure locally', async () =>
    scoped(async () => {
      const rank = jest.fn(async (..._args: unknown[]) => {
        throw new Error('index unavailable');
      });
      service = new PlaybookService(
        loader as any,
        registry,
        api as any,
        { rank } as any,
      );
      const result = await service.searchHybrid(
        session(service, registry, ['read_stock']),
        { query: 'café', limit: 1 },
      );
      expect(rank.mock.calls[0][1]).toEqual([]);
      expect(result).toMatchObject({
        results: [{ availability: { mode: 'preparation_only' } }],
        degraded: ['knowledge_unavailable'],
      });
    }));
  it('invalid query never calls hybrid retrieval', () =>
    scoped(async () => {
      const rank = jest.fn();
      service = new PlaybookService(
        loader as any,
        registry,
        api as any,
        { rank } as any,
      );
      expect(
        await service.searchHybrid(session(service, registry), { query: '' }),
      ).toMatchObject({ error_code: 'PLAYBOOK_SEARCH_INVALID' });
      expect(rank).not.toHaveBeenCalled();
    }));
  it('never resurrects access changed while hybrid retrieval waits', async () =>
    scoped(async () => {
      let finish!: (value: {
        names: string[];
        degraded: string[];
        cacheHit: boolean;
      }) => void;
      const rank = jest.fn(
        () =>
          new Promise((resolve) => {
            finish = resolve;
          }),
      );
      service = new PlaybookService(
        loader as any,
        registry,
        api as any,
        { rank } as any,
      );
      const handle = session(service, registry);
      const pending = service.searchHybrid(handle, {
        query: 'comprobante electrónico',
      });
      service.refreshAuthorization(handle, []);
      finish({
        names: ['facturar-venta:steps'],
        degraded: [],
        cacheHit: false,
      });
      expect(await pending).toMatchObject({ results: [] });
    }));

  it('standalone MCP/voice handlers fail closed despite readOnly declarations', async () => {
    for (const tool of createPlaybookTools()) {
      expect(tool.readOnly).toBe(true);
      expect(tool.requiresConfirmation).toBeUndefined();
      expect(
        JSON.parse(
          await tool.handler!({ query: 'café', session_id: 'forged' }, scope),
        ),
      ).toMatchObject({ error_code: 'PLAYBOOK_SESSION_REQUIRED' });
    }
  });
});

describe('PlaybookLoaderService C: packaged release bootstrap', () => {
  let loader: PlaybookLoaderService;
  let registry: { getAll: jest.Mock };
  let api: { coveredPermissions: jest.Mock; listFor: jest.Mock };
  beforeEach(() => {
    registry = { getAll: jest.fn(() => [read(), write()]) };
    api = {
      coveredPermissions: jest.fn(() => new Set(['inventory:read'])),
      listFor: jest.fn(() => []),
    };
    loader = new PlaybookLoaderService(registry as any, api as any);
  });
  afterEach(() => {
    jest.restoreAllMocks();
  });
  afterAll(() => {});
  function assets() {
    jest.spyOn(fs, 'lstatSync').mockImplementation(
      (path) =>
        ({
          isDirectory: () => String(path).endsWith('/content'),
          isSymbolicLink: () => false,
          isFile: () => !String(path).endsWith('/content'),
          size: 500,
        }) as fs.Stats,
    );
    jest
      .spyOn(fs, 'readdirSync')
      .mockReturnValue(['reponer-inventario.md'] as any);
    jest.spyOn(fs, 'readFileSync').mockReturnValue('release markdown');
    jest.spyOn(validator, 'parsePlaybookMarkdown').mockReturnValue(document());
    jest
      .spyOn(validator, 'validatePlaybookCatalog')
      .mockImplementation((documents) => ({
        playbooks: [...documents],
        gaps: [],
      }));
  }
  it('loads assets relative to compiled __dirname, not cwd or repo fallback', async () => {
    assets();
    await loader.onApplicationBootstrap();
    expect(loader.assetDirectory()).toBe(join(__dirname, 'content'));
    expect(fs.readFileSync).toHaveBeenCalledWith(
      join(__dirname, 'content', 'reponer-inventario.md'),
      'utf8',
    );
    expect(loader.getPlaybooks()).toHaveLength(1);
    const copy = loader.getPlaybooks();
    copy[0].hash = 'mutated';
    expect(loader.getPlaybooks()[0].hash).not.toBe('mutated');
    // Catálogo completo de la release: sin la frontera de dominio del llamante.
    expect(api.listFor).toHaveBeenCalledWith(
      ['inventory:read'],
      undefined,
      undefined,
      undefined,
      { ignoreDomainScope: true },
    );
  });
  it('enforces boot barrier and waits for synchronous API/decentralized registration hooks', async () => {
    assets();
    expect(() => loader.getPlaybooks()).toThrow('PLAYBOOK_BOOT_BARRIER');
    const bootstrap = loader.initializeRelease();
    expect(registry.getAll).not.toHaveBeenCalled();
    registry.getAll.mockReturnValue([read(), write()]);
    await bootstrap;
    expect(validator.validatePlaybookCatalog).toHaveBeenCalledWith(
      expect.any(Array),
      {
        tools: [
          expect.objectContaining({ name: 'read_stock' }),
          expect.objectContaining({ name: 'write_order' }),
        ],
        endpoints: [],
      },
    );
  });
  it('initializes once for concurrent loader/indexer bootstrap callers', async () => {
    assets();
    await Promise.all([
      loader.onApplicationBootstrap(),
      loader.initializeRelease(),
      loader.initializeRelease(),
    ]);
    expect(validator.validatePlaybookCatalog).toHaveBeenCalledTimes(1);
  });

  it('fails explicitly for missing assets rather than resolving source checkout', async () => {
    jest.spyOn(fs, 'lstatSync').mockImplementation(() => {
      throw new Error('ENOENT');
    });
    await expect(loader.initializeRelease()).rejects.toThrow(
      'PLAYBOOK_ASSETS_UNAVAILABLE',
    );
    expect(() => loader.getPlaybooks()).toThrow('PLAYBOOK_BOOT_BARRIER');
  });
  it('rejects symlinked assets', async () => {
    assets();
    jest.spyOn(fs, 'lstatSync').mockReturnValue({
      isDirectory: () => true,
      isSymbolicLink: () => true,
    } as fs.Stats);
    await expect(loader.initializeRelease()).rejects.toThrow(
      'PLAYBOOK_ASSETS_UNAVAILABLE',
    );
  });
  it('propagates validation/version failures and never publishes partial valid files', async () => {
    assets();
    jest.spyOn(validator, 'validatePlaybookCatalog').mockImplementation(() => {
      throw new Error('PLAYBOOK_TOOL_VERSION_MISMATCH');
    });
    await expect(loader.initializeRelease()).rejects.toThrow(
      'PLAYBOOK_TOOL_VERSION_MISMATCH',
    );
    expect(() => loader.getPlaybooks()).toThrow('PLAYBOOK_BOOT_BARRIER');
  });
});
