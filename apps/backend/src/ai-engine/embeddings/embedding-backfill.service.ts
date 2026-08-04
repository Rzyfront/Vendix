import { Injectable, Logger } from '@nestjs/common';
import { InjectQueue } from '@nestjs/bullmq';
import { Queue } from 'bullmq';
import { GlobalPrismaService } from '../../prisma/services/global-prisma.service';
import { RequestContextService } from '@common/context/request-context.service';

/**
 * Per-entity ceiling for one backfill pass.
 *
 * A pass enqueues one embedding job — and therefore one paid provider call — per
 * record, so an unbounded sweep over a large commerce's order history would be an
 * expensive surprise. The newest records are the ones people ask about, and the pass
 * is idempotent, so running it again after a raise costs nothing but the delta.
 */
const PER_ENTITY_LIMIT = 500;

export interface BackfillReport {
  store_id: number;
  enqueued: Record<string, number>;
  total: number;
  note: string;
}

/**
 * Populates the semantic index for records that predate the listeners.
 *
 * Without this, `semantic_search` answers honestly but uselessly on any commerce
 * that existed before the entity was indexed: the listeners only fire on new writes,
 * so a store with three years of history would have an empty index and Vexi would
 * report "no encontré" about its best customer.
 *
 * Safe to run repeatedly. `storeEmbedding` upserts on
 * `(store_id, entity_type, entity_id)`, so a second pass refreshes rather than
 * duplicates — which also makes it the right tool after editing how an entity's
 * searchable text is composed.
 */
@Injectable()
export class EmbeddingBackfillService {
  private readonly logger = new Logger(EmbeddingBackfillService.name);

  constructor(
    @InjectQueue('ai-embedding') private readonly queue: Queue,
    private readonly prisma: GlobalPrismaService,
  ) {}

  /**
   * Sweeps the current store.
   *
   * Reads through `GlobalPrismaService` with an explicit `store_id` predicate rather
   * than the scoped client: several of these tables are scoped relationally and the
   * organization-wide suppliers have to be reached with a deliberately different
   * predicate (`store_id: null`), which a scoped delegate would silently exclude.
   */
  async backfillCurrentStore(): Promise<BackfillReport> {
    const context = RequestContextService.getContext();
    const storeId = context?.store_id;
    const organizationId = context?.organization_id;

    if (!storeId || !organizationId) {
      return {
        store_id: 0,
        enqueued: {},
        total: 0,
        note: 'Sin tienda en contexto: no hay nada que indexar.',
      };
    }

    const enqueued: Record<string, number> = {};

    enqueued.product = await this.indexProducts(storeId, organizationId);
    enqueued.customer = await this.indexCustomers(storeId, organizationId);
    enqueued.order = await this.indexOrders(storeId, organizationId);
    enqueued.supplier = await this.indexSuppliers(storeId, organizationId);
    enqueued.expense = await this.indexExpenses(storeId, organizationId);

    const total = Object.values(enqueued).reduce((sum, n) => sum + n, 0);

    this.logger.log(
      `Embedding backfill for store ${storeId}: ${total} records enqueued (${JSON.stringify(enqueued)})`,
    );

    return {
      store_id: storeId,
      enqueued,
      total,
      note: `Se encolaron ${total} registros. La indexación corre en segundo plano; la búsqueda por significado los irá encontrando a medida que termine. Máximo ${PER_ENTITY_LIMIT} registros por tipo en cada pasada.`,
    };
  }

  private async indexProducts(
    storeId: number,
    organizationId: number,
  ): Promise<number> {
    const products = await this.prisma.products.findMany({
      where: { store_id: storeId, state: { not: 'archived' } },
      orderBy: { id: 'desc' },
      take: PER_ENTITY_LIMIT,
      select: {
        id: true,
        name: true,
        description: true,
        categories: { select: { name: true } },
      },
    });

    return this.enqueueAll(
      storeId,
      organizationId,
      'product',
      products.map((product) => ({
        id: product.id,
        content: [
          product.name,
          product.description ?? '',
          product.categories?.name ? `Categoría ${product.categories.name}` : '',
        ]
          .filter(Boolean)
          .join('. '),
      })),
    );
  }

  /**
   * Customers, reached through the store membership rather than a column.
   *
   * `users` has no `store_id`; a person belongs to a store through `store_users`, and
   * a customer is one with the `customer` role. This is the same predicate the
   * customer tools use (`customers.tools.ts`), and getting it wrong here would index
   * another tenant's people into this store's index.
   */
  private async indexCustomers(
    storeId: number,
    organizationId: number,
  ): Promise<number> {
    const customers = await this.prisma.users.findMany({
      where: {
        store_users: { some: { store_id: storeId } },
        user_roles: { some: { roles: { name: 'customer' } } },
      },
      orderBy: { id: 'desc' },
      take: PER_ENTITY_LIMIT,
      select: {
        id: true,
        first_name: true,
        last_name: true,
        email: true,
        phone: true,
        document_number: true,
      },
    });

    return this.enqueueAll(
      storeId,
      organizationId,
      'customer',
      customers.map((customer) => ({
        id: customer.id,
        content: [
          `${customer.first_name} ${customer.last_name}`.trim(),
          customer.email ?? '',
          customer.phone ?? '',
          customer.document_number
            ? `Documento ${customer.document_number}`
            : '',
        ]
          .filter(Boolean)
          .join('. '),
      })),
    );
  }

  private async indexOrders(
    storeId: number,
    organizationId: number,
  ): Promise<number> {
    const orders = await this.prisma.orders.findMany({
      where: { store_id: storeId },
      orderBy: { id: 'desc' },
      take: PER_ENTITY_LIMIT,
      select: {
        id: true,
        order_number: true,
        grand_total: true,
        users: { select: { first_name: true, last_name: true } },
        order_items: { take: 10, select: { product_name: true, quantity: true } },
      },
    });

    return this.enqueueAll(
      storeId,
      organizationId,
      'order',
      orders.map((order) => ({
        id: order.id,
        content: [
          `Orden ${order.order_number}`,
          order.users
            ? `Cliente ${order.users.first_name} ${order.users.last_name}`.trim()
            : '',
          order.order_items
            .map((item) => `${item.quantity} x ${item.product_name}`)
            .join(', '),
          `Total ${order.grand_total}`,
        ]
          .filter(Boolean)
          .join('. '),
      })),
    );
  }

  /**
   * Suppliers, including the organization-wide ones.
   *
   * `store_id: null` is the ORGANIZATION operating scope: one supplier serving every
   * store of the organization. Those get an embedding row per store, which is
   * duplication by design — the index is store-scoped, and a supplier the store can
   * actually buy from has to be findable from that store.
   */
  private async indexSuppliers(
    storeId: number,
    organizationId: number,
  ): Promise<number> {
    const suppliers = await this.prisma.suppliers.findMany({
      where: {
        organization_id: organizationId,
        OR: [{ store_id: storeId }, { store_id: null }],
        state: { not: 'archived' },
      },
      orderBy: { id: 'desc' },
      take: PER_ENTITY_LIMIT,
      select: {
        id: true,
        name: true,
        contact_person: true,
        email: true,
        phone: true,
        tax_id: true,
        notes: true,
      },
    });

    return this.enqueueAll(
      storeId,
      organizationId,
      'supplier',
      suppliers.map((supplier) => ({
        id: supplier.id,
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
      })),
    );
  }

  /**
   * Expenses that are facts, not drafts.
   *
   * Pending ones are excluded for the same reason the listener waits for approval:
   * indexing a draft would let "¿cuánto llevo en arriendo?" match an amount nobody
   * ever authorised.
   */
  private async indexExpenses(
    storeId: number,
    organizationId: number,
  ): Promise<number> {
    const expenses = await this.prisma.expenses.findMany({
      where: { store_id: storeId, state: { in: ['approved', 'paid'] } },
      orderBy: { id: 'desc' },
      take: PER_ENTITY_LIMIT,
      select: {
        id: true,
        description: true,
        amount: true,
        notes: true,
        expense_categories: { select: { name: true } },
      },
    });

    return this.enqueueAll(
      storeId,
      organizationId,
      'expense',
      expenses.map((expense) => ({
        id: expense.id,
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
      })),
    );
  }

  /**
   * Queues one job per record, skipping those with nothing searchable in them.
   *
   * Failures are counted out rather than thrown: a backfill that dies on record 300
   * of 500 leaves the index in a state nobody can reason about, while one that
   * reports "460 de 500" is actionable.
   */
  private async enqueueAll(
    storeId: number,
    organizationId: number,
    entityType: string,
    records: Array<{ id: number; content: string }>,
  ): Promise<number> {
    let enqueued = 0;

    for (const record of records) {
      if (!record.content.trim()) continue;

      try {
        await this.queue.add(
          'embed',
          {
            store_id: storeId,
            organization_id: organizationId,
            entity_type: entityType,
            entity_id: record.id,
            content: record.content,
          },
          {
            attempts: 2,
            backoff: { type: 'exponential', delay: 3000 },
            removeOnComplete: { count: 500 },
            removeOnFail: { count: 100 },
          },
        );
        enqueued++;
      } catch (error: any) {
        this.logger.warn(
          `Backfill could not enqueue ${entityType}:${record.id} — ${error?.message}`,
        );
      }
    }

    return enqueued;
  }
}
