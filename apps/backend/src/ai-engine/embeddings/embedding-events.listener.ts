import { Injectable, Logger } from '@nestjs/common';
import { OnEvent } from '@nestjs/event-emitter';
import { InjectQueue } from '@nestjs/bullmq';
import { Queue } from 'bullmq';

@Injectable()
export class EmbeddingEventsListener {
  private readonly logger = new Logger(EmbeddingEventsListener.name);

  constructor(
    @InjectQueue('ai-embedding') private readonly embeddingQueue: Queue,
  ) {}

  @OnEvent('product.created')
  async handleProductCreated(event: {
    store_id: number;
    organization_id: number;
    product_id: number;
    name: string;
    description?: string;
    category?: string;
  }) {
    await this.enqueueEmbedding(event, 'product', event.product_id);
  }

  @OnEvent('product.updated')
  async handleProductUpdated(event: {
    store_id: number;
    organization_id: number;
    product_id: number;
    name: string;
    description?: string;
    category?: string;
  }) {
    await this.enqueueEmbedding(event, 'product', event.product_id);
  }

  @OnEvent('product.deleted')
  async handleProductDeleted(event: { store_id: number; product_id: number }) {
    try {
      await this.embeddingQueue.add(
        'delete-embedding',
        {
          store_id: event.store_id,
          entity_type: 'product',
          entity_id: event.product_id,
        },
        { removeOnComplete: { count: 100 } },
      );
    } catch (error: any) {
      this.logger.error(
        `Failed to enqueue embedding deletion: ${error.message}`,
      );
    }
  }

  private async enqueueEmbedding(
    event: {
      store_id: number;
      organization_id: number;
      name: string;
      description?: string;
      category?: string;
    },
    entityType: string,
    entityId: number,
  ): Promise<void> {
    const content = [
      event.name,
      event.description || '',
      event.category ? `Category: ${event.category}` : '',
    ]
      .filter(Boolean)
      .join('. ');

    try {
      await this.embeddingQueue.add(
        'embed',
        {
          store_id: event.store_id,
          organization_id: event.organization_id,
          entity_type: entityType,
          entity_id: entityId,
          content,
        },
        {
          attempts: 2,
          backoff: { type: 'exponential', delay: 3000 },
          removeOnComplete: { count: 500 },
          removeOnFail: { count: 100 },
        },
      );
      this.logger.log(`Enqueued embedding for ${entityType}:${entityId}`);
    } catch (error: any) {
      this.logger.error(`Failed to enqueue embedding: ${error.message}`);
    }
  }
}
