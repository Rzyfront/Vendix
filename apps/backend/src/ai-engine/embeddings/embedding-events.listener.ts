import { Injectable, Logger } from '@nestjs/common';
import { OnEvent } from '@nestjs/event-emitter';
import { InjectQueue } from '@nestjs/bullmq';
import { Queue } from 'bullmq';
import { GlobalPrismaService } from '../../prisma/services/global-prisma.service';

/**
 * The entity kinds `semantic_search` can answer over.
 *
 * Exported because the tool's own `enum` has to match exactly: offering a type
 * nothing indexes makes the model pick it, spend an iteration, and answer "no
 * encontré nada" about a record that exists.
 */
export const EMBEDDABLE_ENTITY_TYPES = [
  'product',
  'customer',
  'order',
  'supplier',
  'expense',
] as const;

/**
 * Help articles are deliberately absent from that list.
 *
 * `ai_embeddings` rows are store-scoped, and the help centre is platform-wide, so
 * indexing it would mean one duplicate vector per article per store to answer a
 * question whose answer is identical everywhere. The articles already have their own
 * keyword search endpoint (`help-center/articles/search?q=`), which the api bridge
 * exposes and the agent is told to use for "how do I" questions.
 */

@Injectable()
export class EmbeddingEventsListener {
  private readonly logger = new Logger(EmbeddingEventsListener.name);

  constructor(
    @InjectQueue('ai-embedding') private readonly embeddingQueue: Queue,
    /**
     * Unscoped by necessity: these listeners fire from every surface — an
     * ecommerce checkout, a POS sale, an admin form — and several of them run
     * after the request's ALS scope is gone. The tenant boundary here is the
     * `store_id` the event carries, which the emitter read off the record itself.
     */
    private readonly prisma: GlobalPrismaService,
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

  /**
   * Customers, indexed by how a shopkeeper would describe them.
   *
   * The record is re-read instead of composed from the event payload: two different
   * emitters fire `customer.created` and neither carries `organization_id`, which the
   * embedding row requires. Reading it here also picks up the phone and the document
   * number, which is what makes "el cliente que compró con la cédula que termina en
   * 45" findable at all.
   */
  @OnEvent('customer.created')
  async handleCustomerCreated(event: {
    store_id: number;
    customer_id: number;
  }) {
    await this.indexEntity('customer', event.customer_id, event.store_id, async () => {
      const customer = await this.prisma.users.findFirst({
        where: { id: event.customer_id },
        select: {
          first_name: true,
          last_name: true,
          email: true,
          phone: true,
          document_number: true,
          organization_id: true,
        },
      });

      if (!customer) return null;

      return {
        organization_id: customer.organization_id ?? undefined,
        content: [
          `${customer.first_name ?? ''} ${customer.last_name ?? ''}`.trim(),
          customer.email ?? '',
          customer.phone ?? '',
          customer.document_number ? `Documento ${customer.document_number}` : '',
        ]
          .filter(Boolean)
          .join('. '),
      };
    });
  }

  /**
   * Orders, indexed by what was bought and by whom.
   *
   * The line items are what make an order semantically findable — "el pedido de las
   * tres cajas de gaseosa" matches nothing if only the order number is indexed. Capped
   * at ten lines because a wholesale order can carry hundreds and the tail adds no
   * discriminating power.
   */
  @OnEvent('order.created')
  async handleOrderCreated(event: { store_id: number; order_id: number }) {
    await this.indexEntity('order', event.order_id, event.store_id, async () => {
      const order = await this.prisma.orders.findFirst({
        where: { id: event.order_id },
        select: {
          order_number: true,
          grand_total: true,
          // `orders` carries no `organization_id` of its own, so it comes from the
          // store it belongs to. The embedding row requires it, and inferring it
          // from the request context would be wrong here: this handler can run
          // after the request that created the order is gone.
          stores: { select: { organization_id: true } },
          users: { select: { first_name: true, last_name: true } },
          order_items: {
            take: 10,
            select: { product_name: true, quantity: true },
          },
        },
      });

      if (!order) return null;

      const items = order.order_items
        .map((item) => `${item.quantity} x ${item.product_name}`)
        .join(', ');

      const customer = order.users
        ? `${order.users.first_name ?? ''} ${order.users.last_name ?? ''}`.trim()
        : '';

      return {
        organization_id: order.stores?.organization_id ?? undefined,
        content: [
          `Orden ${order.order_number}`,
          customer ? `Cliente ${customer}` : '',
          items,
          `Total ${order.grand_total}`,
        ]
          .filter(Boolean)
          .join('. '),
      };
    });
  }

  /**
   * Expenses, indexed at approval rather than at creation.
   *
   * A draft expense is not yet a fact about the business, and indexing it would make
   * "¿cuánto llevo en arriendo?" match things that were never approved. `expense.paid`
   * re-indexes the same id, which the upsert collapses into one row.
   */
  @OnEvent('expense.approved')
  @OnEvent('expense.paid')
  async handleExpenseSettled(event: { store_id: number; expense_id: number }) {
    await this.indexEntity('expense', event.expense_id, event.store_id, async () => {
      const expense = await this.prisma.expenses.findFirst({
        where: { id: event.expense_id },
        select: {
          description: true,
          amount: true,
          organization_id: true,
          notes: true,
          expense_categories: { select: { name: true } },
        },
      });

      if (!expense) return null;

      return {
        organization_id: expense.organization_id,
        content: [
          expense.description ?? 'Gasto',
          expense.expense_categories?.name
            ? `Categoría ${expense.expense_categories.name}`
            : '',
          expense.notes ?? '',
          `Monto ${expense.amount}`,
        ]
          .filter(Boolean)
          .join('. '),
      };
    });
  }

  /**
   * Suppliers, indexed by what they sell and how to reach them.
   *
   * Only store-scoped suppliers arrive here — the emitter withholds the
   * organization-wide ones, which have no single store an embedding row could
   * belong to. The backfill fans those across the organization's stores.
   */
  @OnEvent('supplier.created')
  async handleSupplierCreated(event: {
    store_id: number;
    supplier_id: number;
  }) {
    await this.indexEntity(
      'supplier',
      event.supplier_id,
      event.store_id,
      async () => {
        const supplier = await this.prisma.suppliers.findFirst({
          where: { id: event.supplier_id },
          select: {
            name: true,
            organization_id: true,
            contact_person: true,
            email: true,
            phone: true,
            tax_id: true,
            notes: true,
          },
        });

        if (!supplier) return null;

        return {
          organization_id: supplier.organization_id,
          content: [
            supplier.name,
            supplier.contact_person ?? '',
            supplier.email ?? '',
            supplier.phone ?? '',
            supplier.tax_id ? `NIT ${supplier.tax_id}` : '',
            supplier.notes ?? '',
          ]
            .filter(Boolean)
            .join('. '),
        };
      },
    );
  }

  /**
   * Loads the record, composes its searchable text and queues one embedding.
   *
   * The loader returns `null` for a record that vanished between the event and this
   * handler, which happens legitimately inside rolled-back transactions. Skipping
   * silently is right: there is nothing to index and nothing went wrong.
   */
  private async indexEntity(
    entityType: string,
    entityId: number,
    storeId: number,
    load: () => Promise<{
      organization_id?: number;
      content: string;
    } | null>,
  ): Promise<void> {
    try {
      const loaded = await load();
      if (!loaded?.content?.trim() || !loaded.organization_id) return;

      await this.enqueueEmbedding(
        {
          store_id: storeId,
          organization_id: loaded.organization_id,
          name: loaded.content,
        },
        entityType,
        entityId,
      );
    } catch (error: any) {
      // Indexing is an enrichment, never a precondition of the write that
      // triggered it. A failure here must not surface to the person who just
      // saved a customer.
      this.logger.warn(
        `Could not index ${entityType}:${entityId} — ${error?.message}`,
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
