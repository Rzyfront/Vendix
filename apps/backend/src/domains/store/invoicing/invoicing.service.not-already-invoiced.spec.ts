import { InvoicingService } from './invoicing.service';

/**
 * S4 (factura-zzz-titular): una sales_invoice aceptada revertida por completo
 * con notas crédito ACEPTADAS deja de bloquear una nueva emisión sobre la
 * orden. Una NC parcial/no aceptada o cualquier otra factura viva sigue
 * bloqueando (INVOICING_CREATE_002). Variante `sales_order_id` sin cambios.
 */
describe('InvoicingService · assertNotAlreadyInvoiced (S4)', () => {
  const build = (rows: any[], reversedIds: number[] = []) => {
    const findFirst = jest.fn(async ({ where }: any) => {
      const excluded: number[] = where.id?.notIn ?? [];
      return rows.find((r) => !excluded.includes(r.id)) ?? null;
    });
    const isFullyReversedByAcceptedNotes = jest.fn(async (id: number) =>
      reversedIds.includes(id),
    );
    const service = Object.create(InvoicingService.prototype) as any;
    service.prisma = { invoices: { findFirst } };
    service.creditNoteBalance = { isFullyReversedByAcceptedNotes };
    return { service, findFirst, isFullyReversedByAcceptedNotes };
  };
  const accepted = { id: 5, invoice_number: 'SETT-5', status: 'accepted' };

  it('permite emitir cuando la única factura viva es una aceptada revertida por completo', async () => {
    const { service, isFullyReversedByAcceptedNotes } = build([accepted], [5]);
    await expect(
      service.assertNotAlreadyInvoiced({ order_id: 10 }),
    ).resolves.toBeUndefined();
    expect(isFullyReversedByAcceptedNotes).toHaveBeenCalledWith(5);
  });

  it('bloquea con INVOICING_CREATE_002 si la aceptada solo está parcialmente revertida', async () => {
    const { service } = build([accepted], []);
    await expect(
      service.assertNotAlreadyInvoiced({ order_id: 10 }),
    ).rejects.toMatchObject({ errorCode: 'INVOICING_CREATE_002' });
  });

  it('bloquea si además de la revertida hay una factura viva más reciente (draft)', async () => {
    const draft = { id: 9, invoice_number: null, status: 'draft' };
    const { service } = build([draft, accepted], [5]);
    await expect(
      service.assertNotAlreadyInvoiced({ order_id: 10 }),
    ).rejects.toMatchObject({ errorCode: 'INVOICING_CREATE_002' });
  });

  it('no consulta la reversión para facturas no aceptadas (sent sigue bloqueando)', async () => {
    const sent = { id: 6, invoice_number: 'SETT-6', status: 'sent' };
    const { service, isFullyReversedByAcceptedNotes } = build([sent], [6]);
    await expect(
      service.assertNotAlreadyInvoiced({ order_id: 10 }),
    ).rejects.toMatchObject({ errorCode: 'INVOICING_CREATE_002' });
    expect(isFullyReversedByAcceptedNotes).not.toHaveBeenCalled();
  });

  it('la variante sales_order_id no cambia: una aceptada sigue bloqueando', async () => {
    const { service, isFullyReversedByAcceptedNotes } = build([accepted], [5]);
    await expect(
      service.assertNotAlreadyInvoiced({ sales_order_id: 3 }),
    ).rejects.toMatchObject({ errorCode: 'INVOICING_CREATE_002' });
    expect(isFullyReversedByAcceptedNotes).not.toHaveBeenCalled();
  });
});
