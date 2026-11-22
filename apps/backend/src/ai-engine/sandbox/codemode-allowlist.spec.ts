import { ForbiddenException } from '@nestjs/common';
import { collectToolCatalog } from '../tools/tool-catalog.test-helper';
import type {
  RegisteredTool,
  ToolExecutionResult,
} from '../tools/interfaces/tool.interface';
import {
  CODEMODE_EXCLUDED,
  codeModeCandidate,
  deriveCodeModeAllowlist,
} from './codemode-allowlist.derive';
import { CODEMODE_ALLOWLIST } from './codemode-allowlist.generated';
import { CodeModePolicyService } from './codemode-policy.service';
import { CODEMODE_LIMITS } from './interfaces/codemode-protocol.interface';

/**
 * Snapshot of the Code Mode allowlist. The live tool definitions come from the
 * SAME factories the generator uses (`collectToolCatalog`, inert deps: no DB, no
 * server), so any change to a read-only tool, to what makes it eligible, or to
 * a parameters contract fails here until
 *   npx ts-node -r tsconfig-paths/register scripts/generate-codemode-allowlist.ts
 * is rerun and the diff of `codemode-allowlist.generated.ts` is reviewed.
 */
const REGENERATE =
  'Regenerate with scripts/generate-codemode-allowlist.ts and review the diff.';

const catalog = collectToolCatalog().map((entry) => entry.tool);
const live = new Map<string, RegisteredTool>(
  catalog.map((tool) => [tool.name, tool]),
);

const policy = (tools: Map<string, RegisteredTool> = live) =>
  new CodeModePolicyService(
    { get: (name: string) => tools.get(name) } as never,
    { authorize: jest.fn() } as never,
  );

/** A live copy of an allowlisted tool, mutated the way a careless change would. */
function mutated(
  name: string,
  change: (tool: RegisteredTool) => void,
): Map<string, RegisteredTool> {
  // JSON round trip (not structuredClone: its objects come from another realm
  // under jest and would hash differently from the registry's).
  const source = live.get(name)!;
  const tool = {
    ...JSON.parse(JSON.stringify({ ...source, handler: undefined })),
    handler: source.handler,
  } as RegisteredTool;
  change(tool);
  return new Map([[name, tool as RegisteredTool]]);
}

const SAMPLE = 'get_stock_levels';

describe('Code Mode allowlist snapshot', () => {
  it(`matches the list derived from the live registry definitions. ${REGENERATE}`, () => {
    const derived = deriveCodeModeAllowlist(catalog);
    expect(CODEMODE_ALLOWLIST).toEqual(derived);
  });

  it('is a non-empty, sorted, duplicate-free list with permissions and a parameters hash on every entry', () => {
    const names = CODEMODE_ALLOWLIST.map((entry) => entry.name);
    expect(names.length).toBeGreaterThan(50);
    expect(new Set(names).size).toBe(names.length);
    expect(names).toEqual([...names].sort((a, b) => a.localeCompare(b)));
    for (const entry of CODEMODE_ALLOWLIST) {
      expect(entry.permissions.length).toBeGreaterThan(0);
      expect(entry.parameters_hash).toMatch(/^[0-9a-f]{64}$/);
      expect(entry.version).toBeTruthy();
    }
  });

  it('only holds read-only, server-side, confirmation-free, reversible tools that declare a permission', () => {
    for (const { name } of CODEMODE_ALLOWLIST) {
      const tool = live.get(name)!;
      expect({ name, found: !!tool }).toEqual({ name, found: true });
      expect({ name, ok: tool.readOnly === true }).toEqual({ name, ok: true });
      expect(tool.clientSide).toBeFalsy();
      expect(tool.requiresConfirmation).toBeFalsy();
      expect(tool.irreversible).toBeFalsy();
      expect(tool.access).not.toBe('public');
      expect(name.startsWith('ui_')).toBe(false);
      expect(tool.requiredPermissions?.length).toBeGreaterThan(0);
    }
  });

  it('never lists a script runner, a third-party caller or any excluded tool', () => {
    const names = new Set(CODEMODE_ALLOWLIST.map((entry) => entry.name));
    for (const banned of [
      'run_code',
      'run_analysis',
      'run_readonly_script',
      ...Object.keys(CODEMODE_EXCLUDED),
    ])
      expect({ banned, listed: names.has(banned) }).toEqual({
        banned,
        listed: false,
      });
    expect([...names].filter((name) => /dian|send_|payment_status/.test(name)))
      .toEqual([]);
  });

  it('keeps the geocoding and routing callers out of scripts (F10 verifier B1)', () => {
    const names = new Set(CODEMODE_ALLOWLIST.map((entry) => entry.name));
    for (const name of ['get_route_map', 'list_shipping_config', 'quote_shipping'])
      expect({
        name,
        excluded: Object.prototype.hasOwnProperty.call(CODEMODE_EXCLUDED, name),
        listed: names.has(name),
      }).toEqual({ name, excluded: true, listed: false });
  });

  it('keeps every exclusion alive and justified: a stale entry fails instead of hiding a tool', () => {
    for (const [name, reason] of Object.entries(CODEMODE_EXCLUDED)) {
      expect({ name, reason: reason.length > 10 }).toEqual({ name, reason: true });
      const tool = live.get(name);
      expect({ name, exists: !!tool }).toEqual({ name, exists: true });
      // It is excluded ONLY by this list: it would qualify on shape alone.
      expect({ name, candidate: codeModeCandidate(tool) }).toEqual({
        name,
        candidate: false,
      });
    }
  });

  it('every read-only tool with a permission is either listed or explicitly excluded', () => {
    const listed = new Set(CODEMODE_ALLOWLIST.map((entry) => entry.name));
    const unaccounted = catalog
      .filter(
        (tool) =>
          tool.readOnly === true &&
          !tool.clientSide &&
          !tool.requiresConfirmation &&
          !tool.irreversible &&
          tool.requiredPermissions?.length &&
          !tool.name.startsWith('ui_') &&
          !listed.has(tool.name) &&
          !(tool.name in CODEMODE_EXCLUDED),
      )
      .map((tool) => tool.name);
    expect(unaccounted).toEqual([]);
  });
});

describe('CodeModePolicyService eligibility against the live definition', () => {
  it('accepts every allowlisted tool as defined today', () => {
    const p = policy();
    for (const { name } of CODEMODE_ALLOWLIST)
      expect({ name, eligible: p.eligible(live.get(name)) }).toEqual({
        name,
        eligible: true,
      });
  });

  it.each([
    ['became a write', (t: RegisteredTool) => void (t.requiresConfirmation = true)],
    ['stopped being read-only', (t: RegisteredTool) => void (t.readOnly = false)],
    ['became client-side', (t: RegisteredTool) => void (t.clientSide = true)],
    ['became irreversible', (t: RegisteredTool) => void (t.irreversible = true)],
    ['became public', (t: RegisteredTool) => {
      t.access = 'public';
    }],
    ['lost its permissions', (t: RegisteredTool) => void (t.requiredPermissions = [])],
    ['changed permissions', (t: RegisteredTool) => void (t.requiredPermissions = ['store:admin:everything'])],
    ['changed domain', (t: RegisteredTool) => void (t.domain = 'somewhere-else')],
    ['changed version', (t: RegisteredTool) => void (t.version = '2')],
    ['gained a parameter', (t: RegisteredTool) => {
      t.parameters = {
        ...t.parameters,
        properties: { ...(t.parameters.properties ?? {}), extra: { type: 'string' } },
      };
    }],
  ])('rejects a tool that %s after the audit', (_label, change) => {
    const tools = mutated(SAMPLE, change);
    expect(policy(tools).eligible(tools.get(SAMPLE))).toBe(false);
  });

  it('ignores description prose but not executable schema keywords', () => {
    const prose = mutated(SAMPLE, (t) => {
      t.description = `${t.description} (reworded)`;
    });
    expect(policy(prose).eligible(prose.get(SAMPLE))).toBe(true);
  });

  it('rejects names outside the generated list however read-only they look', () => {
    const fake: RegisteredTool = {
      name: 'brand_new_read',
      domain: 'x',
      description: 'x',
      parameters: { type: 'object', properties: {} },
      readOnly: true,
      requiredPermissions: ['store:x:read'],
      handler: async () => '{}',
    };
    expect(policy().eligible(fake)).toBe(false);
    expect(policy().eligible(undefined)).toBe(false);
    for (const name of ['run_code', 'run_analysis', 'run_readonly_script'])
      expect(policy().allowlisted(name)).toBe(false);
  });
});

describe('CodeModePolicyService argument and result bounds', () => {
  it('accepts a plain JSON object that satisfies the tool schema', () => {
    expect(() => policy().assertArgs(SAMPLE, {})).not.toThrow();
  });

  it.each([
    ['an array', []],
    ['null', null],
    ['a string', 'x'],
    ['an object with a prototype', Object.create({ inherited: 1 })],
    ['a non-finite number', { n: Infinity }],
    ['a payload over the args cap', { blob: 'x'.repeat(CODEMODE_LIMITS.args_bytes) }],
  ])('refuses %s', (_label, args) => {
    expect(() => policy().assertArgs(SAMPLE, args)).toThrow(ForbiddenException);
  });

  it('refuses arguments that break the shared tool-argument schema', () => {
    const typed = [...live.values()].find(
      (tool) =>
        CODEMODE_ALLOWLIST.some((e) => e.name === tool.name) &&
        Object.values(tool.parameters.properties ?? {}).some(
          (p: any) => p?.type === 'boolean',
        ),
    )!;
    const key = Object.entries(typed.parameters.properties).find(
      ([, p]: [string, any]) => p?.type === 'boolean',
    )![0];
    expect(() => policy().assertArgs(typed.name, { [key]: 'yes' })).toThrow(
      ForbiddenException,
    );
  });

  it('refuses arguments for a tool that is not allowlisted', () => {
    expect(() => policy().assertArgs('run_analysis', {})).toThrow(ForbiddenException);
    expect(() => policy().assertArgs('nope', {})).toThrow(ForbiddenException);
  });

  const ok = (data: unknown): ToolExecutionResult =>
    ({
      schema_version: '1',
      status: 'ok',
      error_code: null,
      retryable: false,
      next_action: null,
      evidence_refs: [],
      resource_ids: {},
      pagination: null,
      freshness: 'observed',
      effect_status: 'not_applicable',
      data,
    }) as ToolExecutionResult;

  it('passes a small result, stripping credentials the artifact filter knows', () => {
    const out = policy().filterResult(
      SAMPLE,
      ok({ rows: [{ id: 1, access_token: 'secret' }] }),
    );
    expect(out.status).toBe('ok');
    expect(JSON.stringify(out.data)).not.toContain('secret');
    expect((out.data as any).rows[0].id).toBe(1);
  });

  it('turns a result over the row cap or the journal budget into a recoverable error without data', () => {
    const rows = Array.from({ length: CODEMODE_LIMITS.rows + 1 }, (_, i) => i);
    const many = policy().filterResult(SAMPLE, ok({ rows }));
    expect(many).toMatchObject({
      status: 'recoverable_error',
      error_code: 'CODEMODE_RESULT_TOO_LARGE',
      data: null,
    });
    const big = policy().filterResult(
      SAMPLE,
      ok({ text: 'x'.repeat(CODEMODE_LIMITS.journal_bytes + 1) }),
    );
    expect(big).toMatchObject({ status: 'recoverable_error', data: null });
  });

  it('never publishes the data of a non-ok result and refuses non-plain results', () => {
    const blocked = policy().filterResult(SAMPLE, {
      ...ok({ secret: 1 }),
      status: 'blocked',
    } as ToolExecutionResult);
    expect(blocked.data).toBeNull();
    const cyclic: any = ok({});
    cyclic.data.self = cyclic;
    expect(() => policy().filterResult(SAMPLE, cyclic)).toThrow(ForbiddenException);
    expect(() => policy().filterResult('run_analysis', ok({}))).toThrow(
      ForbiddenException,
    );
  });
});

describe('CodeModePolicyService authority scope', () => {
  it('derives authority through the base policy with an allowlist scope, never the Deno list_products one', async () => {
    const base = {
      authorize: jest.fn(async (...args: unknown[]) =>
        (args[4] as (snapshot: unknown, names: unknown) => unknown)({}, args[2]),
      ),
    };
    const p = new CodeModePolicyService(
      { get: (name: string) => live.get(name) } as never,
      base as never,
    );
    const callback = jest.fn(async () => 'done');
    await expect(
      p.authorize({} as never, 'vex', [SAMPLE], ['x'], callback),
    ).resolves.toBe('done');
    const scope = base.authorize.mock.calls[0][5] as {
      allowedName(name: unknown): boolean;
      eligible(tool: unknown): boolean;
    };
    expect(scope.allowedName(SAMPLE)).toBe(true);
    expect(scope.allowedName('run_code')).toBe(false);
    expect(scope.allowedName(7)).toBe(false);
    expect(scope.eligible(live.get(SAMPLE))).toBe(true);
    expect(scope.eligible(live.get('run_analysis'))).toBe(false);
  });
});
