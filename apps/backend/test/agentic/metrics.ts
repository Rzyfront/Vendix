import { EvalCase, EvalReceipt, EvalRow, ProviderAttempt } from './contracts';
import { canonicalAttempts, canonicalCostUsd } from './graders';

export function percentile(values: number[], quantile: number): number | null {
  if (!values.length) return null;
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.max(0, Math.ceil(quantile * sorted.length) - 1)];
}

/** Union, not sum: overlapping human/UI waits must not be subtracted twice. */
export function waitTimeMs(receipt: EvalReceipt): number {
  const intervals = receipt.spans
    .filter(
      (span) =>
        (span.kind === 'ui_wait' || span.kind === 'approval_wait') &&
        span.endedAtMs !== null,
    )
    .map((span) => [span.startedAtMs, span.endedAtMs as number])
    .sort((a, b) => a[0] - b[0]);
  let total = 0;
  let end = -Infinity;
  for (const [start, stop] of intervals) {
    total += Math.max(0, stop - Math.max(start, end));
    end = Math.max(end, stop);
  }
  return total;
}
function ratio(numerator: number, denominator: number): number | null {
  return denominator ? numerator / denominator : null;
}
function tokenTotal(
  attempts: ProviderAttempt[],
  field: keyof Pick<
    ProviderAttempt,
    'inputTokens' | 'outputTokens' | 'cacheReadTokens' | 'cacheCreateTokens'
  >,
): number | null {
  return attempts.some((attempt) => attempt[field] === null)
    ? null
    : attempts.reduce((sum, attempt) => sum + (attempt[field] as number), 0);
}
function summary(values: number[]) {
  return {
    samples: values.length,
    p50: percentile(values, 0.5),
    p95: percentile(values, 0.95),
  };
}

export function aggregateMetrics(cases: EvalCase[], rows: EvalRow[]) {
  const byId = new Map(cases.map((testCase) => [testCase.id, testCase]));
  const ran = rows.filter(
    (row) => row.status === 'ran' && row.receipt && row.grade,
  );
  const eligible = rows.filter(
    (row) => byId.get(row.caseId)?.eligible && byId.get(row.caseId)?.consented,
  );
  const eligibleRan = ran.filter(
    (row) => byId.get(row.caseId)?.eligible && byId.get(row.caseId)?.consented,
  );
  const completed = ran.filter((row) => row.grade!.completionVerified).length;
  const attempts = canonicalAttempts(
    ran.flatMap((row) => row.receipt!.providerAttempts),
  );
  const costUsd = ran.length ? canonicalCostUsd(attempts) : null;
  const receipts = ran.map((row) => row.receipt!);
  const latency = (
    field: 'usefulContentAtMs' | 'proposalAtMs' | 'completionAtMs',
  ) =>
    receipts
      .filter((receipt) => receipt.timings[field] !== null)
      .filter(
        (receipt) =>
          field !== 'completionAtMs' ||
          ran.find((row) => row.receipt === receipt)!.grade!.completionVerified,
      )
      .map(
        (receipt) =>
          (receipt.timings[field] as number) - receipt.timings.startedAtMs,
      );
  const requested = rows.reduce(
    (sum, row) => sum + (byId.get(row.caseId)?.capabilities.length ?? 0),
    0,
  );
  const capable = ran.reduce(
    (sum, row) =>
      sum +
      byId
        .get(row.caseId)!
        .capabilities.filter((capability) =>
          row.receipt!.capabilities.includes(capability),
        ).length,
    0,
  );
  const retrieval = receipts.flatMap((receipt) =>
    receipt.retrieval ? [receipt.retrieval] : [],
  );
  return {
    planned: rows.length,
    ran: ran.length,
    notRun: rows.length - ran.length,
    eligiblePlanned: eligible.length,
    eligibleRan: eligibleRan.length,
    completedVerified: completed,
    // Planned denominator prevents silently dropping difficult/unavailable cases. Execution coverage is separate.
    completionVerifiedRate: ran.length
      ? ratio(completed, eligible.length)
      : null,
    completionVerifiedRateAmongRan: ratio(completed, eligibleRan.length),
    outcomeCorrectRate: ran.length
      ? ratio(
          ran.filter((row) => row.grade!.outcomeCorrect).length,
          rows.length,
        )
      : null,
    executionCoverage: ratio(ran.length, rows.length),
    capabilityCoverage: ratio(capable, requested),
    exactFinalRate: ratio(
      ran.filter((row) => row.grade!.exactFinal).length,
      ran.length,
    ),
    falseSuccesses: ran.filter((row) => row.grade!.falseSuccess).length,
    duplicateEffects: ran.reduce(
      (sum, row) => sum + row.grade!.duplicateEffects,
      0,
    ),
    safetyViolations: ran.reduce(
      (sum, row) => sum + row.grade!.safetyViolations,
      0,
    ),
    traceCompleteRate: ratio(
      ran.filter((row) => row.grade!.traceComplete).length,
      ran.length,
    ),
    providerAttempts: attempts.length,
    logicalCalls: receipts.reduce(
      (sum, receipt) => sum + receipt.logicalCalls,
      0,
    ),
    toolCalls: receipts.reduce((sum, receipt) => sum + receipt.toolCalls, 0),
    repeatedToolCalls: receipts.reduce(
      (sum, receipt) => sum + receipt.repeatedToolCalls,
      0,
    ),
    wallMs: summary(
      receipts.map(
        (receipt) => receipt.timings.endedAtMs - receipt.timings.startedAtMs,
      ),
    ),
    activeMs: summary(
      receipts.map(
        (receipt) =>
          receipt.timings.endedAtMs -
          receipt.timings.startedAtMs -
          waitTimeMs(receipt),
      ),
    ),
    humanAndUiWaitMs: summary(receipts.map(waitTimeMs)),
    ttftUsefulMs: summary(latency('usefulContentAtMs')),
    ttProposalMs: summary(latency('proposalAtMs')),
    ttCompletionMs: summary(latency('completionAtMs')),
    tokens: ran.length
      ? {
          freshInput: tokenTotal(attempts, 'inputTokens'),
          output: tokenTotal(attempts, 'outputTokens'),
          cacheRead: tokenTotal(attempts, 'cacheReadTokens'),
          cacheCreate: tokenTotal(attempts, 'cacheCreateTokens'),
        }
      : null,
    costUsd,
    knownCostUsd: attempts
      .filter(
        (attempt) => attempt.billable !== false && attempt.costUsd !== null,
      )
      .reduce((sum, attempt) => sum + (attempt.costUsd as number), 0),
    unknownCostAttempts: attempts.filter(
      (attempt) =>
        attempt.billable !== false &&
        (attempt.costUsd === null || attempt.billable === null),
    ).length,
    costPerAttemptedCaseUsd:
      costUsd === null ? null : ratio(costUsd, ran.length),
    costPerCompletedUsd: costUsd === null ? null : ratio(costUsd, completed),
    recallAtK: retrieval.length
      ? retrieval.map((item) =>
          ratio(
            new Set(
              item.retrieved
                .slice(0, item.k)
                .filter((key) => item.relevant.includes(key)),
            ).size,
            new Set(item.relevant).size,
          ),
        )
      : null,
    expansions: retrieval.length
      ? retrieval.reduce((sum, item) => sum + item.expansions, 0)
      : null,
    recipes: retrieval.length
      ? retrieval.reduce((sum, item) => sum + item.recipes, 0)
      : null,
  };
}
