import 'reflect-metadata';
import { Prisma } from '@prisma/client';
import { RequestContextService } from '../../../../common/context/request-context.service';
import { ErrorCodes, VendixHttpException } from 'src/common/errors';
import { StorePrismaService } from '../../../../prisma/services/store-prisma.service';
import {
  buildCreditNoteCandidate,
  CreditNoteBalanceService,
} from './credit-note-balance.service';
import type { CreditNoteCandidate } from './credit-note-balance.service';

const ORG_ID = 31;
const STORE_ID = 41;
const ENTITY_ID = 51;
const PARENT_ID = 61;
const SOURCE_ITEM_ID = 71;
const NOW = new Date('2026-10-13T12:00:00.000Z');

const decimal = (value: Prisma.Decimal.Value) => new Prisma.Decimal(value);

function item(overrides: Record<string, unknown> = {}) {
  return {
    id: SOURCE_ITEM_ID,
    invoice_id: PARENT_ID,
    source_invoice_item_id: null,
    product_id: 81,
    product_variant_id: null,
    description: 'Camiseta base',
    quantity: decimal(2),
    unit_price: decimal(22500),
    discount_amount: decimal(0),
    tax_amount: decimal(0),
    total_amount: decimal(45000),
    is_inclusive: false,
    price_unit_quantity: 1,
    unit_code: 'NIU',
    account_code: '413595',
    aiu_component: null,
    financial_source_line_id: null,
    stock_units_consumed: null,
    serial_numbers_snapshot: null,
    ...overrides,
  };
}

function invoice(overrides: Record<string, unknown> = {}) {
  return {
    id: PARENT_ID,
    organization_id: ORG_ID,
    store_id: STORE_ID,
    accounting_entity_id: ENTITY_ID,
    invoice_type: 'sales_invoice',
    status: 'accepted',
    transmission_status: 'accepted',
    dian_status: 'accepted',
    related_invoice_id: null,
    subtotal_amount: decimal(45000),
    discount_amount: decimal(0),
    tax_amount: decimal(0),
    total_amount: decimal(45000),
    credit_limit_reserved_at: null,
    sent_at: null,
    accepted_at: NOW,
    invoice_items: [item()],
    invoice_taxes: [],
    ...overrides,
  };
}

function note(overrides: Record<string, unknown> = {}) {
  const noteItem = item({
    id: 171,
    invoice_id: 91,
    source_invoice_item_id: SOURCE_ITEM_ID,
    quantity: decimal(0.5),
    unit_price: decimal(20000),
    total_amount: decimal(10000),
  });
  return {
    ...invoice({
      id: 91,
      invoice_type: 'credit_note',
      status: 'validated',
      transmission_status: 'draft',
      dian_status: 'pending',
      related_invoice_id: PARENT_ID,
      subtotal_amount: decimal(10000),
      total_amount: decimal(10000),
      invoice_items: [noteItem],
      accepted_at: null,
      credit_limit_reserved_at: null,
    }),
    ...overrides,
  };
}

const requestContext = {
  organization_id: ORG_ID,
  store_id: STORE_ID,
  user_id: 101,
  is_super_admin: false,
  is_owner: true,
};

function createHarness(options: {
  parent?: ReturnType<typeof invoice>;
  notes?: ReturnType<typeof note>[];
  ledgers?: Array<Record<string, unknown>>;
} = {}) {
  const parent = options.parent ?? invoice();
  const notes = options.notes ?? [];
  const ledgers = options.ledgers ?? [];
  const updates: Array<Record<string, unknown>> = [];
  const transactionClient = {
    $queryRaw: jest.fn(async () => [{ id: parent.id }]),
    invoices: {
      findFirst: jest.fn(async ({ where }: { where: { id: number } }) =>
        where.id === parent.id ? parent : notes.find((row) => row.id === where.id) ?? null,
      ),
      findMany: jest.fn(async () => notes),
      updateMany: jest.fn(async ({ where, data }: { where: { id: number }; data: Record<string, unknown> }) => {
        updates.push(data);
        const target = notes.find((row) => row.id === where.id);
        if (target) Object.assign(target, data);
        return { count: 1 };
      }),
    },
    fiscal_transmissions: {
      findMany: jest.fn(async ({ where }: { where: { source_id?: number | { in: number[] } } }) => {
        const sourceId = where.source_id;
        const ids = typeof sourceId === 'object' ? sourceId.in : [sourceId];
        return ledgers.filter((row) => ids.includes(row.source_id as number));
      }),
      findFirst: jest.fn(async () => null),
    },
  };
  const prisma = {
    invoices: {
      findFirst: jest.fn(async ({ where }: { where: { id: number } }) =>
        where.id === parent.id ? parent : notes.find((row) => row.id === where.id) ?? null,
      ),
      findMany: jest.fn(async () => notes),
    },
    withoutScope: jest.fn(() => ({
      fiscal_transmissions: {
        findMany: jest.fn(async ({ where }: { where: { source_id: { in: number[] } } }) =>
          ledgers.filter((row) => where.source_id.in.includes(row.source_id as number)),
        ),
        findFirst: jest.fn(async () => null),
      },
    })),
    $transaction: jest.fn(
      async (work: (tx: typeof transactionClient) => Promise<unknown>) =>
        work(transactionClient),
    ),
  };
  return {
    service: new CreditNoteBalanceService(prisma as unknown as StorePrismaService),
    prisma,
    tx: transactionClient,
    updates,
    parent,
    notes,
    ledgers,
  };
}

const runInStoreContext = <T>(work: () => T): T =>
  RequestContextService.runIsolated(requestContext, work);

const candidate = (overrides: Partial<CreditNoteCandidate> = {}): CreditNoteCandidate => ({
  total_amount: decimal(10000),
  lines: [
    {
      source_invoice_item_id: SOURCE_ITEM_ID,
      quantity: decimal(0.5),
      base_amount: decimal(10000),
      total_amount: decimal(10000),
    },
  ],
  ...overrides,
});

describe('buildCreditNoteCandidate', () => {
  it('subtracts document allowance from source-keyed lines before limits', () => {
    const result = buildCreditNoteCandidate({
      total_amount: 952,
      tax_amount: 0,
      invoice_items: [
        { source_invoice_item_id: 2, quantity: 1, tax_amount: 0, total_amount: 576 },
        { source_invoice_item_id: 1, quantity: 1, tax_amount: 0, total_amount: 576 },
      ],
    });

    expect(result.total_amount).toEqual(decimal(952));
    expect(result.lines.reduce((sum, line) => sum.plus(line.base_amount), decimal(0))).toEqual(
      decimal(952),
    );
    expect(result.lines.reduce((sum, line) => sum.plus(line.total_amount), decimal(0))).toEqual(
      decimal(952),
    );
  });

  it('rejects invalid decimal inputs, non-positive quantities, duplicate sources, and tax mismatch', () => {
    expect(() =>
      buildCreditNoteCandidate({
        total_amount: Number.NaN,
        tax_amount: 0,
        invoice_items: [],
      }),
    ).toThrow(VendixHttpException);
    expect(() =>
      buildCreditNoteCandidate({
        total_amount: 1,
        tax_amount: 0,
        invoice_items: [
          { source_invoice_item_id: 1, quantity: 0, tax_amount: 0, total_amount: 1 },
        ],
      }),
    ).toThrow(VendixHttpException);
    expect(() =>
      buildCreditNoteCandidate({
        total_amount: 2,
        tax_amount: 0,
        invoice_items: [
          { source_invoice_item_id: 1, quantity: 1, tax_amount: 0, total_amount: 1 },
          { source_invoice_item_id: 1, quantity: 1, tax_amount: 0, total_amount: 1 },
        ],
      }),
    ).toThrow(VendixHttpException);
    expect(() =>
      buildCreditNoteCandidate({
        total_amount: 2,
        tax_amount: 1,
        invoice_items: [
          { source_invoice_item_id: 1, quantity: 1, tax_amount: 0, total_amount: 1 },
        ],
      }),
    ).toThrow(VendixHttpException);
  });
});

describe('CreditNoteBalanceService', () => {
  it('counts accepted projection, accepted ledger, marker, and legacy validated note once per note id', async () => {
    const prior = note({
      status: 'accepted',
      transmission_status: 'accepted',
      dian_status: 'accepted',
      accepted_at: NOW,
      credit_limit_reserved_at: NOW,
    });
    const harness = createHarness({
      notes: [prior],
      ledgers: [
        {
          source_id: prior.id,
          transmission_status: 'accepted',
          dian_status: 'accepted',
          sent_at: NOW,
          accepted_at: NOW,
          rejected_at: null,
        },
      ],
    });

    const result = await runInStoreContext(() => harness.service.remaining(PARENT_ID));

    expect(result.remaining_total).toEqual(decimal(35000));
    expect(result.lines.get(SOURCE_ITEM_ID)).toEqual({
      remaining_quantity: decimal(1.5),
      remaining_base: decimal(35000),
      remaining_total: decimal(35000),
    });
  });

  it.each([
    ['validated without marker', { status: 'validated', transmission_status: 'draft' }, []],
    ['queued claim', { status: 'draft', transmission_status: 'queued' }, []],
    ['cancelled but reserved', { status: 'cancelled', transmission_status: 'cancelled', credit_limit_reserved_at: NOW }, []],
    ['voided with uncertain ledger', { status: 'voided', transmission_status: 'cancelled' }, [{ transmission_status: 'error', dian_status: 'error', sent_at: null, accepted_at: null, rejected_at: null }]],
  ])('conservatively counts %s', async (_label, noteOverrides, ledgerOverrides) => {
    const prior = note(noteOverrides);
    const harness = createHarness({
      notes: [prior],
      ledgers: ledgerOverrides.map((ledger) => ({ source_id: prior.id, ...ledger })),
    });

    const result = await runInStoreContext(() => harness.service.remaining(PARENT_ID));
    expect(result.remaining_total).toEqual(decimal(35000));
  });

  it('does not count a definitive rejection even when its ledger has a submitted timestamp', async () => {
    const prior = note({ status: 'rejected', transmission_status: 'rejected' });
    const harness = createHarness({
      notes: [prior],
      ledgers: [
        {
          source_id: prior.id,
          transmission_status: 'rejected',
          dian_status: 'rejected',
          sent_at: NOW,
          accepted_at: null,
          rejected_at: NOW,
        },
      ],
    });

    const result = await runInStoreContext(() => harness.service.remaining(PARENT_ID));
    expect(result.remaining_total).toEqual(decimal(45000));
  });

  it('keeps a rejected note consuming credit while another ledger is uncertain', async () => {
    const prior = note({ status: 'rejected', transmission_status: 'rejected' });
    const harness = createHarness({
      notes: [prior],
      ledgers: [
        {
          source_id: prior.id,
          transmission_status: 'rejected',
          dian_status: 'rejected',
          sent_at: NOW,
          accepted_at: null,
          rejected_at: NOW,
        },
        {
          source_id: prior.id,
          transmission_status: 'queued',
          dian_status: 'pending',
          sent_at: null,
          accepted_at: null,
          rejected_at: null,
        },
      ],
    });

    const result = await runInStoreContext(() => harness.service.remaining(PARENT_ID));
    expect(result.remaining_total).toEqual(decimal(35000));
  });

  it('rejects duplicate or foreign source lines and enforces global and per-line limits', async () => {
    const harness = createHarness();

    await expect(
      runInStoreContext(() =>
        harness.service.assertCanCreate(PARENT_ID, candidate({ total_amount: decimal(45001) })),
      ),
    ).rejects.toMatchObject({ errorCode: ErrorCodes.INVOICING_NOTE_LIMIT_001.code });
    await expect(
      runInStoreContext(() =>
        harness.service.assertCanCreate(
          PARENT_ID,
          candidate({
            lines: [
              { ...candidate().lines[0], quantity: decimal(3) },
            ],
          }),
        ),
      ),
    ).rejects.toMatchObject({ errorCode: ErrorCodes.INVOICING_NOTE_LIMIT_001.code });
    await expect(
      runInStoreContext(() =>
        harness.service.assertCanCreate(
          PARENT_ID,
          candidate({
            lines: [candidate().lines[0], candidate().lines[0]],
          }),
        ),
      ),
    ).rejects.toBeInstanceOf(VendixHttpException);
    await expect(
      runInStoreContext(() =>
        harness.service.assertCanCreate(
          PARENT_ID,
          candidate({
            lines: [{ ...candidate().lines[0], source_invoice_item_id: 999 }],
          }),
        ),
      ),
    ).rejects.toBeInstanceOf(VendixHttpException);
    expect(harness.tx.$queryRaw).toHaveBeenCalled();
  });

  it('reserves validation atomically on a draft note and uses the caller include', async () => {
    const draft = note({ status: 'draft', credit_limit_reserved_at: null });
    const harness = createHarness({ notes: [draft] });

    const result = await runInStoreContext(() =>
      harness.service.reserveValidation(draft.id, { invoice_items: true }),
    );

    expect(result).toBe(draft);
    expect(harness.tx.invoices.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ status: 'validated', credit_limit_reserved_at: expect.any(Date) }),
      }),
    );
  });

  it('rechecks send balance and claims queued before external transmission', async () => {
    const draft = note({ status: 'validated' });
    const harness = createHarness({ notes: [draft] });

    await runInStoreContext(() => harness.service.ensureForSend(draft.id));

    expect(harness.tx.invoices.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          transmission_status: 'queued',
          credit_limit_reserved_at: expect.any(Date),
        }),
      }),
    );
  });

  it('releases only proven definitive rejection or pretransmission cancellation', async () => {
    const reserved = note({
      status: 'validated',
      transmission_status: 'rejected',
      credit_limit_reserved_at: NOW,
    });
    const rejected = createHarness({
      notes: [reserved],
      ledgers: [
        {
          source_id: reserved.id,
          transmission_status: 'rejected',
          dian_status: 'rejected',
          sent_at: NOW,
          accepted_at: null,
          rejected_at: NOW,
        },
      ],
    });
    await runInStoreContext(() =>
      rejected.service.transition(
        reserved.id,
        { status: 'rejected' },
        { invoice_items: true },
        'definitive_rejection',
        'validated',
      ),
    );
    expect(rejected.updates[0]).toMatchObject({ credit_limit_reserved_at: null });

    const queued = createHarness({
      notes: [
        note({ status: 'validated', transmission_status: 'queued', credit_limit_reserved_at: NOW }),
      ],
    });
    await runInStoreContext(() =>
      queued.service.transition(
        91,
        { status: 'cancelled' },
        { invoice_items: true },
        'pretransmission_cancel',
        'validated',
      ),
    );
    expect(queued.updates[0]).not.toHaveProperty('credit_limit_reserved_at');

    const pretransmission = createHarness({
      notes: [note({ status: 'validated', transmission_status: 'draft', credit_limit_reserved_at: NOW })],
    });
    await runInStoreContext(() =>
      pretransmission.service.transition(
        91,
        { status: 'cancelled' },
        { invoice_items: true },
        'pretransmission_cancel',
        'validated',
      ),
    );
    expect(pretransmission.updates[0]).toMatchObject({ credit_limit_reserved_at: null });
  });

  it('does not release when another ledger attempt is uncertain and preserves manual rejection markers', async () => {
    const reserved = note({ status: 'validated', credit_limit_reserved_at: NOW });
    const harness = createHarness({
      notes: [reserved],
      ledgers: [
        {
          source_id: reserved.id,
          transmission_status: 'rejected',
          dian_status: 'rejected',
          sent_at: NOW,
          accepted_at: null,
          rejected_at: NOW,
        },
        {
          source_id: reserved.id,
          transmission_status: 'error',
          dian_status: 'error',
          sent_at: null,
          accepted_at: null,
          rejected_at: null,
        },
      ],
    });

    await runInStoreContext(() =>
      harness.service.transition(
        reserved.id,
        { status: 'rejected' },
        { invoice_items: true },
        'definitive_rejection',
        'validated',
      ),
    );
    expect(harness.updates[0]).not.toHaveProperty('credit_limit_reserved_at');

    const manual = createHarness({
      notes: [note({ status: 'validated', credit_limit_reserved_at: NOW })],
    });
    await runInStoreContext(() =>
      manual.service.transition(91, { status: 'rejected' }, { invoice_items: true }, 'none', 'validated'),
    );
    expect(manual.updates[0]).not.toHaveProperty('credit_limit_reserved_at');
  });

  it('does not overwrite fresh acceptance with stale cancel, but records late acceptance', async () => {
    const acceptedNote = note({
      status: 'validated',
      transmission_status: 'queued',
      dian_status: 'pending',
      credit_limit_reserved_at: null,
    });
    const acceptedLedger = {
      source_id: acceptedNote.id,
      transmission_status: 'accepted',
      dian_status: 'accepted',
      sent_at: NOW,
      accepted_at: NOW,
      rejected_at: null,
    };
    const stale = createHarness({ notes: [acceptedNote], ledgers: [acceptedLedger] });
    await expect(
      runInStoreContext(() =>
        stale.service.transition(
          acceptedNote.id,
          { status: 'cancelled' },
          { invoice_items: true },
          'none',
          'validated',
        ),
      ),
    ).rejects.toBeInstanceOf(VendixHttpException);
    expect(stale.tx.invoices.updateMany).not.toHaveBeenCalled();

    const late = createHarness({
      notes: [note({ status: 'cancelled', transmission_status: 'queued', credit_limit_reserved_at: null })],
      ledgers: [],
    });
    await runInStoreContext(() =>
      late.service.transition(91, { status: 'accepted', dian_status: 'accepted' }, { invoice_items: true }, 'none', 'sent'),
    );
    expect(late.updates[0]).toMatchObject({ status: 'accepted', credit_limit_reserved_at: expect.any(Date) });
  });
});
