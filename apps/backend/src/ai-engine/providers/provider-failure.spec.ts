import { providerFailureMetadata } from './provider-failure';
import { OpenAICompatibleProvider } from './openai-compatible.provider';
import { AnthropicCompatibleProvider } from './anthropic-compatible.provider';

describe('D0 provider failure metadata without another retry layer', () => {
  it.each([
    { status: 429 },
    { status: 503 },
    { code: 'ETIMEDOUT' },
    { name: 'APIConnectionError' },
  ])('classifies structured transient %j', (error) => {
    expect(providerFailureMetadata(error)).toEqual({
      error_code: 'PROVIDER_TRANSIENT',
      retryable: true,
    });
  });
  it('does not infer a retry from arbitrary error prose or retry a provider auth failure', () => {
    expect(
      providerFailureMetadata({ status: 401, message: '503 timeout' }),
    ).toEqual({ error_code: 'PROVIDER_FAILURE', retryable: false });
  });

  it.each(['openai', 'anthropic'])(
    '%s chat preserves actual transport classification and makes only one SDK dispatch here',
    async (family) => {
      const provider =
        family === 'openai'
          ? new OpenAICompatibleProvider({
              provider: 'OpenAI',
              sdkType: 'openai_compatible',
              apiKey: 'qa-key',
              modelId: 'qa',
            })
          : new AnthropicCompatibleProvider({
              provider: 'Anthropic',
              sdkType: 'anthropic_compatible',
              apiKey: 'qa-key',
              modelId: 'qa',
            });
      const create = jest
        .fn()
        .mockRejectedValue(
          Object.assign(new Error('temporary'), { status: 429 }),
        );
      if (family === 'openai')
        (provider as any).client.chat.completions.create = create;
      else (provider as any).client.messages.create = create;
      const response = await provider.chat([
        { role: 'user', content: 'consulta QA' },
      ]);
      expect(response).toMatchObject({
        success: false,
        error_code: 'PROVIDER_TRANSIENT',
        retryable: true,
      });
      expect(create).toHaveBeenCalledTimes(1);
    },
  );
});
