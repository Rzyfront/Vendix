import { NotFoundException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { GlobalPrismaService } from '../../../prisma/services/global-prisma.service';
import { ReceivedDocumentsContext, ReceivedDocumentsService } from '../received-documents.service';
import { ReceivedDocumentMatchCandidatesService } from './received-document-match-candidates.service';

const context: ReceivedDocumentsContext = {
  organization_id: 1,
  accounting_entity_id: 20,
  store_id: 10,
  actor_id: 7,
  is_organization: false,
};

const receivedDocument = {
  id: 90,
  organization_id: 1,
  accounting_entity_id: 20,
  store_id: 10,
  issuer_tax_id: '900123456-7',
  invoice_number: 'FAC-77',
  issue_date: new Date('2026-09-10T00:00:00.000Z'),
  currency: 'COP',
  total_amount: new Prisma.Decimal('119.00'),
  validation_status: 'valid',
  items: [
    {
      id: 901,
      external_code: 'SUP-COF-1',
      product_id: null,
      product_variant_id: null,
      description: 'Café 250 g',
      quantity: new Prisma.Decimal('2'),
      unit_code: 'EA',
    },
  ],
};

function po(overrides: Record<string, unknown> = {}) {
  return {
    id: 301,
    organization_id: 1,
    supplier_id: 4,
    order_number: 'PO-301',
    status: 'received',
    supplier_invoice_number: 'FAC-77',
    supplier_invoice_date: new Date('2026-09-10T00:00:00.000Z'),
    order_date: new Date('2026-09-01T00:00:00.000Z'),
    expected_date: null,
    received_date: new Date('2026-09-10T00:00:00.000Z'),
    subtotal_amount: new Prisma.Decimal('100.00'),
    tax_amount: new Prisma.Decimal('19.00'),
    total_amount: new Prisma.Decimal('119.00'),
    suppliers: { id: 4, name: 'Coffee Supplier SAS', tax_id: '900.123.456-7' },
    location: { id: 5, name: 'Bodega Norte', store_id: 10, is_central_warehouse: false },
    purchase_order_items: [
      {
        id: 3101,
        product_id: 100,
        product_variant_id: null,
        quantity_ordered: 2,
        quantity_received: 2,
        unit_cost: new Prisma.Decimal('50.0000'),
        unit_price_net: new Prisma.Decimal('50.0000'),
        discount_amount: new Prisma.Decimal('0.00'),
        tax_rate: new Prisma.Decimal('19.00'),
        tax_type: 'iva',
        purchase_uom_id: 8,
        products: {
          id: 100,
          name: 'Café 250 g',
          sku: 'COF-250',
          barcode: '77000100',
          purchase_unit: 'EA',
          purchase_to_stock_factor: 1,
          stores: { organization_id: 1 },
        },
        product_variants: null,
        purchase_order_item_taxes: [
          {
            tax_name: 'IVA',
            tax_type: 'iva',
            tax_rate: new Prisma.Decimal('19.0000'),
            calc_mode: 'percent',
            taxable_amount: new Prisma.Decimal('100.00'),
            tax_amount: new Prisma.Decimal('19.00'),
          },
        ],
      },
    ],
    receptions: [
      {
        id: 401,
        received_at: new Date('2026-09-10T09:00:00.000Z'),
        items: [
          {
            id: 4011,
            purchase_order_item_id: 3101,
            quantity_received: 2,
            note: null,
          },
        ],
      },
    ],
    ...overrides,
  };
}

function setup(options: {
  suppliers?: Array<{ id: number; name: string; tax_id: string | null; store_id: number | null }>;
  orders?: ReturnType<typeof po>[];
  document?: typeof receivedDocument | null;
  catalog?: Array<{
    supplier_sku: string | null;
    product_id: number;
    product_variants: Array<{ id: number; sku: string; barcode: string | null }>;
  }>;
  uoms?: Array<{ id: number; code: string; name: string }>;
  purchaseAllocations?: Array<{ purchase_order_item_id: number; _sum: { target_quantity: Prisma.Decimal | null } }>;
  receptionAllocations?: Array<{ reception_item_id: number; _sum: { target_quantity: Prisma.Decimal | null } }>;
} = {}) {
  const prisma = {
    received_documents: { findFirst: jest.fn().mockResolvedValue(options.document === undefined ? receivedDocument : options.document) },
    $queryRaw: jest.fn().mockResolvedValue(options.suppliers ?? [
      { id: 4, name: 'Coffee Supplier SAS', tax_id: '900.123.456-7', store_id: null },
    ]),
    supplier_products: { findMany: jest.fn().mockResolvedValue(options.catalog ?? [
      { supplier_sku: 'SUP-COF-1', product_id: 100, product_variants: [] },
    ]) },
    purchase_orders: { findMany: jest.fn().mockResolvedValue(options.orders ?? [po()]) },
    units_of_measure: { findMany: jest.fn().mockResolvedValue(options.uoms ?? [{ id: 8, code: 'EA', name: 'Unidad' }]) },
    received_document_match_allocations: {
      groupBy: jest.fn().mockImplementation(({ by }: { by: string[] }) =>
        by[0] === 'purchase_order_item_id'
          ? Promise.resolve(options.purchaseAllocations ?? [])
          : Promise.resolve(options.receptionAllocations ?? [])),
    },
  };
  const documents = { assertContext: jest.fn().mockResolvedValue(undefined) };
  const service = new ReceivedDocumentMatchCandidatesService(
    prisma as unknown as GlobalPrismaService,
    documents as unknown as ReceivedDocumentsService,
  );
  return { service, prisma, documents };
}

describe('ReceivedDocumentMatchCandidatesService', () => {
  it('canonicalizes supplier NIT and ranks exact supplier invoice reference before weaker product evidence', async () => {
    const weakReference = po({
      id: 302,
      order_number: 'PO-302',
      supplier_invoice_number: null,
      total_amount: new Prisma.Decimal('125.00'),
      purchase_order_items: [{
        ...po().purchase_order_items[0],
        id: 3201,
        product_id: 200,
        products: {
          ...po().purchase_order_items[0].products,
          id: 200,
          name: 'Té negro',
          sku: 'TEA-100',
        },
      }],
    });
    const exactReference = po({ id: 301, supplier_invoice_number: 'fac-77' });
    const { service, prisma, documents } = setup({ orders: [weakReference, exactReference] });

    const result = await service.list(context, 90);

    expect(documents.assertContext).toHaveBeenCalledWith(context);
    expect(prisma.$queryRaw).toHaveBeenCalledTimes(1);
    const sql = prisma.$queryRaw.mock.calls[0][0] as Prisma.Sql;
    expect(sql.sql).toContain('organization_id =');
    expect(sql.sql).toContain("state <> 'archived'");
    expect(sql.sql).toContain("regexp_replace(split_part(tax_id, '-', 1), '[^0-9]', '', 'g')");
    expect(sql.sql).toContain('store_id =');
    expect(sql.values).toEqual([1, '900123456', 10, 10, 101]);
    expect(prisma.purchase_orders.findMany).toHaveBeenCalledWith(expect.objectContaining({
      where: expect.objectContaining({ organization_id: 1, supplier_id: 4, location: expect.objectContaining({ organization_id: 1 }) }),
      take: 100,
    }));
    expect(result.candidates[0]).toMatchObject({
      purchase_order_id: 301,
      evidence_tier: 'strong',
      reason_codes: expect.arrayContaining(['EXACT_SUPPLIER_INVOICE_REFERENCE']),
      currency: null,
    });
    expect(result.candidates[0].items[0]).toMatchObject({
      id: 3101,
      quantity_ordered: '2',
      quantity_received: '2',
      allocated_quantity: '0',
      remaining_quantity: '2',
      purchase_uom_code: 'EA',
      match_reason_codes: expect.arrayContaining(['EXACT_SKU_OR_SUPPLIER_CODE']),
    });
    expect(result.candidates[0].items[0].taxes[0]).not.toHaveProperty('eligible_amount');
    expect(result.candidates[0].receptions[0].items[0]).toMatchObject({
      allocated_quantity: '0',
      remaining_quantity: '2',
    });
  });

  it('subtracts active allocations from other documents when showing PO and receipt availability', async () => {
    const { service, prisma } = setup({
      purchaseAllocations: [{ purchase_order_item_id: 3101, _sum: { target_quantity: new Prisma.Decimal('0.75') } }],
      receptionAllocations: [{ reception_item_id: 4011, _sum: { target_quantity: new Prisma.Decimal('1.5') } }],
    });
    const result = await service.list(context, 90);
    const candidate = result.candidates[0];
    expect(candidate.items[0]).toMatchObject({ allocated_quantity: '0.75', remaining_quantity: '1.25' });
    expect(candidate.receptions[0].items[0]).toMatchObject({ allocated_quantity: '1.5', remaining_quantity: '0.5' });
    expect(prisma.received_document_match_allocations.groupBy).toHaveBeenNthCalledWith(1, expect.objectContaining({
      by: ['purchase_order_item_id'],
      where: { organization_id: 1, status: 'active', purchase_order_item_id: { in: [3101] } },
    }));
    expect(prisma.received_document_match_allocations.groupBy).toHaveBeenNthCalledWith(2, expect.objectContaining({
      by: ['reception_item_id'],
      where: { organization_id: 1, status: 'active', reception_item_id: { in: [4011] } },
    }));
  });

  it('warns and downgrades evidence when historical active allocations exceed a target', async () => {
    const { service } = setup({
      purchaseAllocations: [{ purchase_order_item_id: 3101, _sum: { target_quantity: new Prisma.Decimal('3') } }],
    });
    const result = await service.list(context, 90);
    expect(result.candidates[0].items[0]).toMatchObject({ allocated_quantity: '3', remaining_quantity: '0' });
    expect(result.candidates[0].evidence_tier).toBe('review');
    expect(result.candidates[0].reason_codes).toContain('PO_ITEM_ALLOCATION_EXCEEDS_ORDERED');
    expect(result.warnings).toContain('PO_ITEM_ALLOCATION_EXCEEDS_ORDERED');
  });

  it('aggregates active balances only for PO and receipt line IDs on the returned page', async () => {
    const base = po();
    const orders = Array.from({ length: 6 }, (_, index) => po({
      id: 301 + index,
      order_number: `PO-${301 + index}`,
      supplier_invoice_number: null,
      purchase_order_items: [{ ...base.purchase_order_items[0], id: 3101 + index }],
      receptions: [{
        ...base.receptions[0],
        id: 401 + index,
        items: [{ ...base.receptions[0].items[0], id: 4011 + index }],
      }],
    }));
    const { service, prisma } = setup({ orders });
    const result = await service.list(context, 90, { limit: 2 });
    expect(result.candidates).toHaveLength(2);
    expect(prisma.received_document_match_allocations.groupBy).toHaveBeenCalledTimes(2);
    const purchaseQuery = prisma.received_document_match_allocations.groupBy.mock.calls[0][0];
    const receptionQuery = prisma.received_document_match_allocations.groupBy.mock.calls[1][0];
    expect(purchaseQuery.where.organization_id).toBe(1);
    expect(purchaseQuery.where.status).toBe('active');
    expect(purchaseQuery.where.purchase_order_item_id.in).toHaveLength(2);
    expect(receptionQuery.where.reception_item_id.in).toHaveLength(2);
  });

  it('scopes PO candidates to the document store plus central location, never another store', async () => {
    const { service, prisma } = setup();
    await service.list(context, 90);
    const query = prisma.purchase_orders.findMany.mock.calls[0][0];
    expect(query.where.organization_id).toBe(1);
    expect(query.where.supplier_id).toBe(4);
    expect(query.where.location).toEqual({
      organization_id: 1,
      OR: [{ store_id: 10 }, { store_id: null }],
    });
    expect(query.where.location.OR).not.toContainEqual({ store_id: 11 });
  });

  it('returns central PO only as review evidence and warns that receipt/currency need review', async () => {
    const central = po({
      location: { id: 6, name: 'Central warehouse', store_id: null, is_central_warehouse: true },
      receptions: [],
    });
    const { service } = setup({ orders: [central] });
    const result = await service.list(context, 90);
    expect(result.candidates[0]).toMatchObject({
      evidence_tier: 'review',
      reason_codes: expect.arrayContaining(['CENTRAL_LOCATION_MANUAL_REVIEW']),
    });
    expect(result.warnings).toEqual(expect.arrayContaining([
      'CENTRAL_LOCATION_REQUIRES_REVIEW',
      'NO_RECEIPT_RECORDED',
      'PO_CURRENCY_NOT_STORED',
    ]));
  });

  it('returns no automatic suggestions if supplier NIT is ambiguous', async () => {
    const supplier = { id: 5, name: 'Duplicate Supplier', tax_id: '900123456-7', store_id: 10 };
    const { service, prisma } = setup({ suppliers: [
      { id: 4, name: 'Coffee Supplier SAS', tax_id: '900.123.456-7', store_id: null },
      supplier,
    ] });
    const result = await service.list(context, 90);
    expect(result.candidates).toEqual([]);
    expect(result.warnings).toContain('SUPPLIER_MATCH_AMBIGUOUS');
    expect(prisma.purchase_orders.findMany).not.toHaveBeenCalled();
  });

  it('matches normalized NIT digits despite spaces/dots and keeps the SQL lookup tenant/store scoped', async () => {
    const { service, prisma } = setup({ suppliers: [
      { id: 4, name: 'Coffee Supplier SAS', tax_id: '900 123 456-7', store_id: null },
    ] });
    const result = await service.list(context, 90);
    expect(result.candidates).toHaveLength(1);
    const sql = prisma.$queryRaw.mock.calls[0][0] as Prisma.Sql;
    expect(sql.sql).toContain('organization_id =');
    expect(sql.values).toEqual([1, '900123456', 10, 10, 101]);
    expect(sql.sql).toContain("state <> 'archived'");
    expect(sql.sql).toContain('store_id =');
  });

  it('never labels a non-COP invoice as strong evidence', async () => {
    const usdDocument = { ...receivedDocument, currency: 'USD' };
    const { service } = setup({ document: usdDocument });
    const result = await service.list(context, 90);
    expect(result.candidates[0].evidence_tier).toBe('review');
    expect(result.warnings).toContain('DOCUMENT_CURRENCY_NOT_COP');
  });

  it('detects truncated PO lines and downgrades incomplete evidence to review', async () => {
    const base = po();
    const lines = Array.from({ length: 201 }, (_, index) => ({
      ...base.purchase_order_items[0],
      id: 3101 + index,
    }));
    const { service, prisma } = setup({ orders: [po({ purchase_order_items: lines })] });
    const result = await service.list(context, 90);
    expect(prisma.purchase_orders.findMany.mock.calls[0][0].include.purchase_order_items.take).toBe(201);
    expect(result.warnings).toContain('PO_LINES_LIMIT_REACHED');
    expect(result.candidates[0].items).toHaveLength(200);
    expect(result.candidates[0].evidence_tier).toBe('review');
    expect(result.candidates[0].reason_codes).toContain('MATCH_EVIDENCE_TRUNCATED_REQUIRES_REVIEW');
  });

  it('returns a warning and no candidates when the supplier cannot be resolved', async () => {
    const { service, prisma } = setup({ suppliers: [] });
    const result = await service.list(context, 90);
    expect(result).toEqual({ candidates: [], warnings: expect.arrayContaining(['SUPPLIER_NOT_FOUND']) });
    expect(prisma.purchase_orders.findMany).not.toHaveBeenCalled();
  });

  it('bounds candidate count and applies query search without mutating financial or inventory records', async () => {
    const orders = Array.from({ length: 100 }, (_, index) => po({
      id: 301 + index,
      order_number: `PO-${301 + index}`,
      supplier_invoice_number: `FAC-${301 + index}`,
    }));
    const { service, prisma } = setup({ orders });
    const result = await service.list(context, 90, { search: 'PO-', limit: 3 });
    expect(result.candidates).toHaveLength(3);
    expect(result.warnings).toContain('PO_CANDIDATE_SEARCH_LIMIT_REACHED');
    expect(prisma.purchase_orders.findMany.mock.calls[0][0].where.AND[0].OR).toHaveLength(2);
    expect(prisma).not.toHaveProperty('accounts_payable');
    expect(prisma).not.toHaveProperty('inventory_movements');
    expect(prisma).not.toHaveProperty('accounting_entries');
  });

  it('404s a document outside the explicit organization/entity/store scope', async () => {
    const { service, prisma } = setup({ document: null });
    await expect(service.list(context, 90)).rejects.toBeInstanceOf(NotFoundException);
    expect(prisma.$queryRaw).not.toHaveBeenCalled();
    expect(prisma.purchase_orders.findMany).not.toHaveBeenCalled();
  });

  it('rejects nonpositive document IDs and invalid bounds before any candidate query', async () => {
    const { service, prisma } = setup();
    await expect(service.list(context, 0)).rejects.toThrow();
    await expect(service.list(context, 90, { limit: 21 })).rejects.toThrow();
    await expect(service.list(context, 90, { search: 'x'.repeat(101) })).rejects.toThrow();
    expect(prisma.received_documents.findFirst).not.toHaveBeenCalled();
  });
});
