import { initialVexiState, vexiReducer } from './vexi.reducer';
import * as actions from './vexi.actions';
import type { VexiObjective, VexiTask } from '../../services/vexi-api.service';

const objective: VexiObjective = {
  id: 'synthetic-objective',
  conversation_id: 22,
  goal: 'Revisar órdenes',
  version: 7,
  semantic_status: 'partial',
  expires_at: '2099-01-01T00:00:00Z',
  next_step: 'Consultar página siguiente',
  budget: { tools: 9, provider_attempts: 12 },
};

describe('D1 objective state remains separate from job state and approvals', () => {
  const task = { id: 4, status: 'running' } as VexiTask;
  const state = {
    ...initialVexiState,
    activeConversationId: 22,
    activeTask: task,
    activeTaskId: 4,
    autoContinuations: 3,
  };

  it('reading objective progress does not start inference or occupy the background-job slot', () => {
    const loading = vexiReducer(
      state,
      actions.loadObjective({ objectiveId: objective.id }),
    );
    const read = vexiReducer(loading, actions.objectiveReceived({ objective }));
    expect(read.objective).toBe(objective);
    expect(read.objectiveLoading).toBe(false);
    expect(read.activeTask).toBe(task);
    expect(read.activeTaskId).toBe(4);
    expect(read.isSending).toBe(false);
    expect(read.isStreaming).toBe(false);
    expect(read.autoContinuations).toBe(3);
  });

  it('resuming state neither resets accumulated budget/count nor approves pending writes', () => {
    const pendingProposal = {
      tool: 'create_product',
      arguments: {},
      confirmationToken: 'synthetic',
      applying: false,
    };
    const previous = { ...state, objective, pendingProposal };
    const choice = vexiReducer(
      previous,
      actions.resumeObjective({
        objectiveId: objective.id,
        confirmExpired: true,
      }),
    );
    const resumed = vexiReducer(
      choice,
      actions.resumeObjectiveSuccess({
        objective: { ...objective, version: 8 },
      }),
    );
    expect(resumed.autoContinuations).toBe(3);
    expect(resumed.objective?.budget).toBe(objective.budget);
    expect(resumed.pendingProposal).toBe(pendingProposal);
    expect(resumed.pendingProposal?.applying).toBe(false);
    expect(resumed.activeTask).toBe(task);
    expect(resumed.isStreaming).toBe(false);
  });

  it('a stale response from another thread cannot overwrite the selected objective', () => {
    const previous = { ...state, objective };
    expect(
      vexiReducer(
        previous,
        actions.objectiveReceived({
          objective: { ...objective, conversation_id: 999 },
        }),
      ),
    ).toBe(previous);
  });

  it('at the existing cap it shows durable progress without a write or another automatic turn', () => {
    const capped = vexiReducer(
      { ...state, objective, planContinuePending: true },
      actions.planContinueCapped(),
    );
    expect(capped.messages[capped.messages.length - 1].content).toContain(
      'Consultar página siguiente',
    );
    expect(capped.planContinuePending).toBe(false);
    expect(capped.autoContinuations).toBe(3);
    expect(capped.objective?.budget).toBe(objective.budget);
    expect(capped.activeTask).toBe(task);
  });
});

describe('D1 rejection and stale objective snapshots', () => {
  const proposal = {
    tool: 'create_product',
    arguments: {},
    confirmationToken: 'synthetic-token',
    applying: false,
    planActive: true,
  };
  const state = {
    ...initialVexiState,
    activeConversationId: 22,
    objective,
    pendingProposal: proposal,
    autoContinuations: 3,
  };
  const identity = {
    conversationId: 22,
    confirmationToken: proposal.confirmationToken,
  };

  it('keeps the card until the durable reject request succeeds', () => {
    const waiting = vexiReducer(state, actions.rejectProposal());
    expect(waiting.pendingProposal).toBe(proposal);
    expect(waiting.messages.length).toBe(0);
    const failure = vexiReducer(
      waiting,
      actions.rejectProposalFailure({ ...identity, error: 'stale version' }),
    );
    expect(failure.pendingProposal).toBe(proposal);
    expect(failure.error).toBe('stale version');
    expect(failure.isSending).toBe(false);
  });

  it('a successful rejection clears only its own proposal and preserves budget/cap', () => {
    const updated = { ...objective, semantic_status: 'active', version: 8 };
    const result = vexiReducer(
      state,
      actions.rejectProposalSuccess({ ...identity, objective: updated }),
    );
    expect(result.pendingProposal).toBeNull();
    expect(result.rejectedPlanActive).toBe(true);
    expect(result.autoContinuations).toBe(3);
    expect(result.objective?.budget).toBe(objective.budget);
    expect(result.messages[0].content).toContain('no apliqué');
    expect(result.isStreaming).toBe(false);
  });

  it('a late rejection cannot clear a replacement card or another conversation', () => {
    const replacement = {
      ...state,
      pendingProposal: { ...proposal, confirmationToken: 'replacement' },
    };
    expect(
      vexiReducer(replacement, actions.rejectProposalSuccess(identity)),
    ).toBe(replacement);
    expect(
      vexiReducer(
        state,
        actions.rejectProposalSuccess({ ...identity, conversationId: 999 }),
      ),
    ).toBe(state);
  });

  it('older versions and cancelled HTTP reads cannot replace a newer streamed snapshot', () => {
    const fresh = { ...state, objective: { ...objective, version: 10 } };
    expect(vexiReducer(fresh, actions.objectiveReceived({ objective }))).toBe(
      fresh,
    );
    const loading = vexiReducer(
      state,
      actions.loadObjective({ objectiveId: objective.id }),
    );
    const streamed = vexiReducer(
      loading,
      actions.objectiveReceived({
        objective: { ...objective, id: 'new-objective', version: 1 },
      }),
    );
    expect(
      vexiReducer(
        streamed,
        actions.objectiveReceived({ objective, requestedId: objective.id }),
      ),
    ).toBe(streamed);
    expect(
      vexiReducer(
        streamed,
        actions.resumeObjectiveSuccess({
          objective,
          requestedId: objective.id,
        }),
      ),
    ).toBe(streamed);
  });
});
