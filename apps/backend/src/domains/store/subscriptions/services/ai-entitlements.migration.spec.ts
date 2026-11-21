import { readFileSync } from 'fs';
import { join } from 'path';
import {
  AI_CAPS_BY_LINE,
  aiFeatureFlagsFor,
} from '../../../../../prisma/seeds/plan-commercial-lines.seed';
import { syncSeedPlanAIEntitlements } from '../../../../../prisma/seeds/shared/plan-ai-entitlements';
import {
  AI_CAPABILITIES,
  AIEntitlement,
  legacyFlagsToAIEntitlements,
} from '../types/ai-capabilities';

const BACKEND = join(__dirname, '../../../../..');
const M3 = readFileSync(
  join(
    BACKEND,
    'prisma/migrations/20261223100000_plan_ai_entitlements_backfill/migration.sql',
  ),
  'utf8',
);
const STATEMENTS = M3.split('\n')
  .filter((line) => !line.trimStart().startsWith('--'))
  .join('\n');

type SourceRow = [string, string, string | null, string | null, string | null];

/** The VALUES list of M3: agent, capability, feature, enabled_from, cap_field. */
function m3Sources(): SourceRow[] {
  const block = STATEMENTS.slice(
    STATEMENTS.indexOf('VALUES'),
    STATEMENTS.indexOf(') AS s ('),
  );
  return [...block.matchAll(/\(([^()]*)\)/g)].map((m) =>
    m[1].split(',').map((v) => {
      const t = v.trim();
      return t === 'NULL' ? null : t.replace(/^'|'$/g, '');
    }) as SourceRow,
  );
}

/**
 * The CASE expressions of M3 evaluated over a JS value with Postgres jsonb
 * semantics (`->` on a non-object is NULL, `= 'true'::jsonb` only matches the
 * JSON boolean, the cap casts only after `jsonb_typeof = 'number'`).
 */
function evaluateM3(flags: unknown): AIEntitlement[] {
  const arrow = (v: unknown, key: string | null) =>
    key !== null && v && typeof v === 'object' && !Array.isArray(v)
      ? ((v as Record<string, unknown>)[key] ?? null)
      : null;
  return m3Sources().map(([agent, capability, feature, enabledFrom, capField]) => {
    const f = arrow(flags, feature);
    const raw = capField ? arrow(f, capField) : null;
    const cap =
      typeof raw === 'number' && raw > 0 && raw < 9223372036854775807
        ? Math.trunc(raw)
        : null;
    return {
      agent_key: agent,
      capability_key: capability,
      enabled:
        feature === null ? false : enabledFrom === 'always' ? true : arrow(f, 'enabled') === true,
      cap_value: cap,
      on_limit:
        feature === null ? 'block' : arrow(f, 'degradation') === 'block' ? 'block' : 'warn',
    } as AIEntitlement;
  });
}

describe('M3 — backfill of plan_ai_entitlements from ai_feature_flags (T11)', () => {
  it('encodes exactly the catalog legacy mapping, one VALUES row per capability in order', () => {
    expect(m3Sources()).toEqual(
      AI_CAPABILITIES.map((c) => [
        c.agent_key,
        c.capability_key,
        c.legacy?.feature ?? null,
        c.legacy?.enabled_from ?? null,
        c.legacy?.cap_field ?? null,
      ]),
    );
  });

  it('writes the same rows the catalog translation gives, for the commercial lines and messy legacy JSON', () => {
    const fixtures: unknown[] = [
      ...Object.keys(AI_CAPS_BY_LINE).map((line) =>
        aiFeatureFlagsFor(line as keyof typeof AI_CAPS_BY_LINE),
      ),
      {},
      [],
      {
        vex_agent: { enabled: 'true', daily_messages_cap: '100', degradation: 'block' },
        streaming_chat: { enabled: true, daily_messages_cap: 0 },
        realtime_voice: { enabled: true, monthly_voice_seconds_cap: -5 },
        text_generation: { enabled: true, monthly_tokens_cap: 12.9 },
        rag_embeddings: [1, 2],
      },
      { vex_agent: { enabled: true, monthly_tokens_cap: 20_000_000_000 } },
      { realtime_voice: { enabled: false, monthly_voice_seconds_cap: 7200, degradation: 'block' } },
    ];
    for (const flags of fixtures) {
      expect({ flags, rows: evaluateM3(flags) }).toEqual({
        flags,
        rows: legacyFlagsToAIEntitlements(flags),
      });
    }
  });

  it('the SQL carries the rules the evaluator models', () => {
    expect(STATEMENTS).toMatch(/WHEN s\.source_feature IS NULL THEN false/);
    expect(STATEMENTS).toMatch(/WHEN s\.enabled_from = 'always' THEN true/);
    expect(STATEMENTS).toMatch(/-> 'enabled'\) = 'true'::jsonb/);
    expect(STATEMENTS).toMatch(/IS DISTINCT FROM 'number' THEN NULL/);
    expect(STATEMENTS).toMatch(/::numeric <= 0\s+THEN NULL/);
    expect(STATEMENTS).toMatch(/trunc\(.*::numeric\)::bigint/);
    expect(STATEMENTS).toMatch(/WHEN s\.source_feature IS NULL THEN 'block'/);
    expect(STATEMENTS).toMatch(/-> 'degradation'\) = '"block"'::jsonb/);
  });

  it('is additive and idempotent: only INSERTs plan_ai_entitlements rows that do not exist', () => {
    expect(M3).toMatch(/-- DATA IMPACT:/);
    expect(M3).toMatch(/Reversa:/);
    expect(STATEMENTS).not.toMatch(/\b(UPDATE|DELETE|DROP|TRUNCATE|CASCADE|ALTER)\b/i);
    expect(STATEMENTS.match(/INSERT INTO/g)).toHaveLength(1);
    expect(STATEMENTS).toMatch(/INSERT INTO "plan_ai_entitlements"/);
    expect(STATEMENTS).toMatch(/WHERE NOT EXISTS \(/);
    expect(STATEMENTS).toMatch(
      /ON CONFLICT \("plan_id", "agent_key", "capability_key"\) DO NOTHING;/,
    );
  });
});

describe('seeds keep plan_ai_entitlements in step with ai_feature_flags (T11)', () => {
  function client() {
    return { plan_ai_entitlements: { upsert: jest.fn().mockResolvedValue({}) } };
  }
  const flags = aiFeatureFlagsFor('ia_business' as keyof typeof AI_CAPS_BY_LINE);

  it('upserts the 11 catalog rows with BIGINT caps', async () => {
    const c = client();
    expect(await syncSeedPlanAIEntitlements(c as any, 5, flags)).toBe(11);
    expect(c.plan_ai_entitlements.upsert).toHaveBeenCalledTimes(11);
    const expected = legacyFlagsToAIEntitlements(flags);
    c.plan_ai_entitlements.upsert.mock.calls.forEach(([args], i) => {
      const row = expected[i];
      expect(args.where.plan_id_agent_key_capability_key).toEqual({
        plan_id: 5,
        agent_key: row.agent_key,
        capability_key: row.capability_key,
      });
      expect(args.create).toEqual({
        plan_id: 5,
        agent_key: row.agent_key,
        capability_key: row.capability_key,
        enabled: row.enabled,
        cap_value: row.cap_value === null ? null : BigInt(row.cap_value),
        on_limit: row.on_limit,
      });
      expect(args.update).toMatchObject({ enabled: row.enabled });
    });
  });

  it('with overwriteFeatures, only those rows are rewritten; the rest are created when missing', async () => {
    const c = client();
    await syncSeedPlanAIEntitlements(c as any, 1, flags, ['vex_agent']);
    const updates = Object.fromEntries(
      c.plan_ai_entitlements.upsert.mock.calls.map(([args]) => [
        `${args.create.agent_key}.${args.create.capability_key}`,
        args.update,
      ]),
    );
    expect(Object.keys(updates)).toHaveLength(11);
    expect(updates['vex.agent']).toMatchObject({ enabled: expect.any(Boolean) });
    expect(updates['vex.model_tokens']).toHaveProperty('cap_value');
    expect(updates['vex.files']).toHaveProperty('enabled');
    expect(updates['vexi.agent']).toEqual({});
    expect(updates['vex.voice_readout']).toEqual({});
    expect(updates['vex.code_analysis']).toEqual({});
  });

  it('the production image ships the catalog the seeds import', () => {
    const dockerfile = readFileSync(join(BACKEND, 'Dockerfile'), 'utf8');
    expect(dockerfile).toMatch(
      /COPY --from=builder \/app\/src\/domains\/store\/subscriptions\/types\/ai-capabilities\.ts \.\/src\/domains\/store\/subscriptions\/types\//,
    );
  });
});
