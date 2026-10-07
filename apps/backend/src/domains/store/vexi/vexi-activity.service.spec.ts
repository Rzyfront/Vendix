import { RequestContextService } from '../../../common/context/request-context.service';
import { VexiActivityService } from './vexi-activity.service';
import { VexActivityFeedService } from '../vex/services/vex-activity-feed.service';

describe('VexiActivityService.recordApplied live push (vexR3-C)', () => {
  const createdAt = new Date('2026-10-01T10:00:00.000Z');
  let getStoreId: jest.SpyInstance;

  const build = (createImpl?: jest.Mock) => {
    const create =
      createImpl ?? jest.fn().mockResolvedValue({ id: 777, created_at: createdAt });
    const prisma = { ai_messages: { create } };
    const sse = { push: jest.fn() };
    const service = new VexiActivityService(prisma as any, sse as any);
    return { service, prisma, sse, create };
  };

  const input = {
    conversationId: 9,
    tool: 'write_endpoint',
    args: { path: '/store/products', method: 'POST' },
    output: JSON.stringify({ applied: true }),
    agent_key: 'vex',
  };

  beforeEach(() => {
    getStoreId = jest
      .spyOn(RequestContextService, 'getStoreId')
      .mockReturnValue(7);
  });
  afterEach(() => getStoreId.mockRestore());

  it('pushes exactly one vex_agent_action event whose id equals the feed id', async () => {
    const { service, sse } = build();
    await service.recordApplied(input);

    expect(sse.push).toHaveBeenCalledTimes(1);
    const [storeId, event] = sse.push.mock.calls[0];
    expect(storeId).toBe(7);
    expect(event.type).toBe('vex_agent_action');
    expect(event.id).toBe('agent-777-0');

    // Same row read back through the feed yields the identical event.
    const feedPrisma = {
      $queryRawUnsafe: jest.fn(async () => []),
      ai_messages: {
        findMany: jest.fn(async () => [
          {
            id: 777,
            conversation_id: 9,
            created_at: createdAt,
            role: 'tool',
            tool_calls: [
              {
                name: input.tool,
                arguments: input.args,
                result: input.output,
                agent_key: 'vex',
              },
            ],
            conversation: { metadata: { agent_key: 'vex' } },
          },
        ]),
      },
    };
    const feed = new VexActivityFeedService(feedPrisma as any);
    const [entry] = await feed.list();
    expect(entry.id).toBe(event.id);
    expect(feed.toLiveEvent(entry)).toEqual(event);
  });

  it('does not push when the row could not be persisted, and never throws', async () => {
    const { service, sse } = build(jest.fn().mockRejectedValue(new Error('db')));
    await expect(service.recordApplied(input)).resolves.toBeUndefined();
    expect(sse.push).not.toHaveBeenCalled();
  });

  it('a failing SSE push never breaks the record', async () => {
    const { service, sse } = build();
    sse.push.mockImplementation(() => {
      throw new Error('sse down');
    });
    await expect(service.recordApplied(input)).resolves.toBeUndefined();
  });

  it('does not push without a store in context', async () => {
    getStoreId.mockReturnValue(undefined);
    const { service, sse } = build();
    await service.recordApplied(input);
    expect(sse.push).not.toHaveBeenCalled();
  });
});
