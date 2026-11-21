import { ConversationPurgeService } from './conversation-purge.service';
import {
  ConversationPurgeS3Cleaner,
  MAX_S3_PURGE_ATTEMPTS,
} from './conversation-purge-s3.cleaner';
import { RequestContextService } from '../../../common/context/request-context.service';

const ctx = {
  store_id: 1,
  organization_id: 2,
  user_id: 3,
  is_super_admin: false,
  is_owner: false,
};
const CONV = 42;
const OBJ = ['obj-1', 'obj-2'];

type Calls = string[];

/** Delegate with deleteMany/updateMany/findMany/create that records its order. */
function delegate(
  name: string,
  calls: Calls,
  extra: Record<string, unknown> = {},
) {
  const d: Record<string, jest.Mock> = {
    deleteMany: jest.fn(async () => {
      calls.push(`${name}.deleteMany`);
      return { count: 3 };
    }),
    updateMany: jest.fn(async () => {
      calls.push(`${name}.updateMany`);
      return { count: 2 };
    }),
    findMany: jest.fn(async () => []),
    create: jest.fn(async () => {
      calls.push(`${name}.create`);
      return { id: 77 };
    }),
  };
  return Object.assign(d, extra) as Record<string, jest.Mock>;
}

function build(opts?: {
  conversation?: Record<string, unknown> | null;
  runningTasks?: number;
  activeObjectives?: number;
  attachments?: Array<Record<string, unknown>>;
  convDeleteCount?: number;
}) {
  const calls: Calls = [];
  const o = opts ?? {};
  const tx = {
    ai_agent_objectives: delegate('objectives', calls, {
      findMany: jest.fn(async () => OBJ.map((id) => ({ id }))),
    }),
    ai_agent_trace_spans: delegate('spans', calls),
    ai_agent_effects: delegate('effects', calls),
    ai_agent_tool_results: delegate('tool_results', calls),
    ai_agent_tasks: delegate('tasks', calls),
    ai_ui_blocks: delegate('blocks', calls),
    ai_attachments: delegate('attachments', calls, {
      findMany: jest.fn(async () => o.attachments ?? []),
    }),
    ai_messages: delegate('messages', calls),
    ai_engine_logs: delegate('logs', calls),
    ai_conversations: delegate('conversation', calls, {
      deleteMany: jest.fn(async () => {
        calls.push('conversation.deleteMany');
        return { count: o.convDeleteCount ?? 1 };
      }),
    }),
    ai_conversation_purges: delegate('purges', calls),
    // Any access to user_reminders would be a bug: it is not defined here.
  };
  const prisma = {
    ai_conversations: {
      findFirst: jest.fn(async () =>
        o.conversation === undefined
          ? { id: CONV, user_id: 3, metadata: { agent_key: 'vex' } }
          : o.conversation,
      ),
    },
    ai_messages: { count: jest.fn(async () => 42) },
    ai_ui_blocks: { count: jest.fn(async () => 5) },
    ai_attachments: { count: jest.fn(async () => 3) },
    ai_agent_tasks: { count: jest.fn(async () => o.runningTasks ?? 0) },
    ai_agent_objectives: {
      count: jest.fn(async () => o.activeObjectives ?? 0),
    },
    $transaction: jest.fn(async (cb: (t: unknown) => unknown) => cb(tx)),
  };
  const cleaner = { clean: jest.fn(async () => true) };
  const redis = {
    del: jest.fn(async () => 1),
    scan: jest.fn(async () => ['0', []]),
    get: jest.fn(),
  };
  const service = new ConversationPurgeService(
    prisma as never,
    cleaner as never,
    redis as never,
  );
  return { service, prisma, tx, calls, cleaner, redis };
}

const run = <T>(fn: () => Promise<T>) =>
  RequestContextService.runIsolated(ctx, fn);

function totalMutations(tx: Record<string, Record<string, jest.Mock>>) {
  return Object.values(tx).reduce(
    (n, d) =>
      n +
      (d.deleteMany?.mock.calls.length ?? 0) +
      (d.updateMany?.mock.calls.length ?? 0) +
      (d.create?.mock.calls.length ?? 0),
    0,
  );
}

describe('ConversationPurgeService.purge', () => {
  it('deletes every table of §3.13 with a conversation-scoped where, in Restrict order', async () => {
    const { service, tx, calls } = build({
      attachments: [
        {
          id: 1,
          s3_key: 'a/1.pdf',
          linked_entity_type: null,
          linked_entity_id: null,
        },
        {
          id: 2,
          s3_key: 'a/2.pdf',
          linked_entity_type: 'expense',
          linked_entity_id: 9,
        },
      ],
    });
    const result = await run(() => service.purge(CONV));

    // order: leaves hanging with Restrict first
    const idx = (c: string) => calls.indexOf(c);
    expect(idx('spans.deleteMany')).toBeGreaterThanOrEqual(0);
    expect(idx('effects.updateMany')).toBeLessThan(
      idx('tool_results.deleteMany'),
    );
    expect(idx('tool_results.deleteMany')).toBeLessThan(
      idx('tasks.deleteMany'),
    );
    expect(idx('tasks.deleteMany')).toBeLessThan(idx('objectives.deleteMany'));
    expect(idx('objectives.deleteMany')).toBeLessThan(
      idx('conversation.deleteMany'),
    );
    expect(idx('messages.deleteMany')).toBeLessThan(
      idx('conversation.deleteMany'),
    );
    expect(idx('blocks.deleteMany')).toBeLessThan(
      idx('conversation.deleteMany'),
    );
    expect(idx('conversation.deleteMany')).toBeLessThan(idx('purges.create'));

    const w = (name: keyof typeof tx, fn: 'deleteMany' | 'updateMany') =>
      (tx[name] as Record<string, jest.Mock>)[fn].mock.calls[0][0].where;

    expect(w('ai_agent_trace_spans', 'deleteMany')).toEqual({
      store_id: 1,
      OR: [{ conversation_id: '42' }, { objective_id: { in: OBJ } }],
    });
    expect(w('ai_agent_tool_results', 'deleteMany')).toEqual({
      store_id: 1,
      objective_id: { in: OBJ },
    });
    expect(w('ai_agent_tasks', 'deleteMany').OR).toEqual([
      { conversation_id: CONV },
      { objective_id: { in: OBJ } },
    ]);
    expect(w('ai_agent_objectives', 'deleteMany')).toMatchObject({
      id: { in: OBJ },
      conversation_id: CONV,
      store_id: 1,
    });
    expect(w('ai_ui_blocks', 'deleteMany')).toEqual({
      store_id: 1,
      conversation_id: CONV,
    });
    expect(w('ai_messages', 'deleteMany')).toMatchObject({
      conversation_id: CONV,
    });
    expect(w('ai_conversations', 'deleteMany')).toEqual({
      id: CONV,
      store_id: 1,
      organization_id: 2,
      user_id: 3,
    });
    // attachments: only the unlinked one is deleted; the linked one is detached
    expect(w('ai_attachments', 'deleteMany')).toMatchObject({
      conversation_id: CONV,
      id: { in: [1] },
    });
    expect(tx.ai_attachments.updateMany.mock.calls[0][0]).toMatchObject({
      where: { id: { in: [2] } },
      data: { conversation_id: null },
    });

    expect(result).toEqual({
      purged: true,
      counts: { messages: 3, attachments: 1, blocks: 3, memories: 0 },
    });
  });

  it('every mutation names store_id or the conversation (never unscoped)', async () => {
    const { service, tx } = build();
    await run(() => service.purge(CONV));
    for (const d of Object.values(tx) as Array<Record<string, jest.Mock>>) {
      for (const fn of ['deleteMany', 'updateMany'] as const) {
        for (const [arg] of d[fn].mock.calls) {
          expect(Object.keys(arg.where).length).toBeGreaterThan(0);
        }
      }
    }
  });

  it('keeps applied effects (detached, not deleted) and anonymizes engine logs', async () => {
    const { service, tx } = build();
    await run(() => service.purge(CONV));
    expect(tx.ai_agent_effects.deleteMany).not.toHaveBeenCalled();
    expect(tx.ai_agent_effects.updateMany.mock.calls[0][0]).toEqual({
      where: { store_id: 1, objective_id: { in: OBJ } },
      data: { objective_id: null, evidence_result_id: null },
    });
    expect(tx.ai_engine_logs.deleteMany).not.toHaveBeenCalled();
    expect(tx.ai_engine_logs.updateMany.mock.calls[0][0]).toEqual({
      where: {
        store_id: 1,
        OR: [{ conversation_id: '42' }, { objective_id: { in: OBJ } }],
      },
      data: { conversation_id: null, objective_id: null },
    });
  });

  it('does not touch user_reminders (not even defined on the tx)', async () => {
    const { service, tx } = build();
    expect('user_reminders' in tx).toBe(false);
    await expect(run(() => service.purge(CONV))).resolves.toBeDefined();
  });

  it('writes the purge row without title or content, with pending S3 keys', async () => {
    const { service, tx } = build({
      attachments: [
        {
          id: 1,
          s3_key: 'a/1.pdf',
          linked_entity_type: null,
          linked_entity_id: null,
        },
      ],
    });
    await run(() => service.purge(CONV));
    const data = tx.ai_conversation_purges.create.mock.calls[0][0].data;
    expect(data).toMatchObject({
      store_id: 1,
      organization_id: 2,
      user_id: 3,
      conversation_id: CONV,
      agent_key: 'vex',
      pending_s3_keys: ['a/1.pdf'],
      s3_completed_at: null,
    });
    expect(data.counts).toMatchObject({ messages: 3, effects_detached: 2 });
    expect(Object.keys(data)).not.toEqual(
      expect.arrayContaining(['title', 'content', 'summary']),
    );
    expect(JSON.stringify(data)).not.toMatch(/title|content|summary/);
  });

  it('runs the S3 cleaner after commit only when there are keys, and survives its failure', async () => {
    const { service, cleaner } = build({
      attachments: [
        {
          id: 1,
          s3_key: 'a/1.pdf',
          linked_entity_type: null,
          linked_entity_id: null,
        },
      ],
    });
    cleaner.clean.mockRejectedValue(new Error('s3 down'));
    await expect(run(() => service.purge(CONV))).resolves.toMatchObject({
      purged: true,
    });
    expect(cleaner.clean).toHaveBeenCalledTimes(1);
  });

  it('skips the cleaner when there is nothing in S3', async () => {
    const { service, cleaner } = build();
    await run(() => service.purge(CONV));
    expect(cleaner.clean).not.toHaveBeenCalled();
  });

  it('clears the Redis turn key (best effort: a Redis failure does not fail the purge)', async () => {
    const { service, redis } = build();
    redis.del.mockRejectedValue(new Error('redis down'));
    await expect(run(() => service.purge(CONV))).resolves.toMatchObject({
      purged: true,
    });
    expect(redis.del).toHaveBeenCalledWith('vexi:turn:42');
  });

  it.each([
    ['another user / store (scoped lookup finds nothing)', null],
    [
      'a Vexi conversation',
      { id: CONV, user_id: 3, metadata: { agent_key: 'vexi' } },
    ],
    [
      'a legacy conversation (null metadata)',
      { id: CONV, user_id: 3, metadata: null },
    ],
  ])('%s -> AI_CHAT_001 and ZERO mutations', async (_label, conversation) => {
    const { service, tx, prisma } = build({ conversation });
    await run(async () => {
      await expect(service.purge(CONV)).rejects.toMatchObject({
        errorCode: 'AI_CHAT_001',
      });
    });
    expect(prisma.$transaction).not.toHaveBeenCalled();
    expect(totalMutations(tx)).toBe(0);
  });

  it('the ownership lookup filters by the context user', async () => {
    const { service, prisma } = build();
    await run(() => service.purge(CONV));
    expect(prisma.ai_conversations.findFirst).toHaveBeenCalledWith({
      where: { id: CONV, user_id: 3 },
    });
  });

  it.each([
    ['a queued/running task', { runningTasks: 1 }],
    ['an active objective with a live lease', { activeObjectives: 1 }],
  ])('%s -> AI_CHAT_005 (409) and ZERO mutations', async (_label, o) => {
    const { service, tx, prisma } = build(o);
    await run(async () => {
      await expect(service.purge(CONV)).rejects.toMatchObject({
        errorCode: 'AI_CHAT_005',
      });
    });
    expect(prisma.$transaction).not.toHaveBeenCalled();
    expect(totalMutations(tx)).toBe(0);
  });

  it('rolls back (throws) when the conversation row was already gone', async () => {
    const { service } = build({ convDeleteCount: 0 });
    await run(async () => {
      await expect(service.purge(CONV)).rejects.toMatchObject({
        errorCode: 'AI_CHAT_001',
      });
    });
  });

  it('fails closed without request context', async () => {
    const { service } = build();
    await RequestContextService.runIsolated(
      { ...ctx, user_id: undefined as unknown as number },
      async () => {
        await expect(service.purge(CONV)).rejects.toMatchObject({
          errorCode: 'AI_CHAT_001',
        });
      },
    );
  });
});

describe('ConversationPurgeService.preview', () => {
  it('returns the real figures without mutating anything', async () => {
    const { service, tx } = build();
    const preview = await run(() => service.preview(CONV));
    expect(preview).toEqual({
      messages: 42,
      attachments: 3,
      blocks: 5,
      memories: 0,
      has_running_task: false,
    });
    expect(totalMutations(tx)).toBe(0);
  });

  it('flags a running task and rejects non-Vex conversations', async () => {
    const running = build({ runningTasks: 2 });
    expect(
      (await run(() => running.service.preview(CONV))).has_running_task,
    ).toBe(true);
    const vexi = build({
      conversation: { id: CONV, user_id: 3, metadata: { agent_key: 'vexi' } },
    });
    await run(async () => {
      await expect(vexi.service.preview(CONV)).rejects.toMatchObject({
        errorCode: 'AI_CHAT_001',
      });
    });
  });
});

describe('ConversationPurgeS3Cleaner', () => {
  function cleanerFixture(row: Record<string, unknown> | null) {
    // Typed with their argument: a zero-parameter mock types `mock.calls[0]`
    // as an empty tuple and the assertions below stop compiling.
    const update = jest.fn(async (_args: any) => ({}));
    const prisma = {
      ai_conversation_purges: {
        findFirst: jest.fn(async (_args?: any) => row),
        findMany: jest.fn(async (_args: any) => [{ id: 7 }]),
        update,
      },
    };
    const s3 = { deleteFile: jest.fn() };
    const cleaner = new ConversationPurgeS3Cleaner(
      prisma as never,
      s3 as never,
    );
    return { cleaner, prisma, s3, update };
  }

  it('S3 failure leaves the pending keys and increments attempts; retry clears them', async () => {
    const row = {
      id: 7,
      pending_s3_keys: ['a/1.pdf', 'a/2.pdf'],
      s3_attempts: 0,
    };
    const first = cleanerFixture(row);
    first.s3.deleteFile
      .mockRejectedValueOnce(new Error('timeout'))
      .mockResolvedValueOnce(undefined);
    expect(await first.cleaner.clean(7)).toBe(false);
    expect(first.update.mock.calls[0][0].data).toEqual({
      pending_s3_keys: ['a/1.pdf'],
      s3_attempts: { increment: 1 },
      s3_completed_at: null,
    });

    // The retry job re-attempts the remaining key and completes the row.
    const retry = cleanerFixture({
      ...row,
      pending_s3_keys: ['a/1.pdf'],
      s3_attempts: 1,
    });
    retry.s3.deleteFile.mockResolvedValue(undefined);
    expect(await retry.cleaner.retryPending()).toBe(1);
    const data = retry.update.mock.calls[0][0].data;
    expect(data.pending_s3_keys).toEqual([]);
    expect(data.s3_completed_at).toBeInstanceOf(Date);
    expect(
      retry.prisma.ai_conversation_purges.findMany.mock.calls[0][0].where,
    ).toEqual({
      s3_completed_at: null,
      s3_attempts: { lt: MAX_S3_PURGE_ATTEMPTS },
    });
  });

  it('a missing S3 object counts as success', async () => {
    const f = cleanerFixture({
      id: 7,
      pending_s3_keys: ['gone.pdf'],
      s3_attempts: 0,
    });
    f.s3.deleteFile.mockRejectedValue({
      name: 'NoSuchKey',
      $metadata: { httpStatusCode: 404 },
    });
    expect(await f.cleaner.clean(7)).toBe(true);
    expect(f.update.mock.calls[0][0].data.s3_completed_at).toBeInstanceOf(Date);
  });

  it('never throws on database errors', async () => {
    const f = cleanerFixture(null);
    f.prisma.ai_conversation_purges.findFirst.mockRejectedValue(
      new Error('db'),
    );
    await expect(f.cleaner.clean(7)).resolves.toBe(false);
  });
});

describe('ConversationPurgeService.claimAttachments', () => {
  function claimFixture(result: { count: number } | Error = { count: 2 }) {
    const f = build();
    const updateMany = jest.fn(async (_args: any) => {
      if (result instanceof Error) throw result;
      return result;
    });
    Object.assign(f.prisma.ai_attachments, { updateMany });
    return { ...f, updateMany };
  }

  it('binds the first-turn uploads of this user and store, only when unowned', async () => {
    const f = claimFixture();
    const claimed = await run(() =>
      f.service.claimAttachments(CONV, ['att_11', 'att_12', 'att_11', 'x', '12']),
    );
    expect(claimed).toBe(2);
    expect(f.updateMany).toHaveBeenCalledTimes(1);
    expect(f.updateMany.mock.calls[0][0]).toEqual({
      where: {
        id: { in: [11, 12] },
        store_id: ctx.store_id,
        user_id: ctx.user_id,
        conversation_id: null,
      },
      data: { conversation_id: CONV },
    });
  });

  it('does nothing without valid handles and never breaks the turn', async () => {
    const empty = claimFixture();
    expect(await run(() => empty.service.claimAttachments(CONV, []))).toBe(0);
    expect(await run(() => empty.service.claimAttachments(CONV, ['nope']))).toBe(0);
    expect(empty.updateMany).not.toHaveBeenCalled();

    const failing = claimFixture(new Error('db'));
    expect(await run(() => failing.service.claimAttachments(CONV, ['att_1']))).toBe(0);
  });
});
