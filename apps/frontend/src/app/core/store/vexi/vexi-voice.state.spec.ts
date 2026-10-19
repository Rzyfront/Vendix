// Real NgRx reducer: missing Angular/NgRx dependencies must remain an explicit test gate.
import { initialVexiState, vexiReducer, VexiState } from './vexi.reducer';
import * as actions from './vexi.actions';

const waiting = (): VexiState =>
  vexiReducer(
    { ...initialVexiState, activeConversationId: 7 },
    actions.proposalReceived({
      tool: 'change_price',
      arguments: { price: 50 },
      confirmationToken: 'token-1',
      planActive: true,
    }),
  );

describe('G scoped consent receipts through the real Vexi reducer', () => {
  it('a raw dictated yes is a chat turn, not approval', () => {
    const state = waiting();
    const next = vexiReducer(
      state,
      actions.sendMessage({ conversationId: 7, content: 'sí', speak: true }),
    );
    expect(next.pendingProposal?.applying).not.toBe(true);
    expect(
      next.messages.some((message) => message.content.includes('apliqué')),
    ).toBe(false);
  });
  it('adopts the exact applied receipt once, with no audio needed', () => {
    const receipt = actions.confirmProposalSuccess({
      tool: 'change_price',
      output: '{}',
      summary: 'Precio actualizado a 50.',
      conversationId: 7,
      confirmationToken: 'token-1',
      receiptApplied: true,
    });
    const state = vexiReducer(waiting(), receipt);
    expect(state.pendingProposal).toBeNull();
    expect(state.messages.map((message) => message.content)).toEqual([
      'Precio actualizado a 50.',
    ]);
    expect(vexiReducer(state, receipt)).toBe(state);
  });
  it('a late receipt cannot clear another conversation proposal', () => {
    const state = { ...waiting(), activeConversationId: 8 };
    expect(
      vexiReducer(
        state,
        actions.confirmProposalSuccess({
          tool: 'change_price',
          output: '{}',
          conversationId: 7,
          confirmationToken: 'token-1',
          summary: 'Applied elsewhere.',
        }),
      ),
    ).toBe(state);
  });
  it('a stale token cannot clear a new diff in the same conversation', () => {
    const state = waiting();
    expect(
      vexiReducer(
        state,
        actions.confirmProposalSuccess({
          tool: 'change_price',
          output: '{}',
          conversationId: 7,
          confirmationToken: 'old-token',
        }),
      ),
    ).toBe(state);
    expect(
      vexiReducer(
        state,
        actions.confirmProposalFailure({
          error: 'late',
          conversationId: 7,
          confirmationToken: 'old-token',
        }),
      ),
    ).toBe(state);
  });
  it('tokenless realtime cards also bind the proposal ID', () => {
    const state = vexiReducer(
      waiting(),
      actions.proposalReceived({
        tool: 'change_price',
        arguments: { price: 60 },
        confirmationToken: '',
        voiceContext: {
          conversation_id: 7,
          agent_key: 'vexi',
          channel: 'realtime',
          session_id: 'session',
          proposal_id: 'proposal-new',
        },
      }),
    );
    expect(
      vexiReducer(
        state,
        actions.confirmProposalSuccess({
          tool: 'change_price',
          output: '{}',
          conversationId: 7,
          confirmationToken: '',
          proposalId: 'proposal-old',
        }),
      ),
    ).toBe(state);
  });
  it('an unknown receipt is not narrated as applied and cannot be reused as consent', () => {
    const state = vexiReducer(
      waiting(),
      actions.confirmProposalSuccess({
        tool: 'change_price',
        output: '{}',
        conversationId: 7,
        confirmationToken: 'token-1',
        receiptApplied: false,
      }),
    );
    expect(state.pendingProposal).toBeNull();
    expect(state.messages[0].content).toContain('no está confirmado');
    expect(state.messages[0].content).not.toContain('apliqué');
  });
  it('keeps click-only legacy receipts compatible when no G identity is supplied', () => {
    const state = vexiReducer(
      waiting(),
      actions.confirmProposalSuccess({ tool: 'change_price', output: '{}' }),
    );
    expect(state.messages[0].content).toBe('Listo, apliqué el cambio.');
  });
});
