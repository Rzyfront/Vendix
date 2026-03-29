import { Injectable, Logger } from '@nestjs/common';
import { EmbeddingService, SimilarityResult } from './embedding.service';
import { AIEngineService } from '../ai-engine.service';
import { AIMessage, AIResponse } from '../interfaces/ai-provider.interface';
import { RequestContextService } from '@common/context/request-context.service';

export interface RAGQueryParams {
  query: string;
  system_prompt?: string;
  entity_types?: string[];
  max_context_items?: number;
  app_key?: string;
}

@Injectable()
export class RAGService {
  private readonly logger = new Logger(RAGService.name);

  constructor(
    private readonly embeddingService: EmbeddingService,
    private readonly aiEngine: AIEngineService,
  ) {}

  async queryWithContext(params: RAGQueryParams): Promise<AIResponse> {
    const context = RequestContextService.getContext();
    const storeId = context?.store_id;

    if (!storeId) {
      return this.aiEngine.chat([{ role: 'user', content: params.query }]);
    }

    // Search for relevant context
    const results = await this.embeddingService.searchByText(
      storeId,
      params.query,
      params.entity_types,
      params.max_context_items || 5,
    );

    // Build augmented prompt
    const messages: AIMessage[] = [];

    const basePrompt =
      params.system_prompt ||
      'You are a helpful business assistant. Use the provided context to answer questions accurately. If the context does not contain relevant information, say so.';

    const augmentedPrompt = this.buildRAGSystemPrompt(basePrompt, results);
    messages.push({ role: 'system', content: augmentedPrompt });
    messages.push({ role: 'user', content: params.query });

    return this.aiEngine.chat(messages);
  }

  private buildRAGSystemPrompt(
    basePrompt: string,
    contexts: SimilarityResult[],
  ): string {
    if (contexts.length === 0) {
      return basePrompt;
    }

    const contextBlock = contexts
      .map(
        (c, i) =>
          `[${i + 1}] (${c.entity_type} #${c.entity_id}, relevance: ${(c.similarity * 100).toFixed(1)}%)\n${c.content}`,
      )
      .join('\n\n');

    return `${basePrompt}

## Relevant Context
The following information was retrieved from the business database based on the user's question:

${contextBlock}

Use this context to provide accurate, data-driven answers. Cite the source when possible.`;
  }
}
