import { readFileSync } from 'fs';
import { join } from 'path';
import { PATH_METADATA, METHOD_METADATA } from '@nestjs/common/constants';
import { VexiPublicController } from './vexi-public.controller';

/**
 * Vexi público F2 — the public chat is text only (decision D1): no route of
 * this controller (or its module) can reach voice, transcription or TTS.
 */
describe('VexiPublicController (text only)', () => {
  const routes = Object.getOwnPropertyNames(VexiPublicController.prototype)
    .filter((name) => name !== 'constructor')
    .map((name) => ({
      name,
      path: Reflect.getMetadata(
        PATH_METADATA,
        (VexiPublicController.prototype as any)[name],
      ) as string | undefined,
      method: Reflect.getMetadata(
        METHOD_METADATA,
        (VexiPublicController.prototype as any)[name],
      ),
    }))
    .filter((r) => r.path !== undefined);

  it('exposes exactly config, sessions and messages under ecommerce/vexi', () => {
    expect(Reflect.getMetadata(PATH_METADATA, VexiPublicController)).toBe(
      'ecommerce/vexi',
    );
    expect(routes.map((r) => r.path).sort()).toEqual([
      'config',
      'sessions',
      'sessions/:sessionId/messages',
    ]);
  });

  it('no route mentions voice, audio, speech, tts or transcription', () => {
    for (const r of routes)
      expect(r.path).not.toMatch(/voice|audio|speech|tts|transcri|realtime/i);
  });

  it('the module sources import nothing from the voice/TTS stack', () => {
    for (const file of [
      'vexi-public.controller.ts',
      'vexi-public.service.ts',
      'vexi-public.module.ts',
    ]) {
      const imports = (
        readFileSync(join(__dirname, file), 'utf8').match(/from '[^']+'/g) ?? []
      ).join('\n');
      expect(imports).not.toMatch(
        /vexi-voice|voice-pipeline|VOICE_TTS_APP_KEY|tts|speech|realtime|transcri/i,
      );
    }
  });
});
