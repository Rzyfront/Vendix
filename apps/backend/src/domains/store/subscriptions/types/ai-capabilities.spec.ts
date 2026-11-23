import { readFileSync } from 'fs';
import { join } from 'path';
import {
  AI_AGENT_KEYS,
  AI_CAPABILITIES,
  aiCapAcceptsZero,
  aiCapabilityId,
  defaultAIEntitlement,
  describeAIEntitlements,
  findAICapability,
  formatAICapValue,
  legacyCapToCapValue,
  legacyFlagsToAIEntitlements,
} from './ai-capabilities';

// Three byte-identical copies (no executable shared package between runtimes).
const REPO_ROOT = join(__dirname, '../../../../../../..');
const COPIES = [
  { name: 'shared-types', path: 'libs/shared-types/ai-capabilities.ts' },
  {
    name: 'backend',
    path: 'apps/backend/src/domains/store/subscriptions/types/ai-capabilities.ts',
  },
  {
    name: 'frontend',
    path: 'apps/frontend/src/app/shared/constants/ai-capabilities.ts',
  },
];
const M2 = join(
  REPO_ROOT,
  'apps/backend/prisma/migrations/20261223090000_plan_ai_entitlements/migration.sql',
);

describe('ai-capabilities — single catalog of plan AI capabilities (T9)', () => {
  it('the three copies are byte-identical', () => {
    const [canonical, ...rest] = COPIES.map((c) =>
      readFileSync(join(REPO_ROOT, c.path)),
    );
    rest.forEach((buf, i) => {
      expect({ copy: COPIES[i + 1].name, equal: buf.equals(canonical) }).toEqual(
        { copy: COPIES[i + 1].name, equal: true },
      );
    });
  });

  it('the backend subscription types and the super-admin interface import the catalog instead of copying it', () => {
    const backendTypes = readFileSync(
      join(
        REPO_ROOT,
        'apps/backend/src/domains/store/subscriptions/types/access.types.ts',
      ),
      'utf8',
    );
    const adminInterface = readFileSync(
      join(
        REPO_ROOT,
        'apps/frontend/src/app/private/modules/super-admin/subscriptions/interfaces/subscription-admin.interface.ts',
      ),
      'utf8',
    );
    expect(backendTypes).toMatch(/from '\.\/ai-capabilities'/);
    expect(adminInterface).toMatch(
      /from '\.\.\/\.\.\/\.\.\/\.\.\/\.\.\/shared\/constants\/ai-capabilities'/,
    );
  });

  it('declares every row of §3.11 once: Vex, Vexi and the platform', () => {
    const ids = AI_CAPABILITIES.map((c) =>
      aiCapabilityId(c.agent_key, c.capability_key),
    );
    expect(ids).toEqual([
      'vex.agent',
      'vex.model_tokens',
      'vex.voice_readout',
      'vex.files',
      'vex.code_analysis',
      'vex.code_mode',
      'vex.advanced_model',
      'vexi.agent',
      'vexi.model_tokens',
      'vexi.voice_readout',
      'platform.module_ai',
      'platform.smart_search',
    ]);
    expect(new Set(ids).size).toBe(ids.length);
    expect(
      AI_CAPABILITIES.every((c) =>
        (AI_AGENT_KEYS as readonly string[]).includes(c.agent_key),
      ),
    ).toBe(true);
  });

  it('caps are messages, tokens or voice seconds per agent, plus indexed records for the platform', () => {
    const capped = AI_CAPABILITIES.filter((c) => c.kind !== 'toggle').map(
      (c) => `${aiCapabilityId(c.agent_key, c.capability_key)}:${c.cap_unit}/${c.cap_period}`,
    );
    expect(capped).toEqual([
      'vex.agent:messages/daily',
      'vex.model_tokens:tokens/monthly',
      'vex.voice_readout:seconds/monthly',
      'vexi.agent:messages/daily',
      'vexi.model_tokens:tokens/monthly',
      'vexi.voice_readout:seconds/monthly',
      'platform.module_ai:tokens/monthly',
      'platform.smart_search:records/monthly',
    ]);
    // Switch-only capabilities never carry a unit.
    AI_CAPABILITIES.filter((c) => c.kind === 'toggle').forEach((c) => {
      expect({ id: c.capability_key, unit: c.cap_unit, period: c.cap_period })
        .toEqual({ id: c.capability_key, unit: null, period: null });
    });
  });

  it('a cap of 0 is only accepted where the legacy gate can enforce it: blocking, on a capability with its own switch', () => {
    const accepts = (id: string, onLimit: 'block' | 'warn') => {
      const [agent, capability] = id.split('.');
      return aiCapAcceptsZero(findAICapability(agent, capability)!, onLimit);
    };
    // Cap-only rows have no switch: the legacy JSON would read 0 as unlimited.
    expect(accepts('vex.model_tokens', 'block')).toBe(false);
    expect(accepts('vexi.model_tokens', 'block')).toBe(false);
    // A 0 that warns projects nothing the legacy gate holds.
    expect(accepts('vex.voice_readout', 'warn')).toBe(false);
    expect(accepts('vex.agent', 'warn')).toBe(false);
    // A 0 that blocks on a switched capability is the same as switching it off.
    expect(accepts('vex.agent', 'block')).toBe(true);
    expect(accepts('vexi.voice_readout', 'block')).toBe(true);
    expect(accepts('platform.smart_search', 'block')).toBe(true);
  });

  it('contains no tools and no tool-call cap (N4)', () => {
    const text = readFileSync(join(REPO_ROOT, COPIES[0].path), 'utf8');
    // The catalog file may mention the rule in prose; the data must not.
    const data = JSON.stringify(AI_CAPABILITIES);
    expect(data).not.toMatch(/tool/i);
    expect(data).not.toMatch(/async_queue|conversations|retention/);
    expect(text).not.toMatch(/tools_allowed\s*:/);
    expect(text).not.toMatch(/monthly_tool_calls_cap/);
  });

  it('separates the voice of Vex from the voice of Vexi (one row each)', () => {
    expect(findAICapability('vex', 'voice_readout')).toBeDefined();
    expect(findAICapability('vexi', 'voice_readout')).toBeDefined();
    expect(findAICapability('vex', 'voice_readout')).not.toBe(
      findAICapability('vexi', 'voice_readout'),
    );
  });

  it('M2 creates the table with NULL = unlimited (nullable BIGINT cap) and the per-plan unique key', () => {
    const sql = readFileSync(M2, 'utf8');
    expect(sql).toMatch(/-- DATA IMPACT:/);
    expect(sql).toMatch(/CREATE TABLE IF NOT EXISTS "plan_ai_entitlements"/);
    expect(sql).toMatch(/"cap_value" BIGINT,/);
    expect(sql).toMatch(
      /ON "plan_ai_entitlements"\("plan_id", "agent_key", "capability_key"\)/,
    );
    expect(sql).toMatch(/ON DELETE RESTRICT/);
    const statements = sql
      .split('\n')
      .filter((line) => !line.trimStart().startsWith('--'))
      .join('\n');
    expect(statements).not.toMatch(/\b(DROP|TRUNCATE|DELETE\s+FROM|INSERT|UPDATE\s+")/i);
    expect(statements).not.toMatch(/ON DELETE CASCADE/i);
  });

  describe('legacyFlagsToAIEntitlements', () => {
    const byId = (rows: ReturnType<typeof legacyFlagsToAIEntitlements>) =>
      Object.fromEntries(
        rows.map((r) => [aiCapabilityId(r.agent_key, r.capability_key), r]),
      );

    it('copies a commercial plan with the same access and caps it had', () => {
      const rows = byId(
        legacyFlagsToAIEntitlements({
          text_generation: {
            enabled: true,
            monthly_tokens_cap: 999_999_999,
            degradation: 'warn',
          },
          streaming_chat: {
            enabled: true,
            daily_messages_cap: 100,
            degradation: 'warn',
          },
          conversations: { enabled: true, retention_days: 365 },
          tool_agents: { enabled: true, tools_allowed: ['*'] },
          rag_embeddings: {
            enabled: true,
            indexed_docs_cap: 1000,
            degradation: 'block',
          },
          async_queue: { enabled: true, monthly_jobs_cap: 500 },
          realtime_voice: {
            enabled: true,
            monthly_voice_seconds_cap: 7200,
            degradation: 'warn',
          },
          vex_agent: {
            enabled: true,
            monthly_tokens_cap: 20_000_000_000,
            daily_messages_cap: 100,
            monthly_tool_calls_cap: 5000,
            degradation: 'block',
          },
        }),
      );
      expect(Object.keys(rows)).toHaveLength(AI_CAPABILITIES.length);
      expect(rows['vex.agent']).toMatchObject({
        enabled: true,
        cap_value: 100,
        on_limit: 'block',
      });
      // Above INT4: the cap stays exact (BIGINT column).
      expect(rows['vex.model_tokens']).toMatchObject({
        enabled: true,
        cap_value: 20_000_000_000,
      });
      expect(rows['vex.voice_readout']).toMatchObject({
        enabled: true,
        cap_value: 7200,
      });
      expect(rows['vexi.voice_readout']).toMatchObject({
        enabled: true,
        cap_value: 7200,
      });
      expect(rows['vexi.agent']).toMatchObject({
        enabled: true,
        cap_value: 100,
        on_limit: 'warn',
      });
      expect(rows['vexi.model_tokens'].cap_value).toBe(999_999_999);
      expect(rows['platform.module_ai']).toMatchObject({
        enabled: true,
        cap_value: 999_999_999,
      });
      expect(rows['platform.smart_search']).toMatchObject({
        enabled: true,
        cap_value: 1000,
        on_limit: 'block',
      });
      expect(rows['vex.files'].enabled).toBe(true);
      // Capabilities that do not exist yet migrate switched off.
      expect(rows['vex.code_analysis'].enabled).toBe(false);
      expect(rows['vex.advanced_model'].enabled).toBe(false);
      // F10 (N12): Code Mode is a plain switch, no cap, off in every plan.
      expect(rows['vex.code_mode']).toMatchObject({ enabled: false, cap_value: null });
      expect(findAICapability('vex', 'code_mode')).toMatchObject({
        kind: 'toggle',
        cap_unit: null,
        legacy: null,
        label: 'Scripts de herramientas',
      });
      // The tool-call cap has nowhere to go (N4).
      expect(JSON.stringify(rows)).not.toMatch(/5000/);
    });

    it('turns the legacy "0 or absent = unlimited" into NULL, never into 0', () => {
      const rows = byId(
        legacyFlagsToAIEntitlements({
          vex_agent: { enabled: true, daily_messages_cap: 0 },
          streaming_chat: { enabled: true },
          realtime_voice: { enabled: true, monthly_voice_seconds_cap: -5 },
        }),
      );
      expect(rows['vex.agent'].cap_value).toBeNull();
      expect(rows['vexi.agent'].cap_value).toBeNull();
      expect(rows['vex.voice_readout'].cap_value).toBeNull();
      expect(legacyCapToCapValue('100')).toBeNull();
      expect(legacyCapToCapValue(12.9)).toBe(12);
    });

    it('a plan without AI keys gets every capability off (cap-only rows stay on, gated by the agent)', () => {
      const rows = legacyFlagsToAIEntitlements({});
      rows.forEach((r) => {
        const def = findAICapability(r.agent_key, r.capability_key)!;
        expect({ id: def.capability_key, agent: def.agent_key, enabled: r.enabled })
          .toEqual({
            id: def.capability_key,
            agent: def.agent_key,
            enabled: def.kind === 'cap',
          });
        expect(r.cap_value).toBeNull();
      });
      expect(legacyFlagsToAIEntitlements(null)).toEqual(rows);
      expect(legacyFlagsToAIEntitlements('junk')).toEqual(rows);
    });

    it('a disabled feature stays disabled even if it carries caps', () => {
      const rows = byId(
        legacyFlagsToAIEntitlements({
          vex_agent: { enabled: false, daily_messages_cap: 50 },
        }),
      );
      expect(rows['vex.agent']).toMatchObject({ enabled: false, cap_value: 50 });
    });

    it('patch mode (partner override) only emits capabilities whose legacy key is present', () => {
      const rows = legacyFlagsToAIEntitlements(
        { realtime_voice: { enabled: false } },
        'patch',
      );
      expect(rows.map((r) => aiCapabilityId(r.agent_key, r.capability_key)))
        .toEqual(['vex.voice_readout', 'vexi.voice_readout']);
      expect(rows.every((r) => r.enabled === false)).toBe(true);
    });

    it('defaultAIEntitlement is off with no cap for switches', () => {
      const def = findAICapability('vex', 'code_analysis')!;
      expect(defaultAIEntitlement(def)).toEqual({
        agent_key: 'vex',
        capability_key: 'code_analysis',
        enabled: false,
        cap_value: null,
        on_limit: 'block',
      });
    });
  });
  describe('plain-language summary (S11)', () => {
    const rows = (patch: Record<string, Partial<ReturnType<typeof defaultAIEntitlement>>>) =>
      AI_CAPABILITIES.map((def) => ({
        ...defaultAIEntitlement(def),
        ...(patch[aiCapabilityId(def.agent_key, def.capability_key)] ?? {}),
      }));

    it('formats caps with their unit in words; voice is read in minutes', () => {
      expect(formatAICapValue(findAICapability('vex', 'agent')!, 200)).toBe(
        '200 mensajes al día',
      );
      expect(formatAICapValue(findAICapability('vex', 'model_tokens')!, 50_000_000)).toBe(
        '50 M de tokens al mes',
      );
      expect(formatAICapValue(findAICapability('vex', 'voice_readout')!, 3600)).toBe(
        '60 minutos al mes',
      );
      expect(formatAICapValue(findAICapability('vex', 'agent')!, null)).toBe('sin límite');
      expect(formatAICapValue(findAICapability('vex', 'files')!, null)).toBe('');
    });

    it('writes one sentence per agent with what the plan includes and lacks', () => {
      const lines = describeAIEntitlements(
        rows({
          'vex.agent': { enabled: true, cap_value: 200 },
          'vex.model_tokens': { cap_value: 50_000_000 },
          'vex.voice_readout': { enabled: true, cap_value: 3600 },
          'vex.files': { enabled: true },
          'platform.smart_search': { enabled: true, cap_value: null },
        }),
      );
      expect(lines).toEqual([
        'Vex: 200 mensajes al día, 50 M de tokens al mes, 60 minutos de lectura en voz al mes, con archivos e imágenes, sin análisis con código, sin scripts de herramientas, sin modelo avanzado.',
        'Vexi: no incluido.',
        expect.stringMatching(/^IA en los módulos: .*búsqueda inteligente sin límite\.$/),
      ]);
    });

    it('an agent switched off or capped at 0 is "no incluido"; the platform only when every row is off', () => {
      const lines = describeAIEntitlements(
        rows({ 'vex.agent': { enabled: true, cap_value: 0 } }),
      );
      expect(lines).toEqual([
        'Vex: no incluido.',
        'Vexi: no incluido.',
        'IA en los módulos: no incluido.',
      ]);
    });
  });
});
