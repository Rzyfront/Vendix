import { NotFoundException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { GlobalPrismaService } from '../../../prisma/services/global-prisma.service';
import { ReceivedDocumentsContext, ReceivedDocumentsService } from '../received-documents.service';
import { ReceivedDocumentMatchExpensesService } from './received-document-match-expenses.service';

const context: ReceivedDocumentsContext = {
  organization_id: 4,
  accounting_entity_id: 40,
  store_id: 11,
  actor_id: 88,
  is_organization: false,
};
const expense = (overrides: Record<string, unknown> = {}) => ({
  id: 15,
  store_id: 11,
  description: 'Compra de insumos',
  expense_date: new Date('2026-08-12T00:00:00.000Z'),
  state: 'approved',
  amount: new Prisma.Decimal('150.00'),
  currency: 'cop',
  expense_items: [{
    id: 151,
    description: 'Café molido',
    quantity: new Prisma.Decimal('3.00'),
    unit_price: new Prisma.Decimal('50.00'),
    amount: new Prisma.Decimal('150.00'),
  }],
  ...overrides,
});

function setup(options: {
  document?: { id: number; store_id: number | null; currency: string | null } | null;
  expenses?: ReturnType<typeof expense>[];
  total?: number;
  groups?: Array<{ expense_id: number; expense_item_id: number | null; _sum: { allocated_net_amount: Prisma.Decimal | null } }>;
} = {}) {
  const prisma = {
    received_documents: { findFirst: jest.fn().mockResolvedValue(options.document === undefined
      ? { id: 90, store_id: 11, currency: 'COP' }
      : options.document) },
    expenses: {
      findMany: jest.fn().mockResolvedValue(options.expenses ?? [expense()]),
      count: jest.fn().mockResolvedValue(options.total ?? (options.expenses?.length ?? 1)),
    },
    received_document_match_allocations: {
      groupBy: jest.fn().mockResolvedValue(options.groups ?? []),
    },
  };
  const documents = { assertContext: jest.fn().mockResolvedValue(undefined) };
  const service = new ReceivedDocumentMatchExpensesService(
    prisma as unknown as GlobalPrismaService,
    documents as unknown as ReceivedDocumentsService,
  );
  return { service, prisma, documents };
}

describe('ReceivedDocumentMatchExpensesService', () => {
  it('scopes candidates by tenant, selected store, document currency, and allowed states', async () => {
    const { service, prisma, documents } = setup();
    const result = await service.list(context, 90);
    expect(documents.assertContext).toHaveBeenCalledWith(context);
    expect(prisma.received_documents.findFirst).toHaveBeenCalledWith(expect.objectContaining({
      where: { id: 90, organization_id: 4, accounting_entity_id: 40, store_id: 11 },
    }));
    expect(prisma.expenses.findMany).toHaveBeenCalledWith(expect.objectContaining({
      where: expect.objectContaining({
        organization_id: 4,
        store_id: 11,
        state: { in: ['pending', 'approved', 'paid'] },
        currency: { equals: 'COP', mode: 'insensitive' },
      }),
      orderBy: [{ expense_date: 'desc' }, { id: 'desc' }],
      take: 20,
    }));
    expect(result.warnings).toContain('MANUAL_SUPPLIER_IDENTITY_UNVERIFIED');
    expect(prisma.expenses.findMany.mock.calls[0][0].select).not.toHaveProperty('receipt_url');
  });

  it('falls back to the selected document store when the trusted context has none', async () => {
    const { service, prisma } = setup();
    await service.list({ ...context, store_id: null }, 90);
    expect(prisma.expenses.findMany.mock.calls[0][0].where.store_id).toBe(11);
  });

  it('returns no candidates and a warning for missing/invalid document currency', async () => {
    for (const currency of [null, 'UNKNOWN', 'CO']) {
      const { service, prisma } = setup({ document: { id: 90, store_id: 11, currency } });
      const result = await service.list(context, 90);
      expect(result.data).toEqual([]);
      expect(result.total).toBe(0);
      expect(result.warnings).toContain('DOCUMENT_CURRENCY_INVALID');
      expect(prisma.expenses.findMany).not.toHaveBeenCalled();
    }
  });

  it('returns 404 for a document outside the explicit tenant/entity/store scope', async () => {
    const { service, prisma } = setup({ document: null });
    await expect(service.list(context, 90)).rejects.toBeInstanceOf(NotFoundException);
    expect(prisma.expenses.findMany).not.toHaveBeenCalled();
  });

  it('supports exact digit ID search or bounded description contains search', async () => {
    const exact = setup();
    await exact.service.list(context, 90, { search: '15' });
    expect(exact.prisma.expenses.findMany.mock.calls[0][0].where.OR).toEqual([{ id: 15 }]);

    const text = setup();
    await text.service.list(context, 90, { search: ' café   molido ' });
    expect(text.prisma.expenses.findMany.mock.calls[0][0].where.OR).toEqual([
      { description: { contains: 'café molido', mode: 'insensitive' } },
      { expense_items: { some: { description: { contains: 'café molido', mode: 'insensitive' } } } },
    ]);
  });

  it('paginates at 20 rows and rejects invalid service bounds', async () => {
    const { service, prisma } = setup({ total: 30 });
    const result = await service.list(context, 90, { page: 2, limit: 10 });
    expect(result).toMatchObject({ page: 2, limit: 10, total: 30 });
    expect(prisma.expenses.findMany.mock.calls[0][0]).toMatchObject({ skip: 10, take: 10 });
    await expect(service.list(context, 90, { page: 1001 })).rejects.toThrow();
    await expect(service.list(context, 90, { limit: 21 })).rejects.toThrow();
  });

  it('bounds nested expense items, warns that the comparison is incomplete, and returns only safe snapshots', async () => {
    const baseItem = expense().expense_items[0];
    const items = Array.from({ length: 201 }, (_, index) => ({
      ...baseItem,
      id: 151 + index,
      receipt_url: 'private-storage-key',
    }));
    const { service, prisma } = setup({ expenses: [expense({ expense_items: items, receipt_url: 'private-receipt' })] });
    const result = await service.list(context, 90);
    expect(prisma.expenses.findMany.mock.calls[0][0].select.expense_items.take).toBe(201);
    expect(result.data[0].items).toHaveLength(200);
    expect(result.warnings).toContain('EXPENSE_ITEMS_LIMIT_REACHED');
    expect(result.data[0]).not.toHaveProperty('receipt_url');
    expect((result.data[0] as { items: Array<Record<string, unknown>> }).items[0]).not.toHaveProperty('receipt_url');
  });

  it('returns safe decimal balances for expense and line allocations, clamping negative balances with a warning', async () => {
    const { service, prisma } = setup({
      expenses: [expense()],
      groups: [
        { expense_id: 15, expense_item_id: null, _sum: { allocated_net_amount: new Prisma.Decimal('120.00') } },
        { expense_id: 15, expense_item_id: 151, _sum: { allocated_net_amount: new Prisma.Decimal('160.00') } },
      ],
    });
    const result = await service.list(context, 90);
    expect(prisma.received_document_match_allocations.groupBy).toHaveBeenCalledWith(expect.objectContaining({
      by: ['expense_id', 'expense_item_id'],
      where: { organization_id: 4, expense_id: { in: [15] }, status: 'active' },
    }));
    expect(result.data[0]).toMatchObject({ allocated_net_amount: '280.00', remaining_net_amount: '0.00' });
    expect((result.data[0] as { items: Array<Record<string, string>> }).items[0]).toMatchObject({
      allocated_net_amount: '160.00',
      remaining_net_amount: '0.00',
    });
    expect(result.warnings).toContain('EXPENSE_OVERALLOCATED');
    expect(result.warnings).toContain('EXPENSE_ITEM_OVERALLOCATED');
    expect(prisma).not.toHaveProperty('accounts_payable');
    expect(prisma).not.toHaveProperty('accounting_entries');
    expect(prisma).not.toHaveProperty('inventory_movements');
  });
});
