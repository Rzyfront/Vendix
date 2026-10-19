import { readFileSync } from 'fs';
import { createHash } from 'crypto';
import {
  EvalCase,
  EvalFingerprint,
  EvalMode,
  EvalReceipt,
  EvalRow,
} from './contracts';
import {
  CORPUS_VERSION,
  fixtureFingerprint,
  restoreFixture,
  stableJson,
} from './fixtures';
import { canonicalCostUsd, gradeReceipt, UUID } from './graders';
import { aggregateMetrics } from './metrics';

export interface EvalOptions {
  mode: EvalMode;
  split: 'all' | 'dev' | 'holdout';
  repeats: number;
  maxCostUsd: number;
  maxCaseCostUsd: number;
  agent?: 'all' | 'vex' | 'vexi';
  channel?: 'all' | 'text' | 'pipeline' | 'realtime';
}
export interface EvalAdapter {
  /** No production adapter ships in phase A. Implement only in an authorized fixture environment. */
  mode: EvalMode;
  fixtureOnly: true;
  noProductionWrites: true;
  run(input: {
    testCase: EvalCase;
    repeat: number;
    fixture: ReturnType<typeof restoreFixture>;
    fixtureFingerprint: string;
    maxCostUsd: number;
  }): Promise<EvalReceipt | null>;
}

function assert(condition: unknown, reason: string): asserts condition {
  if (!condition) throw new Error(reason);
}
const nonnegative = (value: unknown): value is number =>
  typeof value === 'number' && Number.isFinite(value) && value >= 0;
const count = (value: unknown) => nonnegative(value) && Number.isInteger(value);
const nullableNumber = (value: unknown) => value === null || nonnegative(value);
const OUTCOMES = new Set([
  'completed_verified',
  'awaiting_approval',
  'awaiting_input',
  'blocked_permission',
  'blocked_plan',
  'not_found',
  'partial',
  'unknown_effect',
  'failed',
  'cancelled',
]);

export function validateFingerprint(value: EvalFingerprint): void {
  assert(value && typeof value === 'object', 'Missing fingerprint');
  for (const key of [
    'providerFamily',
    'model',
    'promptHash',
    'appKey',
    'configHash',
    'catalogHash',
    'catalogVersion',
    'featureFlagsHash',
  ] as const) {
    assert(
      typeof value[key] === 'string' &&
        /^[a-zA-Z0-9_.:@/-]{1,160}$/.test(value[key]),
      `Invalid fingerprint ${key}`,
    );
  }
  assert(
    ['cold', 'warm', 'unknown'].includes(value.cacheCondition),
    'Invalid cache condition',
  );
}

export function validateReceipt(receipt: EvalReceipt): void {
  assert(
    receipt && typeof receipt === 'object' && receipt.schemaVersion === 1,
    'Invalid receipt schema',
  );
  assert(
    typeof receipt.caseId === 'string' && /^\d{2}$/.test(receipt.caseId),
    'Invalid case ID',
  );
  assert(count(receipt.repeat) && receipt.repeat >= 1, 'Invalid repeat');
  assert(receipt.corpusVersion === CORPUS_VERSION, 'Unknown corpus version');
  for (const id of [receipt.traceId, receipt.turnId])
    assert(UUID.test(id), 'Invalid correlation UUID');
  assert(
    receipt.objectiveId === null || UUID.test(receipt.objectiveId),
    'Invalid objective UUID',
  );
  assert(
    typeof receipt.fixtureFingerprint === 'string' &&
      /^[a-f0-9]{64}$/.test(receipt.fixtureFingerprint),
    'Invalid fixture fingerprint',
  );
  validateFingerprint(receipt.fingerprint);
  assert(OUTCOMES.has(receipt.outcome), 'Invalid outcome');
  assert(
    typeof receipt.claimedCompleted === 'boolean',
    'Invalid completion claim',
  );
  for (const value of [
    receipt.finalFacts,
    ...(receipt.evidence ?? []).map((item) => item.facts),
  ]) {
    assert(
      value && !Array.isArray(value) && typeof value === 'object',
      'Invalid facts',
    );
    assert(
      Object.values(value).every(
        (item) =>
          item === null ||
          typeof item === 'string' ||
          typeof item === 'boolean' ||
          (typeof item === 'number' && Number.isFinite(item)),
      ),
      'Invalid fact value',
    );
  }
  for (const field of [
    'evidence',
    'effects',
    'violations',
    'providerAttempts',
    'spans',
    'capabilities',
  ] as const) {
    assert(Array.isArray(receipt[field]), `Missing ${field}`);
  }
  const timings = receipt.timings;
  assert(
    timings &&
      nonnegative(timings.startedAtMs) &&
      nonnegative(timings.endedAtMs) &&
      timings.endedAtMs >= timings.startedAtMs,
    'Invalid timing interval',
  );
  for (const field of [
    'usefulContentAtMs',
    'proposalAtMs',
    'completionAtMs',
  ] as const) {
    const value = timings[field];
    assert(
      value === null ||
        (nonnegative(value) &&
          value >= timings.startedAtMs &&
          value <= timings.endedAtMs),
      `Invalid timing ${field}`,
    );
  }
  for (const attempt of receipt.providerAttempts) {
    assert(
      UUID.test(attempt.attemptId) && UUID.test(attempt.providerCallId),
      'Invalid attempt UUID',
    );
    assert(
      attempt.billable === null || typeof attempt.billable === 'boolean',
      'Invalid billable indicator',
    );
    assert(nullableNumber(attempt.costUsd), 'Invalid attempt cost');
    for (const field of [
      'inputTokens',
      'outputTokens',
      'cacheReadTokens',
      'cacheCreateTokens',
    ] as const) {
      assert(
        attempt[field] === null || count(attempt[field]),
        `Invalid usage ${field}`,
      );
    }
  }
  canonicalCostUsd(receipt.providerAttempts); // validates duplicate/conflicting attempts too
  for (const span of receipt.spans) {
    assert(
      nonnegative(span.startedAtMs) && nullableNumber(span.endedAtMs),
      'Invalid span interval',
    );
  }
  for (const field of [
    'logicalCalls',
    'toolCalls',
    'repeatedToolCalls',
  ] as const)
    assert(count(receipt[field]), `Invalid ${field}`);
  assert(
    receipt.repeatedToolCalls <= receipt.toolCalls,
    'Repeated calls exceed tools',
  );
  for (const evidence of receipt.evidence) {
    assert(
      ['server', 'ui', 'guard', 'model'].includes(evidence.authority) &&
        nonnegative(evidence.collectedAtMs),
      'Invalid evidence',
    );
    assert(
      evidence.scope &&
        [
          evidence.scope.organizationId,
          evidence.scope.storeId,
          evidence.scope.userId,
        ].every(count),
      'Invalid evidence scope',
    );
  }
  for (const effect of receipt.effects) {
    assert(
      typeof effect.operationId === 'string' &&
        effect.operationId.length > 0 &&
        effect.operationId.length <= 160,
      'Invalid effect identity',
    );
    assert(
      effect.scope &&
        [
          effect.scope.organizationId,
          effect.scope.storeId,
          effect.scope.userId,
        ].every(count),
      'Invalid effect scope',
    );
    assert(
      typeof effect.authorized === 'boolean' &&
        typeof effect.consentValid === 'boolean',
      'Invalid effect authorization',
    );
  }
  if (receipt.retrieval) {
    assert(
      Array.isArray(receipt.retrieval.relevant) &&
        Array.isArray(receipt.retrieval.retrieved) &&
        count(receipt.retrieval.k) &&
        count(receipt.retrieval.expansions) &&
        count(receipt.retrieval.recipes),
      'Invalid retrieval measurement',
    );
  }
}

export function loadCorpus(path: string): EvalCase[] {
  const cases = readFileSync(path, 'utf8')
    .trim()
    .split(/\r?\n/)
    .map((line) => JSON.parse(line) as EvalCase);
  assert(
    cases.length === 50 &&
      new Set(cases.map((testCase) => testCase.id)).size === 50,
    'Corpus must contain 50 unique cases',
  );
  assert(
    cases.filter((testCase) => testCase.split === 'dev').length === 40 &&
      cases.filter((testCase) => testCase.split === 'holdout').length === 10,
    'Corpus split must be 40/10',
  );
  for (let i = 0; i < cases.length; i++) {
    const testCase = cases[i];
    assert(
      testCase.id === String(i + 1).padStart(2, '0') &&
        testCase.corpusVersion === CORPUS_VERSION,
      'Invalid corpus identity/order',
    );
    assert(
      OUTCOMES.has(testCase.expectedOutcome) &&
        Object.keys(testCase.expectedFacts).length > 0,
      'Missing oracle',
    );
    assert(
      testCase.eligible === (testCase.expectedOutcome === 'completed_verified'),
      'Inconsistent eligibility',
    );
  }
  return cases;
}

export function replayAdapter(receipts: EvalReceipt[]): EvalAdapter {
  const records = new Map<string, EvalReceipt>();
  for (const receipt of receipts) {
    validateReceipt(receipt);
    const key = `${receipt.caseId}:${receipt.repeat}`;
    assert(!records.has(key), `Duplicate recording ${key}`);
    records.set(key, receipt);
  }
  return {
    mode: 'replay',
    fixtureOnly: true,
    noProductionWrites: true,
    run: async ({ testCase, repeat }) =>
      records.get(`${testCase.id}:${repeat}`) ?? null,
  };
}

export function validateOptions(options: EvalOptions): void {
  assert(['replay', 'shadow', 'live'].includes(options.mode), 'Invalid mode');
  assert(['all', 'dev', 'holdout'].includes(options.split), 'Invalid split');
  assert(
    Number.isInteger(options.repeats) &&
      options.repeats >= 1 &&
      options.repeats <= 10,
    'Repeats must be 1..10',
  );
  assert(
    nonnegative(options.maxCostUsd) && nonnegative(options.maxCaseCostUsd),
    'Budgets must be finite and nonnegative',
  );
  assert(
    options.maxCaseCostUsd <= options.maxCostUsd,
    'Per-case budget exceeds total budget',
  );
  assert(
    options.agent === undefined ||
      ['all', 'vex', 'vexi'].includes(options.agent),
    'Invalid agent',
  );
  assert(
    options.channel === undefined ||
      ['all', 'text', 'pipeline', 'realtime'].includes(options.channel),
    'Invalid channel',
  );
}

export async function runEvaluation(
  corpus: EvalCase[],
  options: EvalOptions,
  adapter?: EvalAdapter,
) {
  validateOptions(options);
  const cases = corpus.filter(
    (testCase) =>
      (options.split === 'all' || testCase.split === options.split) &&
      (!options.agent ||
        options.agent === 'all' ||
        testCase.agent === options.agent) &&
      (!options.channel ||
        options.channel === 'all' ||
        testCase.channel === options.channel),
  );
  if (adapter)
    assert(
      adapter.mode === options.mode &&
        adapter.fixtureOnly &&
        adapter.noProductionWrites,
      'Unsafe/mismatched adapter',
    );
  const rows: EvalRow[] = [];
  let spentUsd = 0;
  let spendUnknown = false;
  let stopReason: string | undefined;
  const usedTraces = new Set<string>();
  const usedAttempts = new Set<string>();
  for (const testCase of cases) {
    for (let repeat = 1; repeat <= options.repeats; repeat++) {
      const skip = (reason: string) =>
        rows.push({ caseId: testCase.id, repeat, status: 'not_run', reason });
      if (!adapter) {
        skip('adapter_absent');
        continue;
      }
      if (stopReason) {
        skip(stopReason);
        continue;
      }
      const remaining = options.maxCostUsd - spentUsd;
      if (
        options.mode !== 'replay' &&
        (options.maxCaseCostUsd <= 0 || remaining < options.maxCaseCostUsd)
      ) {
        skip('approved_budget_exhausted');
        continue;
      }
      try {
        // Intentionally awaited inside BOTH loops: never Promise.all, workers or parallel repeats.
        const receipt = await adapter.run({
          testCase,
          repeat,
          fixture: restoreFixture(testCase),
          fixtureFingerprint: fixtureFingerprint(testCase),
          maxCostUsd:
            options.mode === 'replay'
              ? 0
              : Math.min(options.maxCaseCostUsd, remaining),
        });
        if (!receipt) {
          skip('recording_or_capability_absent');
          continue;
        }
        validateReceipt(receipt);
        assert(
          receipt.caseId === testCase.id && receipt.repeat === repeat,
          'Recording identity mismatch',
        );
        assert(
          !usedTraces.has(receipt.traceId),
          'Trace reused across independent repetitions',
        );
        assert(
          !receipt.providerAttempts.some((attempt) =>
            usedAttempts.has(attempt.attemptId),
          ),
          'Attempt reused across independent repetitions',
        );
        usedTraces.add(receipt.traceId);
        for (const attempt of receipt.providerAttempts)
          usedAttempts.add(attempt.attemptId);
        const cost = canonicalCostUsd(receipt.providerAttempts);
        if (options.mode !== 'replay') {
          if (cost === null) {
            stopReason = 'cost_unknown_stop';
            spendUnknown = true;
          } else {
            spentUsd += cost;
            if (cost > options.maxCaseCostUsd || spentUsd > options.maxCostUsd)
              stopReason = 'adapter_budget_violation_stop';
          }
        }
        const grade = gradeReceipt(testCase, receipt);
        if (stopReason === 'adapter_budget_violation_stop') {
          grade.safetyViolations++;
          grade.reasons.push(stopReason);
          grade.outcomeCorrect = false;
          grade.completionVerified = false;
          grade.falseSuccess =
            receipt.claimedCompleted ||
            receipt.outcome === 'completed_verified';
        }
        rows.push({
          caseId: testCase.id,
          repeat,
          status: 'ran',
          receipt,
          grade,
        });
      } catch {
        // A failing live adapter may already have spent money; do not retry or continue blindly.
        skip('invalid_recording_or_adapter_error');
        if (options.mode !== 'replay') {
          stopReason = 'adapter_error_stop_unknown_cost';
          spendUnknown = true;
        }
      }
    }
  }
  const strata = new Set(
    cases.map(
      (testCase) => `${testCase.agent}/${testCase.channel}/${testCase.risk}`,
    ),
  );
  const configurations = new Map<
    string,
    { fingerprint: EvalFingerprint; rows: EvalRow[] }
  >();
  for (const row of rows.filter((item) => item.receipt)) {
    const fingerprint = row.receipt!.fingerprint;
    const key = createHash('sha256')
      .update(stableJson(fingerprint))
      .digest('hex');
    const group = configurations.get(key) ?? { fingerprint, rows: [] };
    group.rows.push(row);
    configurations.set(key, group);
  }
  return {
    schemaVersion: 1 as const,
    corpusVersion: CORPUS_VERSION,
    corpusHash: createHash('sha256').update(stableJson(corpus)).digest('hex'),
    mode: options.mode,
    split: options.split,
    repeats: options.repeats,
    selection: {
      agent: options.agent ?? 'all',
      channel: options.channel ?? 'all',
    },
    budget: {
      maxCostUsd: options.maxCostUsd,
      maxCaseCostUsd: options.maxCaseCostUsd,
      knownSpentByThisRunUsd: options.mode === 'replay' ? 0 : spentUsd,
      spentByThisRunUsd:
        options.mode === 'replay' ? 0 : spendUnknown ? null : spentUsd,
    },
    metrics: aggregateMetrics(cases, rows),
    comparableSubset: aggregateMetrics(
      cases.filter((testCase) => testCase.baselineComparable),
      rows.filter(
        (row) =>
          cases.find((testCase) => testCase.id === row.caseId)!
            .baselineComparable,
      ),
    ),
    phaseGNewSubset: aggregateMetrics(
      cases.filter((testCase) => !testCase.baselineComparable),
      rows.filter(
        (row) =>
          !cases.find((testCase) => testCase.id === row.caseId)!
            .baselineComparable,
      ),
    ),
    strata: Object.fromEntries(
      [...strata].map((stratum) => {
        const selected = cases.filter(
          (testCase) =>
            `${testCase.agent}/${testCase.channel}/${testCase.risk}` ===
            stratum,
        );
        return [
          stratum,
          aggregateMetrics(
            selected,
            rows.filter((row) =>
              selected.some((testCase) => testCase.id === row.caseId),
            ),
          ),
        ];
      }),
    ),
    configurations: Object.fromEntries(
      [...configurations].map(([key, group]) => [
        key,
        {
          fingerprint: group.fingerprint,
          metrics: aggregateMetrics(cases, group.rows),
        },
      ]),
    ),
    pooledMetricsAreDiagnosticOnly: configurations.size > 1,
    // No prompts, answers, documents, confirmation tokens, evidence bodies or private reasoning in report.
    rows: rows.map((row) => ({
      caseId: row.caseId,
      repeat: row.repeat,
      status: row.status,
      reason: row.reason,
      grade: row.grade,
      traceId: row.receipt?.traceId,
      fixtureFingerprint: row.receipt?.fixtureFingerprint,
      fingerprint: row.receipt?.fingerprint,
      measured: row.receipt
        ? aggregateMetrics(
            cases.filter((testCase) => testCase.id === row.caseId),
            [row],
          )
        : undefined,
    })),
    promotion: 'not_evaluated_canary_and_overhead_require_runtime_measurements',
  };
}
export type EvalReport = Awaited<ReturnType<typeof runEvaluation>>;

export type TreatmentField =
  | 'featureFlagsHash'
  | 'catalogHash'
  | 'catalogVersion';
export function compareReports(
  baseline: EvalReport,
  candidate: EvalReport,
  treatmentFields: TreatmentField[] = [],
) {
  const differences: string[] = [];
  const controlledDifferences: string[] = [];
  if (
    treatmentFields.some(
      (field) =>
        !['featureFlagsHash', 'catalogHash', 'catalogVersion'].includes(field),
    )
  ) {
    throw new Error(
      'Only flags/catalog may be explicitly declared treatment fields',
    );
  }
  if (baseline.corpusHash !== candidate.corpusHash)
    differences.push('corpus_changed');
  if (baseline.mode !== candidate.mode)
    differences.push('execution_mode_changed');
  if (
    baseline.split !== candidate.split ||
    baseline.repeats !== candidate.repeats
  )
    differences.push('sampling_changed');
  const baselineRows = new Map(
    baseline.rows.map((row) => [`${row.caseId}:${row.repeat}`, row]),
  );
  const discordant: string[] = [];
  for (const row of candidate.rows) {
    const key = `${row.caseId}:${row.repeat}`;
    const before = baselineRows.get(key);
    if (!before || row.status !== 'ran' || before.status !== 'ran') {
      differences.push(`${key}:not_run`);
      continue;
    }
    if (
      row.fingerprint?.cacheCondition === 'unknown' ||
      before.fingerprint?.cacheCondition === 'unknown'
    )
      differences.push(`${key}:cache_unknown`);
    if (before.fingerprint && row.fingerprint) {
      for (const field of Object.keys(
        before.fingerprint,
      ) as (keyof EvalFingerprint)[]) {
        if (before.fingerprint[field] === row.fingerprint[field]) continue;
        if (treatmentFields.includes(field as TreatmentField))
          controlledDifferences.push(`${key}:${field}`);
        else differences.push(`${key}:${field}_changed`);
      }
    } else differences.push(`${key}:fingerprint_missing`);
    if (before.fixtureFingerprint !== row.fixtureFingerprint)
      differences.push(`${key}:fixture_changed`);
    if (
      before.grade?.outcomeCorrect !== row.grade?.outcomeCorrect ||
      before.grade?.completionVerified !== row.grade?.completionVerified
    )
      discordant.push(key);
  }
  if (baseline.rows.length !== candidate.rows.length)
    differences.push('case_set_changed');
  return {
    comparable: differences.length === 0 && candidate.rows.length > 0,
    differences,
    controlledDifferences,
    treatmentFields,
    discordant,
    uncertainty:
      'Descriptive paired results only; three repeats per case do not establish statistical significance. No causal attribution when fingerprints differ.',
  };
}
