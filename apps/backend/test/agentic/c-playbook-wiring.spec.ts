import { AIAgentService } from '../../src/ai-engine/ai-agent.service';
import { AIToolRegistry } from '../../src/ai-engine/tools/ai-tool-registry';
import { createPlaybookTools } from '../../src/ai-engine/tools/domains/playbook.tools';
import { createDiscoveryTools } from '../../src/ai-engine/tools/domains/discovery.tools';
import { ToolRouterService } from '../../src/ai-engine/tools/tool-router.service';
import {
  localToolRanking,
  catalogHash,
} from '../../src/ai-engine/tools/tool-catalog';
import { PlaybookService } from '../../src/ai-engine/playbooks/playbook.service';
import { RequestContextService } from '../../src/common/context/request-context.service';
import type { PlaybookDocument } from '../../src/ai-engine/playbooks/playbook.interface';
import type { AIResponse } from '../../src/ai-engine/interfaces/ai-provider.interface';
import {
  mkdtempSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  writeFileSync,
} from 'fs';
import { tmpdir } from 'os';
import { join, resolve } from 'path';
import { spawnSync } from 'child_process';

const ctx = {
  store_id: 7,
  organization_id: 3,
  user_id: 11,
  permissions: ['read'],
  is_super_admin: false,
  is_owner: true,
};
const call = (name: string, args: unknown = {}) => ({
  id: `c-${name}`,
  type: 'function' as const,
  function: { name, arguments: JSON.stringify(args) },
});
const answer = (calls?: ReturnType<typeof call>[]): AIResponse =>
  ({
    success: true,
    content: calls ? '' : 'Preparado, requiere aprobación individual.',
    tool_calls: calls,
    usage: { totalTokens: 10 },
  }) as AIResponse;
const document = (): PlaybookDocument => {
  const steps = [
    {
      id: 'read',
      section: 'steps',
      instruction: 'Consulta existencias, no compra.',
      tool: 'read_stock',
      depends_on: [],
      approval: 'none' as const,
    },
  ];
  return {
    id: 'reponer-inventario',
    name: 'reponer-inventario',
    description: 'Reponer stock de inventario',
    hash: catalogHash('release'),
    source: 'reponer-inventario.md',
    body: 'solo cuerpo elegido',
    metadata: {
      workflow_key: 'reponer-inventario',
      version: '1.0.0',
      owner: 'inventory',
      industry: ['all'],
      tool_contracts: [{ name: 'read_stock', version: '1' }],
      required_permissions: ['read'],
      verifier_ids: ['reponer-inventario:v1'],
    },
    contract: {
      schema_version: '1',
      mode: 'executable',
      gaps: [],
      inputs: [],
      steps,
      examples: [],
    },
    sections: [
      { id: 'steps', title: 'Lectura', body: 'solo cuerpo elegido', steps },
      {
        id: 'alternative',
        title: 'Alternativa',
        body: 'unloaded-body-marker',
        steps: [],
      },
    ],
  };
};

describe('C shared loop wiring: Vex/Vexi, D1 pins and B discovery', () => {
  const saved = [
    'AI_AGENT_PLAYBOOKS_ENABLED',
    'AI_TOOL_ROUTING_ENABLED',
    'AI_TOOL_EXECUTION_CONTRACT_ENABLED',
  ].map((key) => [key, process.env[key]]);
  let registry: AIToolRegistry;
  let service: AIAgentService;
  let playbooks: PlaybookService;
  let chat: jest.Mock;
  let read: jest.Mock;
  const run = <T>(fn: () => T) => RequestContextService.runIsolated(ctx, fn);
  beforeEach(() => {
    process.env.AI_AGENT_PLAYBOOKS_ENABLED = 'true';
    process.env.AI_TOOL_EXECUTION_CONTRACT_ENABLED = 'true';
    process.env.AI_TOOL_ROUTING_ENABLED = 'true';
    registry = new AIToolRegistry({} as any);
    registry.registerMany([
      ...createPlaybookTools(),
      ...createDiscoveryTools(),
    ]);
    read = jest
      .fn()
      .mockResolvedValue(
        JSON.stringify({ resource_ids: { product_id: 4 }, available: 5 }),
      );
    registry.register({
      name: 'read_stock',
      domain: 'inventory',
      description: 'stock',
      readOnly: true,
      requiredPermissions: ['read'],
      parameters: { type: 'object', properties: {} },
      handler: read,
    });
    registry.register({
      name: 'forbidden_write',
      domain: 'orders',
      description: 'denied',
      requiresConfirmation: true,
      requiredPermissions: ['secret'],
      parameters: {},
      handler: jest.fn(),
    });
    for (let i = 0; i < 30; i++)
      registry.register({
        name: `unused_${i}`,
        domain: 'other',
        description: 'unrelated',
        readOnly: true,
        parameters: {},
        handler: async () => '{}',
      });
    playbooks = new PlaybookService(
      { getPlaybooks: () => [document()] } as any,
      registry,
      { find: jest.fn() } as any,
    );
    const knowledge = {
      rank: async (
        query: string,
        docs: any[],
        _scope: string,
        domain?: string,
      ) => ({ names: localToolRanking(query, docs, domain), degraded: [] }),
    };
    const router = new ToolRouterService(registry, knowledge as any);
    chat = jest.fn().mockResolvedValue(answer());
    service = new AIAgentService(
      { chat } as any,
      {} as any,
      registry,
      { emit: jest.fn() } as any,
      {} as any,
      {
        canUseAIFeature: async () => ({ allowed: true }),
        getAIFeatureConfig: async () => ({ tools_allowed: ['*'] }),
        consumeAIQuota: jest.fn(),
        checkExtraQuota: async () => ({ exceeded: false }),
        consumeExtraQuota: jest.fn(),
      } as any,
      undefined,
      router,
      playbooks,
    );
  });
  afterEach(() => jest.restoreAllMocks());
  afterAll(() =>
    saved.forEach(([key, value]) => {
      if (value === undefined) delete process.env[key!];
      else process.env[key!] = value;
    }),
  );
  it.each(['vexi', 'vex'])(
    'runs search→load→authorized read on %s, no twenty-body system prompt',
    async (agent) =>
      run(async () => {
        chat
          .mockResolvedValueOnce(
            answer([call('search_playbooks', { query: 'reponer' })]),
          )
          .mockResolvedValueOnce(
            answer([
              call('load_playbook', {
                id: 'reponer-inventario',
                version: '1.0.0',
                section: 'steps',
              }),
            ]),
          )
          .mockResolvedValueOnce(answer([call('read_stock')]))
          .mockResolvedValueOnce(answer());
        const result = await service.runAgent({
          goal: 'reponer inventario',
          agent_key: agent,
          max_iterations: 5,
        });
        expect(read).toHaveBeenCalledTimes(1);
        expect(result.tools_used.map((t) => t.name)).toEqual([
          'search_playbooks',
          'load_playbook',
          'read_stock',
        ]);
        const all = JSON.stringify(chat.mock.calls);
        expect(all).toContain('solo cuerpo elegido');
        expect(all).not.toContain('unloaded-body-marker');
        expect(
          chat.mock.calls[0][1].tools.map((d: any) => d.function.name),
        ).toEqual(
          expect.arrayContaining(['search_playbooks', 'load_playbook']),
        );
        expect(all).not.toContain('forbidden_write');
        expect(result.execution?.outcome).not.toBe('completed_verified');
      }),
  );
  it('C OFF removes previously boot-registered playbooks from definitions and never loads history', async () =>
    run(async () => {
      delete process.env.AI_AGENT_PLAYBOOKS_ENABLED;
      const create = jest.spyOn(playbooks, 'createSession');
      await service.runAgent({ goal: 'reponer inventario', max_iterations: 1 });
      const names = chat.mock.calls[0][1].tools.map(
        (d: any) => d.function.name,
      );
      expect(names).not.toContain('load_playbook');
      expect(names).not.toContain('search_playbooks');
      expect(create).not.toHaveBeenCalled();
      expect(
        chat.mock.calls[0][0]
          .filter((m: any) => m.role === 'system')
          .some((m: any) => m.content.includes('Pines históricos')),
      ).toBe(false);
    }));
  it('agent deny and strict caller scope cannot receive re-added playbook discovery', async () =>
    run(async () => {
      chat.mockResolvedValueOnce(
        answer([
          call('load_playbook', { id: 'reponer-inventario', version: '1.0.0' }),
        ]),
      );
      const load = jest.spyOn(playbooks, 'load');
      const result = await service.runAgent({
        goal: 'reponer',
        tools: ['inventory'],
        agent_denied_tools: ['playbooks'],
        max_iterations: 2,
      });
      expect(load).not.toHaveBeenCalled();
      expect(result.tools_used).toEqual([]);
      expect(result.execution?.outcome).toBe('blocked');
    }));
  it('missing explicit ALS cannot borrow static user identity for the runtime session', async () => {
    jest.spyOn(RequestContextService, 'getContext').mockReturnValue(ctx);
    const create = jest.spyOn(playbooks, 'createSession');
    chat.mockResolvedValueOnce(
      answer([
        call('load_playbook', { id: 'reponer-inventario', version: '1.0.0' }),
      ]),
    );
    const result = await service.runAgent({
      goal: 'reponer',
      max_iterations: 2,
    });
    expect(create).not.toHaveBeenCalled();
    expect(result.tools_used[0].result).toContain('PLAYBOOK_SESSION_REQUIRED');
  });
  it.each(['true', 'false'])(
    'never rehydrates historical tool bodies when C=%s',
    async (flag) =>
      run(async () => {
        process.env.AI_AGENT_PLAYBOOKS_ENABLED = flag;
        const oldCall = call('load_playbook', {
          id: 'reponer-inventario',
          version: '0.9.0',
        });
        await service.runAgent({
          goal: 'continúa',
          max_iterations: 1,
          messages: [
            { role: 'assistant', content: '', tool_calls: [oldCall] },
            {
              role: 'tool',
              tool_call_id: oldCall.id,
              content: 'OLD-UNTRUSTED-BODY-MARKER',
            },
          ],
        });
        expect(JSON.stringify(chat.mock.calls)).not.toContain(
          'OLD-UNTRUSTED-BODY-MARKER',
        );
        expect(JSON.stringify(chat.mock.calls)).toContain(
          'historical_playbook_body_omitted',
        );
      }),
  );
  it('playbook-only discovery is not advertised as current business-operation capability', async () =>
    run(async () => {
      await service.runAgent({
        goal: 'reponer',
        tools: ['playbooks'],
        max_iterations: 1,
      });
      expect(JSON.stringify(chat.mock.calls[0][0])).toContain(
        'No tienes herramientas operativas',
      );
    }));
  it('C remains usable with B routing OFF without changing the normal guarded business dispatch', async () =>
    run(async () => {
      delete process.env.AI_TOOL_ROUTING_ENABLED;
      chat
        .mockResolvedValueOnce(
          answer([
            call('load_playbook', {
              id: 'reponer-inventario',
              version: '1.0.0',
              section: 'steps',
            }),
          ]),
        )
        .mockResolvedValueOnce(answer([call('read_stock')]));
      const result = await service.runAgent({
        goal: 'reponer',
        max_iterations: 3,
      });
      expect(read).toHaveBeenCalledTimes(1);
      expect(result.tools_used[0].name).toBe('load_playbook');
    }));
});

describe('C asset packaging contract exercised by the existing CI gate (not a local build)', () => {
  it('finds all20 runtime MD beside dist/src loader and detects one missing bundled file', () => {
    const backend = resolve(__dirname, '../..');
    const config = JSON.parse(
      readFileSync(join(backend, 'nest-cli.json'), 'utf8'),
    );
    const asset = config.compilerOptions.assets.find(
      (a: any) => a.include === 'ai-engine/playbooks/content/*.md',
    );
    expect(asset.outDir).toBe('dist/src');
    const relative = 'ai-engine/playbooks/content';
    const files = readdirSync(join(backend, 'src', relative)).filter((f) =>
      f.endsWith('.md'),
    );
    expect(files).toHaveLength(20);
    const tmp = mkdtempSync(join(tmpdir(), 'vendix-c-assets-'));
    writeFileSync(
      join(tmp, 'nest-cli.json'),
      JSON.stringify({
        sourceRoot: 'src',
        compilerOptions: { assets: [asset] },
      }),
    );
    for (const dir of ['src', 'dist/src'])
      mkdirSync(join(tmp, dir, relative), { recursive: true });
    for (const file of files)
      writeFileSync(
        join(tmp, 'src', relative, file),
        readFileSync(join(backend, 'src', relative, file)),
      );
    const script = join(backend, 'scripts/assert-build-assets.js');
    expect(
      spawnSync(process.execPath, [script], { cwd: tmp, encoding: 'utf8' })
        .status,
    ).toBe(1);
    for (const file of files.slice(0, -1))
      writeFileSync(join(tmp, 'dist/src', relative, file), 'fixture');
    expect(
      spawnSync(process.execPath, [script], { cwd: tmp, encoding: 'utf8' })
        .status,
    ).toBe(1);
    writeFileSync(join(tmp, 'dist/src', relative, files.at(-1)!), 'fixture');
    const success = spawnSync(process.execPath, [script], {
      cwd: tmp,
      encoding: 'utf8',
    });
    expect(success.status).toBe(0);
    expect(success.stdout).toContain('20 assets OK');
  });
});
