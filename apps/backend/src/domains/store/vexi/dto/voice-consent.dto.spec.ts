import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import {
  ConsumeVoiceConsentDto,
  CreateVoiceConsentSessionDto,
  VoiceConsentChallengeDto,
} from './voice-consent.dto';

describe('voice consent DTOs do not accept browser authority', () => {
  const id = '11111111-1111-4111-8111-111111111111';
  const capture = {
    dedicated: true,
    foreground: true,
    focused: true,
    assistantSilent: true,
    noBargeIn: true,
    notEcho: true,
    reconnected: false,
  };
  const options = { whitelist: true, forbidNonWhitelisted: true };
  const consume = (body: Record<string, unknown>) =>
    plainToInstance(
      ConsumeVoiceConsentDto,
      {
        session_id: id,
        proposal_id: id,
        challenge_id: id,
        capture,
        ...body,
      },
      { enableImplicitConversion: true },
    );

  it('accepts only explicit browser conversation/agent/channel session hints', async () => {
    const dto = plainToInstance(CreateVoiceConsentSessionDto, {
      conversation_id: '8',
      agent_key: 'vexi',
      channel: 'pipeline',
    });
    expect(await validate(dto, options)).toEqual([]);
    expect(dto.conversation_id).toBe(8);
  });

  it.each([
    'objective_id',
    'step_id',
    'tools',
    'user_id',
    'store_id',
    'organization_id',
  ])('rejects browser supplied session authority %s', async (key) => {
    const dto = plainToInstance(CreateVoiceConsentSessionDto, {
      conversation_id: 8,
      agent_key: 'vexi',
      [key]: id,
    });
    expect((await validate(dto, options)).length).toBeGreaterThan(0);
  });

  it('accepts a realtime proposal handle without exposing its token', async () => {
    const dto = plainToInstance(VoiceConsentChallengeDto, {
      session_id: id,
      proposal_id: id,
    });
    expect(await validate(dto, options)).toEqual([]);
  });

  it('accepts click-proposal arguments/token or server-resolved single plan hash', async () => {
    for (const source of [{ confirmation_token: id }, { plan_id: id }]) {
      const dto = plainToInstance(VoiceConsentChallengeDto, {
        session_id: id,
        tool: 'set_product',
        arguments: { price: 5 },
        ...source,
      });
      expect(await validate(dto, options)).toEqual([]);
    }
  });

  it('rejects challenge without a server proposal or exact source token', async () => {
    const dto = plainToInstance(VoiceConsentChallengeDto, {
      session_id: id,
      tool: 'set_product',
      arguments: {},
    });
    expect((await validate(dto, options)).length).toBeGreaterThan(0);
  });

  it.each([
    'transcript',
    'confidence',
    'observation',
    'source',
    'audio_base64',
  ])('rejects client speech authority/persistence field %s', async (key) => {
    expect(
      (await validate(consume({ [key]: 'untrusted' }), options)).length,
    ).toBeGreaterThan(0);
  });

  it('accepts multipart JSON capture and strictly parses optional speak', async () => {
    const dto = consume({ capture: JSON.stringify(capture), speak: 'false' });
    expect(await validate(dto, options)).toEqual([]);
    expect(dto.capture.reconnected).toBe(false);
    expect(dto.speak).toBe(false);
    expect(await validate(consume({ speak: 'junk' }), options)).not.toEqual([]);
  });

  it.each(['false', 'true', 1, 0, null])(
    'does not coerce capture boolean from %s',
    async (value) => {
      expect(
        (
          await validate(
            consume({
              capture: JSON.stringify({ ...capture, dedicated: value }),
            }),
            options,
          )
        ).length,
      ).toBeGreaterThan(0);
    },
  );

  it('rejects absent or broken multipart capture and nested unknown fields', async () => {
    for (const value of [
      undefined,
      '{broken',
      'null',
      '[]',
      JSON.stringify({ ...capture, confidence: 1 }),
    ]) {
      expect(
        (await validate(consume({ capture: value }), options)).length,
      ).toBeGreaterThan(0);
    }
  });
});
