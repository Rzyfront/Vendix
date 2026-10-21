import { NotFoundException } from '@nestjs/common';
import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import { VexiPlanStateService } from './vexi-plan-state.service';
import { VexiController } from './vexi.controller';
import { VexiObjectiveResultsController } from './vexi-objective-results.controller';
import { ResumeAgentObjectiveDto } from './dto/resume-agent-objective.dto';
import { USER_NOTICES } from '../../../ai-engine/agent-execution.contract';

function fixture() {
  const row: any = {
    id: '5c675771-8303-48db-9858-815ae11bc501',
    conversation_id: 1,
    goal: 'Crear cliente',
    semantic_status: 'paused',
    version: 9,
    expires_at: new Date(Date.now() + 60000),
    next_step: 'Revalidar datos',
    budget: { provider_attempts: 5, tools: 3 },
    requires_revalidation: true,
    plan: { private_internal: true },
    authority_snapshot: ['store:products:create'],
  };
  const repo: any = {
    isEnabled: jest.fn(() => true),
    get: jest.fn(async () => row),
    resume: jest.fn(async () => row),
    rejectProposal: jest.fn(async () => row),
    listResults: jest.fn(),
    getResult: jest.fn(),
  };
  const registry: any = { executeTool: jest.fn() };
  const planState: any = new VexiPlanStateService({} as any, repo);
  jest.spyOn(planState, 'applyDurableEffect');
  jest.spyOn(planState, 'markCurrentChangeStep');
  const activity: any = {
    recordApplied: jest.fn(),
    recordAppliedNarration: jest.fn(),
  };
  const controller = new VexiController(
    {} as any,
    { success: (data: unknown) => data } as any,
    registry,
    {} as any,
    {} as any,
    {} as any,
    {} as any,
    activity,
    {} as any,
    {} as any,
    planState,
  );
  const results = new VexiObjectiveResultsController(
    { success: (data: unknown) => data } as any,
    planState,
  );
  return { controller, results, repo, registry, planState, activity, row };
}

describe('Vexi durable objective endpoints', () => {
  it('GET exposes only progress, never plans, authority or an inference', async () => {
    const { controller, repo, registry } = fixture();
    const snapshot: any = await controller.getObjective('owned');
    expect(repo.get).toHaveBeenCalledWith('owned');
    expect(snapshot.version).toBe(9);
    expect(snapshot.plan).toBeUndefined();
    expect(snapshot.authority_snapshot).toBeUndefined();
    expect(registry.executeTool).not.toHaveBeenCalled();
  });

  it('POST selects an explicit expired objective without resetting budget or starting inference', async () => {
    const { controller, repo, registry } = fixture();
    const snapshot: any = await controller.resumeObjective('owned', {
      expected_version: 9,
      confirm_expired: true,
    });
    expect(repo.resume).toHaveBeenCalledWith('owned', {
      expected_version: 9,
      allow_expired: true,
    });
    expect(snapshot.budget).toEqual({ provider_attempts: 5, tools: 3 });
    expect(snapshot.requires_revalidation).toBe(true);
    expect(registry.executeTool).not.toHaveBeenCalled();
  });

  it('declines a proposal under CAS without inference or budget reset', async () => {
    const { controller, repo, registry } = fixture();
    const snapshot: any = await controller.rejectObjectiveProposal('owned', {
      expected_version: 9,
    });
    expect(repo.rejectProposal).toHaveBeenCalledWith('owned', 9);
    expect(snapshot.budget.provider_attempts).toBe(5);
    expect(registry.executeTool).not.toHaveBeenCalled();
  });

  it('does not implicitly confirm expiry and missing/foreign ids have the same 404', async () => {
    const { controller, repo } = fixture();
    repo.get.mockRejectedValue(new NotFoundException('Objective not found'));
    await expect(controller.getObjective('foreign')).rejects.toEqual(
      new NotFoundException('Objective not found'),
    );
    await expect(controller.getObjective('missing')).rejects.toEqual(
      new NotFoundException('Objective not found'),
    );
    await controller.resumeObjective('owned', { expected_version: 9 });
    expect(repo.resume).toHaveBeenCalledWith('owned', {
      expected_version: 9,
      allow_expired: false,
    });
  });

  it('artifact handles are paginated without serializing every full result into the list', async () => {
    const { results: controller, repo } = fixture();
    repo.listResults.mockResolvedValue({
      items: [{ id: 'r1', tool_call_id: 'c1', data: ['large'] }],
      next_cursor: 'r1',
      has_more: true,
    });
    expect(await controller.getObjectiveResults('owned', { limit: 1 })).toEqual(
      {
        items: [{ id: 'r1', tool_call_id: 'c1' }],
        next_cursor: 'r1',
        has_more: true,
      },
    );
    repo.getResult.mockResolvedValue({ id: 'r1', data: [1, 2, 3, 4, 5] });
    expect(
      await controller.getObjectiveResult('owned', 'r1', {
        offset: 2,
        limit: 2,
      }),
    ).toMatchObject({
      id: 'r1',
      data: [3, 4],
      artifact: true,
      reusable_for_write: false,
      observed_at: undefined,
      artifact_pagination: {
        offset: 2,
        limit: 2,
        total: 5,
        complete: false,
        has_more: true,
        next_offset: 4,
      },
    });
  });

  it('pages nested row envelopes as whole records and does not call a last page a complete dataset', async () => {
    const { results: controller, repo } = fixture();
    repo.getResult.mockResolvedValue({
      id: 'r1',
      data: { data: { rows: [{ id: 1 }, { id: 2 }, { id: 3 }], total: 3 } },
    });
    const page = (await controller.getObjectiveResult('owned', 'r1', {
      offset: 2,
      limit: 1,
    })) as any;
    expect(page.data).toEqual({ data: { rows: [{ id: 3 }], total: 3 } });
    expect(page.artifact_pagination).toMatchObject({
      total: 3,
      complete: false,
      has_more: false,
      next_offset: null,
    });
  });

  it('an unknown write outcome never enters the applied audit/narration/plan path', async () => {
    const { controller, registry, planState, activity } = fixture();
    planState.applyDurableEffect.mockResolvedValue({
      output: '{"status":"unknown_effect"}',
      result: {
        status: 'unknown_effect',
        effect_status: 'unknown',
        next_action: 'Verifica el registro.',
      },
    });
    const output: any = await controller.applyConfirmation({
      tool: 'write_endpoint',
      arguments: {},
      confirmation_token: 'secret',
      conversation_id: 1,
    });
    expect(output.execution.status).toBe('unknown_effect');
    expect(activity.recordApplied).not.toHaveBeenCalled();
    expect(activity.recordAppliedNarration).not.toHaveBeenCalled();
    expect(planState.markCurrentChangeStep).not.toHaveBeenCalled();
    expect(registry.executeTool).not.toHaveBeenCalled();
    expect(planState.applyDurableEffect.mock.calls[0][0]).not.toHaveProperty(
      'confirmation_token',
    );
  });

  it('A1: a failed or uncertain approval shows a catalog line, never next_action', async () => {
    const MODEL_ONLY = 'Lista las reservas con list_bookings y usa su booking_id.';
    for (const [result, notice] of [
      [
        { status: 'recoverable_error', effect_status: 'not_applied', next_action: MODEL_ONLY },
        USER_NOTICES.apply_failed,
      ],
      [
        { status: 'unknown_effect', effect_status: 'unknown', next_action: MODEL_ONLY },
        USER_NOTICES.unknown_effect,
      ],
    ] as const) {
      const { controller, planState } = fixture();
      planState.applyDurableEffect.mockResolvedValue({ output: '{}', result });
      const output: any = await controller.applyConfirmation({
        tool: 'cancel_booking',
        arguments: {},
        confirmation_token: 'secret',
        conversation_id: 1,
      });
      expect(output.summary).toBe(notice);
      expect(output.execution).not.toHaveProperty('next_action');
      expect(JSON.stringify(output)).not.toContain(MODEL_ONLY);
    }
  });
});

describe('ResumeAgentObjectiveDto validation', () => {
  it('requires an integer positive version and a boolean explicit expiry choice', async () => {
    for (const input of [
      {},
      { expected_version: 0 },
      { expected_version: 1.5 },
      { expected_version: 2, confirm_expired: 'yes' },
      { expected_version: 2, reset_budget: true },
    ]) {
      expect(
        (
          await validate(plainToInstance(ResumeAgentObjectiveDto, input), {
            whitelist: true,
            forbidNonWhitelisted: true,
          })
        ).length,
      ).toBeGreaterThan(0);
    }
    expect(
      await validate(
        plainToInstance(ResumeAgentObjectiveDto, {
          expected_version: 2,
          confirm_expired: true,
        }),
      ),
    ).toHaveLength(0);
  });
});
