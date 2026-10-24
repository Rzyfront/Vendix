import { RequestContextService } from '../../../common/context/request-context.service';
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
          findFirst: jest.fn().mockResolvedValue({
            id: 1,
            job_id: 'qa',
            status: 'running',
            result: null,
          }),
        },
      } as any,
      {} as any,
      {
        getJobStatus: jest.fn().mockResolvedValue({
          status: 'completed',
          result: { content: 'Resultado parcial.', execution },
        }),
      } as any,
      {} as any,
    );
    expect(
      await RequestContextService.runIsolated(
        {
          store_id: 11,
          organization_id: 7,
          user_id: 3,
          is_owner: true,
          is_super_admin: false,
        },
        () => service.get(1),
      ),
    ).toMatchObject({
      live_status: 'completed',
      result: { execution: { outcome: 'partial' } },
    });
  });
  it('never sends execution.next_action (model guidance) to the browser', async () => {
    const service = new VexiTaskService(
      {
        ai_agent_tasks: {
          findFirst: jest.fn().mockResolvedValue({
            id: 1,
            job_id: 'qa',
            status: 'running',
            result: null,
          }),
        },
      } as any,
      {} as any,
      {
        getJobStatus: jest.fn().mockResolvedValue({
          status: 'completed',
          result: {
            content: 'Resultado parcial.',
            execution: {
              schema_version: '1',
              outcome: 'partial',
              next_action: 'Usa search_tools.',
              evidence_refs: [],
              resource_ids: {},
            },
          },
        }),
      } as any,
      {} as any,
    );
    const task: any = await RequestContextService.runIsolated(
      {
        store_id: 11,
        organization_id: 7,
        user_id: 3,
        is_owner: true,
        is_super_admin: false,
      },
      () => service.get(1),
    );
    expect(task.result.execution).not.toHaveProperty('next_action');
  });
});

describe('D1 task reference is separate from durable objective state', () => {
  const context = {
    store_id: 11,
    organization_id: 7,
    user_id: 3,
    is_owner: false,
    is_super_admin: false,
    roles: ['employee'],
    permissions: ['store:products:read'],
  };
  let prisma: any;
  let queue: any;
  let objectives: any;
  let service: VexiTaskService;
  beforeEach(() => {
    prisma = {
      ai_agent_tasks: {
        count: jest.fn().mockResolvedValue(0),
        create: jest
          .fn()
          .mockResolvedValue({ id: 4, goal: 'consulta', status: 'queued' }),
        update: jest
          .fn()
          .mockResolvedValue({ id: 4, goal: 'consulta', status: 'running' }),
        findMany: jest.fn().mockResolvedValue([]),
        findFirst: jest.fn().mockResolvedValue({ id: 4, job_id: null }),
      },
    };
    queue = {
      enqueueAgentTask: jest.fn().mockResolvedValue({ id: 'queue-4' }),
    };
    objectives = {
      get: jest.fn().mockResolvedValue({
        id: 'objective',
        conversation_id: 22,
        agent_id: 'vexi',
      }),
    };
    service = new VexiTaskService(
      prisma,
      {} as any,
      queue,
      {} as any,
      objectives,
    );
  });
  afterAll(() => {});
  it('keeps exactly the current one-job limit and list while carrying an optional reference', async () => {
    const { RequestContextService } =
      await import('../../../common/context/request-context.service');
    await RequestContextService.runIsolated(context, async () => {
      await service.enqueue({
        goal: 'consulta',
        conversationId: 22,
        objectiveId: 'objective',
      });
      await service.listRecent();
    });
    expect(prisma.ai_agent_tasks.count).toHaveBeenCalledWith({
      where: { user_id: 3, status: { in: ['queued', 'running'] } },
    });
    expect(prisma.ai_agent_tasks.create.mock.calls[0][0].data).toMatchObject({
      objective_id: 'objective',
      status: 'queued',
    });
    expect(queue.enqueueAgentTask).toHaveBeenCalledWith(
      expect.objectContaining({ task_id: 4, objective_id: 'objective' }),
    );
    expect(prisma.ai_agent_tasks.findMany.mock.calls[0][0]).toMatchObject({
      where: { user_id: 3 },
      take: 5,
    });
    expect(Object.keys(objectives)).toEqual(['get']);
  });
  it('inherits a reference from the current owned conversation without creating an objective', async () => {
    const { RequestContextService } =
      await import('../../../common/context/request-context.service');
    objectives.getForConversation = jest.fn().mockResolvedValue({
      id: 'objective',
      conversation_id: 22,
      agent_id: 'vex',
    });
    await RequestContextService.runIsolated(context, () =>
      service.enqueue({ goal: 'consulta', conversationId: 22 }),
    );
    expect(objectives.getForConversation).toHaveBeenCalledWith(22);
    expect(queue.enqueueAgentTask.mock.calls[0][0].objective_id).toBe(
      'objective',
    );
  });
  it('refuses a different objective conversation before creating or queuing a task', async () => {
    const { RequestContextService } =
      await import('../../../common/context/request-context.service');
    await expect(
      RequestContextService.runIsolated(context, () =>
        service.enqueue({
          goal: 'consulta',
          conversationId: 999,
          objectiveId: 'objective',
        }),
      ),
    ).rejects.toThrow();
    expect(prisma.ai_agent_tasks.create).not.toHaveBeenCalled();
    expect(queue.enqueueAgentTask).not.toHaveBeenCalled();
  });
  it('static context alone cannot enqueue, poll or list with D1 enabled', async () => {
    const { RequestContextService } =
      await import('../../../common/context/request-context.service');
    RequestContextService.run(context, () => undefined);
    await expect(service.enqueue({ goal: 'consulta' })).rejects.toThrow();
    await expect(service.get(4)).rejects.toThrow();
    expect(await service.listRecent()).toEqual([]);
    expect(prisma.ai_agent_tasks.count).not.toHaveBeenCalled();
    expect(prisma.ai_agent_tasks.findFirst).not.toHaveBeenCalled();
  });
  it('polls tasks by explicit owner + tenant rather than using an objective or job as authority', async () => {
    const { RequestContextService } =
      await import('../../../common/context/request-context.service');
    await RequestContextService.runIsolated(context, () => service.get(4));
    expect(prisma.ai_agent_tasks.findFirst.mock.calls[0][0].where).toEqual({
      id: 4,
      user_id: 3,
      store_id: 11,
      organization_id: 7,
    });
    expect(objectives.get).not.toHaveBeenCalled();
  });
});
