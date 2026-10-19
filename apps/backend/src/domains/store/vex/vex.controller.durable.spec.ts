import { GUARDS_METADATA } from '@nestjs/common/constants';
import { VexController } from './vex.controller';

function fixture() {
  const controller: any = Object.create(VexController.prototype);
  controller.responseService = { success: (value: unknown) => value };
  controller.planState = {
    getObjectiveProgress: jest.fn(async () => ({ id: 'objective' })),
    rejectObjectiveProposal: jest.fn(async () => ({ id: 'objective' })),
    resumeObjective: jest.fn(async () => ({
      id: 'objective',
      requires_revalidation: true,
    })),
    listObjectiveResults: jest.fn(async () => ({ items: [] })),
    getObjectiveArtifact: jest.fn(async () => ({ id: 'result' })),
    applyDurableEffect: jest.fn(async () => ({
      output: '{}',
      result: {
        status: 'unknown_effect',
        effect_status: 'unknown',
        next_action: 'Reconciliar.',
      },
    })),
    markCurrentChangeStep: jest.fn(),
  };
  controller.planApproval = {
    resolveStepForApply: jest.fn(async () => ({
      tool: 'create_customer',
      arguments: { name: 'Juan' },
    })),
    redeemPlanStep: jest.fn(async () => 'ok'),
  };
  controller.confirmations = { issue: jest.fn(async () => 'single-use') };
  controller.toolRegistry = { executeTool: jest.fn() };
  controller.activity = {
    recordApplied: jest.fn(),
    recordAppliedNarration: jest.fn(),
  };
  controller.consumeVexQuota = jest.fn();
  controller.persistStepResult = jest.fn();
  return controller;
}

describe('Vex durable objective aliases', () => {
  it('uses the Vex switch instead of depending on Vexi being enabled', () => {
    const guards = Reflect.getMetadata(GUARDS_METADATA, VexController).map(
      (guard: { name: string }) => guard.name,
    );
    expect(guards).toContain('VexEnabledGuard');
    expect(guards).not.toContain('VexiEnabledGuard');
  });

  it('delegates owned progress/resume/artifacts to the same scoped service, without inference', async () => {
    const c = fixture();
    expect(await c.getObjective('objective')).toEqual({ id: 'objective' });
    await c.resumeObjective('objective', {
      expected_version: 9,
      confirm_expired: true,
    });
    expect(c.planState.resumeObjective).toHaveBeenCalledWith('objective', {
      expected_version: 9,
      allow_expired: true,
    });
    await c.getObjectiveResult('objective', 'result', { offset: 10, limit: 5 });
    expect(c.planState.getObjectiveArtifact).toHaveBeenCalledWith(
      'objective',
      'result',
      { offset: 10, limit: 5 },
    );
    expect(c.toolRegistry.executeTool).not.toHaveBeenCalled();
  });

  it('does not narrate, close steps or consume successful quota for an uncertain effect', async () => {
    const c = fixture();
    const output = await c.applyPlanStep({
      conversation_id: 1,
      plan_id: 'plan',
      step_id: 's1',
      plan_token: 'approved-token',
    });
    expect(output.execution.status).toBe('unknown_effect');
    expect(c.activity.recordApplied).not.toHaveBeenCalled();
    expect(c.planState.markCurrentChangeStep).not.toHaveBeenCalled();
    expect(c.consumeVexQuota).not.toHaveBeenCalled();
    expect(output.step_status).toBe('unknown');
    expect(output.plan_status).toBe('unknown_effect');
    expect(c.persistStepResult).toHaveBeenCalledWith(
      expect.objectContaining({
        outcome: 'unknown',
        stepId: 's1',
      }),
    );
    expect(c.planState.applyDurableEffect.mock.calls[0][0]).not.toHaveProperty(
      'confirmation_token',
    );
  });
});
