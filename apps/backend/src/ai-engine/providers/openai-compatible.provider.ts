import OpenAI from 'openai';
import {
  AIProvider,
  AIProviderConfig,
  AIMessage,
  AIMessageContentPart,
  AIRequestOptions,
  AIResponse,
  AIStreamChunk,
  AIToolCall,
  AIImageRequestOptions,
  AIImageResponse,
  AIImageStreamChunk,
  AIEmbeddingRequestOptions,
  AIEmbeddingResponse,
  AIVideoRequestOptions,
  AIVideoResponse,
  AISpeechRequestOptions,
  AISpeechResponse,
  AITranscriptionRequestOptions,
  AITranscriptionResponse,
  AIRerankRequestOptions,
  AIRerankResponse,
  AIModelType,
} from '../interfaces/ai-provider.interface';

export class OpenAICompatibleProvider implements AIProvider {
  private client: OpenAI;

  constructor(private config: AIProviderConfig) {
    const baseUrl = this.cleanBaseUrl(config.baseUrl);
    const clientBaseUrl = this.toOpenAIClientBaseUrl(baseUrl);
    this.config = {
      ...config,
      baseUrl,
    };
    this.client = new OpenAI({
      apiKey: config.apiKey,
      ...(clientBaseUrl && { baseURL: clientBaseUrl }),
    });
  }

  async chat(
    messages: AIMessage[],
    options?: AIRequestOptions,
  ): Promise<AIResponse> {
    try {
      const response = await this.client.chat.completions.create({
        model: options?.model || this.config.modelId,
        messages: this.buildMessages(messages, options?.systemPrompt) as any,
        temperature:
          options?.temperature ??
          this.config.settings?.temperature ??
          undefined,
        max_tokens:
          options?.maxTokens ?? this.config.settings?.maxTokens ?? undefined,
        ...(options?.tools?.length && {
          tools: options.tools.map((t) => ({
            type: t.type as any,
            function: t.function,
          })),
        }),
        ...(options?.tool_choice && {
          tool_choice: options.tool_choice as any,
        }),
      });

      const message = response.choices[0]?.message;
      const finishReason = response.choices[0]?.finish_reason;

      const toolCalls: AIToolCall[] | undefined = message?.tool_calls?.map(
        (tc: any) => ({
          id: tc.id,
          type: 'function' as const,
          function: {
            name: tc.function.name,
            arguments: tc.function.arguments,
          },
        }),
      );

      return {
        success: true,
        content: message?.content || '',
        usage: response.usage
          ? {
              promptTokens: response.usage.prompt_tokens || 0,
              completionTokens: response.usage.completion_tokens || 0,
              totalTokens: response.usage.total_tokens || 0,
            }
          : undefined,
        model: response.model,
        tool_calls: toolCalls?.length ? toolCalls : undefined,
        finish_reason:
          finishReason === 'tool_calls'
            ? 'tool_calls'
            : finishReason === 'length'
              ? 'length'
              : 'stop',
      };
    } catch (error: any) {
      return {
        success: false,
        error: error.message || 'OpenAI-compatible request failed',
      };
    }
  }

  async complete(
    prompt: string,
    options?: AIRequestOptions,
  ): Promise<AIResponse> {
    return this.chat([{ role: 'user', content: prompt }], options);
  }

  async generateImage(
    prompt: string,
    options?: AIImageRequestOptions,
  ): Promise<AIImageResponse> {
    try {
      if (this.usesChatModalitiesImageGeneration()) {
        return await this.generateImageWithChatModalities(prompt, options);
      }

      if (options?.referenceImages?.length) {
        return await this.generateImageWithResponses(prompt, options);
      }

      const model =
        options?.model || this.config.settings?.image_model || 'gpt-image-1';
      const response = await this.client.images.generate({
        prompt,
        model,
        n: 1,
        size: options?.size || '1024x1024',
        quality: options?.quality || 'auto',
        output_format: options?.outputFormat || 'png',
        background: options?.background || 'auto',
        ...(options?.outputCompression !== undefined && {
          output_compression: options.outputCompression,
        }),
        ...(model.startsWith('dall-e') && {
          response_format: 'b64_json' as const,
        }),
      } as any);

      const image = response.data?.[0] as any;

      return {
        success: !!image?.b64_json,
        imageBase64: image?.b64_json,
        revisedPrompt: image?.revised_prompt,
        model,
        usage: this.mapImageUsage((response as any).usage),
        error: image?.b64_json ? undefined : 'Image model did not return data',
      };
    } catch (error: any) {
      return {
        success: false,
        error: error.message || 'OpenAI-compatible image generation failed',
      };
    }
  }

  async generateEmbedding(
    input: string | string[],
    options?: AIEmbeddingRequestOptions,
  ): Promise<AIEmbeddingResponse> {
    try {
      const model =
        options?.model ||
        this.config.settings?.embedding_model ||
        this.config.modelId;
      const response = await this.client.embeddings.create({
        model,
        input,
        encoding_format:
          options?.encodingFormat ||
          this.config.settings?.encoding_format ||
          'float',
        ...(options?.dimensions && { dimensions: options.dimensions }),
      } as any);

      const embeddings = response.data.map(
        (item: any) => item.embedding as number[],
      );

      return {
        success: embeddings.length > 0,
        embedding: embeddings[0],
        embeddings,
        model: (response as any).model || model,
        usage: this.mapTokenUsage((response as any).usage),
        error: embeddings.length
          ? undefined
          : 'Embedding model returned no data',
      };
    } catch (error: any) {
      return {
        success: false,
        error: error.message || 'OpenAI-compatible embedding request failed',
      };
    }
  }

  async generateVideo(
    prompt: string,
    options?: AIVideoRequestOptions,
  ): Promise<AIVideoResponse> {
    const model =
      options?.model ||
      this.config.settings?.video_model ||
      this.config.modelId;

    try {
      const submitted = await this.postJson<any>('/videos', {
        model,
        prompt,
        ...(options?.aspectRatio || this.config.settings?.aspect_ratio
          ? {
              aspect_ratio:
                options?.aspectRatio || this.config.settings?.aspect_ratio,
            }
          : {}),
        ...(options?.duration || this.config.settings?.duration
          ? { duration: options?.duration || this.config.settings?.duration }
          : {}),
        ...(options?.resolution || this.config.settings?.resolution
          ? {
              resolution:
                options?.resolution || this.config.settings?.resolution,
            }
          : {}),
        ...(options?.callbackUrl || this.config.settings?.callback_url
          ? {
              callback_url:
                options?.callbackUrl || this.config.settings?.callback_url,
            }
          : {}),
        ...(options?.provider || this.config.settings?.provider_preferences
          ? {
              provider:
                options?.provider || this.config.settings?.provider_preferences,
            }
          : {}),
      });

      const response = this.mapVideoResponse(submitted, model);

      if (!options?.pollUntilComplete || !response.pollingUrl) {
        return response;
      }

      return this.pollVideoUntilComplete(response.pollingUrl, model, options);
    } catch (error: any) {
      return {
        success: false,
        model,
        error: error.message || 'OpenAI-compatible video request failed',
      };
    }
  }

  async generateSpeech(
    input: string,
    options?: AISpeechRequestOptions,
  ): Promise<AISpeechResponse> {
    const model =
      options?.model ||
      this.config.settings?.speech_model ||
      this.config.modelId;

    try {
      const body: Record<string, any> = {
        model,
        input,
        voice:
          options?.voice ||
          this.config.settings?.speech_voice ||
          this.config.settings?.voice ||
          this.getDefaultSpeechVoice(model),
        ...(options?.responseFormat ||
        this.config.settings?.response_format ||
        this.config.settings?.speech_response_format
          ? {
              response_format:
                options?.responseFormat ||
                this.config.settings?.response_format ||
                this.config.settings?.speech_response_format,
            }
          : {}),
        ...(options?.speed || this.config.settings?.speed
          ? { speed: options?.speed || this.config.settings?.speed }
          : {}),
        ...(options?.provider || this.config.settings?.provider_preferences
          ? {
              provider:
                options?.provider || this.config.settings?.provider_preferences,
            }
          : {}),
      };

      const response = await fetch(this.buildProviderUrl('/audio/speech'), {
        method: 'POST',
        headers: this.buildProviderHeaders(),
        body: JSON.stringify(body),
      });

      if (!response.ok) {
        throw new Error(await this.readProviderError(response));
      }

      const buffer = Buffer.from(await response.arrayBuffer());

      return {
        success: buffer.length > 0,
        audioBase64: buffer.toString('base64'),
        contentType:
          response.headers.get('content-type') || 'application/octet-stream',
        generationId: response.headers.get('x-generation-id') || undefined,
        model,
        error: buffer.length ? undefined : 'Speech model returned no audio',
      };
    } catch (error: any) {
      return {
        success: false,
        model,
        error: error.message || 'OpenAI-compatible speech request failed',
      };
    }
  }

  async transcribeAudio(
    options: AITranscriptionRequestOptions,
  ): Promise<AITranscriptionResponse> {
    const model =
      options.model ||
      this.config.settings?.transcription_model ||
      this.config.modelId;

    try {
      const response = await this.postJson<any>('/audio/transcriptions', {
        model,
        input_audio: options.inputAudio,
        ...(options.language || this.config.settings?.language
          ? { language: options.language || this.config.settings?.language }
          : {}),
        ...((options.temperature ?? this.config.settings?.temperature)
          ? {
              temperature:
                options.temperature ?? this.config.settings?.temperature,
            }
          : {}),
        ...(options.provider || this.config.settings?.provider_preferences
          ? {
              provider:
                options.provider || this.config.settings?.provider_preferences,
            }
          : {}),
      });

      return {
        success: typeof response.text === 'string',
        text: response.text,
        model,
        usage: this.mapTokenUsage(response.usage),
        error:
          typeof response.text === 'string'
            ? undefined
            : 'Transcription model returned no text',
      };
    } catch (error: any) {
      return {
        success: false,
        model,
        error:
          error.message || 'OpenAI-compatible transcription request failed',
      };
    }
  }

  async rerank(options: AIRerankRequestOptions): Promise<AIRerankResponse> {
    const model =
      options.model ||
      this.config.settings?.rerank_model ||
      this.config.modelId;

    try {
      const response = await this.postJson<any>('/rerank', {
        model,
        query: options.query,
        documents: options.documents,
        ...(options.topN || this.config.settings?.top_n
          ? { top_n: options.topN || this.config.settings?.top_n }
          : {}),
        ...(options.provider || this.config.settings?.provider_preferences
          ? {
              provider:
                options.provider || this.config.settings?.provider_preferences,
            }
          : {}),
      });

      return {
        success: Array.isArray(response.results),
        id: response.id,
        model: response.model || model,
        provider: response.provider,
        results: Array.isArray(response.results)
          ? response.results.map((item: any) => ({
              index: item.index,
              relevanceScore: item.relevance_score ?? item.relevanceScore ?? 0,
              text: item.document?.text,
            }))
          : undefined,
        usage: this.mapTokenUsage(response.usage),
        error: Array.isArray(response.results)
          ? undefined
          : 'Rerank model returned no results',
      };
    } catch (error: any) {
      return {
        success: false,
        model,
        error: error.message || 'OpenAI-compatible rerank request failed',
      };
    }
  }

  async testConnection(): Promise<{ success: boolean; message: string }> {
    try {
      const modelType = this.getModelType();

      switch (modelType) {
        case 'image':
          return this.testImageConnection();
        case 'embedding':
          return this.testEmbeddingConnection();
        case 'audio':
          return this.testAudioConnection();
        case 'video':
          return this.testVideoConnection();
        case 'speech':
          return this.testSpeechConnection();
        case 'transcription':
          return this.testTranscriptionConnection();
        case 'rerank':
          return this.testRerankConnection();
        case 'text':
          break;
        default:
          return {
            success: false,
            message: `Connection test for model type "${modelType}" is not supported`,
          };
      }

      const response = await this.chat([{ role: 'user', content: 'Say OK' }], {
        maxTokens: 5,
      });
      if (response.success) {
        return {
          success: true,
          message: `Connection successful. Model: ${response.model || this.config.modelId}`,
        };
      }
      return { success: false, message: response.error || 'Unknown error' };
    } catch (error: any) {
      return { success: false, message: error.message || 'Connection failed' };
    }
  }

  private async testImageConnection(): Promise<{
    success: boolean;
    message: string;
  }> {
    const response = await this.generateImage(
      'Generate a simple connection test image with a clean OK mark.',
      { size: '1024x1024' },
    );

    if (response.success) {
      return {
        success: true,
        message: `Connection successful. Image model: ${response.model || this.config.modelId}`,
      };
    }

    return { success: false, message: response.error || 'Unknown error' };
  }

  private async testEmbeddingConnection(): Promise<{
    success: boolean;
    message: string;
  }> {
    const response = await this.generateEmbedding('Vendix connection test');

    if (response.success) {
      return {
        success: true,
        message: `Connection successful. Embedding model: ${response.model || this.config.modelId}`,
      };
    }

    return { success: false, message: response.error || 'Unknown error' };
  }

  private async testAudioConnection(): Promise<{
    success: boolean;
    message: string;
  }> {
    const response = await this.chat(
      [
        {
          role: 'user',
          content: [
            { type: 'text', text: 'Reply with OK after reading this audio.' },
            {
              type: 'input_audio',
              input_audio: {
                data: this.buildSilentWavBase64(),
                format: 'wav',
              },
            },
          ],
        },
      ],
      { maxTokens: 10 },
    );

    if (response.success) {
      return {
        success: true,
        message: `Connection successful. Audio model: ${response.model || this.config.modelId}`,
      };
    }

    return { success: false, message: response.error || 'Unknown error' };
  }

  private async testVideoConnection(): Promise<{
    success: boolean;
    message: string;
  }> {
    if (this.isOpenRouterConfig()) {
      try {
        const response = await this.getJson<any>('/videos/models');
        const models = Array.isArray(response.data) ? response.data : [];
        const configuredModel = models.find(
          (model: any) => model.id === this.config.modelId,
        );

        if (configuredModel) {
          return {
            success: true,
            message: `Connection successful. Video model is available: ${this.config.modelId}`,
          };
        }

        return {
          success: false,
          message: `Video model was not found in OpenRouter video models: ${this.config.modelId}`,
        };
      } catch (error: any) {
        return {
          success: false,
          message: error.message || 'Video model availability check failed',
        };
      }
    }

    return {
      success: false,
      message:
        'Video connection test requires a provider-specific model listing endpoint',
    };
  }

  private async testSpeechConnection(): Promise<{
    success: boolean;
    message: string;
  }> {
    const response = await this.generateSpeech('OK');

    if (response.success) {
      return {
        success: true,
        message: `Connection successful. Speech model: ${response.model || this.config.modelId}`,
      };
    }

    return { success: false, message: response.error || 'Unknown error' };
  }

  private async testTranscriptionConnection(): Promise<{
    success: boolean;
    message: string;
  }> {
    const response = await this.transcribeAudio({
      inputAudio: {
        data: this.buildSilentWavBase64(),
        format: 'wav',
      },
    });

    if (response.success) {
      return {
        success: true,
        message: `Connection successful. Transcription model: ${response.model || this.config.modelId}`,
      };
    }

    return { success: false, message: response.error || 'Unknown error' };
  }

  private async testRerankConnection(): Promise<{
    success: boolean;
    message: string;
  }> {
    const response = await this.rerank({
      query: 'Which document says OK?',
      documents: ['OK', 'Something else'],
      topN: 1,
    });

    if (response.success) {
      return {
        success: true,
        message: `Connection successful. Rerank model: ${response.model || this.config.modelId}`,
      };
    }

    return { success: false, message: response.error || 'Unknown error' };
  }

  async *chatStream(
    messages: AIMessage[],
    options?: AIRequestOptions,
  ): AsyncGenerator<AIStreamChunk> {
    try {
      const stream = await this.client.chat.completions.create({
        model: options?.model || this.config.modelId,
        messages: this.buildMessages(messages, options?.systemPrompt) as any,
        temperature:
          options?.temperature ??
          this.config.settings?.temperature ??
          undefined,
        max_tokens:
          options?.maxTokens ?? this.config.settings?.maxTokens ?? undefined,
        stream: true,
        ...(options?.tools?.length && {
          tools: options.tools.map((t) => ({
            type: t.type as any,
            function: t.function,
          })),
        }),
        ...(options?.tool_choice && {
          tool_choice: options.tool_choice as any,
        }),
      });

      let totalPromptTokens = 0;
      let totalCompletionTokens = 0;

      for await (const chunk of stream) {
        const delta = chunk.choices[0]?.delta;

        if (delta?.content) {
          yield { type: 'text', content: delta.content };
        }

        // Capture usage from the final chunk
        if (chunk.usage) {
          totalPromptTokens = chunk.usage.prompt_tokens || 0;
          totalCompletionTokens = chunk.usage.completion_tokens || 0;
        }
      }

      yield {
        type: 'done',
        usage: {
          promptTokens: totalPromptTokens,
          completionTokens: totalCompletionTokens,
          totalTokens: totalPromptTokens + totalCompletionTokens,
        },
      };
    } catch (error: any) {
      yield {
        type: 'error',
        error: error.message || 'OpenAI-compatible streaming failed',
      };
    }
  }

  async *generateImageStream(
    prompt: string,
    options?: AIImageRequestOptions,
  ): AsyncGenerator<AIImageStreamChunk> {
    try {
      if (this.usesChatModalitiesImageGeneration()) {
        const model =
          options?.model ||
          this.config.settings?.image_model ||
          this.config.modelId;

        yield {
          type: 'progress',
          message: 'Generando imagen con OpenRouter',
          model,
        };

        const response = await this.generateImageWithChatModalities(
          prompt,
          options,
        );

        if (!response.success || !response.imageBase64) {
          yield {
            type: 'error',
            error: response.error || 'Image model did not return data',
          };
          return;
        }

        yield {
          type: 'completed',
          imageBase64: response.imageBase64,
          usage: response.usage,
          model: response.model,
          revisedPrompt: response.revisedPrompt,
        };
        yield {
          type: 'done',
          usage: response.usage,
          model: response.model,
        };
        return;
      }

      if (options?.referenceImages?.length) {
        yield* this.generateImageWithResponsesStream(prompt, options);
        return;
      }

      const model =
        options?.model || this.config.settings?.image_model || 'gpt-image-1';
      yield {
        type: 'progress',
        message: 'Preparando generación de imagen',
        model,
      };

      const stream = await this.client.images.generate({
        prompt,
        model,
        n: 1,
        stream: true,
        partial_images: options?.partialImages ?? 2,
        size: options?.size || '1024x1024',
        quality: options?.quality || 'auto',
        output_format: options?.outputFormat || 'png',
        background: options?.background || 'auto',
        ...(options?.outputCompression !== undefined && {
          output_compression: options.outputCompression,
        }),
      } as any);

      let latestImageBase64: string | undefined;
      let usage: AIImageStreamChunk['usage'];

      for await (const event of stream as any) {
        if (event.type === 'image_generation.partial_image') {
          latestImageBase64 = event.b64_json;
          yield {
            type: 'partial_image',
            imageBase64: event.b64_json,
            partialImageIndex: event.partial_image_index,
            model,
          };
        }

        if (event.type === 'image_generation.completed') {
          latestImageBase64 = event.b64_json || latestImageBase64;
          usage = this.mapImageUsage(event.usage);
        }
      }

      if (!latestImageBase64) {
        const fallback = await this.generateImage(prompt, options);
        if (!fallback.success || !fallback.imageBase64) {
          yield {
            type: 'error',
            error: fallback.error || 'Image model did not return data',
          };
          return;
        }
        latestImageBase64 = fallback.imageBase64;
        usage = fallback.usage;
      }

      yield {
        type: 'completed',
        imageBase64: latestImageBase64,
        usage,
        model,
      };
      yield { type: 'done', usage, model };
    } catch (error: any) {
      yield {
        type: 'error',
        error:
          error.message || 'OpenAI-compatible image generation stream failed',
      };
    }
  }

  private async generateImageWithResponses(
    prompt: string,
    options: AIImageRequestOptions,
  ): Promise<AIImageResponse> {
    const responseModel =
      options.responseModel ||
      this.config.settings?.response_model ||
      this.config.modelId;

    const response = await (this.client as any).responses.create({
      model: responseModel,
      input: this.buildImageResponseInput(prompt, options),
      tools: [this.buildImageGenerationTool(options)],
      tool_choice: { type: 'image_generation' },
    });

    const imageCall = response.output?.find(
      (output: any) => output.type === 'image_generation_call',
    );

    return {
      success: !!imageCall?.result,
      imageBase64: imageCall?.result,
      revisedPrompt: imageCall?.revised_prompt,
      model: options.model || this.config.settings?.image_model,
      usage: this.mapResponseUsage(response.usage),
      error: imageCall?.result ? undefined : 'Image model did not return data',
    };
  }

  private async generateImageWithChatModalities(
    prompt: string,
    options?: AIImageRequestOptions,
  ): Promise<AIImageResponse> {
    const model =
      options?.model ||
      this.config.settings?.image_model ||
      this.config.modelId;

    const response = await this.client.chat.completions.create({
      model,
      messages: this.buildImageChatMessages(prompt, options) as any,
      modalities: this.config.settings?.modalities || ['image'],
    } as any);

    const message = response.choices?.[0]?.message as any;
    const imageBase64 = await this.extractImageBase64FromChatMessage(message);

    return {
      success: !!imageBase64,
      imageBase64,
      revisedPrompt:
        typeof message?.content === 'string' && message.content.trim()
          ? message.content
          : undefined,
      model: response.model || model,
      usage: this.mapChatUsage(response.usage),
      error: imageBase64 ? undefined : 'Image model did not return data',
    };
  }

  private async *generateImageWithResponsesStream(
    prompt: string,
    options: AIImageRequestOptions,
  ): AsyncGenerator<AIImageStreamChunk> {
    const responseModel =
      options.responseModel ||
      this.config.settings?.response_model ||
      this.config.modelId;
    const imageModel =
      options.model || this.config.settings?.image_model || 'gpt-image-1';

    yield {
      type: 'progress',
      message: 'Analizando imágenes de referencia',
      model: imageModel,
    };

    const stream = await (this.client as any).responses.create({
      model: responseModel,
      input: this.buildImageResponseInput(prompt, options),
      stream: true,
      tools: [this.buildImageGenerationTool(options)],
      tool_choice: { type: 'image_generation' },
    });

    let latestImageBase64: string | undefined;
    let usage: AIImageStreamChunk['usage'];
    let revisedPrompt: string | undefined;

    for await (const event of stream as any) {
      if (event.type === 'response.image_generation_call.partial_image') {
        latestImageBase64 = event.partial_image_b64;
        yield {
          type: 'partial_image',
          imageBase64: event.partial_image_b64,
          partialImageIndex: event.partial_image_index,
          model: imageModel,
        };
      }

      if (
        event.type === 'response.output_item.done' &&
        event.item?.type === 'image_generation_call'
      ) {
        latestImageBase64 = event.item.result || latestImageBase64;
        revisedPrompt = event.item.revised_prompt || revisedPrompt;
      }

      if (event.type === 'response.completed') {
        usage = this.mapResponseUsage(event.response?.usage);
        const imageCall = event.response?.output?.find(
          (output: any) => output.type === 'image_generation_call',
        );
        latestImageBase64 = imageCall?.result || latestImageBase64;
        revisedPrompt = imageCall?.revised_prompt || revisedPrompt;
      }

      if (event.type === 'response.failed') {
        yield {
          type: 'error',
          error:
            event.response?.error?.message ||
            'Image generation response failed',
        };
        return;
      }
    }

    if (!latestImageBase64) {
      yield { type: 'error', error: 'Image model did not return data' };
      return;
    }

    yield {
      type: 'completed',
      imageBase64: latestImageBase64,
      usage,
      model: imageModel,
      revisedPrompt,
    };
    yield { type: 'done', usage, model: imageModel };
  }

  private buildImageGenerationTool(options: AIImageRequestOptions): any {
    return {
      type: 'image_generation',
      model:
        options.model || this.config.settings?.image_model || 'gpt-image-1',
      size: options.size || '1024x1024',
      quality: options.quality || 'auto',
      output_format: options.outputFormat || 'png',
      background: options.background || 'auto',
      partial_images: options.partialImages ?? 2,
      ...(options.inputFidelity && { input_fidelity: options.inputFidelity }),
      ...(options.action && { action: options.action }),
      ...(options.outputCompression !== undefined && {
        output_compression: options.outputCompression,
      }),
    };
  }

  private buildImageResponseInput(
    prompt: string,
    options: AIImageRequestOptions,
  ): any[] {
    return [
      {
        role: 'user',
        content: [
          { type: 'input_text', text: prompt },
          ...(options.referenceImages || []).map((image) => ({
            type: 'input_image',
            image_url: image.url,
            detail: image.detail || 'auto',
          })),
        ],
      },
    ];
  }

  private buildImageChatMessages(
    prompt: string,
    options?: AIImageRequestOptions,
  ): AIMessage[] {
    const referenceImages = options?.referenceImages || [];

    if (!referenceImages.length) {
      return [{ role: 'user', content: prompt }];
    }

    return [
      {
        role: 'user',
        content: [
          { type: 'text', text: prompt },
          ...referenceImages.map((image) => ({
            type: 'image_url' as const,
            image_url: {
              url: image.url,
              detail: image.detail === 'original' ? 'high' : image.detail,
            },
          })),
        ],
      },
    ];
  }

  private async extractImageBase64FromChatMessage(
    message: any,
  ): Promise<string | undefined> {
    const imageUrl =
      message?.images?.[0]?.image_url?.url ||
      message?.images?.[0]?.url ||
      message?.content?.find?.((part: any) => part?.image_url)?.image_url?.url;

    if (!imageUrl || typeof imageUrl !== 'string') {
      return undefined;
    }

    return this.imageUrlToBase64(imageUrl);
  }

  private async imageUrlToBase64(imageUrl: string): Promise<string> {
    if (imageUrl.startsWith('data:image/')) {
      return imageUrl;
    }

    if (!imageUrl.startsWith('http://') && !imageUrl.startsWith('https://')) {
      return imageUrl;
    }

    const response = await fetch(imageUrl);
    if (!response.ok) {
      throw new Error(`Generated image download failed: ${response.status}`);
    }

    const contentType = response.headers.get('content-type') || 'image/png';
    const buffer = Buffer.from(await response.arrayBuffer());
    return `data:${contentType};base64,${buffer.toString('base64')}`;
  }

  private async postJson<T>(
    path: string,
    body: Record<string, any>,
  ): Promise<T> {
    const response = await fetch(this.buildProviderUrl(path), {
      method: 'POST',
      headers: this.buildProviderHeaders(),
      body: JSON.stringify(body),
    });

    if (!response.ok) {
      throw new Error(await this.readProviderError(response));
    }

    return (await response.json()) as T;
  }

  private async getJson<T>(pathOrUrl: string): Promise<T> {
    const response = await fetch(this.buildProviderUrl(pathOrUrl), {
      method: 'GET',
      headers: this.buildProviderHeaders(false),
    });

    if (!response.ok) {
      throw new Error(await this.readProviderError(response));
    }

    return (await response.json()) as T;
  }

  private buildProviderHeaders(includeJson = true): Record<string, string> {
    const headers: Record<string, string> = {
      Authorization: `Bearer ${this.config.apiKey}`,
    };

    if (includeJson) {
      headers['Content-Type'] = 'application/json';
    }

    const referer =
      this.config.settings?.http_referer ||
      this.config.settings?.httpReferer ||
      this.config.settings?.site_url;
    const title =
      this.config.settings?.x_openrouter_title ||
      this.config.settings?.appTitle ||
      this.config.settings?.site_name;

    if (referer) {
      headers['HTTP-Referer'] = referer;
    }

    if (title) {
      headers['X-OpenRouter-Title'] = title;
    }

    return headers;
  }

  private buildProviderUrl(pathOrUrl: string): string {
    if (pathOrUrl.startsWith('http://') || pathOrUrl.startsWith('https://')) {
      return pathOrUrl;
    }

    const apiRoot = this.getApiRootBaseUrl();
    const rootUrl = new URL(apiRoot);

    if (pathOrUrl.startsWith('/api/')) {
      return `${rootUrl.origin}${pathOrUrl}`;
    }

    return `${apiRoot.replace(/\/+$/, '')}/${pathOrUrl.replace(/^\/+/, '')}`;
  }

  private getApiRootBaseUrl(): string {
    const configuredRoot = this.toApiRootBaseUrl(this.config.baseUrl);

    if (configuredRoot) {
      return configuredRoot.replace(/\/+$/, '');
    }

    if (this.isOpenRouterConfig()) {
      return 'https://openrouter.ai/api/v1';
    }

    return 'https://api.openai.com/v1';
  }

  private async readProviderError(response: Response): Promise<string> {
    const fallback = `${response.status} ${response.statusText}`.trim();
    const text = await response.text();

    if (!text) {
      return fallback;
    }

    try {
      const parsed = JSON.parse(text);
      return (
        parsed.error?.message ||
        parsed.error ||
        parsed.message ||
        parsed.detail ||
        fallback
      );
    } catch {
      return text || fallback;
    }
  }

  private mapVideoResponse(response: any, model: string): AIVideoResponse {
    return {
      success: !!response.id && response.status !== 'failed',
      id: response.id,
      generationId: response.generation_id,
      pollingUrl: response.polling_url,
      status: response.status,
      urls: response.unsigned_urls,
      model,
      usage: this.mapTokenUsage(response.usage),
      error:
        response.status === 'failed'
          ? response.error || 'Video generation failed'
          : undefined,
    };
  }

  private async pollVideoUntilComplete(
    pollingUrl: string,
    model: string,
    options: AIVideoRequestOptions,
  ): Promise<AIVideoResponse> {
    const maxAttempts = options.maxPollAttempts ?? 60;
    const intervalMs = options.pollIntervalMs ?? 5000;

    for (let attempt = 0; attempt < maxAttempts; attempt++) {
      if (attempt > 0) {
        await new Promise((resolve) => setTimeout(resolve, intervalMs));
      }

      const response = await this.getJson<any>(pollingUrl);
      const mapped = this.mapVideoResponse(response, model);

      if (mapped.status === 'completed' || mapped.status === 'failed') {
        return mapped;
      }
    }

    return {
      success: false,
      pollingUrl,
      model,
      status: 'in_progress',
      error: 'Video generation did not complete before polling timeout',
    };
  }

  private buildSilentWavBase64(): string {
    const sampleRate = 8000;
    const durationSeconds = 0.1;
    const samples = Math.floor(sampleRate * durationSeconds);
    const dataSize = samples * 2;
    const buffer = Buffer.alloc(44 + dataSize);

    buffer.write('RIFF', 0);
    buffer.writeUInt32LE(36 + dataSize, 4);
    buffer.write('WAVE', 8);
    buffer.write('fmt ', 12);
    buffer.writeUInt32LE(16, 16);
    buffer.writeUInt16LE(1, 20);
    buffer.writeUInt16LE(1, 22);
    buffer.writeUInt32LE(sampleRate, 24);
    buffer.writeUInt32LE(sampleRate * 2, 28);
    buffer.writeUInt16LE(2, 32);
    buffer.writeUInt16LE(16, 34);
    buffer.write('data', 36);
    buffer.writeUInt32LE(dataSize, 40);

    return buffer.toString('base64');
  }

  private getDefaultSpeechVoice(model: string): string {
    if (model.toLowerCase().includes('grok-voice')) {
      return 'Eve';
    }

    return 'alloy';
  }

  private mapImageUsage(usage: any): AIImageResponse['usage'] {
    if (!usage) return undefined;
    return {
      promptTokens: usage.input_tokens || 0,
      completionTokens: usage.output_tokens || 0,
      totalTokens:
        usage.total_tokens ||
        (usage.input_tokens || 0) + (usage.output_tokens || 0),
    };
  }

  private mapResponseUsage(usage: any): AIImageResponse['usage'] {
    if (!usage) return undefined;
    return {
      promptTokens: usage.input_tokens || usage.prompt_tokens || 0,
      completionTokens: usage.output_tokens || usage.completion_tokens || 0,
      totalTokens:
        usage.total_tokens ||
        (usage.input_tokens || usage.prompt_tokens || 0) +
          (usage.output_tokens || usage.completion_tokens || 0),
    };
  }

  private mapChatUsage(usage: any): AIImageResponse['usage'] {
    if (!usage) return undefined;
    return {
      promptTokens: usage.prompt_tokens || usage.input_tokens || 0,
      completionTokens: usage.completion_tokens || usage.output_tokens || 0,
      totalTokens:
        usage.total_tokens ||
        (usage.prompt_tokens || usage.input_tokens || 0) +
          (usage.completion_tokens || usage.output_tokens || 0),
    };
  }

  private mapTokenUsage(usage: any): AIResponse['usage'] | undefined {
    if (!usage) return undefined;
    const promptTokens =
      usage.prompt_tokens || usage.input_tokens || usage.total_tokens || 0;
    const completionTokens =
      usage.completion_tokens || usage.output_tokens || 0;
    return {
      promptTokens,
      completionTokens,
      totalTokens:
        usage.total_tokens ||
        usage.totalTokens ||
        promptTokens + completionTokens,
      ...(usage.seconds !== undefined && { seconds: usage.seconds }),
      ...(usage.cost !== undefined && { cost: usage.cost }),
      ...(usage.search_units !== undefined && {
        searchUnits: usage.search_units,
      }),
    } as any;
  }

  private usesChatModalitiesImageGeneration(): boolean {
    if (this.getModelType() !== 'image') {
      return false;
    }

    return (
      this.config.settings?.image_generation_mode === 'chat_completions' ||
      this.config.settings?.image_endpoint === 'chat_completions' ||
      this.config.settings?.modalities?.includes?.('image') ||
      this.isOpenRouterConfig()
    );
  }

  private getModelType(): string {
    const modelType =
      this.config.settings?.model_type || this.config.settings?.modelType;

    if (typeof modelType === 'string' && modelType.trim()) {
      return modelType.trim();
    }

    return this.hasImageGenerationSettings() ? 'image' : 'text';
  }

  private hasImageGenerationSettings(): boolean {
    return (
      this.config.settings?.image_generation_mode !== undefined ||
      this.config.settings?.image_endpoint !== undefined ||
      this.config.settings?.image_model !== undefined ||
      this.config.settings?.modalities?.includes?.('image') === true
    );
  }

  private isOpenRouterConfig(): boolean {
    return (
      this.config.baseUrl?.includes('openrouter.ai') === true ||
      this.config.provider.toLowerCase().includes('openrouter')
    );
  }

  private cleanBaseUrl(baseUrl?: string): string | undefined {
    if (!baseUrl) return undefined;

    return baseUrl.trim() || undefined;
  }

  private toOpenAIClientBaseUrl(baseUrl?: string): string | undefined {
    if (!baseUrl) return undefined;

    const urlWithoutTrailingSlash = baseUrl.replace(/\/+$/, '');
    for (const suffix of [
      '/chat/completions',
      '/images/generations',
      '/responses',
      '/embeddings',
      '/videos',
      '/videos/models',
      '/audio/speech',
      '/audio/transcriptions',
      '/rerank',
    ]) {
      if (urlWithoutTrailingSlash.endsWith(suffix)) {
        return urlWithoutTrailingSlash.slice(0, -suffix.length);
      }
    }

    return baseUrl;
  }

  private toApiRootBaseUrl(baseUrl?: string): string | undefined {
    if (!baseUrl) return undefined;

    const urlWithoutTrailingSlash = baseUrl.replace(/\/+$/, '');
    for (const suffix of [
      '/chat/completions',
      '/images/generations',
      '/responses',
      '/embeddings',
      '/videos',
      '/videos/models',
      '/audio/speech',
      '/audio/transcriptions',
      '/rerank',
    ]) {
      if (urlWithoutTrailingSlash.endsWith(suffix)) {
        return urlWithoutTrailingSlash.slice(0, -suffix.length);
      }
    }

    return baseUrl;
  }

  private buildMessages(
    messages: AIMessage[],
    systemPrompt?: string,
  ): AIMessage[] {
    const result: AIMessage[] = [];
    if (systemPrompt) {
      result.push({ role: 'system', content: systemPrompt });
    }
    result.push(...messages);
    return result;
  }
}
