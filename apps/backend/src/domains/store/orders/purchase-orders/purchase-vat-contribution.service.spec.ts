import { ConflictException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { GlobalPrismaService } from '../../../../prisma/services/global-prisma.service';
import { PurchaseVatContributionService } from './purchase-vat-contribution.service';
import { PurchaseVatContributionSnapshotInput } from './purchase-vat-contribution-snapshot.util';

const input = (patch: Partial<PurchaseVatContributionSnapshotInput> = {}): PurchaseVatContributionSnapshotInput => ({
  organization_id: 1, accounting_entity_id: 2, store_id: 3,
  purchase_order_id: 42, reception_id: 91, supplier_id: 7,
  supplier_tax_id_snapshot: '900123456', invoice_number_snapshot: 'FC-1',
  invoice_issue_date_snapshot: '2026-09-30', currency: 'COP', net_amount: '100.00', iva_amount: '19.00',
  tax_groups: [{ tax_type: 'iva', tax_rate: 19, taxable_amount: '100.00', tax_amount: '19.00' }],
  ...patch,
});

describe('PurchaseVatContributionService.reserve', () => {
  let service: PurchaseVatContributionService;
  let prisma: any;
  let tx: any;
  let created: any;

  const setup = () => {
    created = null;
    tx = {
      stores: { findFirst: jest.fn().mockResolvedValue({ id: 3 }) },
      purchase_orders: { findFirst: jest.fn().mockResolvedValue({ id: 42, organization_id: 1, supplier_id: 7, supplier_invoice_number: ' FC-1 ', supplier_invoice_date: new Date('2026-09-30T00:00:00.000Z'), location: { store_id: 3 } }) },
      purchase_order_receptions: { findFirst: jest.fn().mockResolvedValue({ id: 91 }) },
      suppliers: { findFirst: jest.fn().mockResolvedValue({ id: 7, tax_id: ' 900123456 ' }) },
      accounting_entities: { findFirst: jest.fn().mockResolvedValue({ id: 2, fiscal_scope: 'STORE', store_id: 3 }) },
      purchase_vat_contributions: {
        findUnique: jest.fn().mockResolvedValue(null),
        create: jest.fn().mockImplementation(({ data }) => {
          created = { id: 555, ...data };
          return Promise.resolve(created);
        }),
      },
    };
    prisma = {
      $transaction: jest.fn(async (callback: (client: any) => unknown) => callback(tx)),
      purchase_vat_contributions: { findUnique: jest.fn() },
    };
    service = new PurchaseVatContributionService(prisma as GlobalPrismaService);
  };

  beforeEach(setup);

  it('validates scoped source records and creates a pending immutable snapshot', async () => {
    const result = await service.reserve(input());
    expect(result).toBe(created);
    expect(tx.stores.findFirst).toHaveBeenCalledWith({ where: { id: 3, organization_id: 1 }, select: { id: true } });
    expect(tx.purchase_orders.findFirst).toHaveBeenCalledWith(expect.objectContaining({
      where: { id: 42, organization_id: 1, supplier_id: 7 },
      select: expect.objectContaining({ supplier_invoice_number: true, supplier_invoice_date: true }),
    }));
    expect(tx.purchase_order_receptions.findFirst).toHaveBeenCalledWith({ where: { id: 91, purchase_order_id: 42 }, select: { id: true } });
    expect(tx.suppliers.findFirst).toHaveBeenCalledWith({ where: { id: 7, organization_id: 1 }, select: { id: true, tax_id: true } });
    expect(tx.accounting_entities.findFirst).toHaveBeenCalledWith({ where: { id: 2, organization_id: 1, is_active: true }, select: { id: true, fiscal_scope: true, store_id: true } });
    expect(created).toMatchObject({
      store_id: 3, source_effect_key: 'po:42:deductible-iva:v1',
      ledger_status: 'pending', fiscal_status: 'awaiting_document',
      invoice_issue_date_snapshot: new Date('2026-09-30T00:00:00.000Z'),
    });
    expect(created).not.toHaveProperty('received_document_id');
    expect(created).not.toHaveProperty('accounting_entry_id');
  });

  it('returns existing matching hash on replay without a second create', async () => {
    const existing = { payload_hash: 'same', id: 44 };
    const { buildPurchaseVatContributionSnapshot } = await import('./purchase-vat-contribution-snapshot.util');
    existing.payload_hash = buildPurchaseVatContributionSnapshot(input()).payload_hash;
    tx.purchase_vat_contributions.findUnique.mockResolvedValue(existing);
    expect(await service.reserve(input())).toBe(existing);
    expect(tx.purchase_vat_contributions.create).not.toHaveBeenCalled();
  });

  it.each([
    ['changed cents', { iva_amount: '19.01', tax_groups: [{ tax_type: 'iva', tax_rate: 19, taxable_amount: '100', tax_amount: '19.01' }] }],
    ['changed date', { invoice_issue_date_snapshot: '2026-10-01' }],
  ])('rejects a changed source payload on replay (%s)', async (_label, patch) => {
    const { buildPurchaseVatContributionSnapshot } = await import('./purchase-vat-contribution-snapshot.util');
    tx.purchase_vat_contributions.findUnique.mockResolvedValue({ payload_hash: buildPurchaseVatContributionSnapshot(input()).payload_hash });
    await expect(service.reserve(input(patch as Partial<PurchaseVatContributionSnapshotInput>))).rejects.toBeInstanceOf(ConflictException);
    expect(tx.purchase_vat_contributions.create).not.toHaveBeenCalled();
  });

  it('rejects foreign store and caller-supplied invoice/tax identity drift before writing', async () => {
    tx.stores.findFirst.mockResolvedValue(null);
    await expect(service.reserve(input({ organization_id: 8 }))).rejects.toBeInstanceOf(ConflictException);
    expect(tx.purchase_vat_contributions.create).not.toHaveBeenCalled();

    setup();
    await expect(service.reserve(input({ invoice_number_snapshot: 'OTHER' }))).rejects.toBeInstanceOf(ConflictException);
    expect(tx.purchase_orders.findFirst).toHaveBeenCalled();
    expect(tx.purchase_vat_contributions.findUnique).not.toHaveBeenCalled();
    expect(tx.purchase_vat_contributions.create).not.toHaveBeenCalled();

    setup();
    await expect(service.reserve(input({ invoice_issue_date_snapshot: '2026-10-01' }))).rejects.toBeInstanceOf(ConflictException);
    expect(tx.purchase_orders.findFirst).toHaveBeenCalled();
    expect(tx.purchase_vat_contributions.findUnique).not.toHaveBeenCalled();
    expect(tx.purchase_vat_contributions.create).not.toHaveBeenCalled();

    setup();
    await expect(service.reserve(input({ supplier_tax_id_snapshot: '999' }))).rejects.toBeInstanceOf(ConflictException);
    expect(tx.purchase_orders.findFirst).toHaveBeenCalled();
    expect(tx.purchase_order_receptions.findFirst).toHaveBeenCalled();
    expect(tx.suppliers.findFirst).toHaveBeenCalled();
    expect(tx.purchase_vat_contributions.findUnique).not.toHaveBeenCalled();
    expect(tx.purchase_vat_contributions.create).not.toHaveBeenCalled();
  });

  it('rejects same-key replay hash drift after persisted PO invoice date and input move together', async () => {
    const { buildPurchaseVatContributionSnapshot } = await import('./purchase-vat-contribution-snapshot.util');
    const prior = buildPurchaseVatContributionSnapshot(input());
    tx.purchase_orders.findFirst.mockResolvedValue({
      id: 42, organization_id: 1, supplier_id: 7,
      supplier_invoice_number: 'FC-1', supplier_invoice_date: new Date('2026-10-01T00:00:00.000Z'),
      location: { store_id: 3 },
    });
    tx.purchase_vat_contributions.findUnique.mockResolvedValue({ id: 44, payload_hash: prior.payload_hash });

    await expect(service.reserve(input({ invoice_issue_date_snapshot: '2026-10-01' }))).rejects.toBeInstanceOf(ConflictException);
    expect(tx.purchase_vat_contributions.findUnique).toHaveBeenCalledWith({
      where: { organization_id_accounting_entity_id_source_effect_key: {
        organization_id: 1, accounting_entity_id: 2, source_effect_key: 'po:42:deductible-iva:v1',
      } },
    });
    expect(tx.purchase_vat_contributions.create).not.toHaveBeenCalled();
  });

  it('recovers a P2002 race by refetching and comparing the same scoped effect key', async () => {
    const { buildPurchaseVatContributionSnapshot } = await import('./purchase-vat-contribution-snapshot.util');
    const snapshot = buildPurchaseVatContributionSnapshot(input());
    tx.purchase_vat_contributions.create.mockRejectedValue(new Prisma.PrismaClientKnownRequestError('unique', { code: 'P2002', clientVersion: 'test' }));
    const raced = { id: 999, payload_hash: snapshot.payload_hash };
    prisma.purchase_vat_contributions.findUnique.mockResolvedValue(raced);
    expect(await service.reserve(input())).toBe(raced);
    expect(prisma.purchase_vat_contributions.findUnique).toHaveBeenCalledWith({ where: { organization_id_accounting_entity_id_source_effect_key: {
      organization_id: 1, accounting_entity_id: 2, source_effect_key: 'po:42:deductible-iva:v1',
    } } });
  });

  it.each([
    ['foreign PO', 'purchase_orders', null],
    ['foreign reception', 'purchase_order_receptions', null],
    ['foreign supplier', 'suppliers', null],
    ['foreign entity', 'accounting_entities', null],
  ])('rejects %s before writing', async (_label, model, result) => {
    const method = model === 'purchase_order_receptions' ? 'findFirst' : 'findFirst';
    tx[model][method].mockResolvedValue(result);
    await expect(service.reserve(input())).rejects.toBeInstanceOf(ConflictException);
    expect(tx.purchase_vat_contributions.create).not.toHaveBeenCalled();
  });

  it('rejects entity fiscal-scope and PO location store mismatches without writes', async () => {
    tx.accounting_entities.findFirst.mockResolvedValue({ id: 2, fiscal_scope: 'ORGANIZATION', store_id: 3 });
    await expect(service.reserve(input())).rejects.toBeInstanceOf(ConflictException);
    expect(tx.purchase_vat_contributions.create).not.toHaveBeenCalled();

    setup();
    tx.purchase_orders.findFirst.mockResolvedValue({ id: 42, organization_id: 1, supplier_id: 7, supplier_invoice_number: 'FC-1', supplier_invoice_date: new Date('2026-09-30T00:00:00.000Z'), location: { store_id: 8 } });
    await expect(service.reserve(input())).rejects.toBeInstanceOf(ConflictException);
    expect(tx.purchase_vat_contributions.create).not.toHaveBeenCalled();
  });

  it('does not write if pure input validation fails', async () => {
    await expect(service.reserve(input({ net_amount: '-1' }))).rejects.toThrow();
    expect(prisma.$transaction).not.toHaveBeenCalled();
  });
});
