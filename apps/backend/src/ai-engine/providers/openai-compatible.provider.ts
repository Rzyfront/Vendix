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
} from '../interfaces/ai-provider.interface';

export class OpenAICompatibleProvider implements AIProvider {
  private client: OpenAI;

  constructor(private config: AIProviderConfig) {
    const baseUrl = this.normalizeBaseUrl(config.baseUrl);
    this.config = {
      ...config,
      baseUrl,
    };
    this.client = new OpenAI({
      apiKey: config.apiKey,
      ...(baseUrl && { baseURL: baseUrl }),
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
        return this.generateImageWithChatModalities(prompt, options);
      }

      if (options?.referenceImages?.length) {
        return this.generateImageWithResponses(prompt, options);
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

  async testConnection(): Promise<{ success: boolean; message: string }> {
    try {
      if (this.usesChatModalitiesImageGeneration()) {
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
      modalities: ['image'],
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

  private usesChatModalitiesImageGeneration(): boolean {
    return (
      this.config.settings?.image_generation_mode === 'chat_completions' ||
      this.config.settings?.image_endpoint === 'chat_completions' ||
      this.config.settings?.modalities?.includes?.('image') ||
      this.config.baseUrl?.includes('openrouter.ai') === true
    );
  }

  private normalizeBaseUrl(baseUrl?: string): string | undefined {
    if (!baseUrl) return undefined;

    let normalized = baseUrl.trim().replace(/\/+$/, '');
    for (const suffix of [
      '/chat/completions',
      '/images/generations',
      '/responses',
    ]) {
      if (normalized.endsWith(suffix)) {
        normalized = normalized.slice(0, -suffix.length);
      }
    }

    return normalized;
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
