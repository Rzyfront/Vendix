import { GeminiSpeechProvider } from './gemini-speech.provider';

describe('GeminiSpeechProvider', () => {
  const pcm = Buffer.alloc(48000, 1); // 1 s of 16-bit mono at 24 kHz
  const okBody = (over: Record<string, unknown> = {}) => ({
    candidates: [
      {
        content: {
          parts: [
            {
              inlineData: {
                mimeType: 'audio/L16;codec=pcm;rate=24000',
                data: pcm.toString('base64'),
              },
            },
          ],
        },
      },
    ],
    responseId: 'resp-1',
    modelVersion: 'gemini-2.5-flash-preview-tts',
    ...over,
  });
  const reply = (status: number, body: unknown) => ({
    ok: status >= 200 && status < 300,
    status,
    json: async () => body,
    text: async () => (typeof body === 'string' ? body : JSON.stringify(body)),
  });

  let fetchMock: jest.Mock;
  const build = (over: Record<string, unknown> = {}) =>
    new GeminiSpeechProvider({
      provider: 'Google',
      sdkType: 'gemini_tts',
      apiKey: 'secret-key',
      modelId: 'gemini-2.5-flash-preview-tts',
      fetch: fetchMock,
      ...over,
    } as any);

  beforeEach(() => {
    fetchMock = jest.fn().mockResolvedValue(reply(200, okBody()));
  });

  it('asks for audio with the voice, the model in the URL and the key in a header', async () => {
    await build().generateSpeech('Hola, soy Vex.', { voice: 'Puck' });

    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe(
      'https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash-preview-tts:generateContent',
    );
    expect(url).not.toContain('secret-key');
    expect(init.method).toBe('POST');
    expect(init.headers['x-goog-api-key']).toBe('secret-key');
    expect(JSON.parse(init.body)).toEqual({
      contents: [{ parts: [{ text: 'Hola, soy Vex.' }] }],
      generationConfig: {
        responseModalities: ['AUDIO'],
        speechConfig: {
          voiceConfig: { prebuiltVoiceConfig: { voiceName: 'Puck' } },
        },
      },
    });
  });

  it('wraps the raw PCM in a playable WAV with the real duration', async () => {
    const out = await build().generateSpeech('Hola.');

    expect(out).toMatchObject({
      success: true,
      contentType: 'audio/wav',
      generationId: 'resp-1',
      model: 'gemini-2.5-flash-preview-tts',
    });
    const wav = Buffer.from(out.audioBase64 as string, 'base64');
    expect(wav.toString('ascii', 0, 4)).toBe('RIFF');
    expect(wav.toString('ascii', 8, 12)).toBe('WAVE');
    expect(wav.readUInt16LE(22)).toBe(1); // mono
    expect(wav.readUInt32LE(24)).toBe(24000); // sample rate
    expect(wav.readUInt32LE(28)).toBe(48000); // byte rate
    expect(wav.readUInt32LE(40)).toBe(pcm.length); // data size
    expect(wav.length).toBe(44 + pcm.length);
    expect(wav.subarray(44).equals(pcm)).toBe(true);
  });

  it('reads the sample rate from the mime type', async () => {
    fetchMock.mockResolvedValue(
      reply(
        200,
        okBody({
          candidates: [
            {
              content: {
                parts: [
                  {
                    inlineData: {
                      mimeType: 'audio/L16;rate=16000',
                      data: pcm.toString('base64'),
                    },
                  },
                ],
              },
            },
          ],
        }),
      ),
    );

    const out = await build().generateSpeech('Hola.');

    const wav = Buffer.from(out.audioBase64 as string, 'base64');
    expect(wav.readUInt32LE(24)).toBe(16000);
  });

  it('uses the request model and falls back to the default voice', async () => {
    await build().generateSpeech('Hola.', { model: 'gemini-2.5-pro-preview-tts' });

    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toContain('/models/gemini-2.5-pro-preview-tts:generateContent');
    expect(
      JSON.parse(init.body).generationConfig.speechConfig.voiceConfig
        .prebuiltVoiceConfig.voiceName,
    ).toBe('Kore');
  });

  it('honours a custom base URL', async () => {
    await build({ baseUrl: 'https://proxy.example/v1beta/' }).generateSpeech(
      'Hola.',
    );

    expect(fetchMock.mock.calls[0][0]).toBe(
      'https://proxy.example/v1beta/models/gemini-2.5-flash-preview-tts:generateContent',
    );
  });

  it('reports an HTTP error with the API message and never the key', async () => {
    fetchMock.mockResolvedValue(
      reply(400, { error: { message: 'Voice not found' } }),
    );

    const out = await build().generateSpeech('Hola.');

    expect(out.success).toBe(false);
    expect(out.error).toBe(
      'Gemini speech request failed with HTTP 400: Voice not found',
    );
    expect(out.error).not.toContain('secret-key');
    expect(out.audioBase64).toBeUndefined();
  });

  it('reports a 200 without audio as a failure, naming the reason', async () => {
    fetchMock.mockResolvedValue(
      reply(200, { candidates: [{ finishReason: 'SAFETY', content: {} }] }),
    );

    const out = await build().generateSpeech('Hola.');

    expect(out).toEqual({
      success: false,
      error: 'Gemini returned no audio (SAFETY)',
    });
  });

  it('never throws when the network fails', async () => {
    fetchMock.mockRejectedValue(new Error('ECONNRESET'));

    await expect(build().generateSpeech('Hola.')).resolves.toEqual({
      success: false,
      error: 'ECONNRESET',
    });
  });

  it('Test: succeeds through a real synthesis call', async () => {
    const out = await build().testConnection();

    expect(out.success).toBe(true);
    expect(out.message).toContain('gemini-2.5-flash-preview-tts');
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('Test: fails without calling the API when there is no key', async () => {
    const out = await build({ apiKey: '' }).testConnection();

    expect(out.success).toBe(false);
    expect(out.message).toContain('API key');
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('Test: surfaces the provider error', async () => {
    fetchMock.mockResolvedValue(
      reply(403, { error: { message: 'API key not valid' } }),
    );

    const out = await build().testConnection();

    expect(out).toEqual({
      success: false,
      message: 'Gemini speech request failed with HTTP 403: API key not valid',
    });
  });

  it('refuses chat and completion without throwing', async () => {
    const provider = build();

    await expect(provider.chat([])).resolves.toMatchObject({ success: false });
    await expect(provider.complete('x')).resolves.toMatchObject({
      success: false,
    });
    expect(fetchMock).not.toHaveBeenCalled();
  });
});
