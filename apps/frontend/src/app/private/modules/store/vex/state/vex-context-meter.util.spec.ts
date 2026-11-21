import {
  computeContextPercent,
  isContextWarning,
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
});
