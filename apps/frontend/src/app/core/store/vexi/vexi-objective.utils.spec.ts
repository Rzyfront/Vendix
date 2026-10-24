import {
  canResumeObjective,
  objectiveNeedsExpiredChoice,
  objectivePointer,
  objectiveProgress,
  persistedObjective,
} from './vexi-objective.utils';
import type { VexiObjective } from '../../services/vexi-api.service';

const objective = (patch: Partial<VexiObjective> = {}): VexiObjective => ({
  id: 'synthetic-objective',
  conversation_id: 22,
  goal: 'Revisar órdenes',
  version: 7,
  semantic_status: 'partial',
  expires_at: '2099-01-01T00:00:00.000Z',
  next_step: 'Consultar la página siguiente',
  budget: { provider_attempts: 9, tools: 7 },
  ...patch,
});

describe('D1 objective client contract (no inference, tokens or blocks)', () => {
  it('uses the authoritative pointer after migration, never stale legacy plan metadata', () => {
    expect(
      objectivePointer({
        agent_objective_authority: 'durable-v1',
        agent_objective_id: 'correct',
        agent_plan: { id: 'legacy' },
        objective: { id: 'stale' },
      }),
    ).toBe('correct');
    expect(objectivePointer({ agent_plan: { id: 'legacy' } })).toBeNull();
    expect(
      objectivePointer({
        agent_objective_authority: 'durable-v1',
        objective: { id: 'stale' },
      }),
    ).toBeNull();
  });
  it('accepts the optional persisted terminal pointer and tolerates legacy absence', () => {
    expect(objectivePointer({ objective: { id: 'synthetic' } })).toBe(
      'synthetic',
    );
    expect(objectivePointer(null)).toBeNull();
    expect(objectivePointer({})).toBeNull();
  });
  it('requires an explicit choice of the specific expired objective', () => {
    const expired = objective({
      semantic_status: 'expired',
      expires_at: '2020-01-01T00:00:00Z',
    });
    expect(objectiveNeedsExpiredChoice(expired)).toBe(true);
    expect(canResumeObjective(expired)).toBe(false);
    expect(canResumeObjective(expired, true)).toBe(true);
    expect(canResumeObjective(objective({ expires_at: 'invalid' }))).toBe(
      false,
    );
  });
  it('resume cannot approve writes or repeat an unknown effect', () => {
    for (const semantic_status of [
      'awaiting_approval',
      'waiting_approval',
      'pending_confirmation',
      'unknown_effect',
      'completed_verified',
      'cancelled',
      'superseded',
    ]) {
      expect(canResumeObjective(objective({ semantic_status }), true)).toBe(
        false,
      );
    }
  });
  it('asks to continue at the cap without echoing objective fields', () => {
    const value = objective();
    const before = JSON.stringify(value);
    const message = objectiveProgress(value) ?? '';
    expect(message).toContain('límite de continuaciones automáticas');
    expect(message).toContain('¿Sigo?');
    for (const hidden of [
      'Revisar órdenes',
      'partial',
      'Consultar la página siguiente',
      'Objetivo conservado',
      'Estado:',
      'Siguiente:',
    ]) {
      expect(message).not.toContain(hidden);
    }
    expect(JSON.stringify(value)).toBe(before);
    expect(value.budget?.['provider_attempts']).toBe(9);
    expect(objectiveProgress(null)).toContain('¿Sigo?');
  });
  it('generates no message when the objective cannot continue', () => {
    for (const semantic_status of [
      'awaiting_approval',
      'unknown_effect',
      'completed_verified',
      'blocked',
    ]) {
      expect(objectiveProgress(objective({ semantic_status }))).toBeNull();
    }
  });
});

it('rehydrates only current-conversation persisted progress after a dropped done frame', () => {
  const value = objective();
  const recovered = persistedObjective(
    { objective: { ...value, confirmation_token: 'never-copy' } },
    22,
  );
  expect(recovered?.id).toBe(value.id);
  expect(
    (recovered as unknown as Record<string, unknown>)['confirmation_token'],
  ).toBeUndefined();
  expect(persistedObjective({ objective: value }, 999)).toBeNull();
  expect(
    persistedObjective({ objective: { ...value, version: '7' } }, 22),
  ).toBeNull();
});
