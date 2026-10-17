import { Inject, Injectable, Logger, Optional, forwardRef } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import OpenAI from 'openai';
import { GlobalPrismaService } from '../../prisma/services/global-prisma.service';
import { VendixHttpException, ErrorCodes } from '../../common/errors';
import { AIEngineService } from '../ai-engine.service';
import { RequestContextService } from '../../common/context/request-context.service';
import { BUSINESS_TYPES, KNOWLEDGE_TYPES, KnowledgeType, knowledgeIndexEnabled, toolRoutingEnabled } from '../tools/tool-catalog';
import { KnowledgeEmbeddingService, assertKnowledgeVector } from './knowledge-embedding.service';

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
  organization_id?: number;
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
    @Optional() private readonly knowledgeEmbeddings?: KnowledgeEmbeddingService,
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
   * The silent 'product_embeddings' default does NOT count: no seed
   * guarantees that app row in every environment, and generateEmbedding
   * throws AI_EMBED_001 when the app is missing and no SDK is configured.
   *
   * Exposed so callers can decide not to offer a capability instead of
   * offering one that always fails: the agent picks tools from their
   * descriptions, and a semantic search that throws burns the iteration it
   * would have spent on a search that works.
   */
  isAvailable(): boolean {
    const raw =
      this.configService.get<string>('EMBEDDING_APP_KEY') ||
      process.env.EMBEDDING_APP_KEY;
    return !!raw?.trim() || this.openai !== null;
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
    this.assertStoreIds(params.store_id, params.organization_id);
    if (!BUSINESS_TYPES.includes(params.entity_type as typeof BUSINESS_TYPES[number])) throw new Error('INVALID_BUSINESS_ENTITY');
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
    const organizationId = params.organization_id ?? RequestContextService.asyncLocalStorage.getStore()?.organization_id;
    this.assertStoreIds(params.store_id, organizationId);
    const entityTypes = params.entity_types?.length ? params.entity_types : [...BUSINESS_TYPES];
    if (entityTypes.some((type) => !BUSINESS_TYPES.includes(type as typeof BUSINESS_TYPES[number]))) throw new Error('INVALID_BUSINESS_ENTITY');
    if (toolRoutingEnabled() || knowledgeIndexEnabled()) {
      return this.searchStoreNamespace(params, organizationId!, entityTypes);
    }
    try {
      const embeddingStr = `[${params.query_embedding.join(',')}]`;
      const limit = params.limit || 5;
      const minSimilarity = params.min_similarity || 0.3;

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
        WHERE store_id = $2 AND organization_id = $6
          AND entity_type = ANY($3::text[])
          AND embedding IS NOT NULL
          AND 1 - (embedding <=> $1::vector) > $4
        ORDER BY embedding <=> $1::vector
        LIMIT $5
      `,
        embeddingStr,
        params.store_id,
        entityTypes,
        minSimilarity,
        limit,
        organizationId,
      );
      return results;
    } catch (error: any) {
      this.logger.error(`Similarity search failed: ${error.message}`);
      throw new VendixHttpException(ErrorCodes.AI_EMBED_003, error.message);
    }
  }

  private assertStoreIds(storeId: number, organizationId?: number): void {
    if (!Number.isSafeInteger(storeId) || storeId <= 0 || !Number.isSafeInteger(organizationId) || organizationId! <= 0) {
      throw new Error('POSITIVE_TENANT_CONTEXT_REQUIRED');
    }
  }

  private async searchStoreNamespace(params: SimilaritySearchParams, organizationId: number, entityTypes: string[]): Promise<SimilarityResult[]> {
    const context = RequestContextService.asyncLocalStorage.getStore();
    if (context?.store_id !== params.store_id || context.organization_id !== organizationId) throw new Error('TENANT_CONTEXT_MISMATCH');
    return this.prisma.$queryRawUnsafe<SimilarityResult[]>(`
      SELECT id, entity_type, entity_id, content, metadata, 1 - (embedding <=> $1::vector) AS similarity
      FROM ai_embeddings WHERE knowledge_scope = 'store' AND store_id = $2 AND organization_id = $3
        AND entity_type = ANY($4::text[]) AND embedding IS NOT NULL
        AND 1 - (embedding <=> $1::vector) > $5
      ORDER BY embedding <=> $1::vector, id LIMIT $6`,
      `[${params.query_embedding.join(',')}]`, params.store_id, organizationId, entityTypes,
      params.min_similarity ?? 0.3, Math.max(1, Math.min(50, Math.floor(params.limit ?? 5))));
  }

  /** Internal platform-only write path. Never extend StoreEmbeddingParams with sentinel IDs. */
  async storeGlobalKnowledgeEmbedding(params: { documentId: number; type: KnowledgeType; content: string; hash: string; fingerprint: string }): Promise<void> {
    if (!knowledgeIndexEnabled() || !this.knowledgeEmbeddings) throw new Error('KNOWLEDGE_INDEX_DISABLED');
    if (!Number.isSafeInteger(params.documentId) || params.documentId <= 0 || !KNOWLEDGE_TYPES.includes(params.type)) throw new Error('INVALID_KNOWLEDGE_DOCUMENT');
    // Verify ownership/readiness candidate from the DB, not from a user-supplied store=0 payload.
    const document = await this.prisma.ai_knowledge_documents.findFirst({ where: { id: params.documentId,
      knowledge_scope: 'global', entity_type: params.type, store_id: null, organization_id: null, content_hash: params.hash } });
    if (!document || document.content !== params.content) throw new Error('KNOWLEDGE_DOCUMENT_CHANGED');
    const generated = await this.knowledgeEmbeddings.generate(params.content, params.fingerprint);
    assertKnowledgeVector(generated.vector);
    const inserted = await this.prisma.$executeRawUnsafe(`
      INSERT INTO ai_embeddings (knowledge_scope, store_id, organization_id, entity_type, entity_id, content, embedding, metadata, updated_at)
      SELECT 'global', 0, 0, $1, id, content, $2::vector, $3::jsonb, NOW()
      FROM ai_knowledge_documents WHERE id = $4 AND knowledge_scope = 'global' AND store_id IS NULL
        AND organization_id IS NULL AND content_hash = $5
      ON CONFLICT (store_id, entity_type, entity_id) DO UPDATE SET content = EXCLUDED.content,
        embedding = EXCLUDED.embedding, metadata = EXCLUDED.metadata, updated_at = NOW()
      WHERE ai_embeddings.knowledge_scope = 'global' AND ai_embeddings.organization_id = 0`,
      params.type, `[${generated.vector.join(',')}]`, JSON.stringify({ content_hash: params.hash, fingerprint: generated.fingerprint }), params.documentId, params.hash);
    if (inserted !== 1) throw new Error('KNOWLEDGE_DOCUMENT_CHANGED');
  }

  async deleteEmbedding(
    storeId: number,
    entityType: string,
    entityId: number,
  ): Promise<void> {
    if (!Number.isSafeInteger(storeId) || storeId <= 0 || !BUSINESS_TYPES.includes(entityType as typeof BUSINESS_TYPES[number])) throw new Error('INVALID_BUSINESS_ENTITY');
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
    const context = RequestContextService.asyncLocalStorage.getStore();
    this.assertStoreIds(storeId, context?.organization_id);
    if (context?.store_id !== storeId) throw new Error('TENANT_CONTEXT_MISMATCH');
    const queryEmbedding = await this.generateEmbedding(query);
    return this.searchSimilar({
      store_id: storeId,
      query_embedding: queryEmbedding,
      entity_types: entityTypes,
      limit,
    });
  }
}
