import { EventEmitter } from 'events';
import { Logger } from '@nestjs/common';
import { firstValueFrom, take, toArray } from 'rxjs';
import {
  CRM_INBOX_EVENTS_CHANNEL,
  CrmInboxEventsService,
} from './crm-inbox-events.service';

function setup() {
  const subscriber = Object.assign(new EventEmitter(), {
    subscribe: jest.fn().mockResolvedValue(1),
    quit: jest.fn().mockResolvedValue('OK'),
    disconnect: jest.fn(),
  });
  const redis = {
    publish: jest.fn().mockResolvedValue(1),
    duplicate: jest.fn(() => subscriber),
  };
  const service = new CrmInboxEventsService(redis as never);
  return { service, redis, subscriber };
}

const event = (store_id: number, conversation_id: number) =>
  JSON.stringify({
    type: 'crm.message',
    store_id,
    conversation_id,
    assigned_user_id: null,
    at: '2026-10-31T00:00:00.000Z',
  });

describe('CrmInboxEventsService', () => {
  afterEach(() => jest.restoreAllMocks());

  it('publishes ids and states to the shared Redis channel with a timestamp', async () => {
    const { service, redis } = setup();
    await service.publish({
      type: 'crm.message',
      store_id: 10,
      conversation_id: 3,
      assigned_user_id: 5,
      message_id: 77,
      status: 'sent',
    });
    const [channel, raw] = redis.publish.mock.calls[0];
    expect(channel).toBe(CRM_INBOX_EVENTS_CHANNEL);
    expect(JSON.parse(raw)).toMatchObject({
      store_id: 10,
      conversation_id: 3,
      message_id: 77,
      status: 'sent',
      at: expect.any(String),
    });
  });

  it('never throws when Redis is down: the write that produced it stands', async () => {
    const { service, redis } = setup();
    jest.spyOn(Logger.prototype, 'warn').mockImplementation(() => undefined);
    redis.publish.mockRejectedValue(new Error('ECONNREFUSED'));
    await expect(
      service.publish({
        type: 'crm.conversation',
        store_id: 10,
        conversation_id: 3,
        assigned_user_id: null,
      }),
    ).resolves.toBeUndefined();
  });

  it('does not open the subscriber until an SSE client asks (worker process)', () => {
    const { redis } = setup();
    expect(redis.duplicate).not.toHaveBeenCalled();
  });

  it('streams only the requested store, sharing one subscriber, and drops garbage', async () => {
    const { service, redis, subscriber } = setup();
    const storeA = firstValueFrom(service.stream(10).pipe(take(1), toArray()));
    service.stream(10);

    subscriber.emit('message', CRM_INBOX_EVENTS_CHANNEL, 'not json');
    subscriber.emit('message', 'other:channel', event(10, 1));
    subscriber.emit('message', CRM_INBOX_EVENTS_CHANNEL, event(20, 2));
    subscriber.emit('message', CRM_INBOX_EVENTS_CHANNEL, event(10, 3));

    await expect(storeA).resolves.toEqual([
      expect.objectContaining({ store_id: 10, conversation_id: 3 }),
    ]);
    expect(redis.duplicate).toHaveBeenCalledTimes(1);
    expect(subscriber.subscribe).toHaveBeenCalledWith(CRM_INBOX_EVENTS_CHANNEL);
  });
});
