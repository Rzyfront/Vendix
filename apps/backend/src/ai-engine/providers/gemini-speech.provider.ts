import {
  AIMessage,
  AIProvider,
  AIProviderConfig,
  AIRequestOptions,
  AIResponse,
  AISpeechRequestOptions,
  AISpeechResponse,
} from '../interfaces/ai-provider.interface';
import { sampleRateFromMime, wrapPcmAsWav } from './pcm-wav.util';

/**
 * Google Gemini text-to-speech (F8 T50), through the Generative Language API.
 *
 * A separate provider for the same reason MiniMax is one: the protocol shares
 * nothing with OpenAI's `/audio/speech`.
 *
 * - **Path**: `/v1beta/models/{model}:generateContent`, the model in the URL.
 * - **Auth**: `x-goog-api-key` header, not a bearer token.
 * - **Body**: the text is a `contents` part and the voice travels in
 *   `generationConfig.speechConfig`; `responseModalities` must be `["AUDIO"]`.
 * - **Response**: base64 **raw PCM** (16-bit little-endian, mono) inside
 *   `candidates[0].content.parts[].inlineData`, with the sample rate only in
 *   the mime type (`audio/L16;codec=pcm;rate=24000`). A browser cannot play
 *   headerless PCM, so the bytes are wrapped in a WAV container here — which is
 *   also what lets the voice quota read the real duration from the header.
 *
 * The API has no speed or volume parameter: both options are ignored, by
 * contract (`AISpeechRequestOptions.vol`: "a provider that has no notion of
 * volume ignores it"). The requested `responseFormat` is ignored too — the
 * answer is always WAV and says so in `contentType`.
 */
export class GeminiSpeechProvider implements AIProvider {
  private static readonly DEFAULT_BASE_URL =
    'https://generativelanguage.googleapis.com/v1beta';
  static readonly DEFAULT_VOICE = 'Kore';

  constructor(private config: AIProviderConfig) {}

  /** TTS synthesises; it does not converse. Never throws (provider contract). */
  async chat(
    _messages: AIMessage[],
    _options?: AIRequestOptions,
  ): Promise<AIResponse> {
    return this.notAConversationalProvider();
  }

  async complete(
    _prompt: string,
    _options?: AIRequestOptions,
  ): Promise<AIResponse> {
    return this.notAConversationalProvider();
  }

  async testConnection(): Promise<{ success: boolean; message: string }> {
    if (!this.config.apiKey) {
      return {
        success: false,
        message:
          'Gemini TTS requires an API key. Add it to this configuration, or expose it in the environment.',
      };
    }

    const response = await this.generateSpeech('OK');
    if (response.success) {
      return {
        success: true,
        message: `Connection successful. Speech model: ${response.model || this.config.modelId}`,
      };
    }
    return {
      success: false,
      message: response.error || 'Gemini speech request failed',
    };
  }

  async generateSpeech(
    input: string,
    options?: AISpeechRequestOptions,
  ): Promise<AISpeechResponse> {
    const model =
      options?.model ||
      this.config.settings?.speech_model ||
      this.config.modelId;
    const voice =
      options?.voice ||
      this.config.settings?.speech_voice ||
      this.config.settings?.voice ||
      GeminiSpeechProvider.DEFAULT_VOICE;

    try {
      const doFetch = this.config.fetch ?? globalThis.fetch;
      const response = await doFetch(this.buildUrl(model), {
        method: 'POST',
        headers: {
          'x-goog-api-key': this.config.apiKey,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          contents: [{ parts: [{ text: input }] }],
          generationConfig: {
            responseModalities: ['AUDIO'],
            speechConfig: {
              voiceConfig: { prebuiltVoiceConfig: { voiceName: voice } },
            },
          },
        }),
      });

      if (!response.ok) {
        throw new Error(await this.readTransportError(response));
      }

      const json = (await response.json()) as {
        candidates?: Array<{
          finishReason?: string;
          content?: {
            parts?: Array<{
              inlineData?: { mimeType?: string; data?: string };
            }>;
          };
        }>;
        promptFeedback?: { blockReason?: string };
        responseId?: string;
        modelVersion?: string;
      };

      const candidate = json.candidates?.[0];
      const inline = candidate?.content?.parts?.find(
        (part) => part.inlineData?.data,
      )?.inlineData;

      // A blocked or empty answer still arrives with HTTP 200.
      if (!inline?.data) {
        const reason =
          json.promptFeedback?.blockReason ||
          candidate?.finishReason ||
          'no audio returned';
        throw new Error(`Gemini returned no audio (${reason})`);
      }

      const pcm = Buffer.from(inline.data, 'base64');
      if (!pcm.length) {
        throw new Error('Gemini returned empty audio');
      }

      const mime = (inline.mimeType || '').toLowerCase();
      // Already a container (should the API ever return one): pass it through.
      if (mime.includes('wav') || mime.includes('mpeg') || mime.includes('mp3')) {
        return {
          success: true,
          audioBase64: inline.data,
          contentType: inline.mimeType,
          generationId: json.responseId,
          model: json.modelVersion || model,
        };
      }

      return {
        success: true,
        audioBase64: wrapPcmAsWav(pcm, sampleRateFromMime(mime)).toString(
          'base64',
        ),
        contentType: 'audio/wav',
        generationId: json.responseId,
        model: json.modelVersion || model,
      };
    } catch (error: any) {
      return {
        success: false,
        error: error?.message || 'Gemini speech request failed',
      };
    }
  }

  /** `…/models/{model}:generateContent`, tolerating a pasted full endpoint. */
  private buildUrl(model: string): string {
    const base = (
      this.config.baseUrl || GeminiSpeechProvider.DEFAULT_BASE_URL
    ).replace(/\/+$/, '');
    if (/:generateContent$/.test(base)) return base;
    const root = base.replace(/\/models(\/.*)?$/, '');
    return `${root}/models/${encodeURIComponent(model)}:generateContent`;
  }

  /** The API's own message when it sent one; never the request or the key. */
  private async readTransportError(response: Response): Promise<string> {
    let detail = '';
    try {
      const text = await response.text();
      try {
        const parsed = JSON.parse(text) as { error?: { message?: string } };
        detail = parsed.error?.message || text;
      } catch {
        detail = text;
      }
    } catch {
      detail = '';
    }
    const trimmed = detail.trim().slice(0, 300);
    return `Gemini speech request failed with HTTP ${response.status}${trimmed ? `: ${trimmed}` : ''}`;
  }

  private notAConversationalProvider(): AIResponse {
    return {
      success: false,
      error:
        'Gemini TTS is a speech-synthesis provider and does not support chat or completion. Link this application to a text configuration instead.',
      model: this.config.modelId,
    };
  }
}
