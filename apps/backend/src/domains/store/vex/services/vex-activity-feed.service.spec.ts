import { RequestContextService } from '../../../../common/context/request-context.service';
import {
  AGENT_LIVE_EVENT_TYPE,
  buildAgentLiveEvent,
  VexActivityFeedService,
} from './vex-activity-feed.service';

function makePrisma(notifications: any[], messages: any[]) {
  return {
    $queryRawUnsafe: jest.fn(async () => notifications),
    ai_messages: { findMany: jest.fn(async () => messages) },
  };
}

function notifRow(overrides: Record<string, any> = {}) {
  return {
    id: 11,
    type: 'order_status_change',
    title: 'Pedido nuevo',
    body: 'Orden 1046',
    is_read: false,
    created_at: new Date('2026-09-30T15:00:00.000Z'),
    ...overrides,
  };
}

function agentMessage(overrides: Record<string, any> = {}) {
  return {
    id: 501,
    conversation_id: 9,
    created_at: new Date('2026-09-30T16:00:00.000Z'),
    role: 'assistant',
    tool_calls: [
      {
        name: 'write_endpoint',
        arguments: { path: '/store/products', method: 'POST' },
        result: JSON.stringify({ applied: true }),
      },
    ],
    conversation: { metadata: { agent_key: 'vex' } },
    ...overrides,
  };
}

describe('VexActivityFeedService', () => {
  let getStoreId: jest.SpyInstance;

  beforeEach(() => {
    getStoreId = jest
      .spyOn(RequestContextService, 'getStoreId')
      .mockReturnValue(7);
  });

  afterEach(() => {
    getStoreId.mockRestore();
  });

  it('returns [] without a store in context', async () => {
    getStoreId.mockReturnValue(undefined);
    const service = new VexActivityFeedService(makePrisma([], []) as any);
    await expect(service.list()).resolves.toEqual([]);
  });

  it('mints stable notif-<id> ids for notification rows', async () => {
    const service = new VexActivityFeedService(
      makePrisma([notifRow({ id: 11 }), notifRow({ id: 12, is_read: true })], []) as any,
    );
    const entries = await service.list();
    expect(entries.map((e) => e.id)).toEqual(['notif-11', 'notif-12']);
    expect(entries[0]).toMatchObject({
      category: 'sale',
      title: 'Pedido nuevo',
      is_new: true,
    });
    expect(entries[1].is_new).toBe(false);
  });

  it('mints stable agent-<message_id>-<call_index> ids for applied actions', async () => {
    const service = new VexActivityFeedService(
      makePrisma(
        [],
        [
          agentMessage({
            id: 501,
            tool_calls: [
              {
                name: 'write_endpoint',
                arguments: { path: '/store/products', method: 'POST' },
                result: JSON.stringify({ applied: false }),
              },
              {
                name: 'write_endpoint',
                arguments: { path: '/store/products', method: 'PATCH' },
                result: JSON.stringify({ applied: true }),
              },
            ],
          }),
        ],
      ) as any,
    );
    const entries = await service.list();
    // The skipped proposal does not renumber: the applied call keeps its
    // persisted array position (1), so reloads mint the same id.
    expect(entries.map((e) => e.id)).toEqual(['agent-501-1']);
    expect(entries[0]).toMatchObject({
      category: 'agent',
      is_new: false,
      ref: { conversation_id: 9, tool: 'write_endpoint', agent: 'vex' },
    });
  });

  it('dedupes by stable id: the same rows read twice produce identical ids', async () => {
    const notifications = [notifRow({ id: 11 })];
    const messages = [agentMessage({ id: 501 })];
    const service = new VexActivityFeedService(
      makePrisma(notifications, messages) as any,
    );
    const first = await service.list();
    const second = await service.list();
    expect(first.map((e) => e.id)).toEqual(second.map((e) => e.id));
    expect(first.map((e) => e.id).sort()).toEqual([
      'agent-501-0',
      'notif-11',
    ]);
    // No two entries share an id within one read either.
    const ids = first.map((e) => e.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it('counts recordApplied tool rows as applied by construction', async () => {
    const service = new VexActivityFeedService(
      makePrisma(
        [],
        [
          agentMessage({
            id: 502,
            role: 'tool',
            tool_calls: [
              {
                name: 'send_invoice_dian',
                arguments: { invoice_id: 3 },
                result: JSON.stringify({ cufe: 'abc' }),
              },
            ],
          }),
        ],
      ) as any,
    );
    const entries = await service.list();
    expect(entries.map((e) => e.id)).toEqual(['agent-502-0']);
  });

  it('skips ui_* audit entries and non-vex agent keys', async () => {
    const service = new VexActivityFeedService(
      makePrisma(
        [],
        [
          agentMessage({
            id: 503,
            tool_calls: [
              {
                name: 'ui_navigate',
                arguments: {},
                result: JSON.stringify({ applied: true }),
              },
            ],
          }),
          agentMessage({
            id: 504,
            conversation: { metadata: { agent_key: 'other' } },
          }),
        ],
      ) as any,
    );
    await expect(service.list()).resolves.toEqual([]);
  });

  it('merges both sources newest-first and caps at the limit', async () => {
    const service = new VexActivityFeedService(
      makePrisma(
        [notifRow({ id: 11, created_at: new Date('2026-09-30T15:00:00.000Z') })],
        [agentMessage({ id: 501, created_at: new Date('2026-09-30T16:00:00.000Z') })],
      ) as any,
    );
    const entries = await service.list(1);
    expect(entries.map((e) => e.id)).toEqual(['agent-501-0']);
  });

  it('buildAgentLiveEvent mints the vex_agent_action live frame', async () => {
    const event = buildAgentLiveEvent({
      id: 'agent-501-0',
      title: 'Vex: registró products',
      description: 'path="/store/products"',
      created_at: new Date('2026-09-30T16:00:00.000Z'),
      agent: 'vex',
      tool: 'write_endpoint',
      conversation_id: 9,
    });
    expect(event).toEqual({
      id: 'agent-501-0',
      type: AGENT_LIVE_EVENT_TYPE,
      title: 'Vex: registró products',
      body: 'path="/store/products"',
      created_at: '2026-09-30T16:00:00.000Z',
      data: { agent: 'vex', tool: 'write_endpoint', conversation_id: 9 },
    });
    expect(AGENT_LIVE_EVENT_TYPE).toBe('vex_agent_action');
  });

  it('toLiveEvent converts a feed entry without changing its stable id', async () => {
    const service = new VexActivityFeedService(
      makePrisma([], [agentMessage({ id: 501 })]) as any,
    );
    const [entry] = await service.list();
    const live = service.toLiveEvent(entry);
    expect(live.id).toBe(entry.id);
    expect(live.type).toBe(AGENT_LIVE_EVENT_TYPE);
    expect(live.data).toMatchObject({ agent: 'vex', conversation_id: 9 });
  });
});
