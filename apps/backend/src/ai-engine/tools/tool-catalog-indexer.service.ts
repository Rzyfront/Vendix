import {
  Injectable,
  Logger,
  OnApplicationBootstrap,
  Optional,
} from '@nestjs/common';
import { InjectQueue } from '@nestjs/bullmq';
import { Queue } from 'bullmq';
import { Prisma } from '@prisma/client';
import { GlobalPrismaService } from '../../prisma/services/global-prisma.service';
import { EmbeddingService } from '../embeddings/embedding.service';
import { KnowledgeEmbeddingService } from '../embeddings/knowledge-embedding.service';
import { AIKnowledgeIndexJob } from '../queue/interfaces/ai-queue.interface';
import { PlaybookLoaderService } from '../playbooks/playbook-loader.service';
import { PlaybookService } from '../playbooks/playbook.service';
import { AIToolRegistry } from './ai-tool-registry';
import {
  buildToolManifest,
  catalogHash,
  knowledgeIndexEnabled,
  ToolCatalogManifest,
} from './tool-catalog';

@Injectable()
export class ToolCatalogIndexerService implements OnApplicationBootstrap {
  private readonly logger = new Logger(ToolCatalogIndexerService.name);
  private bootstrapped = false;
  constructor(
    private readonly registry: AIToolRegistry,
    private readonly prisma: GlobalPrismaService,
    private readonly embeddings: EmbeddingService,
    private readonly knowledgeEmbeddings: KnowledgeEmbeddingService,
    @InjectQueue('ai-embedding') private readonly queue: Queue,
    @Optional() private readonly playbooks?: PlaybookService,
    @Optional() private readonly playbookLoader?: PlaybookLoaderService,
  ) {}

  getReleaseManifest(): ToolCatalogManifest {
    const tools = buildToolManifest(this.registry);
    const processes = this.playbooks?.getKnowledgeManifest().documents ?? [];
    if (!processes.length) return tools; // OFF manifest remains byte-for-byte B.
    const documents = [...tools.documents, ...processes].sort((a, b) =>
      a.key.localeCompare(b.key),
    );
    return {
      hash: catalogHash(documents.map((d) => [d.key, d.hash])),
      documents,
    };
  }
  isBootstrapped(): boolean {
    return this.bootstrapped;
  }

  async onApplicationBootstrap(): Promise<void> {
    // All decentralized onModuleInit factories have registered BEFORE this hook.
    await this.playbookLoader?.initializeRelease();
    this.bootstrapped = true;
    if (!knowledgeIndexEnabled()) return;
    try {
      await this.enqueueSnapshot();
    } catch {
      this.logger.warn(
        'Tool knowledge index unavailable; authorized local lexical fallback remains active.',
      );
    }
  }

  async enqueueSnapshot(): Promise<void> {
    if (!knowledgeIndexEnabled() || !this.bootstrapped) return;
    const manifest = this.getReleaseManifest();
    // Complete snapshot, including aliases/versions. Never infer retirement from a batch.
    for (const type of ['tool', 'process'] as const) {
      // When C is OFF do not retire its historical process docs on B rollback.
      if (
        type === 'process' &&
        !manifest.documents.some((d) => d.metadata.entity_type === type)
      )
        continue;
      await this.prisma.ai_knowledge_documents.updateMany({
        where: {
          knowledge_scope: 'global',
          entity_type: type,
          canonical_name: {
            notIn: manifest.documents
              .filter((d) => (d.metadata.entity_type ?? 'tool') === type)
              .map((d) => d.name),
          },
          store_id: null,
          organization_id: null,
          status: { not: 'retired' },
        },
        data: { active: false, status: 'retired', updated_at: new Date() },
      });
    }
    for (let offset = 0; offset < manifest.documents.length; offset += 50) {
      const documents = manifest.documents
        .slice(offset, offset + 50)
        .map((d) => ({ key: d.key, hash: d.hash }));
      await this.queue.add(
        'index-knowledge',
        {
          release_hash: manifest.hash,
          documents,
        } satisfies AIKnowledgeIndexJob,
        {
          jobId: `knowledge-${catalogHash([manifest.hash, offset])}`,
          attempts: 2,
          backoff: { type: 'exponential', delay: 3000 },
          removeOnComplete: true,
          removeOnFail: { count: 50 },
        },
      );
    }
  }

  async indexBatch(job: AIKnowledgeIndexJob): Promise<void> {
    if (!knowledgeIndexEnabled()) return;
    // Reject payload drift/old workers. Job content is reconstructed from release code,
    // not trusted Redis strings or a fabricated store-0 request context.
    if (!this.bootstrapped) throw new Error('KNOWLEDGE_BOOT_BARRIER');
    const manifest = this.getReleaseManifest();
    if (
      manifest.hash !== job.release_hash ||
      !Array.isArray(job.documents) ||
      job.documents.length > 50
    )
      throw new Error('STALE_KNOWLEDGE_RELEASE');
    const selected = job.documents.map((entry) => {
      const document = manifest.documents.find(
        (d) => d.key === entry.key && d.hash === entry.hash,
      );
      if (!document) throw new Error('INVALID_KNOWLEDGE_JOB');
      return document;
    });
    const configuration = await this.knowledgeEmbeddings.configuration();
    for (const doc of selected) {
      const type = doc.metadata.entity_type === 'process' ? 'process' : 'tool';
      const old = await this.prisma.ai_knowledge_documents.findUnique({
        where: { document_key: doc.key },
      });
      if (
        old?.active &&
        old.status === 'ready' &&
        old.content_hash === doc.hash &&
        old.indexed_hash === doc.hash &&
        old.embedding_fingerprint === configuration.fingerprint
      )
        continue;
      const data = {
        entity_type: type,
        knowledge_scope: 'global',
        store_id: null,
        organization_id: null,
        canonical_name: doc.name,
        version: doc.version,
        content: doc.content,
        lexical_text: doc.lexicalText,
        metadata: doc.metadata as Prisma.InputJsonObject,
        content_hash: doc.hash,
        release_hash: manifest.hash,
        status: 'pending',
        active: false,
        error_code: null,
        updated_at: new Date(),
      };
      const saved = await this.prisma.ai_knowledge_documents.upsert({
        where: { document_key: doc.key },
        create: { document_key: doc.key, ...data },
        update: data,
      });
      try {
        await this.embeddings.storeGlobalKnowledgeEmbedding({
          documentId: saved.id,
          type,
          content: doc.content,
          hash: doc.hash,
          fingerprint: configuration.fingerprint,
        });
        // CAS: never mark a newer candidate ready with an older embedding.
        await this.prisma.ai_knowledge_documents.updateMany({
          where: {
            id: saved.id,
            content_hash: doc.hash,
            release_hash: manifest.hash,
            knowledge_scope: 'global',
            status: 'pending',
          },
          data: {
            status: 'ready',
            active: true,
            indexed_hash: doc.hash,
            embedding_fingerprint: configuration.fingerprint,
            updated_at: new Date(),
          },
        });
        // Retire older versions only AFTER this version is ready; no deletion.
        await this.prisma.ai_knowledge_documents.updateMany({
          where: {
            canonical_name: doc.name,
            entity_type: type,
            knowledge_scope: 'global',
            id: { not: saved.id },
            version: { not: doc.version },
          },
          data: { status: 'retired', active: false, updated_at: new Date() },
        });
      } catch {
        await this.prisma.ai_knowledge_documents.updateMany({
          where: {
            id: saved.id,
            content_hash: doc.hash,
            release_hash: manifest.hash,
          },
          data: {
            status: 'error',
            active: false,
            error_code: 'KNOWLEDGE_INDEX_FAILED',
            updated_at: new Date(),
          },
        });
        throw new Error('KNOWLEDGE_INDEX_FAILED');
      }
    }
  }
}
