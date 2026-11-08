import {
  WORKFLOW_LIVE_CHANNEL,
  WorkflowListenClient,
  WorkflowLiveListener,
  WorkflowLivePayload,
  parseWorkflowLivePayload,
} from './workflow-live.listener';

class FakeClient implements WorkflowListenClient {
  handlers: Record<string, Array<(arg?: any) => void>> = {};
  queries: string[] = [];
  ended = false;
  connectError: Error | null = null;
  connect = jest.fn(async () => {
    if (this.connectError) throw this.connectError;
  });
  query = jest.fn(async (sql: string) => {
    this.queries.push(sql);
  });
  on(event: string, cb: (arg?: any) => void) {
    (this.handlers[event] ??= []).push(cb);
    return this;
  }
  removeAllListeners() {
    this.handlers = {};
    return this;
  }
  end = jest.fn(async () => {
    this.ended = true;
  });
  emit(event: string, arg?: unknown) {
    (this.handlers[event] ?? []).forEach((h) => h(arg));
  }
  notify(payload: string, channel = WORKFLOW_LIVE_CHANNEL) {
    this.emit('notification', { channel, payload });
  }
}

describe('parseWorkflowLivePayload', () => {
  it('acepta ids y tipo conocidos', () => {
    expect(parseWorkflowLivePayload('{"store_id":1,"instance_id":5,"kind":"event"}')).toEqual({
      store_id: 1, instance_id: 5, kind: 'event',
    });
    expect(parseWorkflowLivePayload('{"store_id":1,"instance_id":5,"task_id":9,"kind":"task"}')).toEqual({
      store_id: 1, instance_id: 5, task_id: 9, kind: 'task',
    });
  });

  it.each([
    undefined,
    '',
    'no json',
    'null',
    '[]',
    '{"store_id":"1","instance_id":5,"kind":"event"}',
    '{"store_id":1,"instance_id":0,"kind":"event"}',
    '{"store_id":1,"instance_id":5,"kind":"other"}',
    '{"store_id":1,"instance_id":5,"task_id":"x","kind":"task"}',
  ])('descarta %p', (raw) => {
    expect(parseWorkflowLivePayload(raw as string | undefined)).toBeNull();
  });
});

describe('WorkflowLiveListener', () => {
  let clients: FakeClient[];
  let listener: WorkflowLiveListener;
  const seen: WorkflowLivePayload[] = [];

  beforeEach(() => {
    jest.useFakeTimers();
    clients = [];
    seen.length = 0;
    listener = new WorkflowLiveListener();
    listener.clientFactory = () => {
      const c = new FakeClient();
      clients.push(c);
      return c;
    };
    delete process.env.VENDIX_PROCESS_ROLE;
  });
  afterEach(async () => {
    await listener.onModuleDestroy();
    jest.useRealTimers();
    delete process.env.VENDIX_PROCESS_ROLE;
  });

  it('abre una sola conexión, hace LISTEN y reparte solo los eventos de la tienda pedida', async () => {
    await listener.onModuleInit();
    expect(clients).toHaveLength(1);
    expect(clients[0].queries).toEqual(['LISTEN workflow_live']);
    listener.stream(1).subscribe((e) => seen.push(e));
    clients[0].notify('{"store_id":1,"instance_id":5,"kind":"event"}');
    clients[0].notify('{"store_id":2,"instance_id":6,"kind":"event"}');
    clients[0].notify('basura');
    clients[0].notify('{"store_id":1,"instance_id":7,"kind":"event"}', 'otro_canal');
    expect(seen).toEqual([{ store_id: 1, instance_id: 5, kind: 'event' }]);
  });

  it('un proceso worker no escucha', async () => {
    process.env.VENDIX_PROCESS_ROLE = 'worker';
    await listener.onModuleInit();
    expect(clients).toHaveLength(0);
  });

  it('reconecta con espera creciente cuando la conexión se cae', async () => {
    await listener.onModuleInit();
    clients[0].emit('error', new Error('boom'));
    clients[0].emit('end');
    expect(clients[0].ended).toBe(true);
    expect(clients).toHaveLength(1);
    await jest.advanceTimersByTimeAsync(999);
    expect(clients).toHaveLength(1);
    await jest.advanceTimersByTimeAsync(1);
    expect(clients).toHaveLength(2);
    expect(clients[1].queries).toEqual(['LISTEN workflow_live']);
  });

  it('si el connect falla reintenta con 1 s, 2 s, 4 s', async () => {
    listener.clientFactory = () => {
      const c = new FakeClient();
      c.connectError = new Error('down');
      clients.push(c);
      return c;
    };
    await listener.onModuleInit();
    expect(clients).toHaveLength(1);
    await jest.advanceTimersByTimeAsync(1_000);
    expect(clients).toHaveLength(2);
    await jest.advanceTimersByTimeAsync(1_999);
    expect(clients).toHaveLength(2);
    await jest.advanceTimersByTimeAsync(1);
    expect(clients).toHaveLength(3);
    await jest.advanceTimersByTimeAsync(4_000);
    expect(clients).toHaveLength(4);
  });

  it('al destruir cierra la conexión y no reconecta', async () => {
    await listener.onModuleInit();
    await listener.onModuleDestroy();
    expect(clients[0].ended).toBe(true);
    await jest.advanceTimersByTimeAsync(60_000);
    expect(clients).toHaveLength(1);
  });
});
