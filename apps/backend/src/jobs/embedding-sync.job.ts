import { Injectable, Logger } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import { InjectQueue } from '@nestjs/bullmq';
import { Queue } from 'bullmq';
import { GlobalPrismaService } from '../prisma/services/global-prisma.service';

@Injectable()
export class EmbeddingSyncJob {
  private readonly logger = new Logger(EmbeddingSyncJob.name);
  private isRunning = false;

  constructor(
    private readonly prisma: GlobalPrismaService,
    @InjectQueue('ai-embedding') private readonly embeddingQueue: Queue,
  ) {}

  @Cron('0 2 * * *') // Daily at 2 AM
  async syncEmbeddings(): Promise<void> {
    if (this.isRunning) {
      this.logger.warn('Embedding sync already running, skipping');
      return;
    }

    this.isRunning = true;
    this.logger.log('Starting daily embedding sync');

    try {
      // Find products without embeddings
      const productsWithoutEmbeddings = await this.prisma.$queryRawUnsafe<
        Array<{
          id: number;
          store_id: number;
          organization_id: number;
          name: string;
          description: string | null;
        }>
      >(`
        SELECT p.id, p.store_id, p.organization_id, p.name, p.description
        FROM products p
        LEFT JOIN ai_embeddings e
          ON e.store_id = p.store_id
          AND e.entity_type = 'product'
          AND e.entity_id = p.id
        WHERE e.id IS NULL
          AND p.is_active = true
        LIMIT 500
      `);

      this.logger.log(
        `Found ${productsWithoutEmbeddings.length} products without embeddings`,
      );

      let enqueued = 0;
      for (const product of productsWithoutEmbeddings) {
        const content = [product.name, product.description || '']
          .filter(Boolean)
          .join('. ');

        await this.embeddingQueue.add(
          'embed',
          {
            store_id: product.store_id,
            organization_id: product.organization_id,
            entity_type: 'product',
            entity_id: product.id,
            content,
          },
          {
            attempts: 2,
            backoff: { type: 'exponential', delay: 3000 },
            removeOnComplete: { count: 500 },
          },
        );
        enqueued++;
      }

      this.logger.log(`Enqueued ${enqueued} embedding jobs`);
    } catch (error: any) {
      this.logger.error(`Embedding sync failed: ${error.message}`);
    } finally {
      this.isRunning = false;
    }
  }
}
