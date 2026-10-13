import 'reflect-metadata';
import { randomUUID } from 'node:crypto';
import { Prisma } from '@prisma/client';
import { RequestContextService } from '../../../../common/context/request-context.service';
import { ErrorCodes, VendixHttpException } from 'src/common/errors';
import { StorePrismaService } from '../../../../prisma/services/store-prisma.service';
import { CreditNoteBalanceService } from './credit-note-balance.service';

/**
 * Opt-in PostgreSQL integration for the real StorePrismaService, parent-row
 * lock, reservation writes, and persisted ledger/projection union. It creates
 * only uniquely prefixed synthetic rows in a dedicated test database; it does
 * not create/drop databases, schemas, or truncate tables.
 *
 * Run only with QUI_702_TEST_DATABASE_URL targeting loopback PostgreSQL or Docker host `db`
 * with database `vendix_qui702_test` (or another explicitly isolated *_test DB).
 * Without the opt-in URL, this suite is skipped and is not verification.
 */
const describePostgres = process.env.QUI_702_TEST_DATABASE_URL
  ? describe
  : describe.skip;

type TestTenant = {
  organization_id: number;
  store_id: number;
  accounting_entity_id: number;
};

type BalanceFixture = TestTenant & {
  source_invoice_id: number;
  source_item_id: number;
  note_id: number;
};

function deferred<T = void>() {
  let resolve!: (value: T | PromiseLike<T>) => void;
  const promise = new Promise<T>((done) => {
    resolve = done;
  });
  return { promise, resolve };
}

function safeTestDatabaseUrl(): string {
  const raw = process.env.QUI_702_TEST_DATABASE_URL;
  if (!raw) {
    throw new Error(
      'Opt-in balance integration requires QUI_702_TEST_DATABASE_URL; no DATABASE_URL fallback is allowed.',
    );
  }
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    throw new Error('QUI_702_TEST_DATABASE_URL must be a valid PostgreSQL URL.');
  }
  const database = decodeURIComponent(url.pathname.replace(/^\/+/, ''));
  const allowedHost = ['localhost', '127.0.0.1', '::1', '[::1]', 'db'].includes(
    url.hostname,
  );
  if (
    !['postgres:', 'postgresql:'].includes(url.protocol) ||
    !allowedHost ||
    database === 'vendix_db' ||
    !(/_test$/.test(database) || database === 'vendix_qui702_test') ||
    /prod/i.test(database) ||
    process.env.NODE_ENV === 'production'
  ) {
    throw new Error(
      'Refusing balance integration: only a loopback/db PostgreSQL *_test database is allowed.',
    );
  }

  // A bounded database lock wait makes a regression that serializes unrelated
  // parents fail and unwind the deferred-lock case instead of hanging Jest.
  url.searchParams.set(
    'options',
    '-c lock_timeout=5000ms -c statement_timeout=20000ms',
  );
  return url.toString();
}

describePostgres('CreditNoteBalanceService PostgreSQL integration', () => {
  jest.setTimeout(45000);
  const runId = randomUUID().replace(/-/g, '');
  const prefix = `qui702_${runId}`;
  let prisma: StorePrismaService | undefined;
  let service: CreditNoteBalanceService;
  let previousDatabaseUrl: string | undefined;
  let tenant: TestTenant;

  beforeAll(async () => {
    const databaseUrl = safeTestDatabaseUrl();
    previousDatabaseUrl = process.env.DATABASE_URL;
    process.env.DATABASE_URL = databaseUrl;
    prisma = new StorePrismaService();
    await prisma.$connect();
    service = new CreditNoteBalanceService(prisma);

    const client = prisma.withoutScope();
    const columns = await client.$queryRaw<Array<{ table_name: string; column_name: string }>>`
      SELECT table_name, column_name
      FROM information_schema.columns
      WHERE table_schema = current_schema()
        AND (table_name, column_name) IN (
          ('invoice_items', 'source_invoice_item_id'),
          ('invoices', 'credit_limit_reserved_at')
        )
    `;
    const foundColumns = new Set(columns.map((row) => `${row.table_name}.${row.column_name}`));
    if (
      !foundColumns.has('invoice_items.source_invoice_item_id') ||
      !foundColumns.has('invoices.credit_limit_reserved_at')
    ) {
      throw new Error(
        'QUI-702 integration database is missing the source-link or reservation migration.',
      );
    }
    const selfForeignKey = await client.$queryRaw<Array<{ definition: string }>>`
      SELECT pg_get_constraintdef(oid) AS definition
      FROM pg_constraint
      WHERE conrelid = 'invoice_items'::regclass
        AND confrelid = 'invoice_items'::regclass
        AND contype = 'f'
        AND conname = 'invoice_items_source_invoice_item_id_fkey'
    `;
    if (!selfForeignKey[0]?.definition.includes('ON DELETE SET NULL')) {
      throw new Error(
        'QUI-702 integration database does not have the expected self-reference SET NULL constraint.',
      );
    }
    tenant = await createTenant(prisma, `${prefix}_main`);
  });

  afterAll(async () => {
    await prisma?.$disconnect();
    if (previousDatabaseUrl === undefined) {
      delete process.env.DATABASE_URL;
    } else {
      process.env.DATABASE_URL = previousDatabaseUrl;
    }
  });

  it('serializes two credits on one source, reserves once, and keeps retry idempotent', async () => {
    const fixture = await createBalanceFixture(prisma!, tenant, `${prefix}_same_parent`);
    const attempts = await Promise.allSettled([
      inTenant(fixture, () => service.reserveValidation(fixture.note_id, { invoice_items: true })),
      inTenant(fixture, () => service.reserveValidation(fixture.second_note_id!, { invoice_items: true })),
    ]);
    const fulfilled = attempts.filter(
      (attempt): attempt is PromiseFulfilledResult<unknown> => attempt.status === 'fulfilled',
    );
    const rejected = attempts.filter(
      (attempt): attempt is PromiseRejectedResult => attempt.status === 'rejected',
    );

    expect(fulfilled).toHaveLength(1);
    expect(rejected).toHaveLength(1);
    expect(rejected[0].reason).toBeInstanceOf(VendixHttpException);
    expect(rejected[0].reason.errorCode).toBe(ErrorCodes.INVOICING_NOTE_LIMIT_001.code);

    const client = prisma!.withoutScope();
    const noteRows = await client.invoices.findMany({
      where: { id: { in: [fixture.note_id, fixture.second_note_id!] } },
      select: {
        id: true,
        status: true,
        credit_limit_reserved_at: true,
        invoice_items: { select: { source_invoice_item_id: true } },
      },
    });
    const winner = noteRows.find((row) => row.status === 'validated');
    const loser = noteRows.find((row) => row.status === 'draft');
    expect(winner?.credit_limit_reserved_at).toBeInstanceOf(Date);
    expect(winner?.invoice_items[0].source_invoice_item_id).toBe(fixture.source_item_id);
    expect(loser?.credit_limit_reserved_at).toBeNull();

    await inTenant(fixture, () => service.ensureForSend(winner!.id));
    const afterFirstSendClaim = await inTenant(fixture, () =>
      service.remaining(fixture.source_invoice_id),
    );
    await inTenant(fixture, () => service.ensureForSend(winner!.id));
    const afterRetry = await inTenant(fixture, () =>
      service.remaining(fixture.source_invoice_id),
    );
    expect(afterFirstSendClaim.remaining_total).toEqual(new Prisma.Decimal(50));
    expect(afterRetry.remaining_total).toEqual(new Prisma.Decimal(50));
  });

  it('reserves a different parent while another parent row remains locked', async () => {
    const first = await createBalanceFixture(prisma!, tenant, `${prefix}_parent_a`);
    const second = await createBalanceFixture(prisma!, tenant, `${prefix}_parent_b`);
    const lockAcquired = deferred<void>();
    const releaseLock = deferred<void>();
    const heldTransaction = prisma!.$transaction(async (tx: Prisma.TransactionClient) => {
      const rows = await tx.$queryRaw<Array<{ id: number }>>`
        SELECT "id"
        FROM "invoices"
        WHERE "id" = ${first.source_invoice_id}
          AND "organization_id" = ${first.organization_id}
          AND "store_id" = ${first.store_id}
          AND "accounting_entity_id" = ${first.accounting_entity_id}
        FOR UPDATE
      `;
      expect(rows).toHaveLength(1);
      lockAcquired.resolve();
      await releaseLock.promise;
    });

    await lockAcquired.promise;
    try {
      // Await the real reserve while parent A is still locked. If the service
      // ever takes a global/table lock instead of the scoped parent row, the
      // DB lock_timeout from the test URL makes this reject deterministically.
      await inTenant(second, () => service.reserveValidation(second.note_id, { invoice_items: true }));
      const persisted = await prisma!.withoutScope().invoices.findFirst({
        where: { id: second.note_id },
        select: { status: true, credit_limit_reserved_at: true },
      });
      expect(persisted?.status).toBe('validated');
      expect(persisted?.credit_limit_reserved_at).toBeInstanceOf(Date);
    } finally {
      releaseLock.resolve();
      await heldTransaction;
    }
  });

  it('counts a ledger acceptance during projection lag exactly once', async () => {
    const fixture = await createBalanceFixture(prisma!, tenant, `${prefix}_ledger_accept`);
    await prisma!.withoutScope().fiscal_transmissions.create({
      data: {
        organization_id: fixture.organization_id,
        store_id: fixture.store_id,
        accounting_entity_id: fixture.accounting_entity_id,
        document_type: 'credit_note',
        source_type: 'invoice',
        source_id: fixture.note_id,
        document_number: `${prefix}_accepted`,
        idempotency_key: `${prefix}:accepted:${fixture.note_id}`,
        transmission_status: 'accepted',
        dian_status: 'accepted',
        accepted_at: new Date(),
      },
    });
    await prisma!.withoutScope().invoices.updateMany({
      where: { id: fixture.note_id },
      data: { status: 'draft', credit_limit_reserved_at: null },
    });

    const ledgerOnly = await inTenant(fixture, () =>
      service.remaining(fixture.source_invoice_id),
    );
    await prisma!.withoutScope().invoices.updateMany({
      where: { id: fixture.note_id },
      data: { status: 'accepted' },
    });
    const projected = await inTenant(fixture, () =>
      service.remaining(fixture.source_invoice_id),
    );

    expect(ledgerOnly.remaining_total).toEqual(new Prisma.Decimal(50));
    expect(projected.remaining_total).toEqual(new Prisma.Decimal(50));
  });

  it('retains timeout reservations and releases only a persisted definitive rejection', async () => {
    const timeoutFixture = await createBalanceFixture(prisma!, tenant, `${prefix}_timeout`);
    await inTenant(timeoutFixture, () =>
      service.reserveValidation(timeoutFixture.note_id, { invoice_items: true }),
    );
    await inTenant(timeoutFixture, () =>
      service.transition(
        timeoutFixture.note_id,
        { transmission_status: 'error' },
        { invoice_items: true },
        'none',
        'validated',
      ),
    );
    const timeoutRow = await prisma!.withoutScope().invoices.findFirst({
      where: { id: timeoutFixture.note_id },
      select: { credit_limit_reserved_at: true },
    });
    expect(timeoutRow?.credit_limit_reserved_at).toBeInstanceOf(Date);

    const rejectedFixture = await createBalanceFixture(prisma!, tenant, `${prefix}_reject`);
    await inTenant(rejectedFixture, () =>
      service.reserveValidation(rejectedFixture.note_id, { invoice_items: true }),
    );
    await prisma!.withoutScope().fiscal_transmissions.create({
      data: {
        organization_id: rejectedFixture.organization_id,
        store_id: rejectedFixture.store_id,
        accounting_entity_id: rejectedFixture.accounting_entity_id,
        document_type: 'credit_note',
        source_type: 'invoice',
        source_id: rejectedFixture.note_id,
        document_number: `${prefix}_rejected`,
        idempotency_key: `${prefix}:rejected:${rejectedFixture.note_id}`,
        transmission_status: 'rejected',
        dian_status: 'rejected',
        sent_at: new Date(),
        rejected_at: new Date(),
      },
    });
    await inTenant(rejectedFixture, () =>
      service.transition(
        rejectedFixture.note_id,
        { status: 'rejected', transmission_status: 'rejected', dian_status: 'rejected' },
        { invoice_items: true },
        'definitive_rejection',
        'validated',
      ),
    );
    const released = await prisma!.withoutScope().invoices.findFirst({
      where: { id: rejectedFixture.note_id },
      select: { credit_limit_reserved_at: true },
    });
    expect(released?.credit_limit_reserved_at).toBeNull();
    const reopened = await inTenant(rejectedFixture, () =>
      service.remaining(rejectedFixture.source_invoice_id),
    );
    expect(reopened.remaining_total).toEqual(new Prisma.Decimal(200));

    await inTenant(rejectedFixture, () => service.ensureForSend(rejectedFixture.note_id));
    const retried = await prisma!.withoutScope().invoices.findFirst({
      where: { id: rejectedFixture.note_id },
      select: { transmission_status: true, credit_limit_reserved_at: true },
    });
    expect(retried?.transmission_status).toBe('queued');
    expect(retried?.credit_limit_reserved_at).toBeInstanceOf(Date);
  });
});

async function createTenant(
  prisma: StorePrismaService,
  identity: string,
): Promise<TestTenant> {
  const client = prisma.withoutScope();
  const organization = await client.organizations.create({
    data: {
      name: `QUI-702 synthetic org ${identity}`,
      slug: identity,
      email: `${identity}@example.invalid`,
    },
    select: { id: true },
  });
  const store = await client.stores.create({
    data: {
      name: `QUI-702 synthetic store ${identity}`,
      slug: `store-${identity}`,
      organization_id: organization.id,
    },
    select: { id: true },
  });
  const entity = await client.accounting_entities.create({
    data: {
      organization_id: organization.id,
      store_id: store.id,
      scope: 'STORE',
      fiscal_scope: 'STORE',
      name: `QUI-702 synthetic entity ${identity}`,
    },
    select: { id: true },
  });
  return {
    organization_id: organization.id,
    store_id: store.id,
    accounting_entity_id: entity.id,
  };
}

async function createBalanceFixture(
  prisma: StorePrismaService,
  tenant: TestTenant,
  identity: string,
): Promise<BalanceFixture & { second_note_id?: number }> {
  const client = prisma.withoutScope();
  const source = await client.invoices.create({
    data: {
      organization_id: tenant.organization_id,
      store_id: tenant.store_id,
      accounting_entity_id: tenant.accounting_entity_id,
      invoice_type: 'sales_invoice',
      fiscal_document_type: 'sales_invoice',
      invoice_number: `${identity}_FE`,
      status: 'accepted',
      transmission_status: 'accepted',
      dian_status: 'accepted',
      accounting_status: 'provisional',
      subtotal_amount: new Prisma.Decimal(200),
      discount_amount: new Prisma.Decimal(0),
      tax_amount: new Prisma.Decimal(0),
      total_amount: new Prisma.Decimal(200),
      issue_date: new Date('2026-10-13T00:00:00.000Z'),
      accepted_at: new Date(),
      invoice_items: {
        create: [
          {
            description: 'QUI-702 synthetic source line',
            quantity: new Prisma.Decimal(2),
            unit_price: new Prisma.Decimal(100),
            discount_amount: new Prisma.Decimal(0),
            tax_amount: new Prisma.Decimal(0),
            total_amount: new Prisma.Decimal(200),
            is_inclusive: false,
            unit_code: 'EA',
          },
        ],
      },
    },
    select: {
      id: true,
      invoice_items: { select: { id: true } },
    },
  });
  const noteCreateData = {
    organization_id: tenant.organization_id,
    store_id: tenant.store_id,
    accounting_entity_id: tenant.accounting_entity_id,
    invoice_type: 'credit_note' as const,
    fiscal_document_type: 'credit_note' as const,
    related_invoice_id: source.id,
    status: 'draft' as const,
    transmission_status: 'draft' as const,
    dian_status: 'pending' as const,
    accounting_status: 'blocked' as const,
    subtotal_amount: new Prisma.Decimal(150),
    discount_amount: new Prisma.Decimal(0),
    tax_amount: new Prisma.Decimal(0),
    total_amount: new Prisma.Decimal(150),
    issue_date: new Date('2026-10-13T00:00:00.000Z'),
    invoice_items: {
      create: {
        source_invoice_item_id: source.invoice_items[0].id,
        description: 'QUI-702 synthetic credit note line',
        quantity: new Prisma.Decimal(1.5),
        unit_price: new Prisma.Decimal(100),
        discount_amount: new Prisma.Decimal(0),
        tax_amount: new Prisma.Decimal(0),
        total_amount: new Prisma.Decimal(150),
        is_inclusive: false,
        unit_code: 'EA',
      },
    },
  };
  const firstNote = await client.invoices.create({
    data: noteCreateData,
    select: { id: true },
  });
  const secondNote = await client.invoices.create({
    data: {
      ...noteCreateData,
      invoice_items: {
        create: {
          ...noteCreateData.invoice_items.create,
          description: 'QUI-702 synthetic concurrent credit note line',
        },
      },
    },
    select: { id: true },
  });
  return {
    ...tenant,
    source_invoice_id: source.id,
    source_item_id: source.invoice_items[0].id,
    note_id: firstNote.id,
    second_note_id: secondNote.id,
  };
}

function inTenant<T>(fixture: TestTenant, work: () => T): T {
  return RequestContextService.runIsolated(
    {
      organization_id: fixture.organization_id,
      store_id: fixture.store_id,
      user_id: 999,
      is_super_admin: false,
      is_owner: true,
    },
    work,
  );
}
