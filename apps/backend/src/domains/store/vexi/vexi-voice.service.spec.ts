import { RequestContextService } from '../../../common/context/request-context.service';
import { VexiVoiceService } from './vexi-voice.service';

const context = {
  user_id: 3,
  store_id: 1,
  organization_id: 2,
  is_owner: true,
  is_super_admin: false,
};
const file = {
  buffer: Buffer.from('synthetic-audio'),
  mimetype: 'audio/webm',
  originalname: 'fixture.webm',
} as Express.Multer.File;
describe('G dedicated server transcription', () => {
  it('requests reliable server observation without dictation chunks', () =>
    RequestContextService.runIsolated(context, async () => {
      const runTranscription = jest.fn().mockResolvedValue({
        success: true,
        text: 'confirmo cambiar registro codigo 123456',
        confidence: 0.99,
      });
      const service = new VexiVoiceService({ runTranscription } as any);
      service.appendChunk('normal-turn', file);
      await expect(service.transcribeConsent(file)).resolves.toMatchObject({
        source: 'server_stt',
        confidence: 0.99,
      });
      expect(runTranscription).toHaveBeenCalledWith(
        'vexi_voice_stt',
        expect.objectContaining({
          requireConfidence: true,
          inputAudio: { data: file.buffer.toString('base64'), format: 'webm' },
        }),
      );
    }));
  it('unknown provider confidence stays null, never defaults true', () =>
    RequestContextService.runIsolated(context, async () => {
      const service = new VexiVoiceService({
        runTranscription: async () => ({ success: true, text: 'si' }),
      } as any);
      await expect(service.transcribeConsent(file)).resolves.toEqual({
        source: 'server_stt',
        text: 'si',
        confidence: null,
      });
    }));
  it('missing ALS never dispatches STT', async () => {
    const runTranscription = jest.fn();
    const service = new VexiVoiceService({ runTranscription } as any);
    await expect(service.transcribeConsent(file)).rejects.toBeDefined();

    expect(runTranscription).not.toHaveBeenCalled();
  });
  it('invalid and oversized audio fail before provider', () =>
    RequestContextService.runIsolated(context, async () => {
      const runTranscription = jest.fn();
      const service = new VexiVoiceService({ runTranscription } as any);
      for (const audio of [
        undefined,
        { ...file, mimetype: 'text/plain' },
        { ...file, buffer: Buffer.alloc(1024 * 1024 + 1) },
      ])
        await expect(
          service.transcribeConsent(audio as any),
        ).rejects.toBeDefined();
      expect(runTranscription).not.toHaveBeenCalled();
    }));
});
