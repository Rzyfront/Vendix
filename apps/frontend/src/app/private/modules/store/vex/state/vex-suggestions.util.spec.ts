import {
  resolveWelcomeSuggestions,
  type VexSuggestionId,
} from './vex-suggestions.util';

describe('resolveWelcomeSuggestions (welcome chips follow the store)', () => {
  it('shows «¿Qué debo reabastecer?» when the store has stock under its minimum', () => {
    const chips = resolveWelcomeSuggestions([{ id: 'restock', count: 3 }, { id: 'sales_today' }]);
    expect(chips.map((chip) => chip.label)).toEqual([
      '¿Qué debo reabastecer?',
      'Resumen de ventas de hoy',
    ]);
  });

  it('does not show the restock chip when the server did not send it', () => {
    const chips = resolveWelcomeSuggestions([{ id: 'sales_today' }]);
    expect(chips.some((chip) => chip.id === 'restock')).toBe(false);
  });

  it('keeps the server order and drops repeated or unknown ids', () => {
    const chips = resolveWelcomeSuggestions([
      { id: 'cash_close' },
      { id: 'made_up' },
      { id: 'cash_close' },
      { id: 'sales_today' },
    ]);
    expect(chips.map((chip) => chip.id)).toEqual(['cash_close', 'sales_today']);
  });

  it('falls back to the default questions when nothing usable arrives', () => {
    const fallback: VexSuggestionId[] = [
      'sales_today',
      'top_products',
      'overdue_receivables',
    ];
    expect(resolveWelcomeSuggestions(null).map((chip) => chip.id)).toEqual(fallback);
    expect(resolveWelcomeSuggestions([]).map((chip) => chip.id)).toEqual(fallback);
    expect(resolveWelcomeSuggestions([{ id: 'made_up' }]).map((chip) => chip.id)).toEqual(
      fallback,
    );
  });

  it('gives every chip a message to send', () => {
    for (const chip of resolveWelcomeSuggestions([{ id: 'reminders_today' }])) {
      expect(chip.prompt.length).toBeGreaterThan(0);
    }
  });
});
