import { initialVexiState, vexiReducer, VexiState } from './vexi.reducer';
import * as actions from './vexi.actions';

describe('H progress is transient, not a false assistant claim or applied effect', () => {
  it('shows progress separately and persists only the verified final answer', () => {
    let state: VexiState = { ...initialVexiState, activeConversationId: 7 };
    state = vexiReducer(state, actions.streamStarted({ conversationId: 7 }));
    state = vexiReducer(
      state,
      actions.receiveStreamProgress({ content: 'Consultando el registro.' }),
    );
    expect(state.streamingProgress).toBe('Consultando el registro.');
    expect(state.streamingContent).toBe('');
    expect(state.messages).toEqual([]);
    state = vexiReducer(
      state,
      actions.receiveStreamChunk({ content: 'El registro está verificado.' }),
    );
    state = vexiReducer(state, actions.streamComplete());
    expect(state.streamingProgress).toBe('');
    expect(state.messages.map((message) => message.content)).toEqual([
      'El registro está verificado.',
    ]);
  });
  it('does not duplicate an already known tool step', () => {
    const start = actions.toolCallStarted({ id: 'same', name: 'get_product' });
    const state = vexiReducer(vexiReducer(initialVexiState, start), start);
    expect(state.toolSteps).toHaveLength(1);
  });
  it('cancellation preserves pending proposals and marks running work unknown, never done/applied', () => {
    let state: VexiState = vexiReducer(
      initialVexiState,
      actions.streamStarted({ conversationId: 7 }),
    );
    state = vexiReducer(
      state,
      actions.toolCallStarted({ id: 'running', name: 'get_product' }),
    );
    state = vexiReducer(
      state,
      actions.receiveStreamProgress({ content: 'Consultando.' }),
    );
    state = vexiReducer(state, actions.cancelStream());
    expect(state.streamingProgress).toBe('');
    expect(state.isStreaming).toBe(false);
    expect(state.toolSteps[0].status).toBe('unknown');
    expect(state.messages).toEqual([]);
    expect(state.error).toContain('Verifica');
  });
  it.each([
    actions.streamError({ error: 'interrupted' }),
    actions.streamReconciled(),
    actions.streamStarted({ conversationId: 7 }),
  ])('clears stale progress on terminal/reconcile/new turn %s', (action) => {
    const progress = vexiReducer(
      initialVexiState,
      actions.receiveStreamProgress({ content: 'Consultando.' }),
    );
    expect(vexiReducer(progress, action).streamingProgress).toBe('');
  });
});
