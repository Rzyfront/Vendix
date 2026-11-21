import { withTurnConversationId } from './surface-tools';

describe('withTurnConversationId (H6)', () => {
  it('remember always carries the turn conversation, even when the model invents one', () => {
    expect(
      withTurnConversationId(
        'remember',
        { key: 'learning.format', content: 'video', conversation_id: 999 },
        55,
      ),
    ).toEqual({
      key: 'learning.format',
      content: 'video',
      conversation_id: 55,
    });
    expect(
      withTurnConversationId('remember', { key: 'k', content: 'c' }, 55),
    ).toEqual({ key: 'k', content: 'c', conversation_id: 55 });
  });

  it('remember drops a model conversation id when the turn has none', () => {
    expect(
      withTurnConversationId(
        'remember',
        { key: 'k', content: 'c', conversation_id: 999 },
        null,
      ),
    ).toEqual({ key: 'k', content: 'c' });
  });

  it('other Vex-only tools keep the previous default-only behavior', () => {
    expect(
      withTurnConversationId('vex_show_table', { conversation_id: 7 }, 55),
    ).toEqual({
      conversation_id: 7,
    });
    expect(
      withTurnConversationId('vex_show_table', { title: 't' }, 55),
    ).toEqual({
      title: 't',
      conversation_id: 55,
    });
    expect(
      withTurnConversationId('vex_show_table', { title: 't' }, undefined),
    ).toEqual({
      title: 't',
    });
  });

  it('tools outside the Vex surface are untouched', () => {
    const args = { conversation_id: 999, q: 'x' };
    expect(withTurnConversationId('search_help', args, 55)).toBe(args);
  });
});
