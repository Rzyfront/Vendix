import { RequestContextService } from '@common/context/request-context.service';
import {
  AgentDeadline,
  agentDeadlineContext,
} from '../../tasks/agent-deadline';
import { internalApiText, internalAuthHeaders } from './internal-http';
import { createApiBridgeTools } from './api-bridge.tools';

describe('D2 guarded bridge cancellation', () => {
  const fetcher = jest.fn();
  const originalFetch = global.fetch;
  let deadline: AgentDeadline;
  const context = {
    user_id: 8,
    store_id: 3,
    organization_id: 2,
    is_owner: false,
    is_super_admin: false,
    access_token: 'synthetic-test-only',
    permissions: ['read', 'write'],
  };
  beforeEach(() => {
    jest.useFakeTimers();
    global.fetch = fetcher;
    deadline = new AgentDeadline({
      wallDeadlineMs: Date.now() + 100,
      activeBudgetMs: 100,
      reserveMs: 0,
    });
  });
  afterEach(() => {
    deadline.dispose();
    global.fetch = originalFetch;
    fetcher.mockReset();
    jest.restoreAllMocks();
    jest.useRealTimers();
  });
  const run = <T>(work: () => T): T =>
    RequestContextService.runIsolated(context, () =>
      agentDeadlineContext.run(deadline, work),
    );

  it('preserves the legacy fetch request with no cancellation context', async () => {
    const response = { text: jest.fn().mockResolvedValue('legacy') };
    fetcher.mockResolvedValue(response);
    const init = { method: 'GET' };
    await expect(
      internalApiText('http://127.0.0.1/api/store/products', init),
    ).resolves.toEqual({ response, body: 'legacy' });
    expect(fetcher).toHaveBeenCalledWith(
      'http://127.0.0.1/api/store/products',
      init,
    );
    expect(init).not.toHaveProperty('signal');
  });

  it('carries the caller bearer and cooperative signal through the same guarded fetch', async () => {
    fetcher.mockResolvedValue({ text: jest.fn().mockResolvedValue('body') });
    await run(() =>
      internalApiText('http://127.0.0.1/api/store/products', {
        method: 'GET',
        headers: internalAuthHeaders(),
      }),
    );
    expect(fetcher.mock.calls[0][1]).toMatchObject({
      headers: { Authorization: 'Bearer synthetic-test-only' },
      signal: expect.any(AbortSignal),
    });
  });

  it('covers body consumption, not only response headers, and fences a late body', async () => {
    let body!: (value: string) => void;
    const text = jest.fn(
      () =>
        new Promise<string>((resolve) => {
          body = resolve;
        }),
    );
    fetcher.mockResolvedValue({ text });
    const result = run(() =>
      internalApiText('http://127.0.0.1/api/store/products', { method: 'GET' }),
    );
    const assertion = expect(result).rejects.toMatchObject({
      code: 'AGENT_DEADLINE_EXCEEDED',
    });
    await jest.advanceTimersByTimeAsync(100);
    await assertion;
    expect(fetcher.mock.calls[0][1].signal.aborted).toBe(true);
    body('late');
    await jest.advanceTimersByTimeAsync(0);
  });

  it('does not use the static last tenant when D2 request ALS is missing', () => {
    jest
      .spyOn(RequestContextService, 'getContext')
      .mockReturnValue({ ...context, access_token: 'wrong-principal' });
    agentDeadlineContext.run(deadline, () =>
      expect(internalAuthHeaders().Authorization).toBe('Bearer '),
    );
  });

  it('preserves write uncertainty by throwing cancellation instead of applied:false', async () => {
    fetcher.mockImplementation(() => new Promise(() => undefined));
    const entry = {
      path: 'store/things',
      method: 'POST',
      domain: 'things',
      requiredPermissions: ['write'],
    };
    const tools = createApiBridgeTools({
      catalog: { find: () => entry } as any,
      attachments: {} as any,
    });
    const result = run(() =>
      tools.find((tool) => tool.name === 'write_endpoint')!.handler!(
        { path: 'store/things', method: 'POST', body: {} },
        {},
      ),
    );
    const assertion = expect(result).rejects.toMatchObject({
      code: 'AGENT_DEADLINE_EXCEEDED',
    });
    await jest.advanceTimersByTimeAsync(100);
    await assertion;
    expect(fetcher).toHaveBeenCalledTimes(1);
  });

  it('does not turn an expired preview read into a confirmation proposal', async () => {
    fetcher.mockImplementation(() => new Promise(() => undefined));
    const tools = createApiBridgeTools({
      catalog: {
        find: () => ({
          path: 'store/things/4',
          method: 'GET',
          domain: 'things',
          requiredPermissions: ['write'],
        }),
      } as any,
      attachments: {} as any,
    });
    const write = tools.find((tool) => tool.name === 'write_endpoint')!;
    const result = run(() =>
      write.preview!(
        { path: 'store/things/4', method: 'PATCH', body: { name: 'new' } },
        {},
      ),
    );
    const assertion = expect(result).rejects.toMatchObject({
      code: 'AGENT_DEADLINE_EXCEEDED',
    });
    await jest.advanceTimersByTimeAsync(100);
    await assertion;
    expect(fetcher).toHaveBeenCalledTimes(1);
  });
});
