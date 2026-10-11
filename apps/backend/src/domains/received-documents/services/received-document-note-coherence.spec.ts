import { evaluateReceivedDocumentNoteCoherence } from './received-document-note-coherence';

const context = { organization_id: 8, accounting_entity_id: 12, store_id: 4 };
const invoice = { id: 20, document_type: 'invoice', issuer_tax_id: '900100200', accepted_at: null };
const note = { id: 21, document_type: 'credit_note', issuer_tax_id: invoice.issuer_tax_id, original_reference_key: 'cufe-original', original_reference_number: 'F-20' };

function client(options: { document?: any; notes?: any[]; originals?: any[]; acceptedEvent?: any } = {}) {
  return {
    received_documents: {
      findFirst: jest.fn().mockResolvedValue(options.document ?? { ...invoice, document_key: 'cufe-original' }),
      findMany: jest.fn().mockImplementation((args: any) => Promise.resolve(
        args.where.document_type ? options.notes ?? [note] : options.originals ?? [invoice],
      )),
    },
    received_document_events: { findFirst: jest.fn().mockResolvedValue(options.acceptedEvent ?? null) },
  };
}

describe('evaluateReceivedDocumentNoteCoherence', () => {
  it('allows a note whose original is known, scoped, and not accepted', async () => {
    const db = client();
    await expect(evaluateReceivedDocumentNoteCoherence(db, context, 20)).resolves.toEqual({ allowed: true });
    expect(db.received_documents.findMany.mock.calls[0][0].where).toMatchObject({ organization_id: 8, accounting_entity_id: 12, store_id: 4 });
    expect(db.received_document_events.findFirst).toHaveBeenCalledWith(expect.objectContaining({ where: expect.objectContaining({ event_type: 'BUYER_DIAN_EVENT', event_code: { in: ['033', '034'] }, status: 'accepted' }) }));
  });

  it('blocks effects when the original has a durable accepted timestamp or trusted accepted buyer event', async () => {
    await expect(evaluateReceivedDocumentNoteCoherence(client({ originals: [{ ...invoice, accepted_at: new Date() }] }), context, 20)).resolves.toMatchObject({ allowed: false, reason: 'original_accepted' });
    await expect(evaluateReceivedDocumentNoteCoherence(client({ acceptedEvent: { id: 90 } }), context, 20)).resolves.toMatchObject({ allowed: false, reason: 'original_accepted' });
  });

  it('fails closed when a note original cannot be resolved or is ambiguous', async () => {
    await expect(evaluateReceivedDocumentNoteCoherence(client({ originals: [] }), context, 20)).resolves.toMatchObject({ allowed: false, reason: 'original_unknown' });
    await expect(evaluateReceivedDocumentNoteCoherence(client({ originals: [invoice, { ...invoice, id: 22 }] }), context, 20)).resolves.toMatchObject({ allowed: false, reason: 'original_ambiguous' });
    await expect(evaluateReceivedDocumentNoteCoherence(client({ document: { ...note, original_reference_key: null, original_reference_number: null } }), context, 21)).resolves.toMatchObject({ allowed: false, reason: 'original_unknown' });
  });

  it('ignores unrelated imported acceptance events and keeps store scoping operationally narrow', async () => {
    const db = client({ acceptedEvent: null });
    await expect(evaluateReceivedDocumentNoteCoherence(db, { organization_id: 8, accounting_entity_id: 12 }, 20)).resolves.toEqual({ allowed: true });
    expect(db.received_documents.findMany.mock.calls[0][0].where).not.toHaveProperty('store_id');
    expect(db.received_document_events.findFirst.mock.calls[0][0].where.event_type).toBe('BUYER_DIAN_EVENT');
  });
});
