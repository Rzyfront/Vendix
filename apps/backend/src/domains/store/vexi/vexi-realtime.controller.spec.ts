import { VexiRealtimeController } from './vexi-realtime.controller';

describe('VexiRealtimeController G transport', () => {
  let flag: string | undefined;
  let controller: VexiRealtimeController;
  let realtime: Record<string, jest.Mock>;
  const sessionId = '11111111-1111-4111-8111-111111111111';

  beforeEach(() => {
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

  it('passes only the server session id and exact call into the G adapter', async () => {
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

  it('ON closes only the authenticated server session', async () => {
    await controller.closeSession({
      session_id: sessionId,
      duration_seconds: 10,
    });
    expect(realtime.closeSession).toHaveBeenCalledWith(sessionId, 10);
    expect(realtime.consumeSessionQuota).not.toHaveBeenCalled();
  });
});
