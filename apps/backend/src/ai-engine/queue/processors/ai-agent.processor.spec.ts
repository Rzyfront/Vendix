import { DelayedError } from 'bullmq';
import { ConflictException } from '@nestjs/common';
import {
  AgentObjectiveRepository,
  ObjectiveLeaseBusyException,
  ObjectiveLeaseChangedException,
} from '../../tasks/agent-objective.repository';
import { AgentDurableSessionService } from '../../tasks/agent-durable-session.service';
import { ObjectiveMemoryDatabase } from '../../tasks/testing/objective-memory-db';
import { RequestContextService } from '../../../common/context/request-context.service';
import { AIAgentProcessor } from './ai-agent.processor';

describe('D1 worker authority and isolated durable reference', () => {
  const data = {
    goal: 'Consulta sintética',
    store_id: 11,
    organization_id: 7,
    user_id: 3,
    permissions: ['store:products:read'],
    roles: ['employee'],
    conversation_id: 22,
  };
  let runAgent: jest.Mock;
  let emit: jest.Mock;
  let prisma: any;
  let gate: jest.Mock;
  let objectives: any;
  let sessions: any;
  let processor: AIAgentProcessor;
  const assignment = (permissions: string[], role = 'employee') => ({
    store_id: 11,
    roles: {
      name: role,
      role_permissions: permissions.map((name) => ({
        granted: true,
        permissions: { name, status: 'active' },
      })),
    },
  });
  beforeEach(() => {
    runAgent = jest.fn().mockResolvedValue({
      success: true,
      content: 'Datos observados.',
      tools_used: [],
    });
    prisma = {
      ai_agents: {
        findUnique: jest.fn().mockResolvedValue({
          key: 'vexi',
          is_active: true,
          app_key: 'chat_assistant',
          allowed_tools: ['products'],
          denied_tools: ['ui_*'],
          max_iterations: 8,
          timeout_seconds: 30,
        }),
      },
      store_settings: {
        findUnique: jest.fn().mockResolvedValue({
          settings: { vexi: { enabled: true }, vex: { enabled: true } },
        }),
      },
      users: {
        findFirst: jest
          .fn()
          .mockResolvedValue({ id: 3, state: 'active', locked_until: null }),
      },
      stores: { findFirst: jest.fn().mockResolvedValue({ id: 11 }) },
      store_users: { findUnique: jest.fn().mockResolvedValue({ id: 9 }) },
      user_roles: {
        findMany: jest.fn().mockResolvedValue([assignment(data.permissions)]),
      },
    };
    gate = jest.fn().mockResolvedValue({ allowed: true });
    objectives = {
      get: jest.fn().mockResolvedValue({
        id: 'objective',
        conversation_id: 22,
        goal: data.goal,
        authority_snapshot: data.permissions,
      }),
    };
    sessions = {
      open: jest.fn().mockResolvedValue({
        objective_id: 'objective',
        objective: { id: 'objective', conversation_id: 22 },
        turn_id: 'synthetic-turn',
        context: 'Hechos observados',
        close: jest.fn(),
      }),
    };
    emit = jest.fn();
    processor = new AIAgentProcessor(
      { runAgent } as any,
      { emit } as any,
      prisma,
      { canUseAIFeature: gate } as any,
      objectives,
      sessions,
    );
  });
  afterAll(() => {});
  const job = (extra: Record<string, unknown> = {}) => {
    const value: any = { id: 'synthetic', data: { ...data, ...extra } };
    value.updateData = jest.fn(async (next) => {
      value.data = next;
    });
    value.moveToDelayed = jest.fn().mockResolvedValue(undefined);
    return value;
  };

  it('defers ONLY lease contention without consuming the single functional attempt or notifying failure', async () => {
    const task = job({ objective_id: 'objective' });
    sessions.open.mockRejectedValueOnce(new ObjectiveLeaseBusyException());
    await expect(processor.process(task, 'worker-lock')).rejects.toBeInstanceOf(
      DelayedError,
    );
    expect(task.moveToDelayed).toHaveBeenCalledWith(
      expect.any(Number),
      'worker-lock',
    );
    expect(task.data.lease_wait.count).toBe(1);
    expect(runAgent).not.toHaveBeenCalled();
    expect(emit).not.toHaveBeenCalled();
    // After the emitting chat releases, the same job takes a fresh authority path.
    await processor.process(task, 'worker-lock-2');
    expect(prisma.user_roles.findMany).toHaveBeenCalledTimes(2);
    expect(runAgent).toHaveBeenCalledTimes(1);
    expect(emit).toHaveBeenCalledTimes(1);
  });
  it.each([ObjectiveLeaseBusyException, ObjectiveLeaseChangedException])(
    'revalidates revocation after %s rather than retaining old ALS permissions',
    async (Contention) => {
      const task = job({ objective_id: 'objective' });
      sessions.open.mockRejectedValueOnce(new Contention());
      await expect(processor.process(task, 'lock')).rejects.toBeInstanceOf(
        DelayedError,
      );
      prisma.user_roles.findMany.mockResolvedValue([assignment([])]);
      await expect(processor.process(task, 'lock2')).rejects.toThrow(
        'Worker permissions revoked',
      );
      expect(runAgent).not.toHaveBeenCalled();
      expect(task.moveToDelayed).toHaveBeenCalledTimes(1);
      expect(emit).toHaveBeenCalledTimes(1);
    },
  );
  it.each([false, true])(
    'reenters the real repository/session after handoff contention (release during open: %s)',
    async (releaseDuringOpen) => {
      const db = new ObjectiveMemoryDatabase();
      db.seedConversation(22, data);
      const repo = new AgentObjectiveRepository(db.prisma);
      const realSessions = new AgentDurableSessionService(repo, {
        build: jest.fn().mockResolvedValue({ context: '', playbook_pins: [] }),
      } as any);
      const context = { ...data, is_owner: false, is_super_admin: false };
      const owner = await RequestContextService.runIsolated(context, async () => {
        const initial = await repo.createOrReplace(22, null, 'vexi', {
          goal: data.goal,
          authority_snapshot: data.permissions,
        });
        return repo.acquireLease(initial.id, initial.version, 650_000);
      });
      const acquire = repo.acquireLease.bind(repo);
      const acquireSpy = jest.spyOn(repo, 'acquireLease');
      if (releaseDuringOpen) {
        acquireSpy.mockImplementationOnce(async (...args) => {
          // open has read v2. The emitter releases v2 -> v3 before the CAS.
          expect(await repo.releaseLease(owner.id, owner)).toBe(true);
          return acquire(...args);
        });
      }
      processor = new AIAgentProcessor(
        { runAgent } as any,
        { emit } as any,
        prisma,
        { canUseAIFeature: gate } as any,
        repo,
        realSessions,
      );
      const task = job({ objective_id: owner.id });
      await expect(processor.process(task, 'lock1')).rejects.toBeInstanceOf(
        DelayedError,
      );
      await expect(acquireSpy.mock.results[0].value).rejects.toBeInstanceOf(
        releaseDuringOpen
          ? ObjectiveLeaseChangedException
          : ObjectiveLeaseBusyException,
      );
      expect(task.moveToDelayed).toHaveBeenCalledTimes(1);
      expect(runAgent).not.toHaveBeenCalled();
      expect(emit).not.toHaveBeenCalled();
      if (!releaseDuringOpen) {
        await RequestContextService.runIsolated(context, () =>
          repo.releaseLease(owner.id, owner),
        );
      }
      runAgent.mockImplementationOnce(async ({ durable }) => {
        expect(durable.objective.version).toBe(owner.version + 2);
        expect(durable.objective.lease_generation).toBe(
          owner.lease_generation + 1,
        );
        expect(durable.objective.budget).toEqual(owner.budget);
        return { success: true, tools_used: [] };
      });
      await processor.process(task, 'lock2');
      expect(acquireSpy.mock.calls.map((call) => call[1])).toEqual([
        owner.version,
        owner.version + 1,
      ]);
      expect(prisma.user_roles.findMany).toHaveBeenCalledTimes(2);
      expect(gate).toHaveBeenCalledTimes(2);
      expect(runAgent).toHaveBeenCalledTimes(1);
      expect(emit).toHaveBeenCalledTimes(1);
    },
  );
  it.each([
    new ConflictException('budget exhausted'),
    new ConflictException('unknown effect'),
  ])('does not defer a functional block %s', async (error) => {
    const task = job({ objective_id: 'objective' });
    sessions.open.mockRejectedValue(error);
    await expect(processor.process(task, 'lock')).rejects.toBe(error);
    expect(task.moveToDelayed).not.toHaveBeenCalled();
    expect(runAgent).not.toHaveBeenCalled();
    expect(emit).toHaveBeenCalledTimes(1);
  });
  it.each([ObjectiveLeaseBusyException, ObjectiveLeaseChangedException])(
    'bounds %s across worker reentries and eventually reports one real failure',
    async (Contention) => {
      const task = job({
        objective_id: 'objective',
        lease_wait: { started_at: Date.now() - 660001, count: 133 },
      });
      sessions.open.mockRejectedValue(new Contention());
      await expect(processor.process(task, 'lock')).rejects.toBeInstanceOf(
        Contention,
      );
      expect(task.moveToDelayed).not.toHaveBeenCalled();
      expect(runAgent).not.toHaveBeenCalled();
      expect(emit).toHaveBeenCalledTimes(1);
    },
  );

  it('does not execute when all snapshotted permissions were revoked', async () => {
    prisma.user_roles.findMany.mockResolvedValue([
      assignment(['store:orders:read']),
    ]);
    await expect(processor.process(job())).rejects.toThrow(
      'Worker permissions revoked',
    );
    expect(runAgent).not.toHaveBeenCalled();
  });
  it('new grants never expand the job snapshot; no bearer survives the boundary', async () => {
    const { RequestContextService } =
      await import('../../../common/context/request-context.service');
    prisma.user_roles.findMany.mockResolvedValue([
      assignment([...data.permissions, 'store:orders:create'], 'owner'),
    ]);
    runAgent.mockImplementation(async () => {
      const context = RequestContextService.asyncLocalStorage.getStore();
      expect(context).toMatchObject({
        store_id: 11,
        permissions: data.permissions,
        roles: [],
        is_owner: false,
        is_super_admin: false,
      });
      expect(context?.access_token).toBeUndefined();
      return { success: true, content: 'Sin writes.', tools_used: [] };
    });
    await processor.process(job({ access_token: 'must-never-be-restored' }));
    expect(prisma.user_roles.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { user_id: 3, OR: [{ store_id: null }, { store_id: 11 }] },
      }),
    );
  });
  it.each(['membership', 'user', 'store', 'gate', 'switch', 'agent'])(
    'fails closed on current %s revocation',
    async (which) => {
      if (which === 'membership')
        prisma.store_users.findUnique.mockResolvedValue(null);
      if (which === 'user')
        prisma.users.findFirst.mockResolvedValue({ id: 3, state: 'suspended' });
      if (which === 'store') prisma.stores.findFirst.mockResolvedValue(null);
      if (which === 'gate') gate.mockResolvedValue({ allowed: false });
      if (which === 'switch')
        prisma.store_settings.findUnique.mockResolvedValue({ settings: {} });
      if (which === 'agent')
        prisma.ai_agents.findUnique.mockResolvedValue({ is_active: false });
      await expect(processor.process(job())).rejects.toThrow();
      expect(runAgent).not.toHaveBeenCalled();
    },
  );
  it('missing explicit IDs cannot borrow a stale static ALS fallback', async () => {
    const { RequestContextService } =
      await import('../../../common/context/request-context.service');
    const stale = {
      is_super_admin: true,
      is_owner: true,
      store_id: 999,
      organization_id: 999,
      user_id: 999,
      access_token: 'foreign',
    };
    RequestContextService.run(stale, () => undefined);
    await expect(
      processor.process(job({ store_id: undefined })),
    ).rejects.toThrow('Explicit worker authority');
    expect(runAgent).not.toHaveBeenCalled();
    expect(RequestContextService.getContext()).toBe(stale);
  });
  it('opens only an owned same-conversation durable reference and closes its lease', async () => {
    await processor.process(job({ objective_id: 'objective' }));
    expect(objectives.get).toHaveBeenCalledWith('objective');
    expect(sessions.open).toHaveBeenCalledWith(22, 'vexi', data.goal, {
      objectiveId: 'objective',
      continuation: true,
    });
    const session = await sessions.open.mock.results[0].value;
    expect(runAgent).toHaveBeenCalledWith(
      expect.objectContaining({
        objective_id: 'objective',
        durable: session,
        conversation_id: 22,
        turn_id: 'synthetic-turn',
      }),
    );
    expect(session.close).toHaveBeenCalledTimes(1);
  });
  it('an empty objective snapshot never falls back to an owner role', async () => {
    objectives.get.mockResolvedValue({
      id: 'objective',
      conversation_id: 22,
      authority_snapshot: [],
    });
    await expect(
      processor.process(job({ objective_id: 'objective' })),
    ).rejects.toThrow('Objective authority revoked');
    expect(runAgent).not.toHaveBeenCalled();
  });
  it('a cross-conversation objective never enters the agent loop', async () => {
    objectives.get.mockResolvedValue({ id: 'objective', conversation_id: 999 });
    await expect(
      processor.process(job({ objective_id: 'objective' })),
    ).rejects.toThrow('Objective context mismatch');
    expect(runAgent).not.toHaveBeenCalled();
  });
  it('honors current Vex row denies, role gate and quotas without Vex-only hooks', async () => {
    prisma.user_roles.findMany.mockResolvedValue([
      assignment(data.permissions, 'owner'),
    ]);
    prisma.ai_agents.findUnique.mockResolvedValue({
      key: 'vex',
      is_active: true,
      app_key: 'current_vex',
      allowed_tools: ['products'],
      denied_tools: ['ui_*', 'create_product'],
      max_iterations: 5,
      timeout_seconds: 20,
    });
    objectives.get.mockResolvedValue({
      id: 'objective',
      conversation_id: 22,
      agent_id: 'vex',
      authority_snapshot: data.permissions,
    });
    await processor.process(
      job({
        objective_id: 'objective',
        roles: ['owner'],
        max_iterations: 4,
        timeout_ms: 10000,
        tools: ['read_product'],
      }),
    );
    expect(gate).toHaveBeenCalledWith(11, 'vex_agent');
    const params = runAgent.mock.calls[0][0];
    expect(params).toMatchObject({
      agent_key: 'vex',
      app_key: 'current_vex',
      agent_allowed_tools: ['products'],
      agent_denied_tools: [
        'ui_*',
        'create_product',
        'call_endpoint',
        'write_endpoint',
        'bulk_prepare',
      ],
      max_iterations: 4,
      timeout_ms: 10000,
      tools: ['read_product'],
    });
    expect(params.plan_approval).toBeUndefined();
    expect(params.block_sink).toBeUndefined();
  });
  it('does not treat a role permission marked granted=false as current authority', async () => {
    prisma.user_roles.findMany.mockResolvedValue([
      {
        roles: {
          name: 'employee',
          role_permissions: [
            {
              granted: false,
              permissions: { name: data.permissions[0], status: 'active' },
            },
          ],
        },
      },
    ]);
    await expect(processor.process(job())).rejects.toThrow(
      'Worker permissions revoked',
    );
    expect(runAgent).not.toHaveBeenCalled();
  });
});
