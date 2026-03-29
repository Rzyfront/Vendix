import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import OpenAI from 'openai';
import { GlobalPrismaService } from '../../prisma/services/global-prisma.service';
import { VendixHttpException, ErrorCodes } from '../../common/errors';

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

  async generateEmbedding(text: string): Promise<number[]> {
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
        const results = await this.prisma.$queryRawUnsafe<SimilarityResult[]>(`
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

      const results = await this.prisma.$queryRawUnsafe<SimilarityResult[]>(`
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
