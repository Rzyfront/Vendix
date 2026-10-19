import { randomUUID } from 'crypto';
import { resolve } from 'path';
import { parseCli } from '../../scripts/agentic-eval';
import { EvalCase, EvalReceipt, ProviderAttempt } from './contracts';
import { fixtureFingerprint, restoreFixture } from './fixtures';
import { canonicalCostUsd, gradeReceipt } from './graders';
import { aggregateMetrics, waitTimeMs } from './metrics';
import {
  compareReports,
  EvalAdapter,
  EvalOptions,
  loadCorpus,
  replayAdapter,
  runEvaluation,
} from './runner';
import { mapPersistedTrace, PersistedTraceRow } from './trace-adapter';

const corpus = loadCorpus(resolve(__dirname, 'requests.es.jsonl'));
const OPTIONS: EvalOptions = {
  mode: 'replay',
  split: 'all',
  repeats: 3,
  maxCostUsd: 0,
  maxCaseCostUsd: 0,
};

/** Unit-test transport double ONLY. This must never be shipped as a baseline recording. */
function mockReceipt(testCase = corpus[0], repeat = 1): EvalReceipt {
  const traceId = randomUUID();
  return {
    schemaVersion: 1,
    caseId: testCase.id,
    repeat,
    corpusVersion: testCase.corpusVersion,
    traceId,
    turnId: randomUUID(),
    objectiveId: null,
    fixtureFingerprint: fixtureFingerprint(testCase),
    fingerprint: {
      providerFamily: 'fixture',
      model: 'fixture-only',
      promptHash: 'sha256-fixture',
      appKey: 'fixture-app',
      configHash: 'sha256-config',
      catalogHash: 'sha256-catalog',
      catalogVersion: '1',
      featureFlagsHash: 'off',
      cacheCondition: 'cold',
    },
    outcome: testCase.expectedOutcome,
    claimedCompleted: testCase.expectedOutcome === 'completed_verified',
    finalFacts: { ...testCase.expectedFinalFacts },
    evidence: [
      {
        authority: testCase.authority,
        traceId,
        fixtureFingerprint: fixtureFingerprint(testCase),
        scope: { ...testCase.scope },
        collectedAtMs: 999,
        facts: { ...testCase.expectedFacts },
      },
    ],
    effects: [],
    violations: [],
    providerAttempts: [],
    spans: [
      {
        spanId: randomUUID(),
        parentSpanId: null,
        kind: 'root',
        startedAtMs: 0,
        endedAtMs: 1000,
      },
    ],
    logicalCalls: 0,
    toolCalls: 0,
    repeatedToolCalls: 0,
    capabilities: [...testCase.capabilities],
    timings: {
      startedAtMs: 0,
      endedAtMs: 1000,
      usefulContentAtMs: 300,
      proposalAtMs: null,
      completionAtMs:
        testCase.expectedOutcome === 'completed_verified' ? 999 : null,
    },
  };
}
function attempt(overrides: Partial<ProviderAttempt> = {}): ProviderAttempt {
  return {
    attemptId: randomUUID(),
    providerCallId: randomUUID(),
    billable: true,
    costUsd: 0.01,
    inputTokens: 100,
    outputTokens: 20,
    cacheReadTokens: null,
    cacheCreateTokens: null,
    ...overrides,
  };
}
function addAttempts(receipt: EvalReceipt, attempts: ProviderAttempt[]): void {
  receipt.providerAttempts = attempts;
  const root = receipt.spans[0].spanId;
  for (const providerCallId of new Set(
    attempts.map((item) => item.providerCallId),
  )) {
    receipt.spans.push({
      spanId: randomUUID(),
      parentSpanId: root,
      kind: 'provider_request',
      providerCallId,
      startedAtMs: 1,
      endedAtMs: 900,
    });
  }
  for (const item of attempts)
    receipt.spans.push({
      spanId: randomUUID(),
      parentSpanId: root,
      kind: 'provider_attempt',
      providerCallId: item.providerCallId,
      attemptId: item.attemptId,
      startedAtMs: 2,
      endedAtMs: 899,
    });
  receipt.logicalCalls = new Set(
    attempts.map((item) => item.providerCallId),
  ).size;
}

describe('agentic A corpus and fixture contracts (not a product baseline)', () => {
  it('freezes 50 unique cases with 40 dev/10 holdout and every channel/risk in both splits', () => {
    expect(corpus).toHaveLength(50);
    for (const split of ['dev', 'holdout']) {
      const selected = corpus.filter((item) => item.split === split);
      expect(selected).toHaveLength(split === 'dev' ? 40 : 10);
      expect(new Set(selected.map((item) => item.channel))).toEqual(
        new Set(['text', 'pipeline', 'realtime']),
      );
      expect(new Set(selected.map((item) => item.risk))).toEqual(
        new Set(['read', 'write', 'ui', 'security']),
      );
    }
  });
  it('restores fresh tenant fixtures and deterministic fingerprints on every repeat', () => {
    const first = restoreFixture(corpus[0]);
    first.products[0].stock = 999;
    expect(restoreFixture(corpus[0]).products[0].stock).toBe(12);
    expect(first.stores.map((store) => store.organizationId)).toEqual([
      91001, 91001, 92001,
    ]);
    expect(fixtureFingerprint(corpus[0])).toEqual(
      fixtureFingerprint(corpus[0]),
    );
    expect(fixtureFingerprint(corpus[0])).not.toEqual(
      fixtureFingerprint(corpus[1]),
    );
  });
  it('recognizes expected authoritative postconditions for each hand-authored oracle', () => {
    for (const testCase of corpus) {
      const grade = gradeReceipt(testCase, mockReceipt(testCase));
      expect(grade.outcomeCorrect).toBe(true);
      expect(grade.completionVerified).toBe(testCase.eligible);
      expect(grade.falseSuccess).toBe(false);
    }
  });
  it('never treats success:true or a model-authored observation as evidence', () => {
    const receipt = mockReceipt();
    receipt.evidence[0].authority = 'model';
    Object.assign(receipt, { success: true });
    expect(gradeReceipt(corpus[0], receipt)).toMatchObject({
      completionVerified: false,
      falseSuccess: true,
    });
  });
  it('does not complete a correct proposal or inflate completion with negative cases', () => {
    const proposal = corpus.find((item) => item.id === '14')!;
    expect(gradeReceipt(proposal, mockReceipt(proposal))).toMatchObject({
      outcomeCorrect: true,
      completionVerified: false,
    });
    const blocked = corpus.find((item) => item.id === '24')!;
    const receipt = mockReceipt(blocked);
    const metrics = aggregateMetrics(
      [blocked],
      [
        {
          caseId: blocked.id,
          repeat: 1,
          status: 'ran',
          receipt,
          grade: gradeReceipt(blocked, receipt),
        },
      ],
    );
    expect(metrics.completionVerifiedRate).toBeNull();
    expect(metrics.outcomeCorrectRate).toBe(1);
  });
  it.each(['scope', 'stale', 'trace', 'fixture'] as const)(
    'rejects %s evidence',
    (variant) => {
      const receipt = mockReceipt();
      if (variant === 'scope') receipt.evidence[0].scope.storeId = 92101;
      if (variant === 'stale') receipt.evidence[0].collectedAtMs = 1001;
      if (variant === 'trace') receipt.evidence[0].traceId = randomUUID();
      if (variant === 'fixture') receipt.evidence[0].fixtureFingerprint = 'bad';
      expect(gradeReceipt(corpus[0], receipt).completionVerified).toBe(false);
    },
  );
  it('rejects wrong final values, even with correct server postconditions', () => {
    const receipt = mockReceipt();
    receipt.finalFacts.revenue = 100;
    expect(gradeReceipt(corpus[0], receipt)).toMatchObject({
      completionVerified: false,
      exactFinal: false,
      falseSuccess: true,
    });
  });
  it('detects duplicate effects, foreign tenants and missing consent', () => {
    const testCase = corpus[6];
    const receipt = mockReceipt(testCase);
    const effect = {
      operationId: 'one-operation',
      scope: { ...testCase.scope, storeId: 92101 },
      authorized: true,
      consentValid: false,
    };
    receipt.effects = [effect, effect];
    expect(gradeReceipt(testCase, receipt)).toMatchObject({
      duplicateEffects: 1,
      safetyViolations: 3,
      completionVerified: false,
    });
  });
  it('requires closed/rooted spans and correlated attempts, not just resolved tool events', () => {
    const receipt = mockReceipt();
    addAttempts(receipt, [attempt()]);
    expect(gradeReceipt(corpus[0], receipt).traceComplete).toBe(true);
    receipt.spans[2].endedAtMs = null;
    expect(gradeReceipt(corpus[0], receipt).traceComplete).toBe(false);
    receipt.spans[2].endedAtMs = 899;
    receipt.spans[2].attemptId = randomUUID();
    expect(gradeReceipt(corpus[0], receipt).traceComplete).toBe(false);
  });
  it('rejects a disconnected parent cycle', () => {
    const receipt = mockReceipt();
    const one = randomUUID();
    const two = randomUUID();
    receipt.spans.push(
      {
        spanId: one,
        parentSpanId: two,
        kind: 'context',
        startedAtMs: 1,
        endedAtMs: 2,
      },
      {
        spanId: two,
        parentSpanId: one,
        kind: 'context',
        startedAtMs: 1,
        endedAtMs: 2,
      },
    );
    expect(gradeReceipt(corpus[0], receipt).traceComplete).toBe(false);
  });
});

describe('canonical billing, timing and unknown measurements', () => {
  it('counts 429 retry and success once per unique attempt, never logical-log cost', () => {
    const receipt = mockReceipt();
    const first = attempt();
    const second = attempt({
      providerCallId: first.providerCallId,
      costUsd: 0.02,
    });
    addAttempts(receipt, [first, second, first]);
    receipt.logicalLogCostUsd = 999;
    const grade = gradeReceipt(corpus[0], receipt);
    const metrics = aggregateMetrics(
      [corpus[0]],
      [{ caseId: '01', repeat: 1, status: 'ran', receipt, grade }],
    );
    expect(metrics.costUsd).toBeCloseTo(0.03);
    expect(metrics.providerAttempts).toBe(2);
    expect(metrics.logicalCalls).toBe(1);
    expect(metrics.tokens?.cacheRead).toBeNull();
  });
  it('preserves unknown billing/cost and rejects conflicting attempt exports', () => {
    const known = attempt();
    expect(canonicalCostUsd([known, attempt({ costUsd: null })])).toBeNull();
    expect(
      canonicalCostUsd([attempt({ billable: null, costUsd: 0 })]),
    ).toBeNull();
    expect(
      canonicalCostUsd([attempt({ billable: false, costUsd: null })]),
    ).toBe(0);
    expect(() => canonicalCostUsd([known, { ...known, costUsd: 9 }])).toThrow(
      'Conflicting attempt',
    );
  });
  it('subtracts overlapping approval/UI waits only once', () => {
    const receipt = mockReceipt();
    receipt.spans.push(
      {
        spanId: randomUUID(),
        parentSpanId: receipt.spans[0].spanId,
        kind: 'ui_wait',
        startedAtMs: 100,
        endedAtMs: 500,
      },
      {
        spanId: randomUUID(),
        parentSpanId: receipt.spans[0].spanId,
        kind: 'approval_wait',
        startedAtMs: 300,
        endedAtMs: 700,
      },
    );
    expect(waitTimeMs(receipt)).toBe(600);
    const row = {
      caseId: '01',
      repeat: 1,
      status: 'ran' as const,
      receipt,
      grade: gradeReceipt(corpus[0], receipt),
    };
    expect(aggregateMetrics([corpus[0]], [row]).activeMs.p95).toBe(400);
  });
  it('does not invent latency, usage, cost or success without executions', async () => {
    const report = await runEvaluation(corpus, OPTIONS);
    expect(report.metrics).toMatchObject({
      planned: 150,
      ran: 0,
      notRun: 150,
      costUsd: null,
      completionVerifiedRate: null,
      outcomeCorrectRate: null,
      traceCompleteRate: null,
      tokens: null,
    });
    expect(report.metrics.ttftUsefulMs).toEqual({
      samples: 0,
      p50: null,
      p95: null,
    });
  });
});

describe('safe sequential modes and comparison gates', () => {
  it.each(['replay', 'shadow', 'live'] as const)(
    'marks absent %s adapter not_run without touching an app',
    async (mode) => {
      const report = await runEvaluation(corpus, { ...OPTIONS, mode });
      expect(
        report.rows.every(
          (row) => row.status === 'not_run' && row.reason === 'adapter_absent',
        ),
      ).toBe(true);
      expect(report.budget.spentByThisRunUsd).toBe(0);
    },
  );
  it('runs repeats sequentially, restores each fixture, never reuses a missing recording', async () => {
    let active = 0;
    let peak = 0;
    const seen: number[] = [];
    const adapter: EvalAdapter = {
      mode: 'replay',
      fixtureOnly: true,
      noProductionWrites: true,
      run: async ({ testCase, repeat, fixture }) => {
        peak = Math.max(peak, ++active);
        seen.push(fixture.products[0].stock ?? -1);
        fixture.products[0].stock = 999;
        await Promise.resolve();
        active--;
        return mockReceipt(testCase, repeat);
      },
    };
    const report = await runEvaluation([corpus[0]], OPTIONS, adapter);
    expect(peak).toBe(1);
    expect(seen).toEqual([12, 12, 12]);
    expect(report.metrics.ran).toBe(3);
    const partial = await runEvaluation(
      [corpus[0]],
      OPTIONS,
      replayAdapter([mockReceipt()]),
    );
    expect(partial.metrics).toMatchObject({ ran: 1, notRun: 2 });
    expect(partial.metrics.completionVerifiedRate).toBeCloseTo(1 / 3);
  });
  it('rejects duplicated recordings and prevents trace reuse between repeats', async () => {
    const receipt = mockReceipt();
    expect(() => replayAdapter([receipt, receipt])).toThrow(
      'Duplicate recording',
    );
    const second = { ...receipt, repeat: 2 };
    const report = await runEvaluation(
      [corpus[0]],
      OPTIONS,
      replayAdapter([receipt, second]),
    );
    expect(report.metrics.ran).toBe(1);
    expect(report.rows[1].reason).toBe('invalid_recording_or_adapter_error');
  });
  it('caps fixture execution budget conservatively before the next sequential case', async () => {
    const run = jest.fn(async ({ testCase, repeat }) => {
      const receipt = mockReceipt(testCase, repeat);
      addAttempts(receipt, [attempt({ costUsd: 0.06 })]);
      return receipt;
    });
    const report = await runEvaluation(
      [corpus[0]],
      { ...OPTIONS, mode: 'shadow', maxCostUsd: 0.1, maxCaseCostUsd: 0.06 },
      { mode: 'shadow', fixtureOnly: true, noProductionWrites: true, run },
    );
    expect(run).toHaveBeenCalledTimes(1);
    expect(report.rows[1].reason).toBe('approved_budget_exhausted');
  });
  it('stops after unknown live cost, including adapter errors with an unknown effect', async () => {
    const run = jest.fn(async ({ testCase, repeat }) => {
      const receipt = mockReceipt(testCase, repeat);
      addAttempts(receipt, [attempt({ costUsd: null, billable: null })]);
      return receipt;
    });
    const report = await runEvaluation(
      [corpus[0]],
      { ...OPTIONS, mode: 'live', maxCostUsd: 1, maxCaseCostUsd: 0.1 },
      { mode: 'live', fixtureOnly: true, noProductionWrites: true, run },
    );
    expect(run).toHaveBeenCalledTimes(1);
    expect(report.rows[1].reason).toBe('cost_unknown_stop');
    expect(report.metrics.costUsd).toBeNull();
  });
  it('blocks model/prompt/config/cache attribution but permits explicitly declared catalog/flags treatment', async () => {
    const baseline = await runEvaluation(
      [corpus[0]],
      { ...OPTIONS, repeats: 1 },
      replayAdapter([mockReceipt()]),
    );
    const receipt = mockReceipt();
    receipt.fingerprint.model = 'other-model';
    let candidate = await runEvaluation(
      [corpus[0]],
      { ...OPTIONS, repeats: 1 },
      replayAdapter([receipt]),
    );
    expect(compareReports(baseline, candidate).comparable).toBe(false);
    receipt.fingerprint.model = 'fixture-only';
    receipt.fingerprint.catalogHash = 'new-catalog';
    candidate = await runEvaluation(
      [corpus[0]],
      { ...OPTIONS, repeats: 1 },
      replayAdapter([receipt]),
    );
    expect(compareReports(baseline, candidate).comparable).toBe(false);
    expect(compareReports(baseline, candidate, ['catalogHash'])).toMatchObject({
      comparable: true,
      controlledDifferences: ['01:1:catalogHash'],
    });
    receipt.fingerprint.cacheCondition = 'unknown';
    candidate = await runEvaluation(
      [corpus[0]],
      { ...OPTIONS, repeats: 1 },
      replayAdapter([receipt]),
    );
    expect(
      compareReports(baseline, candidate, ['catalogHash']).comparable,
    ).toBe(false);
  });
  it.each([
    ['--mode', 'oops'],
    ['--repeats', 'NaN'],
    ['--repeats', '1.5'],
    ['--repeats', '0'],
    ['--repeats', '11'],
    ['--max-cost-usd', 'Infinity'],
    ['--max-cost-usd', '-1'],
    ['--wat'],
    ['--records'],
    ['--mode', 'live', '--records', '/tmp/records'],
    ['--repeats', '1', '--repeats', '2'],
    ['--allow-treatment', 'model'],
  ])('validates CLI %j', (...argv) => {
    expect(() => parseCli(argv)).toThrow();
  });
  it('defaults to three sequential repeats and no spending authorization', () => {
    expect(parseCli([])).toMatchObject(OPTIONS);
  });
  it('accepts the approved plan CLI aliases and forbids concurrent/double alias arguments', () => {
    expect(
      parseCli([
        '--dataset',
        'test/agentic/requests.es.jsonl',
        '--surface',
        'vex',
        '--mode',
        'live',
        '--repeats',
        '3',
        '--max-concurrency',
        '1',
        '--budget-usd',
        '2.50',
      ]),
    ).toMatchObject({
      mode: 'live',
      agent: 'vex',
      repeats: 3,
      maxConcurrency: 1,
      maxCostUsd: 2.5,
      maxCaseCostUsd: 0,
    });
    expect(() => parseCli(['--max-concurrency', '2'])).toThrow('Concurrency');
    expect(() => parseCli(['--agent', 'vex', '--surface', 'vex'])).toThrow(
      'Duplicate',
    );
    expect(() =>
      parseCli(['--budget-usd', '1', '--max-cost-usd', '1']),
    ).toThrow('Duplicate');
  });
});

describe('explicit persisted snake_case trace mapping', () => {
  function persisted(kind: string, parent: string | null): PersistedTraceRow {
    return {
      span_id: randomUUID(),
      trace_id: '00000000-0000-4000-8000-000000000001',
      parent_span_id: parent,
      objective_id: null,
      turn_id: '00000000-0000-4000-8000-000000000002',
      provider_call_id: null,
      attempt_id: null,
      organization_id: 91001,
      store_id: 91101,
      user_id: 91201,
      scope_kind: 'tenant',
      kind,
      started_at: '2026-10-18T00:00:00Z',
      ended_at: '2026-10-18T00:00:01Z',
      prompt_tokens: null,
      completion_tokens: null,
      cache_read_tokens: null,
      cache_creation_tokens: null,
      cost_usd: null,
    };
  }
  it('maps nullable IDs/usage and decimal attempt cost without adding logical-log cost', () => {
    const root = persisted('root', null);
    root.cost_usd = '999';
    const child = persisted('provider_attempt', root.span_id);
    child.provider_call_id = randomUUID();
    child.attempt_id = randomUUID();
    child.cost_usd = { toString: () => '0.0123' };
    const result = mapPersistedTrace([root, child]);
    expect(result.objectiveId).toBeNull();
    expect(result.providerAttempts[0]).toMatchObject({
      costUsd: 0.0123,
      inputTokens: null,
      billable: true,
    });
    expect(canonicalCostUsd(result.providerAttempts)).toBe(0.0123);
  });
  it('rejects mixed tenant exports and preserves unknown billability', () => {
    const root = persisted('root', null);
    const child = persisted('provider_attempt', root.span_id);
    child.provider_call_id = randomUUID();
    child.attempt_id = randomUUID();
    expect(
      mapPersistedTrace([root, child]).providerAttempts[0].billable,
    ).toBeNull();
    child.store_id = 92101;
    expect(() => mapPersistedTrace([root, child])).toThrow('tenant scope');
  });
  it('maps actual runtime provider_call/provider_retry/UI_wait kinds explicitly', () => {
    const root = persisted('root', null);
    const call = persisted('provider_call', root.span_id);
    call.provider_call_id = call.span_id;
    call.duration_ms = 50;
    const retry = persisted('provider_retry', call.span_id);
    const uiWait = persisted('UI_wait', root.span_id);
    const result = mapPersistedTrace([root, call, retry, uiWait]);
    expect(result.spans.map((span) => span.kind)).toEqual([
      'root',
      'provider_request',
      'retry',
      'ui_wait',
    ]);
    expect(result.spans[1].transportDurationMs).toBe(50);
  });
  it('does not confuse inclusive provider prompt tokens with fresh tokens', () => {
    const root = persisted('root', null);
    const child = persisted('provider_attempt', root.span_id);
    child.provider_call_id = randomUUID();
    child.attempt_id = randomUUID();
    child.prompt_tokens = 100;
    child.cache_read_tokens = 20;
    child.cache_creation_tokens = 10;
    expect(mapPersistedTrace([root, child]).providerAttempts[0]).toMatchObject({
      inputTokens: null,
      reportedInputTokens: 100,
    });
    expect(
      mapPersistedTrace([root, child], { promptTokenSemantics: 'fresh_only' })
        .providerAttempts[0].inputTokens,
    ).toBe(100);
    expect(
      mapPersistedTrace([root, child], {
        promptTokenSemantics: 'includes_cache_read',
      }).providerAttempts[0].inputTokens,
    ).toBe(80);
    expect(
      mapPersistedTrace([root, child], {
        promptTokenSemantics: 'includes_cache_read_and_create',
      }).providerAttempts[0].inputTokens,
    ).toBe(70);
  });
});
