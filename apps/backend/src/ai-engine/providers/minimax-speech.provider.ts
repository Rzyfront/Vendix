import {
  AIMessage,
  AIProvider,
  AIProviderConfig,
  AIRequestOptions,
  AIResponse,
  AISpeechRequestOptions,
  AISpeechResponse,
} from '../interfaces/ai-provider.interface';

/**
 * MiniMax Text-to-Audio (T2A v2).
 *
 * Deliberately a separate provider rather than a branch inside
 * `OpenAICompatibleProvider`, because MiniMax differs on all three axes that
 * define a protocol:
 *
 * - **Path**: `/v1/t2a_v2`, which `toApiRootBaseUrl` does not know how to strip
 *   (it recognises nine OpenAI suffixes, none of them this one).
 * - **Body**: voice and audio parameters travel in nested `voice_setting` /
 *   `audio_setting` objects, not as flat `voice` / `response_format` / `speed`.
 * - **Response**: JSON with the audio **hex-encoded** inside `data.audio`, plus
 *   a `base_resp` envelope that reports failure with HTTP 200. Calling
 *   `response.arrayBuffer()` on that — which is what the OpenAI path does —
 *   yields the JSON bytes, so the caller gets "audio" that is really an error
 *   document.
 *
 * Values here are not guesses: they mirror a configuration already verified in
 * production against this same API.
 */
export class MinimaxSpeechProvider implements AIProvider {
  /**
   * MiniMax rejects anything outside this window with a validation error rather
   * than clamping, so a speed the operator typed by hand must be brought into
   * range here — losing the exact tempo is a better outcome than losing the
   * turn.
   */
  private static readonly SPEED_MIN = 0.5;
  private static readonly SPEED_MAX = 2;
  private static readonly DEFAULT_SPEED = 1;

  /**
   * Misma razón que la velocidad: MiniMax valida y rechaza, no acota.
   *
   * El mínimo es un valor por encima de cero y no cero: `vol: 0` es audio
   * silencioso, y devolver un turno mudo con éxito 200 es peor que ignorar el
   * valor — nadie configura el volumen en cero a propósito, y si lo hiciera por
   * error no tendría forma de saber por qué Vexi dejó de hablar.
   */
  private static readonly VOL_MIN = 0.1;
  private static readonly VOL_MAX = 10;
  private static readonly DEFAULT_VOL = 1;

  private static readonly DEFAULT_VOICE = 'Spanish_MaturePartner';
  private static readonly DEFAULT_FORMAT = 'mp3';
  private static readonly DEFAULT_SAMPLE_RATE = 32000;
  private static readonly DEFAULT_BITRATE = 128000;
  private static readonly DEFAULT_CHANNEL = 1;

  constructor(private config: AIProviderConfig) {}

  /**
   * T2A synthesises; it does not converse.
   *
   * Returns a failed response instead of throwing because `AIEngineService.chat`
   * does not wrap this call — it reads `response.success` and hands the result to
   * `sanitizeResponse`. Throwing here would escape as an unhandled rejection,
   * and the contract every other provider honours is "never throw from chat".
   *
   * The message names the incapacity on purpose: a provider that answered with
   * empty content would be diagnosed as a broken agent, sending the reader to
   * the prompt instead of to the configuration.
   */
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
          'MiniMax requires an API key. Add it to this configuration, or expose AI_MINIMAX_API_KEY in the environment.',
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
      message: response.error || 'MiniMax speech request failed',
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

    const format = String(
      options?.responseFormat ||
        this.config.settings?.response_format ||
        this.config.settings?.speech_response_format ||
        MinimaxSpeechProvider.DEFAULT_FORMAT,
    ).toLowerCase();

    try {
      const body = {
        model,
        text: input,
        language_boost: this.languageBoost(),
        // `hex` is what makes the response JSON rather than a binary stream. It
        // is also what lets `base_resp` travel alongside the audio, which is the
        // only channel MiniMax uses to report a failure it answered with 200.
        output_format: 'hex',
        voice_setting: {
          voice_id:
            options?.voice ||
            this.config.settings?.speech_voice ||
            this.config.settings?.voice ||
            MinimaxSpeechProvider.DEFAULT_VOICE,
          speed: this.clampSpeed(options?.speed ?? this.config.settings?.speed),
          // La opción de la petición manda sobre la config, igual que `speed`.
          // Antes `vol` salía SÓLO de `config.settings`, así que dos líneas
          // contiguas tenían dos modelos de permiso distintos: la velocidad la
          // editaba un operador desde la aplicación y el volumen sólo se podía
          // cambiar por SQL. `vol` es un multiplicador sobre el default del
          // proveedor (1 = sin cambio) y MiniMax admite hasta 10.
          vol: this.clampVol(options?.vol ?? this.config.settings?.vol),
          pitch: this.finite(this.config.settings?.pitch) ?? 0,
        },
        audio_setting: {
          format,
          sample_rate:
            this.positive(this.config.settings?.sample_rate) ??
            MinimaxSpeechProvider.DEFAULT_SAMPLE_RATE,
          bitrate:
            this.positive(this.config.settings?.bitrate) ??
            MinimaxSpeechProvider.DEFAULT_BITRATE,
          channel:
            this.positive(this.config.settings?.channel) ??
            MinimaxSpeechProvider.DEFAULT_CHANNEL,
        },
      };

      const response = await fetch(this.buildT2aUrl(), {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${this.config.apiKey}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(body),
      });

      if (!response.ok) {
        throw new Error(await this.readTransportError(response));
      }

      const json = (await response.json()) as {
        data?: { audio?: string };
        extra_info?: Record<string, any>;
        trace_id?: string;
        base_resp?: { status_code?: number; status_msg?: string };
      };

      // A non-zero `status_code` arrives with HTTP 200. Checking `response.ok`
      // alone would treat a quota rejection as a successful synthesis and hand
      // the caller an empty buffer with `success: true`.
      const statusCode = json.base_resp?.status_code;
      if (typeof statusCode === 'number' && statusCode !== 0) {
        throw new Error(
          `MiniMax error ${statusCode}: ${json.base_resp?.status_msg || 'unknown error'}`,
        );
      }

      const hex = json.data?.audio;
      if (!hex) {
        return {
          success: false,
          model,
          error: 'MiniMax returned no audio payload',
        };
      }

      const buffer = Buffer.from(hex, 'hex');

      return {
        success: buffer.length > 0,
        audioBase64: buffer.toString('base64'),
        contentType: `audio/${format}`,
        generationId: json.trace_id,
        model,
        error: buffer.length ? undefined : 'MiniMax returned an empty audio buffer',
      };
    } catch (error: any) {
      return {
        success: false,
        model,
        error: error.message || 'MiniMax speech request failed',
      };
    }
  }

  /**
   * The configured `base_url` is used as-is when it already addresses the T2A
   * endpoint — the operator pastes the full URL from MiniMax's own docs. Only a
   * bare host gets the path appended, so a copy-pasted endpoint is never
   * rewritten into something the API does not serve.
   *
   * `GroupId` is appended only when configured: some MiniMax accounts require it
   * as a query parameter and others reject it, so it cannot be defaulted.
   */
  private buildT2aUrl(): string {
    const configured = (this.config.baseUrl || 'https://api.minimax.io').replace(
      /\/+$/,
      '',
    );

    const url = configured.includes('/t2a_v2')
      ? configured
      : `${configured}/v1/t2a_v2`;

    const groupId =
      this.config.settings?.group_id || this.config.settings?.groupId;

    return groupId
      ? `${url}${url.includes('?') ? '&' : '?'}GroupId=${encodeURIComponent(String(groupId))}`
      : url;
  }

  /**
   * MiniMax takes a language *name*, not a BCP-47 tag. An unrecognised locale
   * falls back to `auto` rather than to Spanish: guessing the language of a
   * store we know nothing about produces a worse accent than letting the model
   * detect it.
   */
  private languageBoost(): string {
    const raw = String(
      this.config.settings?.language_boost ||
        this.config.settings?.language ||
        '',
    ).toLowerCase();

    if (!raw) return 'Spanish';
    if (raw.startsWith('es')) return 'Spanish';
    if (raw.startsWith('en')) return 'English';
    if (raw.startsWith('zh')) return 'Chinese';
    if (raw.startsWith('pt')) return 'Portuguese';
    if (raw.startsWith('fr')) return 'French';
    return 'auto';
  }

  private clampSpeed(value: unknown): number {
    const speed = this.finite(value);
    if (speed === undefined) return MinimaxSpeechProvider.DEFAULT_SPEED;
    return Math.min(
      MinimaxSpeechProvider.SPEED_MAX,
      Math.max(MinimaxSpeechProvider.SPEED_MIN, speed),
    );
  }

  private clampVol(value: unknown): number {
    const vol = this.finite(value);
    if (vol === undefined) return MinimaxSpeechProvider.DEFAULT_VOL;
    return Math.min(
      MinimaxSpeechProvider.VOL_MAX,
      Math.max(MinimaxSpeechProvider.VOL_MIN, vol),
    );
  }

  private finite(value: unknown): number | undefined {
    const parsed = typeof value === 'string' ? Number(value) : value;
    return typeof parsed === 'number' && Number.isFinite(parsed)
      ? parsed
      : undefined;
  }

  private positive(value: unknown): number | undefined {
    const parsed = this.finite(value);
    return parsed !== undefined && parsed > 0 ? parsed : undefined;
  }

  private async readTransportError(response: Response): Promise<string> {
    const fallback = `${response.status} ${response.statusText}`.trim();
    const text = await response.text().catch(() => '');

    if (!text) return fallback;

    try {
      const parsed = JSON.parse(text);
      return (
        parsed.base_resp?.status_msg ||
        parsed.error?.message ||
        parsed.message ||
        fallback
      );
    } catch {
      return text || fallback;
    }
  }

  private notAConversationalProvider(): AIResponse {
    return {
      success: false,
      error:
        'MiniMax T2A is a speech-synthesis provider and does not support chat or completion. Link this application to a text configuration instead.',
      model: this.config.modelId,
    };
  }
}
