import { Inject, Injectable, Optional, forwardRef } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import Redis from 'ioredis';
import { randomUUID } from 'crypto';
import { REDIS_CLIENT } from '../../common/redis/redis.module';
import { RequestContextService } from '../../common/context/request-context.service';
import { AgentTraceService } from '../observability/agent-trace.service';
import { AIEngineService } from '../ai-engine.service';
import { catalogHash, KNOWLEDGE_DIMENSION } from '../tools/tool-catalog';

/** Owner decision 2026-10-19: in-code default, prod maps no extra env var. */
export const AI_KNOWLEDGE_DAILY_TOKEN_BUDGET_DEFAULT = 2_000_000;

/** `openai/text-embedding-3-small` (OpenRouter) ≡ `text-embedding-3-small`. */
export function embeddingModelName(model: string | null | undefined): string {
  return (model ?? '').trim().split('/').pop() ?? '';
}

export function assertKnowledgeVector(vector: number[]): void {
  if (
    !Array.isArray(vector) ||
    vector.length !== KNOWLEDGE_DIMENSION ||
    vector.some((v) => !Number.isFinite(v)) ||
    !vector.some((v) => v !== 0)
  ) {
    throw new Error('KNOWLEDGE_VECTOR_INCOMPATIBLE');
  }
}

/** Platform spend reservation, NOT a merchant successful-tool/product quota.
 * Conservative input-byte upper bound is reserved even on failure (it may have cost money).
 * No SDK fallback, no synthetic tenant=0 and no unmetered provider invocation.
 */
@Injectable()
export class KnowledgeEmbeddingService {
  constructor(
    private readonly config: ConfigService,
    @Inject(forwardRef(() => AIEngineService))
    private readonly engine: AIEngineService,
    @Inject(REDIS_CLIENT) private readonly redis: Redis,
    @Optional() private readonly trace?: AgentTraceService,
  ) {}

  private setting(key: string): string | undefined {
    return this.config.get<string>(key) ?? process.env[key];
  }

  async configuration(): Promise<{
    appKey: string;
    model: string;
    fingerprint: string;
  }> {
    const appKey =
      this.setting('AI_KNOWLEDGE_EMBEDDING_APP_KEY')?.trim() ||
      'agent_knowledge_embeddings';
    if (
      appKey === 'product_embeddings' ||
      appKey === this.setting('EMBEDDING_APP_KEY')?.trim()
    )
      throw new Error('KNOWLEDGE_APP_MUST_BE_SEPARATE');
    const app = await this.engine.getApplication(appKey);
    const model =
      this.setting('AI_KNOWLEDGE_EMBEDDING_MODEL')?.trim() ||
      'text-embedding-3-small';
    // Explicit config is mandatory; never silently follow the text default provider.
    if (
      !app.is_active ||
      app.ai_feature_category !== 'rag_embeddings' ||
      !app.config?.id ||
      embeddingModelName(app.config.model_id) !== embeddingModelName(model) ||
      app.model_type !== 'embedding'
    ) {
      throw new Error('KNOWLEDGE_APP_INCOMPATIBLE');
    }
    return {
      appKey,
      model,
      fingerprint: catalogHash([
        appKey,
        app.config.id,
        app.config.provider,
        model,
        KNOWLEDGE_DIMENSION,
      ]),
    };
  }

  async generate(
    text: string,
    expectedFingerprint?: string,
  ): Promise<{ vector: number[]; fingerprint: string }> {
    const config = await this.configuration();
    if (expectedFingerprint && expectedFingerprint !== config.fingerprint)
      throw new Error('KNOWLEDGE_FINGERPRINT_CHANGED');
    const budget = Number(
      this.setting('AI_KNOWLEDGE_DAILY_TOKEN_BUDGET')?.trim() ||
        AI_KNOWLEDGE_DAILY_TOKEN_BUDGET_DEFAULT,
    );
    if (!Number.isSafeInteger(budget) || budget <= 0)
      throw new Error('KNOWLEDGE_BUDGET_UNAVAILABLE');
    const input = text.slice(0, 8000);
    const units = Math.max(1, Buffer.byteLength(input, 'utf8'));
    // Shared UTC spend ceiling across workers/retries; no PII in Redis keys.
    const day = new Date().toISOString().slice(0, 10).replace(/-/g, '');
    const allowed = await this.redis.eval(
      `
      local used = tonumber(redis.call('GET', KEYS[1]) or '0')
      if used + tonumber(ARGV[1]) > tonumber(ARGV[2]) then return 0 end
      redis.call('INCRBY', KEYS[1], ARGV[1]); redis.call('EXPIRE', KEYS[1], 172800)
      return 1`,
      1,
      `ai:knowledge:spend-reservation:${config.fingerprint}:${day}`,
      units,
      budget,
    );
    if (Number(allowed) !== 1) throw new Error('KNOWLEDGE_BUDGET_EXHAUSTED');
    const requestId = `platform-knowledge-${randomUUID()}`;
    const root = this.trace?.startTrace({
      kind: 'system',
      system_purpose: 'platform_knowledge',
      request_id: requestId,
    });
    let response: Awaited<ReturnType<AIEngineService['runEmbedding']>>;
    try {
      response = await RequestContextService.runIsolated(
        {
          is_super_admin: false,
          is_owner: false,
          request_id: requestId,
        },
        () =>
          this.trace
            ? this.trace.run(root, () =>
                this.engine.runEmbedding(config.appKey, undefined, input),
              )
            : this.engine.runEmbedding(config.appKey, undefined, input),
      );
      if (
        !response.success ||
        !response.embedding ||
        embeddingModelName(response.model) !== embeddingModelName(config.model)
      )
        throw new Error('KNOWLEDGE_EMBEDDING_FAILED');
      assertKnowledgeVector(response.embedding);
      // A config change while in flight must not insert under the old fingerprint.
      if ((await this.configuration()).fingerprint !== config.fingerprint)
        throw new Error('KNOWLEDGE_FINGERPRINT_CHANGED');
      if (root) this.trace?.finishTrace(root, 'partial');
      return { vector: response.embedding, fingerprint: config.fingerprint };
    } catch (error) {
      if (root)
        this.trace?.finishTrace(root, 'failed', {
          status: 'error',
          error_code: 'KNOWLEDGE_EMBEDDING_FAILED',
        });
      throw error;
    }
  }
}
