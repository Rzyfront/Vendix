import {
  VEX_TITLE_EMPTY_ERROR,
  VEX_TITLE_TOO_LONG_ERROR,
  groupConversationsByDate,
  validateConversationTitle,
} from './vex-conversation-groups.util';

interface Row {
  id: string;
  updated_at: Date;
}

function row(id: string, year: number, month: number, day: number, hour = 12): Row {
  return { id, updated_at: new Date(year, month - 1, day, hour, 0, 0) };
}

// Local time on purpose: groups follow the browser's calendar day.
const NOW = new Date(2026, 10, 20, 9, 30, 0);

describe('groupConversationsByDate', () => {
  it('returns no groups for an empty list', () => {
    expect(groupConversationsByDate([], NOW)).toEqual([]);
  });

  it('puts the same local day in «Hoy», even a few minutes before midnight', () => {
    const groups = groupConversationsByDate([row('a', 2026, 11, 20, 0), row('b', 2026, 11, 20, 23)], NOW);
    expect(groups.map((g) => g.label)).toEqual(['Hoy']);
    expect(groups[0].items.map((i) => i.id)).toEqual(['a', 'b']);
  });

  it('splits «Ayer» and «Últimos 7 días» by calendar day, not by 24 h windows', () => {
    const groups = groupConversationsByDate(
      [row('y', 2026, 11, 19, 23), row('d2', 2026, 11, 18), row('d7', 2026, 11, 13), row('d8', 2026, 11, 12)],
      NOW,
    );
    expect(groups.map((g) => g.label)).toEqual(['Ayer', 'Últimos 7 días', 'Noviembre 2026']);
    expect(groups[1].items.map((i) => i.id)).toEqual(['d2', 'd7']);
    expect(groups[2].items.map((i) => i.id)).toEqual(['d8']);
  });

  it('groups older conversations by month and year, keeping the input order', () => {
    const groups = groupConversationsByDate(
      [row('o1', 2026, 10, 30), row('o2', 2026, 10, 2), row('s1', 2026, 9, 15), row('l1', 2025, 10, 5)],
      NOW,
    );
    expect(groups.map((g) => g.label)).toEqual(['Octubre 2026', 'Septiembre 2026', 'Octubre 2025']);
    expect(groups.map((g) => g.key)).toEqual(['2026-10', '2026-09', '2025-10']);
    expect(groups[0].items.map((i) => i.id)).toEqual(['o1', 'o2']);
  });

  it('treats a future timestamp (clock skew) as «Hoy»', () => {
    const groups = groupConversationsByDate([row('f', 2026, 11, 21)], NOW);
    expect(groups.map((g) => g.label)).toEqual(['Hoy']);
  });
});

describe('validateConversationTitle', () => {
  it('accepts 1 to 80 characters after trimming', () => {
    expect(validateConversationTitle('  Ventas de octubre  ')).toBeNull();
    expect(validateConversationTitle('a'.repeat(80))).toBeNull();
  });

  it('rejects an empty or blank name', () => {
    expect(validateConversationTitle('')).toBe(VEX_TITLE_EMPTY_ERROR);
    expect(validateConversationTitle('   ')).toBe(VEX_TITLE_EMPTY_ERROR);
  });

  it('rejects more than 80 characters', () => {
    expect(validateConversationTitle('a'.repeat(81))).toBe(VEX_TITLE_TOO_LONG_ERROR);
  });
});
