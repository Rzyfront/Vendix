import { firstValueFrom, take, toArray } from 'rxjs';
import { RequestContextService } from '@common/context/request-context.service';
import { WorkflowLiveController } from './workflow-live.controller';
import { WorkflowListenClient, WorkflowLiveListener } from './workflow-live.listener';

describe('WorkflowLiveController', () => {
  let listener: WorkflowLiveListener;
  let controller: WorkflowLiveController;
  let notify: (payload: string) => void;

  beforeEach(async () => {
    jest.useFakeTimers();
    let onNotification: (msg: { channel: string; payload?: string }) => void = () => undefined;
    const client: WorkflowListenClient = {
      connect: async () => undefined,
      query: async () => undefined,
      on: (event: string, cb: (arg?: never) => void) => {
        if (event === 'notification') onNotification = cb as typeof onNotification;
        return client;
      },
      removeAllListeners: () => client,
      end: async () => undefined,
    };
    listener = new WorkflowLiveListener();
    listener.clientFactory = () => client;
    await listener.connect();
    notify = (payload) => onNotification({ channel: 'workflow_live', payload });
    controller = new WorkflowLiveController(listener);
  });
  afterEach(async () => {
    await listener.onModuleDestroy();
    jest.useRealTimers();
    jest.restoreAllMocks();
  });

  it('emite solo ids de la tienda del contexto', async () => {
    jest.spyOn(RequestContextService, 'getStoreId').mockReturnValue(1);
    const out = firstValueFrom(controller.stream().pipe(take(2), toArray()));
    notify('{"store_id":2,"instance_id":9,"kind":"event"}');
    notify('{"store_id":1,"instance_id":5,"kind":"event"}');
    notify('{"store_id":1,"instance_id":5,"task_id":8,"kind":"task"}');
    expect(await out).toEqual([
      { type: 'workflow', data: { instance_id: 5, kind: 'event' } },
      { type: 'workflow', data: { instance_id: 5, task_id: 8, kind: 'task' } },
    ]);
  });

  it('manda un latido cada 30 s', async () => {
    jest.spyOn(RequestContextService, 'getStoreId').mockReturnValue(1);
    const out = firstValueFrom(controller.stream().pipe(take(1)));
    await jest.advanceTimersByTimeAsync(30_000);
    expect((await out).type).toBe('heartbeat');
  });

  it('sin tienda en el contexto responde 404', () => {
    jest.spyOn(RequestContextService, 'getStoreId').mockReturnValue(undefined);
    expect(() => controller.stream()).toThrow();
  });
});
