import {
  computeContextPercent,
  isContextWarning,
  latestContextBudget,
} from './vex-context-meter.util';

describe('computeContextPercent', () => {
  it('rounds used / window to a whole percent', () => {
    expect(
      computeContextPercent({ estimated_input_tokens: 1234, context_window_tokens: 10000 }),
    ).toBe(12);
  });

  it('caps at 100 when the estimate exceeds the window', () => {
    expect(
      computeContextPercent({ estimated_input_tokens: 20000, context_window_tokens: 10000 }),
    ).toBe(100);
  });

  it('returns 0 for an empty prompt with a valid window', () => {
    expect(
      computeContextPercent({ estimated_input_tokens: 0, context_window_tokens: 10000 }),
    ).toBe(0);
  });

  it('returns null for missing, zero or invalid windows', () => {
    expect(computeContextPercent(null)).toBeNull();
    expect(computeContextPercent(undefined)).toBeNull();
    expect(computeContextPercent({ estimated_input_tokens: 5 })).toBeNull();
    expect(
      computeContextPercent({ estimated_input_tokens: 5, context_window_tokens: 0 }),
    ).toBeNull();
    expect(
      computeContextPercent({ estimated_input_tokens: 5, context_window_tokens: -1 }),
    ).toBeNull();
    expect(
      computeContextPercent({ estimated_input_tokens: NaN, context_window_tokens: 100 }),
    ).toBeNull();
  });
});

describe('isContextWarning', () => {
  it('warns from 75 % upwards only', () => {
    expect(isContextWarning(74)).toBe(false);
    expect(isContextWarning(75)).toBe(true);
    expect(isContextWarning(100)).toBe(true);
  });

  it('does not warn without a value', () => {
    expect(isContextWarning(null)).toBe(false);
    expect(isContextWarning(undefined)).toBe(false);
  });

  it('warns at the threshold the server compacts at, when the budget carries one', () => {
    // 32 768 window with 8 192 of output: the engine refuses past 65 %.
    expect(isContextWarning(53, 54)).toBe(false);
    expect(isContextWarning(54, 54)).toBe(true);
    // Invalid thresholds fall back to 75.
    expect(isContextWarning(74, -1)).toBe(false);
    expect(isContextWarning(75, null)).toBe(true);
  });
});

describe('latestContextBudget', () => {
  const budget = (tokens: number) => ({
    estimated_input_tokens: tokens,
    omitted_messages: 2,
    context_window_tokens: 10000,
    provenance: 'configured' as const,
    method: 'conservative_estimate' as const,
  });

  it('reads the budget persisted with the newest assistant answer', () => {
    expect(
      latestContextBudget([
        { role: 'assistant', metadata: { context_budget: budget(1000) } },
        { role: 'user', metadata: null },
        { role: 'assistant', metadata: { context_budget: budget(8000) } },
        { role: 'user', metadata: { context_budget: budget(9999) } },
      ]),
    ).toEqual(budget(8000));
  });

  it('skips answers whose budget is missing or invalid', () => {
    expect(
      latestContextBudget([
        { role: 'assistant', metadata: { context_budget: budget(3000) } },
        { role: 'assistant', metadata: { context_budget: { bogus: true } } },
        {
          role: 'assistant',
          metadata: { context_budget: { ...budget(5), context_window_tokens: 0 } },
        },
        { role: 'assistant', metadata: null },
      ]),
    ).toEqual(budget(3000));
  });

  it('keeps the threshold and output reserve stamped on the persisted budget', () => {
    const stamped = { ...budget(6000), max_output_tokens: 4096, compaction_percent: 67 };
    expect(
      latestContextBudget([{ role: 'assistant', metadata: { context_budget: stamped } }]),
    ).toEqual(stamped);
  });

  it('returns null when no answer carries a budget', () => {
    expect(latestContextBudget([])).toBeNull();
    expect(latestContextBudget(undefined)).toBeNull();
    expect(latestContextBudget([{ role: 'assistant', metadata: null }])).toBeNull();
  });
});
