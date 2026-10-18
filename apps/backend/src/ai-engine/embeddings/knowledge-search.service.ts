import { proceduralMemoryEnabled } from '../memory/recipe.interface';
import { requireObjectiveScope } from '../tasks/agent-objective.repository';
import { playbooksEnabled } from '../playbooks/playbook-flags';
import { Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { normalizeSearchText } from '../../common/utils/search-text.util';
import { GlobalPrismaService } from '../../prisma/services/global-prisma.service';
import {
  catalogHash,
  knowledgeIndexEnabled,
  localToolRanking,
  reciprocalRankFusion,
  ToolDocument,
} from '../tools/tool-catalog';
import {
  KnowledgeEmbeddingService,
  assertKnowledgeVector,
} from './knowledge-embedding.service';

interface CachedRanking {
  expires: number;
  names: string[];
  degraded: string[];
}
interface ReadyDocument {
  id: number;
  document_key: string;
  content_hash: string;
  indexed_hash: string | null;
  embedding_fingerprint: string | null;
}
export interface KnowledgeRanking {
  names: string[];
  degraded: string[];
  cacheHit: boolean;
}

/** This API only retrieves platform documentation, NEVER business embeddings. */
@Injectable()
export class KnowledgeSearchService {
  private readonly cache = new Map<string, CachedRanking>();
  constructor(
    private readonly prisma: GlobalPrismaService,
    private readonly embeddings: KnowledgeEmbeddingService,
  ) {}

  async rank(
    query: string,
    documents: ToolDocument[],
    scopeSignature: string,
    domain?: string,
    type: 'tool' | 'process' | 'recipe' = 'tool',
  ): Promise<KnowledgeRanking> {
    if (type !== 'tool' && type !== 'process' && type !== 'recipe')
      throw new Error('INVALID_KNOWLEDGE_TYPE');
    if (type === 'recipe' && !proceduralMemoryEnabled())
      return { names: [], degraded: ['recipes_disabled'], cacheHit: false };
    if (type === 'process' && !playbooksEnabled())
      return { names: [], degraded: ['playbooks_disabled'], cacheHit: false };
    documents = documents.filter(
      (d) => (d.metadata.entity_type ?? 'tool') === type,
    );
    const boundedQuery = query.slice(0, 500);
    const local = localToolRanking(boundedQuery, documents, domain);
    if (!documents.length || !knowledgeIndexEnabled())
      return { names: local, degraded: ['index_disabled'], cacheHit: false };
    const normalizedQuery = normalizeSearchText(boundedQuery);
    if (
      documents.some((d) =>
        [d.name, ...d.aliases].some(
          (n) => normalizeSearchText(n) === normalizedQuery,
        ),
      )
    ) {
      return { names: local, degraded: [], cacheHit: false }; // exact-name fast path: zero provider calls
    }
    let fingerprint = 'unavailable';
    try {
      fingerprint = (await this.embeddings.configuration()).fingerprint;
    } catch {
      /* PostgreSQL lexical still works without a provider/app. */
    }
    const key = catalogHash([
      boundedQuery,
      domain,
      type,
      documents.map((d) => [d.key, d.hash]),
      fingerprint,
      scopeSignature,
    ]);
    const cached = this.cache.get(key);
    const authorized = new Set(documents.map((d) => d.name));
    if (cached && cached.expires > Date.now())
      return {
        names: cached.names.filter((name) => authorized.has(name)),
        degraded: cached.degraded,
        cacheHit: true,
      };
    const degraded: string[] = [];
    const rankings = [local];
    try {
      const ready = await this.readyDocuments(documents, type);
      const byKey = new Map(documents.map((d) => [d.key, d]));
      // Recheck release hash/version/embedding fingerprint before including ANY DB ID.
      const valid = ready.filter(
        (d) =>
          d.content_hash === byKey.get(d.document_key)?.hash &&
          d.indexed_hash === d.content_hash,
      );
      const namesById = new Map(
        valid.map((d) => [d.id, byKey.get(d.document_key)!.name]),
      );
      const ids = [...namesById.keys()];
      if (!ids.length) degraded.push('index_not_ready');
      else {
        const lexical = await this.queryIds(
          `
          SELECT id FROM ai_knowledge_documents WHERE knowledge_scope = 'global'
            AND store_id IS NULL AND organization_id IS NULL AND entity_type = $3
            AND active = true AND status = 'ready' AND id = ANY($1::int[])
            AND search_vector @@ plainto_tsquery('spanish', $2)
          ORDER BY ts_rank_cd(search_vector, plainto_tsquery('spanish', $2)) DESC, id LIMIT 100`,
          ids,
          normalizedQuery,
          type,
        );
        rankings.push(lexical.map((id) => namesById.get(id)!).filter(Boolean));
        const vectorIds = valid
          .filter((d) => d.embedding_fingerprint === fingerprint)
          .map((d) => d.id);
        if (fingerprint !== 'unavailable' && vectorIds.length) {
          try {
            const embedding = await this.embeddings.generate(
              boundedQuery,
              fingerprint,
            );
            assertKnowledgeVector(embedding.vector);
            const vector = await this.queryIds(
              `
              SELECT d.id FROM ai_knowledge_documents d JOIN ai_embeddings e
                ON e.entity_id = d.id AND e.entity_type = d.entity_type
              WHERE d.knowledge_scope = 'global' AND d.store_id IS NULL AND d.organization_id IS NULL
                AND d.entity_type = $4 AND d.active = true AND d.status = 'ready' AND d.id = ANY($1::int[])
                AND e.knowledge_scope = 'global' AND e.store_id = 0 AND e.organization_id = 0
                AND d.embedding_fingerprint = $3 AND e.metadata->>'fingerprint' = $3
                AND e.metadata->>'content_hash' = d.content_hash AND d.indexed_hash = d.content_hash
                AND e.embedding IS NOT NULL ORDER BY e.embedding <=> $2::vector, d.id LIMIT 100`,
              vectorIds,
              `[${embedding.vector.join(',')}]`,
              fingerprint,
              type,
            );
            rankings.push(
              vector.map((id) => namesById.get(id)!).filter(Boolean),
            );
          } catch {
            degraded.push('vector_unavailable');
          }
        } else degraded.push('vector_unavailable');
      }
    } catch {
      degraded.push('index_unavailable');
    }
    // Exact canonical/alias/domain matches always precede RRF (including lexical-only fallback).
    const exact = local.filter((name) => {
      const doc = documents.find((d) => d.name === name)!;
      return [doc.name, ...doc.aliases, doc.domain].some(
        (value) => normalizeSearchText(value) === normalizedQuery,
      );
    });
    const names = [
      ...new Set([...exact, ...reciprocalRankFusion(rankings)]),
    ].filter((name) => authorized.has(name));
    if (this.cache.size >= 256)
      this.cache.delete(this.cache.keys().next().value!);
    // Cache degradations too: one intention embedding per material query, NOT per round.
    this.cache.set(key, { names, degraded, expires: Date.now() + 300000 });
    return { names, degraded, cacheHit: false };
  }

  /** Private procedural namespace: explicit owner/org/store; never semantic_search or global sentinel. */
  async rankPrivateRecipes(query: string, ids: number[]): Promise<number[]> {
    if (!proceduralMemoryEnabled() || !knowledgeIndexEnabled() || !ids.length)
      return [];
    const scope = requireObjectiveScope();
    if (
      ids.length > 100 ||
      ids.some((id) => !Number.isSafeInteger(id) || id <= 0)
    )
      throw new Error('RECIPE_SEARCH_IDS');
    const base = `r.knowledge_scope='store' AND r.store_id=$1 AND r.organization_id=$2 AND r.user_id=$3
      AND r.id=ANY($4::int[]) AND r.status='approved' AND r.expires_at>NOW()
      AND e.knowledge_scope='store' AND e.store_id=$1 AND e.organization_id=$2 AND e.entity_type='recipe'
      AND e.metadata->>'owner_user_id'=$3::text AND e.metadata->>'content_hash'=r.content_hash`;
    const lexical = await this.queryIds(
      `SELECT r.id FROM ai_agent_recipes r JOIN ai_embeddings e ON e.entity_id=r.id
      WHERE ${base} AND to_tsvector('spanish',e.content) @@ plainto_tsquery('spanish',$5)
      ORDER BY ts_rank_cd(to_tsvector('spanish',e.content),plainto_tsquery('spanish',$5)) DESC,r.id LIMIT 100`,
      scope.store_id,
      scope.organization_id,
      scope.user_id,
      ids,
      query.slice(0, 500),
    );
    try {
      const config = await this.embeddings.configuration(),
        generated = await this.embeddings.generate(
          query.slice(0, 500),
          config.fingerprint,
        );
      assertKnowledgeVector(generated.vector);
      if (!proceduralMemoryEnabled()) return [];
      const vector = await this.queryIds(
        `SELECT r.id FROM ai_agent_recipes r JOIN ai_embeddings e ON e.entity_id=r.id
        WHERE ${base} AND e.metadata->>'fingerprint'=$6 AND e.embedding IS NOT NULL ORDER BY e.embedding <=> $5::vector,r.id LIMIT 100`,
        scope.store_id,
        scope.organization_id,
        scope.user_id,
        ids,
        `[${generated.vector.join(',')}]`,
        config.fingerprint,
      );
      return [...new Set([...lexical, ...vector])];
    } catch {
      return lexical;
    }
  }

  private readyDocuments(
    documents: ToolDocument[],
    type: 'tool' | 'process' | 'recipe',
  ): Promise<ReadyDocument[]> {
    return this.prisma.$transaction(
      async (tx: Prisma.TransactionClient) => {
        await tx.$executeRawUnsafe(`SET LOCAL statement_timeout = '150ms'`);
        return tx.$queryRawUnsafe<ReadyDocument[]>(
          `
        SELECT id, document_key, content_hash, indexed_hash, embedding_fingerprint FROM ai_knowledge_documents
        WHERE knowledge_scope = 'global' AND store_id IS NULL AND organization_id IS NULL
          AND entity_type = $2 AND active = true AND status = 'ready' AND document_key = ANY($1::text[])
        ORDER BY id LIMIT 1000`,
          documents.map((d) => d.key),
          type,
        );
      },
      { timeout: 500, maxWait: 150 },
    );
  }

  private async queryIds(sql: string, ...params: unknown[]): Promise<number[]> {
    return this.prisma.$transaction(
      async (tx: Prisma.TransactionClient) => {
        await tx.$executeRawUnsafe(`SET LOCAL statement_timeout = '150ms'`);
        const rows = await tx.$queryRawUnsafe<Array<{ id: number }>>(
          sql,
          ...params,
        );
        return rows.map((row) => row.id);
      },
      { timeout: 500, maxWait: 150 },
    );
  }
}
