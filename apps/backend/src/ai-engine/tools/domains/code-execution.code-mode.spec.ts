import { createCodeModeTools } from './code-execution.tools';
import { RequestContextService } from '../../../common/context/request-context.service';
import { codeModeInvocation } from '../../sandbox/codemode-invocation.context';
import { CODEMODE_ALLOWLIST } from '../../sandbox/codemode-allowlist.generated';
import { CodeModePolicyService } from '../../sandbox/codemode-policy.service';
import {
  CODEMODE_LIMITS,
  CodeModeError,
} from '../../sandbox/interfaces/codemode-protocol.interface';
import { collectToolCatalog } from '../tool-catalog.test-helper';
import type { RegisteredTool } from '../interfaces/tool.interface';

const STORE = 3;
const CONVERSATION = 7;
const READ = 'get_stock_levels';
const READ2 = 'list_orders';
const live = new Map<string, RegisteredTool>(
  collectToolCatalog().map((e) => [e.tool.name, e.tool]),
);

function setup(
  o: {
    enabled?: boolean | Error;
    available?: boolean;
    run?: Record<string, unknown> | Error;
    initialNames?: string[];
    extraTools?: RegisteredTool[];
    createError?: Error;
    conversation?: number | null;
  } = {},
) {
  const tools = new Map(live);
  for (const t of o.extraTools ?? []) tools.set(t.name, t);
  const registry = { get: jest.fn((name: string) => tools.get(name)) };
  const policy = new CodeModePolicyService(registry as never, {} as never);
  const runner = {
    available: jest.fn().mockReturnValue(o.available ?? true),
    run: jest.fn().mockImplementation(async () => {
      if (o.run instanceof Error) throw o.run;
      return {
        run_id: 'run-1',
        source_hash: 'hash-1',
        result: { total: 3 },
        result_truncated: false,
        logs: ['hola'],
        calls: [{ seq: 1, tool: READ, status: 'ok', rows: 4, duration_ms: 2 }],
        rows_seen: 4,
        rounds: 2,
        blocks: [],
        usage: { duration_ms: 9 },
        ...(o.run ?? {}),
      };
    }),
  };
  let n = 0;
  const blocks = {
    getById: jest.fn(),
    create: jest.fn().mockImplementation(async (input) => {
      if (o.createError) throw o.createError;
      return { id: `blk-${++n}`, version: 1, kind: input.kind, spec: input.spec, data: input.data };
    }),
    toUiBlock: jest.fn().mockImplementation(async (row) => ({
      block_id: row.id, kind: row.kind, version: 1, spec: row.spec, data: row.data,
    })),
  };
  const entitlements = {
    codeModeEnabled: jest.fn().mockImplementation(async () => {
      if (o.enabled instanceof Error) throw o.enabled;
      return o.enabled ?? true;
    }),
  };
  const tool = createCodeModeTools({ runner, blocks, entitlements, registry, policy })[0];
  const invocation = {
    agentKey: 'vex',
    initialNames: o.initialNames ?? [READ, READ2, 'run_code', 'run_analysis'],
    revalidate: async () => [],
  };
  const call = (args: Record<string, unknown> = {}, withInvocation = true) =>
    RequestContextService.run(
      { store_id: STORE, user_id: 1, is_super_admin: false } as never,
      async () => {
        const exec = () =>
          tool.handler!(
            { source: 'return 1;', tools: [READ], purpose: 'stock total', ...args },
            { conversation_id: o.conversation === null ? undefined : (o.conversation ?? CONVERSATION) },
          );
        return JSON.parse(
          await (withInvocation ? codeModeInvocation.run(invocation as never, exec) : exec()),
        );
      },
    );
  return { tool, runner, blocks, entitlements, registry, call };
}

const fake = (name: string, extra: Partial<RegisteredTool>): RegisteredTool => ({
  name, domain: 'x', description: 'x', parameters: { type: 'object', properties: {} },
  requiredPermissions: ['store:x:read'], handler: async () => '{}', ...extra,
});

describe('run_code declaration', () => {
  it('is public, read-only, never allowlisted, and states the routing rule in Spanish', () => {
    const { tool } = setup();
    expect(tool.name).toBe('run_code');
    expect(tool.readOnly).toBe(true);
    expect(tool.access).toBe('public');
    expect(tool.parameters.required).toEqual(['source', 'tools', 'purpose']);
    expect(CODEMODE_ALLOWLIST.map((e) => e.name)).not.toContain('run_code');
    expect(tool.description).toMatch(/3 o más lecturas encadenadas/);
    expect(tool.description).toMatch(/~50 filas/);
    expect(tool.description).toMatch(/1 o 2 lecturas/);
    expect(tool.description).toMatch(/NUNCA/);
  });
});

describe('run_code gates (nothing is invoked unless all pass)', () => {
  it('plan without code_mode: fails closed, runner untouched', async () => {
    const f = setup({ enabled: false });
    const r = await f.call();
    expect(r.error).toBe('Tu plan no incluye «Scripts de herramientas».');
    expect(f.runner.available).not.toHaveBeenCalled();
    expect(f.runner.run).not.toHaveBeenCalled();
  });

  it('a resolver error is OFF', async () => {
    const f = setup({ enabled: new Error('db down') });
    expect((await f.call()).error).toMatch(/no incluye/);
    expect(f.runner.run).not.toHaveBeenCalled();
  });

  it('runner off: Spanish "no disponible", no invocation, direct tools suggested', async () => {
    const f = setup({ available: false });
    const r = await f.call();
    expect(r.error).toMatch(/no están disponibles/);
    expect(r.next_step).toMatch(/herramientas directas/);
    expect(f.runner.run).not.toHaveBeenCalled();
  });

  it('no turn invocation context: unavailable, no invocation', async () => {
    const f = setup();
    const r = await f.call({}, false);
    expect(r.error).toMatch(/no están disponibles en este turno/);
    expect(f.runner.run).not.toHaveBeenCalled();
  });

  it('refuses when ALS is empty even if static currentContext and handler context hold another store_id (F10 audit B3)', async () => {
    const f = setup();
    // Populate legacy static RequestContextService.currentContext with another store,
    // then exit the ALS scope so asyncLocalStorage.getStore() is undefined.
    RequestContextService.run(
      { store_id: 999, user_id: 99, is_super_admin: false } as never,
      () => undefined,
    );
    try {
      expect(RequestContextService.asyncLocalStorage.getStore()).toBeUndefined();
      expect(RequestContextService.getContext()?.store_id).toBe(999);
      const raw = await codeModeInvocation.run(
        {
          agentKey: 'vex',
          initialNames: [READ, 'run_code'],
          revalidate: async () => [],
        } as never,
        () =>
          f.tool.handler!(
            { source: 'return 1;', tools: [READ], purpose: 'stock total' },
            { store_id: 999, conversation_id: CONVERSATION },
          ),
      );
      const r = JSON.parse(raw);
      expect(r.error).toBe('No pude identificar la tienda de esta conversación.');
      expect(f.entitlements.codeModeEnabled).not.toHaveBeenCalled();
      expect(f.runner.run).not.toHaveBeenCalled();
    } finally {
      RequestContextService.run(undefined as never, () => undefined);
    }
  });

  it.each([
    ['requires confirmation', { requiresConfirmation: true, readOnly: false }],
    ['is irreversible', { irreversible: true, requiresConfirmation: true }],
    ['is client-side', { clientSide: true, readOnly: true }],
    ['is not read-only', { readOnly: false }],
  ])('rejects before invoking a manifest tool that %s', async (_l, flags) => {
    const f = setup({ extraTools: [fake('write_thing', flags as Partial<RegisteredTool>)], initialNames: [READ, 'write_thing'] });
    const r = await f.call({ tools: [READ, 'write_thing'] });
    expect(r.error).toMatch(/solo pueden leer: write_thing/);
    expect(f.runner.run).not.toHaveBeenCalled();
  });

  it('rejects script runners, unknown names and read tools the allowlist does not hold', async () => {
    const f = setup({ extraTools: [fake('fresh_read', { readOnly: true })], initialNames: [READ, 'fresh_read', 'run_code', 'run_analysis', 'run_readonly_script'] });
    for (const name of ['run_code', 'run_analysis', 'run_readonly_script', 'fresh_read', 'ghost_tool']) {
      const r = await f.call({ tools: [READ, name] });
      expect({ name, error: r.error }).toEqual({ name, error: expect.stringContaining(`No se pueden usar en scripts: ${name}`) });
    }
    expect(f.runner.run).not.toHaveBeenCalled();
  });

  it('rejects an allowlisted tool the turn did not authorize (role, plan, agent)', async () => {
    const f = setup({ initialNames: [READ] });
    const r = await f.call({ tools: [READ, READ2] });
    expect(r.error).toBe(`No están autorizadas en este turno: ${READ2}.`);
    expect(f.runner.run).not.toHaveBeenCalled();
  });

  it('validates source, purpose and manifest shape', async () => {
    const f = setup();
    expect((await f.call({ source: '  ' })).error).toMatch(/Falta el script/);
    expect((await f.call({ source: 'x'.repeat(CODEMODE_LIMITS.source_bytes + 1) })).error).toMatch(/32 KiB/);
    expect((await f.call({ purpose: ' ' })).error).toMatch(/Falta purpose/);
    for (const tools of [[], [READ, READ], ['Bad-Name'], Array.from({ length: 21 }, (_, i) => `t${i}`), 'x'])
      expect((await f.call({ tools })).error).toMatch(/tools debe traer/);
    expect(f.runner.run).not.toHaveBeenCalled();
  });
});

describe('run_code result to the model', () => {
  it('runs once with the manifest and returns status, result, logs, calls and rows_seen', async () => {
    const f = setup();
    const r = await f.call();
    expect(f.runner.run).toHaveBeenCalledTimes(1);
    expect(f.runner.run).toHaveBeenCalledWith({ source: 'return 1;', tools: [READ], purpose: 'stock total' });
    expect(r.data).toEqual({
      status: 'ok', result: { total: 3 }, logs: ['hola'],
      calls: [{ seq: 1, tool: READ, status: 'ok', rows: 4 }], rows_seen: 4,
    });
  });

  it('is partial when a call failed, and caps result and logs', async () => {
    const f = setup({
      run: {
        result: { text: 'é'.repeat(20_000) },
        logs: Array.from({ length: 100 }, () => 'x'.repeat(100)),
        calls: [{ seq: 1, tool: READ, status: 'error', rows: 0, duration_ms: 1 }],
      },
    });
    const r = await f.call();
    expect(r.data.status).toBe('partial');
    expect(r.data.result_truncated).toBe(true);
    expect(Buffer.byteLength(JSON.stringify(r.data.result))).toBeLessThanOrEqual(CODEMODE_LIMITS.result_bytes + 8);
    expect(Buffer.byteLength(r.data.logs.join(''))).toBeLessThanOrEqual(CODEMODE_LIMITS.log_bytes);
  });

  it('persists script blocks through the block service; the model gets id, rows and a 5-row preview', async () => {
    const rows = Array.from({ length: 7 }, (_, i) => ({ n: i }));
    const f = setup({
      run: {
        blocks: [
          { kind: 'table', spec: { title: 'Top', analysis: { source: 'FORGED' } }, data: { columns: [{ key: 'n', label: 'N' }], rows } },
          { kind: 'image', data: {} },
          { kind: 'table', data: 'nope' },
        ],
      },
    });
    const r = await f.call();
    expect(f.blocks.create).toHaveBeenCalledTimes(1);
    expect(f.blocks.create.mock.calls[0][0]).toMatchObject({
      conversation_id: CONVERSATION,
      kind: 'table',
      spec: { title: 'Top', analysis: { language: 'js', run_id: 'run-1', source: '' } },
    });
    expect(r.data.blocks).toEqual([{ block_id: 'blk-1', kind: 'table', rows: 7, preview: rows.slice(0, 5) }]);
    expect(r.data.blocks_skipped).toBe(2);
    expect(r.data.ui_blocks).toHaveLength(1);
  });

  it('skips blocks without a conversation or when the block service refuses them, keeping the result', async () => {
    const block = { kind: 'kpi', data: { label: 'x', value: 1 } };
    const noConv = setup({ run: { blocks: [block] }, conversation: null });
    expect((await noConv.call()).data).toMatchObject({ blocks_skipped: 1, status: 'ok' });
    expect(noConv.blocks.create).not.toHaveBeenCalled();
    const refused = setup({ run: { blocks: [block] }, createError: new Error('inválido') });
    const r = await refused.call();
    expect(r.data.blocks_skipped).toBe(1);
    expect(r.data.result).toEqual({ total: 3 });
  });

  it.each([
    ['CODEMODE_RUNTIME', /falló al ejecutarse/],
    ['CODEMODE_LIMIT', /superó un límite/],
    ['CODEMODE_DENIED', /no tiene autorización/],
    ['CODEMODE_UNAVAILABLE', /no están disponibles/],
  ])('maps %s to a Spanish error the model can act on', async (code, pattern) => {
    const f = setup({ run: new CodeModeError(code as never, 'detalle') });
    const r = await f.call();
    expect(r.error).toMatch(pattern);
    expect(r.next_step).toBeTruthy();
  });
});
