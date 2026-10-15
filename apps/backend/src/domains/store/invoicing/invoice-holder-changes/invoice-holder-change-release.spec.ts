import { Prisma } from '@prisma/client';
import { InvoiceHolderChangesService } from './invoice-holder-changes.service';
import {
  holderEconomicHash,
  HolderOperation,
} from './invoice-holder-change.types';

describe('release requires one accepted economically identical total credit note', () => {
  function harness() {
    const original: any = {
      id: 10,
      order_id: 4,
      status: 'accepted',
      subtotal_amount: new Prisma.Decimal(100),
      total_amount: new Prisma.Decimal(119),
      tax_amount: new Prisma.Decimal(19),
      discount_amount: new Prisma.Decimal(0),
      invoice_items: [
        {
          id: 1,
          description: 'A',
          quantity: 1,
          unit_price: 60,
          total_amount: 79,
        },
        {
          id: 2,
          description: 'B',
          quantity: 1,
          unit_price: 40,
          total_amount: 40,
        },
      ],
      invoice_taxes: [
        { id: 3, invoice_item_id: 1, tax_type: 'iva', tax_amount: 19 },
      ],
    };
    const note: any = {
      ...original,
      id: 11,
      related_invoice_id: 10,
      note_concept_code: '2',
      invoice_items: original.invoice_items.map((i: any) => ({
        ...i,
        id: i.id + 100,
      })),
      invoice_taxes: [
        { ...original.invoice_taxes[0], id: 103, invoice_item_id: 101 },
      ],
    };
    const op = {
      id: 21,
      original_order_id: 4,
      original_invoice_id: 10,
      credit_note_id: 11,
      store_id: 3,
      organization_id: 7,
      accounting_entity_id: 9,
      version: 2,
      phase: 'waiting_credit_note_dian',
      lease_owner: 'worker',
      economic_snapshot_hash: holderEconomicHash(original),
    } as HolderOperation;
    const tx: any = {
      $queryRaw: jest
        .fn()
        .mockImplementation(async (sql: TemplateStringsArray) =>
          sql.join('').includes('SELECT version')
            ? [
                {
                  version: 2,
                  lease_owner: 'worker',
                  lease_expires_at: new Date(Date.now() + 60000),
                },
              ]
            : [{ id: 4 }],
        ),
      invoices: {
        findFirst: jest
          .fn()
          .mockImplementation(async ({ where }: any) =>
            where.id === 10 ? original : note,
          ),
        updateMany: jest.fn(),
      },
      fiscal_transmissions: {
        findFirst: jest.fn().mockResolvedValue({ id: 1 }),
      },
      invoice_holder_changes: {
        updateMany: jest.fn().mockResolvedValue({ count: 1 }),
      },
      fiscal_operation_events: { create: jest.fn() },
    };
    const prisma: any = {
      $transaction: jest.fn(async (work: any) => work(tx)),
    };
    const history: any = { record: jest.fn() };
    const service = new InvoiceHolderChangesService(
      prisma,
      undefined as never,
      undefined as never,
      undefined as never,
      undefined as never,
      undefined as never,
      history,
      undefined as never,
      undefined as never,
      undefined as never,
    );
    const internal = service as unknown as {
      release(op: HolderOperation, originalId: number): Promise<boolean>;
    };
    return {
      tx,
      original,
      note,
      op,
      history,
      release: () => internal.release(op, original.id),
    };
  }
  it('preserves accepted source and note while unlinking once with an audited checkpoint', async () => {
    const { release, tx, history } = harness();
    await expect(release()).resolves.toBe(true);
    expect(tx.invoices.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({ data: { order_id: null } }),
    );
    expect(tx.invoice_holder_changes.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ phase: 'order_released' }),
        where: expect.objectContaining({ version: 2, lease_owner: 'worker' }),
      }),
    );
    expect(history.record).toHaveBeenCalledTimes(1);
  });
  it('freight snapshot matches before unlink; losing it fails closed', async () => {
    const h = harness();
    h.original.shipping_amount = new Prisma.Decimal(5);
    h.note.shipping_amount = new Prisma.Decimal(5);
    h.op.economic_snapshot_hash = holderEconomicHash(h.original);
    await expect(h.release()).resolves.toBe(true);
    const broken = harness();
    broken.original.shipping_amount = new Prisma.Decimal(5);
    broken.note.shipping_amount = new Prisma.Decimal(0);
    broken.op.economic_snapshot_hash = holderEconomicHash(broken.original);
    await expect(broken.release()).rejects.toMatchObject({ errorCode: 'CF_HOLDER_ECONOMIC_MISMATCH' });
    expect(broken.tx.invoices.updateMany).not.toHaveBeenCalled();
  });
  it('a partial or missing qualifying note cannot release the order', async () => {
    const { release, tx, original } = harness();
    tx.invoices.findFirst.mockImplementation(async ({ where }: any) =>
      where.id === 10 ? original : null,
    );
    await expect(release()).rejects.toThrow();
    expect(tx.invoices.updateMany).not.toHaveBeenCalled();
  });
  it('matching header amounts do not authorize reassigned tax-line economics', async () => {
    const { release, tx, note } = harness();
    note.invoice_taxes[0].invoice_item_id = 102;
    await expect(release()).rejects.toMatchObject({
      errorCode: 'CF_HOLDER_ECONOMIC_MISMATCH',
    });
    expect(tx.invoices.updateMany).not.toHaveBeenCalled();
  });
  it('accepted row without accepted DIAN ledger evidence is insufficient', async () => {
    const { release, tx } = harness();
    tx.fiscal_transmissions.findFirst.mockResolvedValue(null);
    await expect(release()).rejects.toThrow();
    expect(tx.invoices.updateMany).not.toHaveBeenCalled();
  });
});
