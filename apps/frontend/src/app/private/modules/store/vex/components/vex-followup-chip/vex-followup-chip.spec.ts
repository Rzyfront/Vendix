import { buildFollowupEdits } from './vex-followup-chip.component';

describe('buildFollowupEdits (what an edited follow-up card saves)', () => {
  it('trims the title and keeps the store-local date as typed', () => {
    expect(
      buildFollowupEdits({ title: '  Llamar a Lácteos  ', remind_at: '2026-12-01T09:30' }),
    ).toEqual({ title: 'Llamar a Lácteos', remind_at: '2026-12-01T09:30' });
  });

  it('sends null when the person cleared the date (a dateless log entry)', () => {
    expect(buildFollowupEdits({ title: 'Revisar precios', remind_at: '' })).toEqual({
      title: 'Revisar precios',
      remind_at: null,
    });
  });

  it('yields an empty title for blank text so the card can refuse to save', () => {
    expect(buildFollowupEdits({ title: '   ', remind_at: '' }).title).toBe('');
  });
});
