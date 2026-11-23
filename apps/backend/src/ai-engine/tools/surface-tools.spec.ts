import {
  isForeignSurfaceTool,
  isVexOnlyTool,
  TURN_BOUND_CONVERSATION_TOOLS,
  withTurnConversation,
  withTurnConversationId,
} from './surface-tools';

describe('withTurnConversationId (H6)', () => {
  it('remember never carries a conversation_id argument: the turn binds it outside the args', () => {
    expect(
      withTurnConversationId(
        'remember',
        { key: 'learning.format', content: 'video', conversation_id: 999 },
        55,
      ),
    ).toEqual({ key: 'learning.format', content: 'video' });
    expect(
      withTurnConversationId('remember', { key: 'k', content: 'c' }, 55),
    ).toEqual({ key: 'k', content: 'c' });
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

describe('withTurnConversation (P2-3)', () => {
  const TURN = 42;

  it('propose_write_batch always runs under the turn conversation, whatever the model sent', () => {
    expect(TURN_BOUND_CONVERSATION_TOOLS.has('propose_write_batch')).toBe(true);
    for (const modelValue of [7, 42, undefined, 'abc', 0]) {
      expect(
        withTurnConversation(
          'propose_write_batch',
          { conversation_id: modelValue, goal: 'g' },
          TURN,
        ),
      ).toEqual({ conversation_id: TURN, goal: 'g' });
    }
  });

  it('propose_write_batch without a turn conversation drops the model value', () => {
    for (const turn of [null, undefined]) {
      expect(
        withTurnConversation(
          'propose_write_batch',
          { conversation_id: 7, goal: 'g' },
          turn,
        ),
      ).toEqual({ goal: 'g' });
    }
  });

  it('other vex tools keep the previous rule: the turn only fills a missing or invalid id', () => {
    expect(withTurnConversation('vex_render_table', { title: 't' }, TURN)).toEqual({
      title: 't',
      conversation_id: TURN,
    });
    expect(
      withTurnConversation('vex_render_table', { conversation_id: 'x' }, TURN),
    ).toEqual({ conversation_id: TURN });
    const explicit = { conversation_id: 7 };
    expect(withTurnConversation('vex_render_table', explicit, TURN)).toBe(explicit);
    const noTurn = { title: 't' };
    expect(withTurnConversation('vex_render_table', noTurn, null)).toBe(noTurn);
  });

  it('non-vex tools are untouched', () => {
    const args = { conversation_id: 7, product_id: 1 };
    expect(withTurnConversation('update_product_price', args, TURN)).toBe(args);
    expect(withTurnConversation('queue_task', {}, TURN)).toEqual({});
  });

  it('run_analysis is Vex-only and always bound to the turn conversation (F9/T52)', () => {
    expect(isVexOnlyTool('run_analysis')).toBe(true);
    expect(isForeignSurfaceTool('run_analysis', 'vexi')).toBe(true);
    expect(isForeignSurfaceTool('run_analysis', 'vex')).toBe(false);
    expect(TURN_BOUND_CONVERSATION_TOOLS.has('run_analysis')).toBe(true);
    expect(
      withTurnConversation(
        'run_analysis',
        { conversation_id: 999, purpose: 'projection' },
        TURN,
      ),
    ).toEqual({ conversation_id: TURN, purpose: 'projection' });
    expect(
      withTurnConversation(
        'run_analysis',
        { conversation_id: 999, purpose: 'projection' },
        null,
      ),
    ).toEqual({ purpose: 'projection' });
  });
});
