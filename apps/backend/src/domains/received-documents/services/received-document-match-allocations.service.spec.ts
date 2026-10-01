import { BadRequestException, ConflictException, ForbiddenException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { ReceivedDocumentsContext, ReceivedDocumentsService } from '../received-documents.service';
import { GlobalPrismaService } from '../../../prisma/services/global-prisma.service';
import { ReceivedDocumentMatchAllocationsService } from './received-document-match-allocations.service';

const ctx: ReceivedDocumentsContext = {
  organization_id: 3, accounting_entity_id: 8, store_id: 21, actor_id: 55, is_organization: true,
};
const reason = 'Supplier units differ';
const dec = (value: string | number) => new Prisma.Decimal(value);

function harness(options: Record<string, any> = {}) {
  const state: any = {
    document: {
      id: 100, organization_id: 3, accounting_entity_id: 8, store_id: 21,
      document_type: 'invoice', issuer_tax_id: '900123456-0', currency: 'COP',
      processing_status: 'ready', validation_status: 'valid', matching_status: 'unlinked', fiscal_status: 'pending',
      posting_status: 'pending', accepted_at: null, version: 1,
      items: [{ id: 10, document_id: 100, line_number: 1, quantity: dec('10'), unit_code: 'EA', net_amount: dec('100.00') }],
      ...options.document,
    },
    po: {
      id: 50, organization_id: 3, status: 'approved', supplier_id: 70,
      location: { id: 21, organization_id: 3, store_id: 21, is_central_warehouse: false },
      suppliers: { id: 70, tax_id: '900123456' },
      ...options.po,
    },
    poItems: new Map<number, any>([[50, {
      id: 50, purchase_order_id: 50, quantity_ordered: 10, purchase_uom_id: 1,
      product_id: 90, products: { purchase_uom_id: 1 },
      ...options.poItem,
    }]]),
    reception: { id: 60, purchase_order_id: 50, ...options.reception },
    receptionItem: { id: 61, reception_id: 60, purchase_order_item_id: 50, quantity_received: 8, ...options.receptionItem },
    expense: { id: 80, organization_id: 3, store_id: 21, currency: 'COP', state: 'approved', amount: dec('100.00'), ...options.expense },
    expenseItem: { id: 81, expense_id: 80, quantity: dec('10'), amount: dec('100.00'), ...options.expenseItem },
    documentTaxes: options.documentTaxes ?? [],
    allocations: [...(options.allocations ?? [])],
    taxAllocations: [...(options.taxAllocations ?? [])],
    events: [] as any[],
  };
  let nextAllocationId = 300;
  let nextTaxAllocationId = 700;
  const scopedDoc = (where: any) => where?.id === state.document.id &&
    where.organization_id === state.document.organization_id &&
    where.accounting_entity_id === state.document.accounting_entity_id &&
    (where.store_id == null || where.store_id === state.document.store_id);
  const allocationMatches = (row: any, where: any) =>
    (where.document_id == null || where.document_id === row.document_id) &&
    (where.idempotency_key == null || where.idempotency_key === row.idempotency_key) &&
    (where.id == null || where.id === row.id) &&
    (where.status == null || where.status === row.status) &&
    (where.document_item_id == null || where.document_item_id === row.document_item_id) &&
    (where.purchase_order_item_id == null || where.purchase_order_item_id === row.purchase_order_item_id) &&
    (where.reception_item_id == null || where.reception_item_id === row.reception_item_id) &&
    (where.expense_id == null || where.expense_id === row.expense_id) &&
    (where.expense_item_id == null || where.expense_item_id === row.expense_item_id);
  const sumField = (rows: any[], field: string) => rows.length === 0
    ? null
    : rows.reduce((sum: Prisma.Decimal, row: any) => sum.plus(row[field] ?? 0), dec(0));
  const connection = {
    received_documents: {
      findFirst: jest.fn(async ({ where }: any) => scopedDoc(where) ? { ...state.document, items: state.document.items } : null),
      updateMany: jest.fn(async ({ where, data }: any) => {
        if (!scopedDoc(where) || where.version !== state.document.version) return { count: 0 };
        const nextVersion = data.version?.increment ? state.document.version + data.version.increment : state.document.version;
        Object.assign(state.document, { ...data, version: nextVersion });
        return { count: 1 };
      }),
    },
    received_document_items: {
      findFirst: jest.fn(async ({ where }: any) => state.document.items.find((item: any) => item.id === where.id && item.document_id === where.document_id) ?? null),
      findMany: jest.fn(async ({ where }: any) => state.document.items.filter((item: any) => item.document_id === where.document_id)),
    },
    received_document_taxes: {
      findMany: jest.fn(async ({ where }: any) => state.documentTaxes.filter((tax: any) => tax.document_id === where.document_id && tax.item_id === where.item_id)),
    },
    received_document_match_allocations: {
      findFirst: jest.fn(async ({ where }: any) => state.allocations.find((row: any) => allocationMatches(row, where)) ?? null),
      findMany: jest.fn(async ({ where }: any) => state.allocations.filter((row: any) => allocationMatches(row, where)).map((row: any) => ({
        ...row,
        tax_allocations: state.taxAllocations.filter((tax: any) => tax.allocation_id === row.id),
        purchase_order_item: row.purchase_order_item_id == null ? null : state.poItems.get(row.purchase_order_item_id),
        reception_item: row.reception_item_id == null ? null : state.receptionItem,
        expense: row.expense_id == null ? null : state.expense,
        expense_item: row.expense_item_id == null ? null : state.expenseItem,
      }))),
      aggregate: jest.fn(async ({ where, _sum }: any) => {
        const rows = state.allocations.filter((row: any) => allocationMatches(row, where));
        const sum: any = {};
        for (const field of Object.keys(_sum)) sum[field] = sumField(rows, field);
        return { _sum: sum };
      }),
      create: jest.fn(async ({ data }: any) => {
        const created = { id: nextAllocationId++, status: 'active', created_at: new Date(), updated_at: new Date(), ...data };
        state.allocations.push(created);
        return created;
      }),
      updateMany: jest.fn(async ({ where, data }: any) => {
        const row = state.allocations.find((candidate: any) => candidate.id === where.id && candidate.document_id === where.document_id && candidate.status === where.status);
        if (!row) return { count: 0 };
        Object.assign(row, data);
        return { count: 1 };
      }),
    },
    received_document_match_tax_allocations: {
      aggregate: jest.fn(async ({ where }: any) => {
        const rows = state.taxAllocations.filter((tax: any) => tax.document_tax_id === where.document_tax_id &&
          state.allocations.some((allocation: any) => allocation.id === tax.allocation_id && allocation.status === 'active'));
        return { _sum: { allocated_amount: sumField(rows, 'allocated_amount') } };
      }),
      createMany: jest.fn(async ({ data }: any) => {
        for (const entry of data) state.taxAllocations.push({ id: nextTaxAllocationId++, ...entry });
        return { count: data.length };
      }),
    },
    purchase_orders: {
      findFirst: jest.fn(async ({ where }: any) => state.po.id === where.id && state.po.organization_id === where.organization_id ? state.po : null),
    },
    purchase_order_items: {
      findFirst: jest.fn(async ({ where }: any) => {
        const item = state.poItems.get(where.id);
        return item?.purchase_order_id === where.purchase_order_id ? item : null;
      }),
    },
    purchase_order_receptions: {
      findFirst: jest.fn(async ({ where }: any) => state.reception.id === where.id && state.reception.purchase_order_id === where.purchase_order_id ? state.reception : null),
    },
    purchase_order_reception_items: {
      findFirst: jest.fn(async ({ where }: any) => state.receptionItem.id === where.id && state.receptionItem.reception_id === where.reception_id ? state.receptionItem : null),
    },
    expenses: {
      findFirst: jest.fn(async ({ where }: any) => state.expense.id === where.id && state.expense.organization_id === where.organization_id ? state.expense : null),
    },
    expense_items: {
      findFirst: jest.fn(async ({ where }: any) => state.expenseItem.id === where.id && state.expenseItem.expense_id === where.expense_id ? state.expenseItem : null),
    },
    stores: { findFirst: jest.fn(async ({ where }: any) => where.id === 21 && where.organization_id === 3 ? { id: 21 } : null) },
    units_of_measure: { findUnique: jest.fn().mockResolvedValue({ code: 'EA', is_active: true }) },
    received_document_events: {
      create: jest.fn(async ({ data }: any) => { state.events.push(data); return { id: state.events.length }; }),
    },
    $queryRaw: jest.fn().mockResolvedValue([{ id: 1 }]),
    $transaction: jest.fn(async (callback: (tx: any) => Promise<unknown>) => callback(connection)),
  };
  const documents = { assertContext: jest.fn().mockResolvedValue(undefined) };
  const service = new ReceivedDocumentMatchAllocationsService(
    connection as unknown as GlobalPrismaService,
    documents as unknown as ReceivedDocumentsService,
  );
  return { service, state, prisma: connection, documents };
}

const poInput = (overrides: Record<string, unknown> = {}) => ({
  expected_version: 1,
  idempotency_key: 'match-1',
  document_item_id: 10,
  purchase_order_id: 50,
  purchase_order_item_id: 50,
  source_quantity: '4.0000',
  target_quantity: '4.0000',
  allocated_net_amount: '40.00',
  target_unit_code: 'EA',
  ...overrides,
});

describe('ReceivedDocumentMatchAllocationsService', () => {
  it('confirms successive partial allocations and derives unlinked/partial/linked without economic effects', async () => {
    const h = harness();
    const first = await h.service.confirm(ctx, 100, poInput() as any);
    expect(first).toMatchObject({ document_version: 2, matching_status: 'partially_linked', duplicate: false });
    expect(h.state.document.version).toBe(2);
    expect(h.state.document.matching_status).toBe('partially_linked');

    const second = await h.service.confirm(ctx, 100, poInput({
      expected_version: 2, idempotency_key: 'match-2', source_quantity: '6', target_quantity: '6', allocated_net_amount: '60',
    }) as any);
    expect(second).toMatchObject({ document_version: 3, matching_status: 'linked' });
    expect(h.state.allocations).toHaveLength(2);
    expect(h.state.events.map((event: any) => event.event_type)).toEqual(['MATCH_CONFIRMED', 'MATCH_CONFIRMED']);
    for (const event of h.state.events) {
      expect(event).not.toHaveProperty('confirmed_at');
      expect(event).not.toHaveProperty('event_code');
      expect(event).not.toHaveProperty('cude');
      expect(event).not.toHaveProperty('request_xml');
    }
    expect(h.state.document).not.toHaveProperty('quantity_received');
    expect(h.state.document).not.toHaveProperty('accounts_payable_id');
  });

  it('supports N:M across two documents and one PO item without exceeding its active target quantity', async () => {
    const h = harness({ allocations: [{
      id: 20, document_id: 99, document_item_id: 19, purchase_order_item_id: 50,
      source_quantity: dec('1'), target_quantity: dec('7'), allocated_net_amount: dec('70'), status: 'active',
    }] });
    await expect(h.service.confirm(ctx, 100, poInput({ source_quantity: '4', target_quantity: '4' }) as any))
      .rejects.toBeInstanceOf(ConflictException);
    expect(h.state.allocations).toHaveLength(1);
  });

  it('supports one document line split across multiple purchase orders', async () => {
    const h = harness();
    await h.service.confirm(ctx, 100, poInput({ source_quantity: '4', target_quantity: '4', allocated_net_amount: '40' }) as any);
    h.state.po = { ...h.state.po, id: 51 };
    h.state.poItems.set(51, {
      id: 51, purchase_order_id: 51, quantity_ordered: 10, purchase_uom_id: 1,
      product_id: 90, products: { purchase_uom_id: 1 },
    });
    const split = await h.service.confirm(ctx, 100, poInput({
      expected_version: 2, idempotency_key: 'split-po-2', purchase_order_id: 51,
      purchase_order_item_id: 51, source_quantity: '6', target_quantity: '6', allocated_net_amount: '60',
    }) as any);
    expect(split).toMatchObject({ document_version: 3, matching_status: 'linked' });
    expect(h.state.allocations.map((allocation: any) => allocation.purchase_order_id)).toEqual([50, 51]);
  });

  it('replays an exact idempotency key before stale-version checks and rejects a changed payload', async () => {
    const h = harness();
    const created = await h.service.confirm(ctx, 100, poInput() as any);
    const replay = await h.service.confirm(ctx, 100, poInput({ expected_version: 999 }) as any);
    expect(replay).toMatchObject({ allocation: { id: created.allocation.id }, duplicate: true, document_version: 2 });
    await expect(h.service.confirm(ctx, 100, poInput({ allocated_net_amount: '39.99' }) as any))
      .rejects.toBeInstanceOf(ConflictException);
    expect(h.state.allocations).toHaveLength(1);
  });

  it('rejects source-line and PO over-allocation using exact decimal sums', async () => {
    const h = harness();
    await h.service.confirm(ctx, 100, poInput() as any);
    await expect(h.service.confirm(ctx, 100, poInput({
      expected_version: 2, idempotency_key: 'match-too-much', source_quantity: '7', target_quantity: '7', allocated_net_amount: '70.01',
    }) as any)).rejects.toBeInstanceOf(ConflictException);
    expect(h.state.allocations).toHaveLength(1);
  });

  it('rejects supplier NIT, foreign store, and cross-order PO line mismatches', async () => {
    const wrongNit = harness({ po: { suppliers: { id: 70, tax_id: '800123456' } } });
    await expect(wrongNit.service.confirm(ctx, 100, poInput() as any)).rejects.toBeInstanceOf(ConflictException);

    const otherStore = harness({ po: { location: { id: 25, organization_id: 3, store_id: 25, is_central_warehouse: false } } });
    await expect(otherStore.service.confirm(ctx, 100, poInput() as any)).rejects.toBeInstanceOf(BadRequestException);

    const wrongLine = harness({ poItem: { purchase_order_id: 999 } });
    await expect(wrongLine.service.confirm(ctx, 100, poInput() as any)).rejects.toBeInstanceOf(BadRequestException);
  });

  it('requires explicit review for unknown/cross UoM and central warehouse targets', async () => {
    const differentUom = harness({ poItem: { purchase_uom_id: 2, products: { purchase_uom_id: 2 } } });
    differentUom.prisma.units_of_measure.findUnique.mockResolvedValue({ code: 'KG', is_active: true });
    await expect(differentUom.service.confirm(ctx, 100, poInput({ target_unit_code: undefined }) as any)).rejects.toBeInstanceOf(BadRequestException);
    await expect(differentUom.service.confirm(ctx, 100, poInput({
      idempotency_key: 'uom-reviewed', target_unit_code: 'KG', target_quantity: '2', manual_reason: reason,
    }) as any)).resolves.toMatchObject({ duplicate: false });

    const central = harness({ po: { location: { id: 99, organization_id: 3, store_id: null, is_central_warehouse: true } } });
    await expect(central.service.confirm(ctx, 100, poInput() as any)).rejects.toBeInstanceOf(ConflictException);
    await expect(central.service.confirm(ctx, 100, poInput({ idempotency_key: 'central-manual', manual_reason: reason }) as any))
      .resolves.toMatchObject({ duplicate: false });
  });

  it('requires a valid document classification and blocks terminal targets or unapproved purchase orders', async () => {
    const invalidDocument = harness({ document: { validation_status: 'pending' } });
    await expect(invalidDocument.service.confirm(ctx, 100, poInput() as any)).rejects.toBeInstanceOf(ConflictException);
    expect(invalidDocument.state.allocations).toHaveLength(0);

    for (const status of ['draft', 'cancelled']) {
      const invalidOrder = harness({ po: { status } });
      await expect(invalidOrder.service.confirm(ctx, 100, poInput() as any)).rejects.toBeInstanceOf(ConflictException);
      expect(invalidOrder.state.allocations).toHaveLength(0);
    }

    for (const state of ['rejected', 'cancelled', 'refunded']) {
      const invalidExpense = harness({ expense: { state } });
      await expect(invalidExpense.service.confirm(ctx, 100, {
        expected_version: 1, idempotency_key: `expense-${state}`, document_item_id: 10,
        expense_id: 80, source_quantity: '4', target_quantity: '4', allocated_net_amount: '40',
        target_unit_code: 'EA', manual_reason: reason,
      } as any)).rejects.toBeInstanceOf(ConflictException);
      expect(invalidExpense.state.allocations).toHaveLength(0);
    }
  });

  it('does not allow quantity overrides when source and target UoM are identical', async () => {
    const h = harness();
    await expect(h.service.confirm(ctx, 100, poInput({ target_quantity: '3', manual_reason: reason }) as any))
      .rejects.toBeInstanceOf(ConflictException);
    expect(h.state.allocations).toHaveLength(0);
  });

  it('validates the full optional purchase reception chain and caps actual received quantity', async () => {
    const badReceptionLine = harness({ receptionItem: { purchase_order_item_id: 999 } });
    await expect(badReceptionLine.service.confirm(ctx, 100, poInput({ reception_id: 60, reception_item_id: 61 }) as any))
      .rejects.toBeInstanceOf(BadRequestException);

    const overReceipt = harness({ receptionItem: { quantity_received: 2 } });
    await expect(overReceipt.service.confirm(ctx, 100, poInput({
      reception_id: 60, reception_item_id: 61, target_quantity: '4',
    }) as any)).rejects.toBeInstanceOf(ConflictException);

    const linkedReceipt = harness();
    await linkedReceipt.service.confirm(ctx, 100, poInput({ reception_id: 60, reception_item_id: 61 }) as any);
    const history = await linkedReceipt.service.list(ctx, 100);
    expect(history.receipt_targets[0]).toMatchObject({
      reception_item_id: 61, quantity_received: '8', allocated_quantity: '4', remaining_quantity: '4', receipt_state: 'received',
    });
  });

  it('validates expense tenant, currency, UoM assertion, and amount/quantity ceilings', async () => {
    const expenseInput = {
      expected_version: 1, idempotency_key: 'expense-1', document_item_id: 10,
      expense_id: 80, expense_item_id: 81, source_quantity: '2', target_quantity: '2',
      allocated_net_amount: '20', target_unit_code: 'EA', manual_reason: reason,
    };
    const wrongCurrency = harness({ expense: { currency: 'USD' } });
    await expect(wrongCurrency.service.confirm(ctx, 100, expenseInput as any)).rejects.toBeInstanceOf(ConflictException);

    const ok = harness();
    await expect(ok.service.confirm(ctx, 100, expenseInput as any)).resolves.toMatchObject({ matching_status: 'partially_linked' });
    await expect(ok.service.confirm(ctx, 100, { ...expenseInput, expected_version: 2, idempotency_key: 'expense-over', target_quantity: '11', allocated_net_amount: '90' } as any))
      .rejects.toBeInstanceOf(ConflictException);
  });

  it('writes signed prorated credit-note tax allocations and residual cents', async () => {
    const h = harness({
      document: { document_type: 'credit_note' },
      documentTaxes: [{ id: 501, document_id: 100, item_id: 10, amount: dec('19.00'), eligible_amount: dec('0'), treatment: 'pending' }],
    });
    const first = await h.service.confirm(ctx, 100, poInput() as any);
    expect(h.state.taxAllocations[0].allocated_amount).toEqual(dec('-7.60'));
    await h.service.confirm(ctx, 100, poInput({ expected_version: 2, idempotency_key: 'credit-last', source_quantity: '6', target_quantity: '6', allocated_net_amount: '60' }) as any);
    expect(h.state.taxAllocations.reduce((sum: Prisma.Decimal, tax: any) => sum.plus(tax.allocated_amount), dec(0)))
      .toEqual(dec('-19.00'));
    expect(h.state.documentTaxes[0]).toMatchObject({ eligible_amount: dec('0'), treatment: 'pending' });
    expect(first.allocation).toHaveProperty('id');
  });

  it('blocks nonzero line taxes when source net is zero rather than allocating the full tax to a partial slice', async () => {
    const h = harness({
      document: { items: [{ id: 10, document_id: 100, line_number: 1, quantity: dec('10'), unit_code: 'EA', net_amount: dec('0') }] },
      documentTaxes: [{ id: 601, document_id: 100, item_id: 10, amount: dec('4.25'), eligible_amount: dec('0'), treatment: 'pending' }],
    });
    await expect(h.service.confirm(ctx, 100, poInput({ allocated_net_amount: '0' }) as any)).rejects.toBeInstanceOf(ConflictException);
    expect(h.state.taxAllocations).toHaveLength(0);
  });

  it('revokes without deleting history, recomputes status, and repeats without a second event', async () => {
    const h = harness();
    const created = await h.service.confirm(ctx, 100, poInput() as any);
    const revoked = await h.service.revoke(ctx, 100, Number(created.allocation.id), { expected_version: 2, reason });
    expect(revoked).toMatchObject({ document_version: 3, matching_status: 'unlinked', duplicate: false });
    expect(h.state.allocations[0]).toMatchObject({ status: 'revoked', revoked_by: 55, revocation_reason: reason });
    const repeated = await h.service.revoke(ctx, 100, Number(created.allocation.id), { expected_version: 1, reason });
    expect(repeated).toMatchObject({ duplicate: true, document_version: 3 });
    expect(h.state.events.map((event: any) => event.event_type)).toEqual(['MATCH_CONFIRMED', 'MATCH_REVOKED']);
    expect(h.state.allocations).toHaveLength(1);
  });

  it('requires actor and document scope, and returns line history with remaining balances', async () => {
    const h = harness();
    await expect(h.service.confirm({ ...ctx, actor_id: undefined }, 100, poInput() as any)).rejects.toBeInstanceOf(ForbiddenException);
    await h.service.confirm(ctx, 100, poInput() as any);
    const list = await h.service.list(ctx, 100);
    expect(list.lines[0]).toMatchObject({ allocated_quantity: '4', remaining_quantity: '6', allocated_net_amount: '40.00', remaining_net_amount: '60.00' });
    expect(list.targets[0]).toMatchObject({ target_type: 'purchase_order_item', target_id: 50, receipt_state: 'receipt_not_linked' });
  });

  it('fails closed for foreign, terminal, or stale documents before writing an allocation', async () => {
    const foreign = harness();
    await expect(foreign.service.confirm({ ...ctx, organization_id: 99 }, 100, poInput() as any))
      .rejects.toThrow('Documento recibido no encontrado');
    expect(foreign.state.allocations).toHaveLength(0);

    const terminal = harness({ document: { fiscal_status: 'posted' } });
    await expect(terminal.service.confirm(ctx, 100, poInput() as any)).rejects.toBeInstanceOf(ConflictException);
    expect(terminal.state.allocations).toHaveLength(0);

    const stale = harness({ document: { version: 3 } });
    await expect(stale.service.confirm(ctx, 100, poInput({ expected_version: 2 }) as any))
      .rejects.toBeInstanceOf(ConflictException);
    expect(stale.state.allocations).toHaveLength(0);
  });
});
