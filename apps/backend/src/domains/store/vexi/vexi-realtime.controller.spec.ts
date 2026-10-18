import { RequestContextService } from '../../../common/context/request-context.service';
import {
  ConditionalRealtimeEnabledGuard,
  VexiRealtimeController,
} from './vexi-realtime.controller';

describe('VexiRealtimeController G transport', () => {
  let flag: string | undefined;
  let controller: VexiRealtimeController;
  let realtime: Record<string, jest.Mock>;
  const sessionId = '11111111-1111-4111-8111-111111111111';

  beforeEach(() => {
    flag = process.env.AI_VOICE_CONFIRM_ENABLED;
    realtime = {
      createSession: jest.fn().mockResolvedValue({ session_id: sessionId }),
      executeToolCall: jest.fn().mockResolvedValue('legacy output'),
      executeSessionToolCall: jest.fn().mockResolvedValue({
        output: '{"status":"pending_confirmation","applied":false}',
        proposal: { proposal_id: 'public-proposal' },
      }),
      consumeSessionQuota: jest.fn().mockResolvedValue(undefined),
      closeSession: jest.fn().mockResolvedValue(undefined),
    };
    controller = new VexiRealtimeController(
      realtime as any,
      {
        success: (data: unknown, message: string) => ({
          success: true,
          data,
          message,
        }),
      } as any,
    );
  });

  afterEach(() => {
    if (flag === undefined) delete process.env.AI_VOICE_CONFIRM_ENABLED;
    else process.env.AI_VOICE_CONFIRM_ENABLED = flag;
  });

  it('passes only the server session id and exact call into the G adapter', async () => {
    process.env.AI_VOICE_CONFIRM_ENABLED = 'true';
    const response = await controller.callTool({
      session_id: sessionId,
      name: 'change_product',
      arguments: { id: 7 },
      call_id: 'call-1',
    });
    expect(realtime.executeSessionToolCall).toHaveBeenCalledWith(
      sessionId,
      'change_product',
      { id: 7 },
      'call-1',
    );
    expect(realtime.executeToolCall).not.toHaveBeenCalled();
    expect(response.data).toMatchObject({
      call_id: 'call-1',
      proposal: { proposal_id: 'public-proposal' },
    });
    expect(response.data.output).not.toContain('browser-only-token');
  });

  it('does not turn missing session ids into legacy execution with G ON', async () => {
    process.env.AI_VOICE_CONFIRM_ENABLED = 'true';
    await controller.callTool({
      name: 'read_product',
      arguments: {},
      call_id: 'call-2',
    });
    expect(realtime.executeSessionToolCall).toHaveBeenCalledWith(
      undefined,
      'read_product',
      {},
      'call-2',
    );
    expect(realtime.executeToolCall).not.toHaveBeenCalled();
  });

  it('OFF preserves the legacy response shape and method', async () => {
    delete process.env.AI_VOICE_CONFIRM_ENABLED;
    const response = await controller.callTool({
      name: 'read_product',
      arguments: { id: 7 },
      call_id: 'call-1',
    });
    expect(realtime.executeToolCall).toHaveBeenCalledWith('read_product', {
      id: 7,
    });
    expect(response.data).toEqual({
      call_id: 'call-1',
      output: 'legacy output',
    });
    expect(realtime.executeSessionToolCall).not.toHaveBeenCalled();
  });

  it('ON closes only the authenticated server session', async () => {
    process.env.AI_VOICE_CONFIRM_ENABLED = 'true';
    await controller.closeSession({
      session_id: sessionId,
      duration_seconds: 10,
    });
    expect(realtime.closeSession).toHaveBeenCalledWith(sessionId, 10);
    expect(realtime.consumeSessionQuota).not.toHaveBeenCalled();
  });

  it('OFF preserves duration-based close with request quota dedupe', async () => {
    delete process.env.AI_VOICE_CONFIRM_ENABLED;
    await RequestContextService.runIsolated(
      { request_id: 'request-qa', is_owner: true, is_super_admin: false },
      () => controller.closeSession({ duration_seconds: 10 }),
    );
    expect(realtime.consumeSessionQuota).toHaveBeenCalledWith(10, 'request-qa');
    expect(realtime.closeSession).not.toHaveBeenCalled();
  });

  it('OFF delegates the existing Vexi enabled guard exactly', async () => {
    delete process.env.AI_VOICE_CONFIRM_ENABLED;
    const legacy = { canActivate: jest.fn().mockResolvedValue(false) };
    const guard = new ConditionalRealtimeEnabledGuard(legacy as any);
    const context = {} as any;
    await expect(guard.canActivate(context)).resolves.toBe(false);
    expect(legacy.canActivate).toHaveBeenCalledWith(context);
  });

  it('ON defers the conversation-specific Vex/Vexi toggle to mandatory service authority', () => {
    process.env.AI_VOICE_CONFIRM_ENABLED = 'true';
    const legacy = { canActivate: jest.fn() };
    const guard = new ConditionalRealtimeEnabledGuard(legacy as any);
    expect(guard.canActivate({} as any)).toBe(true);
    expect(legacy.canActivate).not.toHaveBeenCalled();
  });
});
