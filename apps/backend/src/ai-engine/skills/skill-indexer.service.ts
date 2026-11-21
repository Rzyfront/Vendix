import {
  Injectable,
  Logger,
  OnApplicationBootstrap,
} from '@nestjs/common';
import { OnEvent } from '@nestjs/event-emitter';
import { Prisma } from '@prisma/client';
import { GlobalPrismaService } from '../../prisma/services/global-prisma.service';
import { EmbeddingService } from '../embeddings/embedding.service';
import { KnowledgeEmbeddingService } from '../embeddings/knowledge-embedding.service';
import { buildSkillDocument, skillDocumentKey } from './skill-document';
import {
  SKILL_ARCHIVED_EVENT,
  SKILL_PUBLISHED_EVENT,
  SkillEventPayload,
} from './skill.events';
import { SkillRepository } from './skill.repository';
import { MANAGED_RELEASE_HASH } from './skill.types';

/**
 * Keeps the global knowledge index in step with published skills. Skills are
 * MANAGED documents (`release_hash = 'managed'`): editable without a deploy,
 * and never retired by the release tool-catalog indexer.
 *
 * - publish → upsert `skill:<key>` (lexical first, embedding best effort)
 * - archive → retire (logical, never deleted)
 * - boot    → backfill published skills whose content hash changed
 */
@Injectable()
export class SkillIndexerService implements OnApplicationBootstrap {
  private readonly logger = new Logger(SkillIndexerService.name);

  constructor(
    private readonly repository: SkillRepository,
    private readonly prisma: GlobalPrismaService,
    private readonly embeddings: EmbeddingService,
    private readonly knowledgeEmbeddings: KnowledgeEmbeddingService,
  ) {}

  onApplicationBootstrap(): void {
    // Never hold the boot on a provider call; the index heals on the next boot.
    void this.backfill().catch(() =>
      this.logger.warn('Skill index backfill failed; lexical index unchanged.'),
    );
  }

  @OnEvent(SKILL_PUBLISHED_EVENT, { async: true, promisify: true })
  async onPublished(payload: SkillEventPayload): Promise<void> {
    try {
      await this.indexSkill(payload.skill_id);
    } catch {
      this.logger.warn(`Skill ${payload.key} could not be indexed.`);
    }
  }

  @OnEvent(SKILL_ARCHIVED_EVENT, { async: true, promisify: true })
  async onArchived(payload: SkillEventPayload): Promise<void> {
    try {
      await this.retire(payload.key);
    } catch {
      this.logger.warn(`Skill ${payload.key} could not be retired.`);
    }
  }

  /** Index the PUBLISHED version of a skill; retires the document when it is not published. */
  async indexSkill(skillId: number): Promise<boolean> {
    const published = await this.repository.findPublishedById(skillId);
    if (!published) {
      const skill = await this.repository.findById(skillId);
      if (skill) await this.retire(skill.key);
      return false;
    }
    const doc = buildSkillDocument(published);
    const configuration = await this.knowledgeEmbeddings
      .configuration()
      .catch(() => null);
    const data = {
      entity_type: 'skill',
      knowledge_scope: 'global',
      store_id: null,
      organization_id: null,
      canonical_name: doc.name,
      version: doc.version,
      content: doc.content,
      lexical_text: doc.lexicalText,
      metadata: doc.metadata as Prisma.InputJsonObject,
      content_hash: doc.hash,
      release_hash: MANAGED_RELEASE_HASH,
      status: 'ready',
      active: true,
      indexed_hash: doc.hash,
      embedding_fingerprint: null,
      error_code: null,
      updated_at: new Date(),
    };
    const saved = await this.prisma.ai_knowledge_documents.upsert({
      where: { document_key: doc.key },
      create: { document_key: doc.key, ...data },
      update: data,
    });
    if (!configuration) return true; // lexical index is usable without a provider
    try {
      await this.embeddings.storeGlobalKnowledgeEmbedding({
        documentId: saved.id,
        type: 'skill',
        content: doc.content,
        hash: doc.hash,
        fingerprint: configuration.fingerprint,
      });
      // CAS: never mark a newer version with an older embedding.
      await this.prisma.ai_knowledge_documents.updateMany({
        where: {
          id: saved.id,
          content_hash: doc.hash,
          release_hash: MANAGED_RELEASE_HASH,
          knowledge_scope: 'global',
          status: 'ready',
        },
        data: {
          embedding_fingerprint: configuration.fingerprint,
          updated_at: new Date(),
        },
      });
    } catch {
      await this.prisma.ai_knowledge_documents.updateMany({
        where: {
          id: saved.id,
          content_hash: doc.hash,
          release_hash: MANAGED_RELEASE_HASH,
        },
        data: { error_code: 'KNOWLEDGE_INDEX_FAILED', updated_at: new Date() },
      });
    }
    return true;
  }

  async retire(key: string): Promise<void> {
    await this.prisma.ai_knowledge_documents.updateMany({
      where: {
        document_key: skillDocumentKey(key),
        entity_type: 'skill',
        knowledge_scope: 'global',
        release_hash: MANAGED_RELEASE_HASH,
      },
      data: { active: false, status: 'retired', updated_at: new Date() },
    });
  }

  /**
   * Boot heal: (re)index every published skill whose document is missing, stale
   * (content hash) or embedded with another model, and retire documents of
   * skills that are no longer published.
   */
  async backfill(): Promise<{ indexed: number; retired: number }> {
    const published = await this.repository.listPublished();
    const fingerprint = (
      await this.knowledgeEmbeddings.configuration().catch(() => null)
    )?.fingerprint;
    let indexed = 0;
    for (const skill of published) {
      const doc = buildSkillDocument(skill);
      const row = await this.prisma.ai_knowledge_documents.findUnique({
        where: { document_key: doc.key },
      });
      const current =
        !!row &&
        row.active &&
        row.status === 'ready' &&
        row.content_hash === doc.hash &&
        row.indexed_hash === doc.hash &&
        (!fingerprint || row.embedding_fingerprint === fingerprint);
      if (current) continue;
      if (await this.indexSkill(skill.skill_id)) indexed++;
    }
    const live = new Set(published.map((s) => skillDocumentKey(s.key)));
    const stale = (await this.prisma.ai_knowledge_documents.findMany({
      where: {
        entity_type: 'skill',
        knowledge_scope: 'global',
        release_hash: MANAGED_RELEASE_HASH,
        active: true,
      },
      select: { document_key: true, canonical_name: true },
    })) as Array<{ document_key: string; canonical_name: string }>;
    let retired = 0;
    for (const row of stale)
      if (!live.has(row.document_key)) {
        await this.retire(row.canonical_name);
        retired++;
      }
    if (indexed || retired)
      this.logger.log(`Skill index backfill: ${indexed} indexed, ${retired} retired`);
    return { indexed, retired };
  }
}
