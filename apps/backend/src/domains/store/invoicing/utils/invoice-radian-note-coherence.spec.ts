import { Prisma } from '@prisma/client';
import { VendixHttpException } from '../../../../common/errors';
import { assertNoteOriginalHasNoAcceptedRadianEvent } from './invoice-radian-note-coherence';

const scope = {
  note_type: 'credit_note',
  related_invoice_id: 10,
  organization_id: 2,
  store_id: 3,
  accounting_entity_id: 8,
};

function client(options: {
  original?: { id: number; status?: string } | null;
  event?: { id: number; event_code: string; status?: string; organization_id?: number; store_id?: number; invoice_id?: number } | null;
} = {}) {
  const event = options.event;
  const db = {
    invoices: { findFirst: jest.fn().mockResolvedValue(options.original === undefined ? { id: 10 } : options.original) },
    dian_document_events: {
      findFirst: jest.fn(async ({ where }: { where: { invoice_id: number; organization_id: number; OR: Array<{ store_id: number | null }>; event_code: { in: string[] }; status: string } }) => event &&
        event.invoice_id === where.invoice_id &&
        event.organization_id === where.organization_id &&
        where.OR.some((scope) => event.store_id === scope.store_id) &&
        where.event_code.in.includes(event.event_code) &&
        event.status === where.status
        ? event
        : null),
    },
  };
  return { db, prisma: db as unknown as Prisma.TransactionClient };
}

describe('assertNoteOriginalHasNoAcceptedRadianEvent', () => {
  it.each(['033', '034'])('blocks persisted accepted RADIAN event %s', async (event_code) => {
    const h = client({ event: { id: 50, event_code, status: 'accepted', organization_id: 2, store_id: 3, invoice_id: 10 } });
    await expect(assertNoteOriginalHasNoAcceptedRadianEvent(h.prisma, scope))
      .rejects.toMatchObject({ errorCode: 'INVOICING_STATUS_002' });
    expect(h.db.invoices.findFirst).toHaveBeenCalledWith({
      where: {
        id: 10, organization_id: 2, store_id: 3, accounting_entity_id: 8,
      },
      select: { id: true },
    });
    expect(h.db.dian_document_events.findFirst).toHaveBeenCalledWith({
      where: {
        invoice_id: 10, organization_id: 2, OR: [{ store_id: 3 }, { store_id: null }],
        event_code: { in: ['033', '034'] }, status: 'accepted',
      },
      select: { id: true, event_code: true },
    });
  });

  it('does not confuse DIAN invoice status accepted with a RADIAN event', async () => {
    const h = client({ original: { id: 10, status: 'accepted' }, event: null });
    await expect(assertNoteOriginalHasNoAcceptedRadianEvent(h.prisma, scope)).resolves.toBeUndefined();
    expect(h.db.dian_document_events.findFirst).toHaveBeenCalledTimes(1);
  });

  it('blocks legacy accepted events whose store attribution is null after validating the original store', async () => {
    const h = client({ event: { id: 51, event_code: '033', status: 'accepted', organization_id: 2, store_id: null as unknown as undefined, invoice_id: 10 } });
    await expect(assertNoteOriginalHasNoAcceptedRadianEvent(h.prisma, scope))
      .rejects.toMatchObject({ errorCode: 'INVOICING_STATUS_002' });
    expect(h.db.invoices.findFirst).toHaveBeenCalledWith(expect.objectContaining({
      where: { id: 10, organization_id: 2, store_id: 3, accounting_entity_id: 8 },
    }));
  });

  it('does not block rejected, unrelated-code, or differently scoped events', async () => {
    for (const event of [
      { id: 20, event_code: '033', status: 'rejected', organization_id: 2, store_id: 3, invoice_id: 10 },
      { id: 21, event_code: '032', status: 'accepted', organization_id: 2, store_id: 3, invoice_id: 10 },
      { id: 22, event_code: '033', status: 'accepted', organization_id: 99, store_id: 3, invoice_id: 10 },
      { id: 23, event_code: '034', status: 'accepted', organization_id: 2, store_id: 99, invoice_id: 10 },
      { id: 24, event_code: '033', status: 'accepted', organization_id: 2, store_id: 3, invoice_id: 99 },
    ]) {
      const h = client({ event });
      await expect(assertNoteOriginalHasNoAcceptedRadianEvent(h.prisma, scope)).resolves.toBeUndefined();
      expect(h.db.dian_document_events.findFirst.mock.calls[0][0].where).toMatchObject({
        invoice_id: 10, organization_id: 2, OR: [{ store_id: 3 }, { store_id: null }],
        event_code: { in: ['033', '034'] }, status: 'accepted',
      });
    }
  });

  it('fails closed when the original is unknown or the note lacks its original id', async () => {
    const missing = client({ original: null });
    await expect(assertNoteOriginalHasNoAcceptedRadianEvent(missing.prisma, scope))
      .rejects.toBeInstanceOf(VendixHttpException);
    expect(missing.db.dian_document_events.findFirst).not.toHaveBeenCalled();
    const unlinked = client();
    await expect(assertNoteOriginalHasNoAcceptedRadianEvent(unlinked.prisma, {
      ...scope, related_invoice_id: null,
    })).rejects.toMatchObject({ errorCode: 'INVOICING_STATUS_002' });
    expect(unlinked.db.invoices.findFirst).not.toHaveBeenCalled();
  });

  it('skips unrelated invoice/support-document flows', async () => {
    const h = client();
    await expect(assertNoteOriginalHasNoAcceptedRadianEvent(h.prisma, {
      ...scope, note_type: 'sales_invoice', related_invoice_id: null,
    })).resolves.toBeUndefined();
    expect(h.db.invoices.findFirst).not.toHaveBeenCalled();
    expect(h.db.dian_document_events.findFirst).not.toHaveBeenCalled();
  });
});
