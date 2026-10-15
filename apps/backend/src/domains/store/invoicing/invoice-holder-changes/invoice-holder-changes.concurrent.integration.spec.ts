import 'reflect-metadata';
import { randomUUID } from 'crypto';
import { ConfigService } from '@nestjs/config';
import { Prisma } from '@prisma/client';
import { StorePrismaService } from '../../../../prisma/services/store-prisma.service';
import { GlobalPrismaService } from '../../../../prisma/services/global-prisma.service';
import { RequestContextService } from '../../../../common/context/request-context.service';
import { FiscalScopeService } from '../../../../common/services/fiscal-scope.service';
import { FiscalGateService } from '../../../../common/services/fiscal-gate.service';
import { OrderHistoryService } from '../../orders/order-history/order-history.service';
import {
  assertNoHolderChangeReservation,
  lockHolderChangeOrder,
} from '../../orders/shared/holder-change-reservation';
import { CustomerFiscalIdentityValidator } from '../validators/customer-fiscal-identity.validator';
import { FiscalTransmissionLedgerService } from '../services/fiscal-transmission-ledger.service';
import { HolderChangeAccountingService } from './holder-change-accounting.service';
import { InvoiceHolderChangesService } from './invoice-holder-changes.service';
import { InvoiceHolderLinkService } from './invoice-holder-link.service';
import { HolderOperation } from './invoice-holder-change.types';

/** Real Prisma + PostgreSQL motor transactions, locks and audit. Scope deliberately
 * excludes live DIAN, NC creation, replacement transmission and accounting-enabled
 * journals: these are NOT proved by this spec. No mock persistence or toy tables.
 * Synthetic rows are preserved; no reset, global seed, DELETE or schema teardown.
 */
function isolatedDatabaseUrl() {
  const raw = process.env.CF_HOLDER_TEST_DATABASE_URL;
  if (!raw)
    throw new Error(
      'Explicit CF_HOLDER_TEST_DATABASE_URL required; no DATABASE_URL fallback.',
    );
  const url = new URL(raw);
  const database = decodeURIComponent(url.pathname.slice(1));
  if (
    !['postgres:', 'postgresql:'].includes(url.protocol) ||
    !['localhost', '127.0.0.1', '[::1]'].includes(url.hostname) ||
    !/^vendix_cf_holder_[a-z0-9_]+_test$/.test(database) ||
    process.env.NODE_ENV === 'production' ||
    url.search ||
    url.hash
  )
    throw new Error(
      'Refusing integration outside a dedicated loopback vendix_cf_holder_*_test database.',
    );
  url.searchParams.set(
    'options',
    '-c lock_timeout=4000ms -c statement_timeout=10000ms',
  );
  return url.toString();
}

const postgres = process.env.CF_HOLDER_TEST_DATABASE_URL
  ? describe
  : describe.skip;
postgres(
  'Holder motor PostgreSQL concurrency (not DIAN / full fiscal E2E)',
  () => {
    jest.setTimeout(20000);
    let prisma: StorePrismaService;
    let global: GlobalPrismaService;
    let service: InvoiceHolderChangesService;
    let settings: ConfigService;
    let previousUrl: string | undefined;
    let tenant: {
      organization_id: number;
      store_id: number;
      accounting_entity_id: number;
    };
    const prefix = `cf_holder_${randomUUID().replace(/-/g, '').slice(0, 14)}`;
    let serial = 0;
    const scoped = <T>(work: () => T, storeId = tenant.store_id): T =>
      RequestContextService.runIsolated(
        {
          organization_id: tenant.organization_id,
          store_id: storeId,
          is_owner: true,
          is_super_admin: false,
        },
        work,
      );

    beforeAll(async () => {
      const url = isolatedDatabaseUrl();
      previousUrl = process.env.DATABASE_URL;
      process.env.DATABASE_URL = url;
      prisma = new StorePrismaService();
      global = new GlobalPrismaService();
      await prisma.$connect();
      await global.$connect();
      const db = prisma.withoutScope();
      const org = await db.organizations.create({
        data: {
          name: prefix,
          slug: prefix,
          email: `${prefix}@example.invalid`,
          fiscal_scope: 'STORE',
        },
      });
      const store = await db.stores.create({
        data: { name: prefix, slug: prefix, organization_id: org.id },
      });
      const entity = await db.accounting_entities.create({
        data: {
          organization_id: org.id,
          store_id: store.id,
          name: prefix,
          scope: 'STORE',
          fiscal_scope: 'STORE',
        },
      });
      tenant = {
        organization_id: org.id,
        store_id: store.id,
        accounting_entity_id: entity.id,
      };
      settings = new ConfigService({ CF_HOLDER_CHANGE_ENABLED: 'true' });
      // Explicit accounting-disabled fixture, not evidence of posted journal correctness.
      const disabledAccounting = {
        isAreaEnabled: async () => false,
      } as unknown as FiscalGateService;
      service = new InvoiceHolderChangesService(
        prisma,
        undefined as never,
        undefined as never,
        new FiscalTransmissionLedgerService(prisma),
        undefined as never,
        new CustomerFiscalIdentityValidator(),
        new OrderHistoryService(prisma),
        new InvoiceHolderLinkService(global, settings, disabledAccounting),
        new FiscalScopeService(prisma),
        new HolderChangeAccountingService(global, disabledAccounting, undefined as never),
      );
    });
    afterAll(async () => {
      await prisma?.$disconnect();
      await global?.$disconnect();
      if (previousUrl === undefined) delete process.env.DATABASE_URL;
      else process.env.DATABASE_URL = previousUrl;
    });

    async function fixture() {
      const db = prisma.withoutScope();
      const order = await db.orders.create({
        data: {
          store_id: tenant.store_id,
          order_number: `${prefix}_${++serial}`,
          grand_total: 100,
          subtotal_amount: 100,
          tax_amount: 0,
          discount_amount: 0,
        },
      });
      const invoice = await db.invoices.create({
        data: {
          ...tenant,
          order_id: order.id,
          invoice_type: 'sales_invoice',
          fiscal_document_type: 'sales_invoice',
          customer_tax_id: '222222222222',
          status: 'rejected',
          subtotal_amount: 100,
          total_amount: 100,
          tax_amount: 0,
          discount_amount: 0,
          issue_date: new Date(),
          invoice_items: {
            create: {
              description: prefix,
              quantity: 1,
              unit_price: 100,
              total_amount: 100,
            },
          },
        },
      });
      return { order, invoice };
    }
    async function operation(id: number): Promise<HolderOperation> {
      const row = await prisma
        .withoutScope()
        .invoice_holder_changes.findFirst({
          where: { id, store_id: tenant.store_id },
        });
      if (!row) throw new Error('Missing synthetic operation');
      return row;
    }

    it('two identical starts serialize into one operation, one unlink and truthful audit', async () => {
      const { order, invoice } = await fixture();
      const attempts = await Promise.all([
        scoped(() =>
          service.startManual(invoice.id, 'Corregir titular de prueba'),
        ),
        scoped(() =>
          service.startManual(invoice.id, 'Corregir titular de prueba'),
        ),
      ]);
      expect(attempts[0].id).toBe(attempts[1].id);
      await scoped(() => service.resume(attempts[0].id));
      const op = await operation(attempts[0].id);
      expect(op.phase).toBe('awaiting_customer');
      expect(op.credit_note_id).toBeNull();
      expect(op.new_invoice_id).toBeNull();
      const db = prisma.withoutScope();
      expect(
        await db.invoice_holder_changes.count({
          where: { original_invoice_id: invoice.id },
        }),
      ).toBe(1);
      expect(
        (await db.invoices.findFirst({ where: { id: invoice.id } }))!.order_id,
      ).toBeNull();
      expect(
        await db.order_events.count({
          where: { order_id: order.id, event_type: 'holder_change_transition' },
        }),
      ).toBe(3);
      expect(
        await db.invoice_data_requests.count({ where: { order_id: order.id } }),
      ).toBe(0);
    });

    it('the real shared reservation rejects competing ordinary mutation under the order lock', async () => {
      const { order, invoice } = await fixture();
      const op = await scoped(() =>
        service.startManual(invoice.id, 'Reserva de prueba'),
      );
      await expect(
        scoped(() =>
          prisma.$transaction(async (tx: Prisma.TransactionClient) => {
            await lockHolderChangeOrder(
              tx,
              order.id,
              tenant.store_id,
              tenant.organization_id,
            );
            await assertNoHolderChangeReservation(
              tx,
              order.id,
              tenant.store_id,
            );
            await tx.orders.updateMany({
              where: { id: order.id, store_id: tenant.store_id },
              data: { grand_total: 999 },
            });
          }),
        ),
      ).rejects.toMatchObject({ errorCode: 'INVOICING_CREATE_002' });
      expect(
        (await prisma
          .withoutScope()
          .orders.findFirst({
            where: { id: order.id },
          }))!.grand_total.toString(),
      ).toBe('100');
      expect((await operation(op.id)).active_order_key).not.toBeNull();
    });

    it('a stale checkpoint cannot regress phase or append a false audit after another claim', async () => {
      const { invoice } = await fixture();
      const result = await scoped(() =>
        service.startManual(invoice.id, 'Checkpoint de prueba'),
      );
      const old = await operation(result.id);
      const db = prisma.withoutScope();
      await db.invoice_holder_changes.updateMany({
        where: { id: old.id },
        data: {
          lease_owner: 'new-worker',
          lease_expires_at: new Date(Date.now() + 60000),
          version: { increment: 1 },
        },
      });
      const count = await db.fiscal_operation_events.count({
        where: { resource_type: 'invoice_holder_change', resource_id: old.id },
      });
      const checkpoint = service as unknown as {
        checkpoint(op: HolderOperation, phase: string): Promise<boolean>;
      };
      expect(await scoped(() => checkpoint.checkpoint(old, 'requested'))).toBe(
        false,
      );
      expect((await operation(old.id)).phase).toBe('awaiting_customer');
      expect(
        await db.fiscal_operation_events.count({
          where: {
            resource_type: 'invoice_holder_change',
            resource_id: old.id,
          },
        }),
      ).toBe(count);
    });

    it('an expired lease cannot unlink an invoice or produce a misleading transition', async () => {
      const { invoice } = await fixture();
      // Start persistence only so the linked invoice remains available for the fencing test.
      const internals = service as unknown as {
        start(id: number, reason: string, mode: string): Promise<number>;
        release(op: HolderOperation, original: number): Promise<boolean>;
      };
      const id = await scoped(() =>
        internals.start(invoice.id, 'Lease vencida de prueba', 'manual'),
      );
      const db = prisma.withoutScope();
      await db.invoice_holder_changes.updateMany({
        where: { id },
        data: {
          lease_owner: 'late-worker',
          lease_expires_at: new Date(Date.now() - 1000),
        },
      });
      const expired = await operation(id);
      await expect(
        scoped(() => internals.release(expired, invoice.id)),
      ).rejects.toThrow();
      expect(
        (await db.invoices.findFirst({ where: { id: invoice.id } }))!.order_id,
      ).not.toBeNull();
      expect((await operation(id)).phase).toBe('requested');
    });

    it('an identical continuation survives admission shutdown and is denied in another store', async () => {
      const { invoice } = await fixture();
      const before = await scoped(() =>
        service.startManual(invoice.id, 'Continuar sin nuevas admisiones'),
      );
      settings.set('CF_HOLDER_CHANGE_ENABLED', 'false');
      try {
        const replay = await scoped(() =>
          service.startManual(invoice.id, 'Continuar sin nuevas admisiones'),
        );
        expect(replay.id).toBe(before.id);
        await expect(
          scoped(() => service.resume(before.id), tenant.store_id + 100000),
        ).rejects.toThrow();
      } finally {
        settings.set('CF_HOLDER_CHANGE_ENABLED', 'true');
      }
    });
    it('default and transactional order projections omit guest capability; explicit select alone exposes it', async () => {
      const token = randomUUID();
      const db = prisma.withoutScope();
      const order = await db.orders.create({
        data: {
          store_id: tenant.store_id,
          order_number: `${prefix}_${++serial}`,
          public_access_token: token,
        },
      });
      expect(
        Object.prototype.hasOwnProperty.call(order, 'public_access_token'),
      ).toBe(false);
      const ordinary = await db.$transaction((tx) =>
        tx.orders.findFirst({ where: { id: order.id } }),
      );
      expect(
        Object.prototype.hasOwnProperty.call(ordinary, 'public_access_token'),
      ).toBe(false);
      const explicit = await db.orders.findFirst({
        where: { id: order.id },
        select: { public_access_token: true },
      });
      expect(explicit?.public_access_token).toBe(token);
    });
  },
);
