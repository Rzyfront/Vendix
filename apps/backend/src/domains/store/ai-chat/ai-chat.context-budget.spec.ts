import { estimateContextBudget } from '../../../ai-engine/context/agent-context-budget';

describe('T21 estimateContextBudget', () => {
  it('returns the fallback-provenance shape with the 32768 default window', () => {
    const budget = estimateContextBudget([
      { role: 'user', content: 'hola mundo' },
    ]);
    expect(budget.context_window_tokens).toBe(32768);
    expect(budget.provenance).toBe('fallback');
    expect(budget.method).toBe('conservative_estimate');
    expect(budget.omitted_messages).toBe(0);
    expect(budget.estimated_input_tokens).toBeGreaterThan(0);
  });
});
