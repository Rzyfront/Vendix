import { Inject, Injectable, Logger, forwardRef } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import OpenAI from 'openai';
import { GlobalPrismaService } from '../../prisma/services/global-prisma.service';
import { VendixHttpException, ErrorCodes } from '../../common/errors';
import { AIEngineService } from '../ai-engine.service';

export interface StoreEmbeddingParams {
  store_id: number;
  organization_id: number;
  entity_type: string;
  entity_id: number;
  content: string;
  metadata?: Record<string, any>;
}

export interface SimilaritySearchParams {
  store_id: number;
  query_embedding: number[];
  entity_types?: string[];
  limit?: number;
  min_similarity?: number;
}

export interface SimilarityResult {
  id: number;
  entity_type: string;
  entity_id: number;
  content: string;
  metadata: any;
  similarity: number;
}

@Injectable()
export class EmbeddingService {
  private readonly logger = new Logger(EmbeddingService.name);
  private openai: OpenAI | null = null;
  private readonly embeddingModel = 'text-embedding-3-small';

  constructor(
    private readonly prisma: GlobalPrismaService,
    private readonly configService: ConfigService,
    // forwardRef: AIEngineModule (global) imports EmbeddingModule AND provides
    // AIEngineService. Plain injection would not resolve at boot.
    @Inject(forwardRef(() => AIEngineService))
    private readonly aiEngine: AIEngineService,
  ) {
    this.initializeOpenAI();
  }

  private initializeOpenAI(): void {
    const apiKey =
      this.configService.get<string>('OPENAI_API_KEY') ||
      process.env.OPENAI_API_KEY;

    if (apiKey) {
      this.openai = new OpenAI({ apiKey });
      this.logger.log('OpenAI client initialized for embeddings');
    } else {
      this.logger.warn(
        'OPENAI_API_KEY not configured — embedding generation will fail',
      );
    }
  }

  /**
   * App key that routes generation through the AI Engine instead of the
   * direct SDK. Convention matches every other caller (hardcoded key like
   * 'rut_scanner' or 'chat_assistant'); EMBEDDING_APP_KEY only overrides it
   * when a second embedding app must be targeted without a redeploy.
   */
  private static readonly DEFAULT_EMBEDDING_APP_KEY = 'product_embeddings';

  private resolveEmbeddingAppKey(): string | null {
    const raw =
      this.configService.get<string>('EMBEDDING_APP_KEY') ||
      process.env.EMBEDDING_APP_KEY;
    const appKey = raw?.trim();
    return (
      appKey || EmbeddingService.DEFAULT_EMBEDDING_APP_KEY
    );
  }

  /**
   * Whether embeddings can actually run in this environment.
   *
   * True when either route is configured: the AI Engine app route
   * (EMBEDDING_APP_KEY set) or the direct SDK route (OPENAI_API_KEY set).
   *
   * Exposed so callers can decide not to offer a capability instead of
   * offering one that always fails: the agent picks tools from their
   * descriptions, and a semantic search that throws burns the iteration it
   * would have spent on a search that works.
   */
  isAvailable(): boolean {
    return this.resolveEmbeddingAppKey() !== null || this.openai !== null;
  }

  async generateEmbedding(text: string): Promise<number[]> {
    const appKey = this.resolveEmbeddingAppKey();
    if (appKey) {
      try {
        return await this.generateEmbeddingViaApp(appKey, text);
      } catch (error: any) {
        // The app row may not exist in every environment (dev without panel
        // setup). Resolution errors fall back to the direct SDK when it is
        // configured; anything else propagates untouched.
        if (this.openai && this.isAppResolutionError(error)) {
          this.logger.warn(
            `Embedding app '${appKey}' unusable (${error?.errorCode}); falling back to direct SDK`,
          );
          return this.generateEmbeddingDirect(text);
        }
        throw error;
      }
    }

    return this.generateEmbeddingDirect(text);
  }

  private async generateEmbeddingDirect(text: string): Promise<number[]> {
    if (!this.openai) {
      throw new VendixHttpException(
        ErrorCodes.AI_EMBED_001,
        'OpenAI API key not configured for embeddings',
      );
    }

    try {
      const response = await this.openai.embeddings.create({
        model: this.embeddingModel,
        input: text.substring(0, 8000),
      });

      return response.data[0].embedding;
    } catch (error: any) {
      this.logger.error(`Embedding generation failed: ${error.message}`);
      throw new VendixHttpException(ErrorCodes.AI_EMBED_001, error.message);
    }
  }

  private isAppResolutionError(error: any): boolean {
    const code = error?.errorCode;
    return (
      code === ErrorCodes.AI_APP_001.code ||
      code === ErrorCodes.AI_APP_003.code ||
      code === ErrorCodes.AI_APP_004.code ||
      code === ErrorCodes.AI_CONFIG_001.code ||
      code === ErrorCodes.AI_PROVIDER_002.code
    );
  }

  /**
   * AI Engine route: generates through the configured application so the
   * call gets provider config, logging, and cost tracking from ai-config.
   * App/config resolution errors are rethrown typed so the caller can fall
   * back to the direct SDK; provider-level failures map to AI_EMBED_001.
   * Never throws raw.
   */
  private async generateEmbeddingViaApp(
    appKey: string,
    text: string,
  ): Promise<number[]> {
    try {
      const response = await this.aiEngine.runEmbedding(
        appKey,
        undefined,
        text.substring(0, 8000),
      );

      if (!response.success || !response.embedding?.length) {
        throw new VendixHttpException(
          ErrorCodes.AI_EMBED_001,
          response.error || 'Embedding app returned no data',
        );
      }

      return response.embedding;
    } catch (error: any) {
      if (error instanceof VendixHttpException) throw error;
      this.logger.error(
        `Embedding generation via app failed: ${error?.message}`,
      );
      throw new VendixHttpException(
        ErrorCodes.AI_EMBED_001,
        error?.message,
      );
    }
  }

  async storeEmbedding(params: StoreEmbeddingParams): Promise<void> {
    try {
      const embedding = await this.generateEmbedding(params.content);
      const embeddingStr = `[${embedding.join(',')}]`;

      await this.prisma.$queryRawUnsafe(
        `
        INSERT INTO ai_embeddings (store_id, organization_id, entity_type, entity_id, content, embedding, metadata, updated_at)
        VALUES ($1, $2, $3, $4, $5, $6::vector, $7::jsonb, NOW())
        ON CONFLICT (store_id, entity_type, entity_id)
        DO UPDATE SET
          content = EXCLUDED.content,
          embedding = EXCLUDED.embedding,
          metadata = EXCLUDED.metadata,
          updated_at = NOW()
      `,
        params.store_id,
        params.organization_id,
        params.entity_type,
        params.entity_id,
        params.content,
        embeddingStr,
        params.metadata ? JSON.stringify(params.metadata) : null,
      );
    } catch (error: any) {
      if (error instanceof VendixHttpException) throw error;
      this.logger.error(`Store embedding failed: ${error.message}`);
      throw new VendixHttpException(ErrorCodes.AI_EMBED_001, error.message);
    }
  }

  async searchSimilar(
    params: SimilaritySearchParams,
  ): Promise<SimilarityResult[]> {
    try {
      const embeddingStr = `[${params.query_embedding.join(',')}]`;
      const limit = params.limit || 5;
      const minSimilarity = params.min_similarity || 0.3;

      if (params.entity_types?.length) {
        const results = await this.prisma.$queryRawUnsafe<SimilarityResult[]>(
          `
          SELECT
            id,
            entity_type,
            entity_id,
            content,
            metadata,
            1 - (embedding <=> $1::vector) as similarity
          FROM ai_embeddings
          WHERE store_id = $2
            AND entity_type = ANY($3::text[])
            AND embedding IS NOT NULL
            AND 1 - (embedding <=> $1::vector) > $4
          ORDER BY embedding <=> $1::vector
          LIMIT $5
        `,
          embeddingStr,
          params.store_id,
          params.entity_types,
          minSimilarity,
          limit,
        );
        return results;
      }

      const results = await this.prisma.$queryRawUnsafe<SimilarityResult[]>(
        `
        SELECT
          id,
          entity_type,
          entity_id,
          content,
          metadata,
          1 - (embedding <=> $1::vector) as similarity
        FROM ai_embeddings
        WHERE store_id = $2
          AND embedding IS NOT NULL
          AND 1 - (embedding <=> $1::vector) > $3
        ORDER BY embedding <=> $1::vector
        LIMIT $4
      `,
        embeddingStr,
        params.store_id,
        minSimilarity,
        limit,
      );
      return results;
    } catch (error: any) {
      this.logger.error(`Similarity search failed: ${error.message}`);
      throw new VendixHttpException(ErrorCodes.AI_EMBED_003, error.message);
    }
  }

  async deleteEmbedding(
    storeId: number,
    entityType: string,
    entityId: number,
  ): Promise<void> {
    await this.prisma.ai_embeddings.deleteMany({
      where: {
        store_id: storeId,
        entity_type: entityType,
        entity_id: entityId,
      },
    });
  }

  async searchByText(
    storeId: number,
    query: string,
    entityTypes?: string[],
    limit?: number,
  ): Promise<SimilarityResult[]> {
    const queryEmbedding = await this.generateEmbedding(query);
    return this.searchSimilar({
      store_id: storeId,
      query_embedding: queryEmbedding,
      entity_types: entityTypes,
      limit,
    });
  }
}
