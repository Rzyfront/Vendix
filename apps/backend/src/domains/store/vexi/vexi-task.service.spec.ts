import { VexiTaskService } from './vexi-task.service';

describe('VexiTaskService D0 business outcome vs worker completion', () => {
  const update = jest.fn().mockResolvedValue({});
  const sendToUser = jest.fn().mockResolvedValue(undefined);
  const service = new VexiTaskService(
    {} as any,
    { ai_agent_tasks: { update } } as any,
    {} as any,
    { sendToUser } as any,
  );
  beforeEach(() => jest.clearAllMocks());
  it.each(['partial', 'blocked', 'unknown_effect', 'pending_confirmation'])(
    'persists %s and does not notify business completion',
    async (outcome) => {
      const execution = {
        schema_version: '1' as const,
        outcome: outcome as 'partial',
        next_action: 'Verifica el registro.',
        evidence_refs: [],
        resource_ids: {},
      };
      await service.onTaskFinished({
        task_id: 1,
        store_id: 1,
        user_id: 9,
        goal: 'QA',
        success: true,
        content: 'Pendiente.',
        execution,
      });
      expect(update.mock.calls[0][0].data).toMatchObject({
        status: 'completed',
        result: { execution },
      });
      expect(sendToUser.mock.calls[0][3]).toBe(
        'Vexi dejó un resultado para revisar',
      );
    },
  );
  it('keeps the flag-OFF notification contract unchanged when no metadata exists', async () => {
    await service.onTaskFinished({
      store_id: 1,
      user_id: 9,
      goal: 'QA',
      success: true,
      content: 'Resultado legacy',
    });
    expect(sendToUser.mock.calls[0][3]).toBe('Vexi terminó tu trabajo');
  });
  it('preserves semantic failure receipts even when the job reports failure', async () => {
    const execution = {
      schema_version: '1' as const,
      outcome: 'failed' as const,
      next_action: 'Reintenta la consulta.',
      evidence_refs: [],
      resource_ids: {},
    };
    await service.onTaskFinished({
      task_id: 1,
      goal: 'QA',
      success: false,
      error: 'falló',
      execution,
    });
    expect(update.mock.calls[0][0].data.result.execution).toEqual(execution);
  });
});

describe('D0 task listener lag', () => {
  it('live job execution metadata wins before the listener persists the row', async () => {
    const execution = {
      schema_version: '1',
      outcome: 'partial',
      next_action: 'Revisa los datos.',
      evidence_refs: [],
      resource_ids: {},
    };
    const service = new VexiTaskService(
      {
        ai_agent_tasks: {
          findFirst: jest
            .fn()
            .mockResolvedValue({
              id: 1,
              job_id: 'qa',
              status: 'running',
              result: null,
            }),
        },
      } as any,
      {} as any,
      {
        getJobStatus: jest
          .fn()
          .mockResolvedValue({
            status: 'completed',
            result: { content: 'Resultado parcial.', execution },
          }),
      } as any,
      {} as any,
    );
    expect(await service.get(1)).toMatchObject({
      live_status: 'completed',
      result: { execution },
    });
  });
});
