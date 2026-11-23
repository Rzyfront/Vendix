import { VexiRealtimeController } from './vexi-realtime.controller';
import { VexiVoiceController } from './vexi-voice.controller';
import { VendixHttpException } from '../../../common/errors';

/**
 * T17 (N5) — realtime voice is withdrawn: a NEW session is refused with a typed
 * error, while `tool-call` and `session/close` stay alive so a session opened
 * before the deploy still closes and bills. The backend never reads the stored
 * `vexi.voice_engine` setting to decide anything (only the settings service and
 * the frontend facade do), so a store that saved `'realtime'` is served by the
 * same endpoints as any other store: there is no per-store branch to assert.
 */
describe('Vexi realtime retirement (T17, N5)', () => {
  const sessionId = '11111111-1111-4111-8111-111111111111';
  const respond = {
    success: (data: unknown, message: string) => ({
      success: true,
      data,
      message,
    }),
  };

  function realtimeFixture() {
    const realtime: Record<string, jest.Mock> = {
      createSession: jest.fn().mockResolvedValue({ session_id: sessionId }),
      executeSessionToolCall: jest.fn().mockResolvedValue({ output: '{}' }),
      closeSession: jest.fn().mockResolvedValue(undefined),
    };
    const controller = new VexiRealtimeController(
      realtime as any,
      respond as any,
    );
    return { realtime, controller };
  }

  it('refuses a new session with the typed unavailable error and never reaches the provider', () => {
    const { realtime, controller } = realtimeFixture();
    let thrown: unknown;
    try {
      controller.createSession();
    } catch (error) {
      thrown = error;
    }
    expect(thrown).toBeInstanceOf(VendixHttpException);
    expect((thrown as VendixHttpException).errorCode).toBe(
      'VEXI_REALTIME_UNAVAILABLE',
    );
    expect((thrown as VendixHttpException).getStatus()).toBe(410);
    expect(realtime.createSession).not.toHaveBeenCalled();
  });

  it('close still bills the session seconds through the service', async () => {
    const { realtime, controller } = realtimeFixture();
    const response = await controller.closeSession({
      session_id: sessionId,
      duration_seconds: 42,
    });
    expect(realtime.closeSession).toHaveBeenCalledTimes(1);
    expect(realtime.closeSession).toHaveBeenCalledWith(sessionId, 42);
    expect(response).toEqual({
      success: true,
      data: { duration_seconds: 42 },
      message: 'Session closed',
    });
  });

  it('tool-call of a session opened before the deploy still executes', async () => {
    const { realtime, controller } = realtimeFixture();
    const response: any = await controller.callTool({
      session_id: sessionId,
      name: 'read_product',
      arguments: { id: 1 },
      call_id: 'call-1',
    });
    expect(realtime.executeSessionToolCall).toHaveBeenCalledWith(
      sessionId,
      'read_product',
      { id: 1 },
      'call-1',
    );
    expect(response.data).toEqual({ call_id: 'call-1', output: '{}' });
  });

  it('pins the previous pipeline dictation behaviour: transcribe passes the turn and file through unchanged', async () => {
    const voice = {
      transcribe: jest.fn().mockResolvedValue({ text: 'sube la coca', ms: 5 }),
    };
    const controller = new VexiVoiceController(
      voice as any,
      {} as any,
      respond as any,
    );
    const file = { buffer: Buffer.from('a') } as Express.Multer.File;
    const response: any = await controller.transcribe(file, {
      turn_id: 'turn-1',
    } as any);
    expect(voice.transcribe).toHaveBeenCalledWith('turn-1', file);
    expect(response).toEqual({
      success: true,
      data: { text: 'sube la coca', ms: 5 },
      message: 'Audio transcrito',
    });
  });
});
