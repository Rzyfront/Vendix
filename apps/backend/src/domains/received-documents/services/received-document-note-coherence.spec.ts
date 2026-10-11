import { Prisma } from '@prisma/client';
import { evaluateReceivedDocumentNoteCoherence } from './received-document-note-coherence';

const context = { organization_id: 8, accounting_entity_id: 12, store_id: 4 };
const invoice = {
  id: 20, document_type: 'invoice', issuer_tax_id: '900123456', accepted_at: null,
  document_key: 'original-cufe', invoice_number: 'F-20',
  organization_id: 8, accounting_entity_id: 12, store_id: 4,
};
const note = {
  id: 21, document_type: 'credit_note', issuer_tax_id: '900.123.456',
  document_key: 'note-cufe', invoice_number: 'NC-21',
  original_reference_key: null, original_reference_number: 'F-20', accepted_at: null,
};

function client(options: {
  document?: Record<string, unknown>;
  candidates?: Array<Record<string, unknown>>;
  acceptedEvent?: Record<string, unknown> | null;
  originalAfterLock?: Record<string, unknown> | null;
  foreignScope?: boolean;
} = {}) {
  const selectedDocument = options.document ?? note;
  const candidates = options.candidates ?? [invoice];
  const db = {
    received_documents: {
      findFirst: jest.fn(async (args: { where: { id?: number; organization_id?: number; accounting_entity_id?: number; store_id?: number } }) => {
        if (options.foreignScope && args.where.id === selectedDocument.id) return null;
        if (args.where.id === selectedDocument.id) return selectedDocument;
        if (args.where.id === invoice.id) {
          const original = options.originalAfterLock === undefined
            ? candidates.find((candidate) => candidate.id === args.where.id) ?? invoice
            : options.originalAfterLock;
          if (!original) return null;
          return original.organization_id === args.where.organization_id && original.accounting_entity_id === args.where.accounting_entity_id &&
            (args.where.store_id == null || original.store_id === args.where.store_id) ? original : null;
        }
        return null;
      }),
      findMany: jest.fn(async (args: { where: { document_key?: string; invoice_number?: string; organization_id?: number; accounting_entity_id?: number; store_id?: number } }) =>
        candidates.filter((candidate) => candidate.organization_id === args.where.organization_id && candidate.accounting_entity_id === args.where.accounting_entity_id &&
          (args.where.store_id == null || candidate.store_id === args.where.store_id) &&
          (!args.where.document_key || candidate.document_key === args.where.document_key) &&
          (!args.where.invoice_number || candidate.invoice_number === args.where.invoice_number)),
      ),
    },
    received_document_events: {
      findFirst: jest.fn(async () => options.acceptedEvent ?? null),
    },
    $queryRaw: jest.fn(async (_query: unknown) => [{ id: invoice.id }]),
  };
  return { db, transactionClient: db as unknown as Prisma.TransactionClient };
}

describe('evaluateReceivedDocumentNoteCoherence', () => {
  it.each(['credit_note', 'debit_note'])('resolves a %s by invoice number and normalized supplier NIT', async (documentType) => {
    const db = client({ document: { ...note, document_type: documentType } });
    await expect(evaluateReceivedDocumentNoteCoherence(db.transactionClient, context, note.id)).resolves.toEqual({ allowed: true });
    expect(db.db.received_documents.findMany).toHaveBeenCalledWith(expect.objectContaining({
      where: expect.objectContaining({ organization_id: 8, accounting_entity_id: 12, store_id: 4, invoice_number: 'F-20', document_type: 'invoice' }),
      select: expect.objectContaining({ id: true, issuer_tax_id: true, document_type: true }),
    }));
    expect(db.db.$queryRaw).toHaveBeenCalledTimes(1);
    expect((db.db.$queryRaw.mock.calls[0][0] as { sql: string }).sql).toContain('FOR UPDATE');
  });

  it('prefers CUFE and does not fall back to a number when the referenced CUFE has the wrong supplier', async () => {
    const db = client({
      document: { ...note, original_reference_key: 'spoofed-key' },
      candidates: [{ ...invoice, document_key: 'spoofed-key', issuer_tax_id: '800123456' }],
    });
    await expect(evaluateReceivedDocumentNoteCoherence(db.transactionClient, context, note.id)).resolves.toMatchObject({ allowed: false, reason: 'original_unknown' });
    expect(db.db.received_documents.findMany).toHaveBeenCalledTimes(1);
    expect(db.db.received_documents.findMany.mock.calls[0][0].where).toHaveProperty('document_key', 'spoofed-key');
    expect(db.db.received_documents.findMany.mock.calls[0][0].where).not.toHaveProperty('invoice_number');
    expect(db.db.$queryRaw).not.toHaveBeenCalled();
  });

  it('normalizes a raw uppercase CUFE reference against its canonical lowercase original', async () => {
    const canonicalCufe = 'a'.repeat(96);
    const db = client({
      document: { ...note, original_reference_key: canonicalCufe.toUpperCase() },
      candidates: [{ ...invoice, document_key: canonicalCufe }],
    });
    await expect(evaluateReceivedDocumentNoteCoherence(db.transactionClient, context, note.id)).resolves.toEqual({ allowed: true });
    expect(db.db.received_documents.findMany.mock.calls[0][0].where).toHaveProperty('document_key', canonicalCufe);
  });

  it('fails closed for a missing or ambiguous original', async () => {
    await expect(evaluateReceivedDocumentNoteCoherence(client({ candidates: [] }).transactionClient, context, note.id))
      .resolves.toMatchObject({ allowed: false, reason: 'original_unknown' });
    await expect(evaluateReceivedDocumentNoteCoherence(client({ candidates: [invoice, { ...invoice, id: 22 }] }).transactionClient, context, note.id))
      .resolves.toMatchObject({ allowed: false, reason: 'original_ambiguous' });
    await expect(evaluateReceivedDocumentNoteCoherence(client({ document: { ...note, original_reference_number: null } }).transactionClient, context, note.id))
      .resolves.toMatchObject({ allowed: false, reason: 'original_unknown' });
  });

  it('blocks accepted originals by durable timestamp or accepted trusted 033/034 buyer event only', async () => {
    await expect(evaluateReceivedDocumentNoteCoherence(client({ candidates: [{ ...invoice, accepted_at: new Date() }] }).transactionClient, context, note.id))
      .resolves.toMatchObject({ allowed: false, reason: 'original_accepted' });
    for (const eventCode of ['033', '034']) {
      const db = client({ acceptedEvent: { id: 90, event_code: eventCode } });
      await expect(evaluateReceivedDocumentNoteCoherence(db.transactionClient, context, note.id))
        .resolves.toMatchObject({ allowed: false, reason: 'original_accepted' });
      expect(db.db.received_document_events.findFirst).toHaveBeenCalledWith(expect.objectContaining({
        where: { document_id: invoice.id, event_type: 'BUYER_DIAN_EVENT', event_code: { in: ['033', '034'] }, status: 'accepted' },
      }));
    }
    const importedOnly = client({ acceptedEvent: null });
    await expect(evaluateReceivedDocumentNoteCoherence(importedOnly.transactionClient, context, note.id)).resolves.toEqual({ allowed: true });
  });

  it('locks and re-reads the original under tenant, accounting entity, and active store scope before acceptance checks', async () => {
    const db = client({ originalAfterLock: { ...invoice, accepted_at: new Date() } });
    await expect(evaluateReceivedDocumentNoteCoherence(db.transactionClient, context, note.id)).resolves.toMatchObject({ allowed: false, reason: 'original_accepted' });
    expect(db.db.$queryRaw).toHaveBeenCalledTimes(1);
    const lockQuery = db.db.$queryRaw.mock.calls[0][0] as { sql: string };
    expect(lockQuery.sql).toContain('"organization_id"');
    expect(lockQuery.sql).toContain('"accounting_entity_id"');
    expect(lockQuery.sql).toContain('"store_id"');
    expect(lockQuery.sql).toContain('FOR UPDATE');
    expect(db.db.received_documents.findFirst.mock.calls[1][0].where).toEqual({
      organization_id: 8, accounting_entity_id: 12, store_id: 4, id: invoice.id,
    });
  });

  it('fails closed if the locked original no longer matches the selected CUFE or number reference', async () => {
    const keyChanged = client({
      document: { ...note, original_reference_key: 'original-cufe' },
      originalAfterLock: { ...invoice, document_key: 'changed-cufe' },
    });
    await expect(evaluateReceivedDocumentNoteCoherence(keyChanged.transactionClient, context, note.id))
      .resolves.toMatchObject({ allowed: false, reason: 'original_unknown' });

    const numberChanged = client({
      document: { ...note, original_reference_key: null, original_reference_number: 'F-20' },
      originalAfterLock: { ...invoice, invoice_number: 'F-21' },
    });
    await expect(evaluateReceivedDocumentNoteCoherence(numberChanged.transactionClient, context, note.id))
      .resolves.toMatchObject({ allowed: false, reason: 'original_unknown' });

    const disappeared = client({ originalAfterLock: null });
    await expect(evaluateReceivedDocumentNoteCoherence(disappeared.transactionClient, context, note.id))
      .resolves.toMatchObject({ allowed: false, reason: 'original_unknown' });
  });

  it('does not let an archived or unrelated note reference block invoice matching', async () => {
    const db = client({ document: invoice });
    await expect(evaluateReceivedDocumentNoteCoherence(db.transactionClient, context, invoice.id)).resolves.toEqual({ allowed: true });
    expect(db.db.received_documents.findMany).not.toHaveBeenCalled();
    expect(db.db.received_document_events.findFirst).not.toHaveBeenCalled();
    expect(db.db.$queryRaw).not.toHaveBeenCalled();
  });

  it('fails closed when document lookup is outside the selected tenant scope', async () => {
    const db = client({ foreignScope: true });
    await expect(evaluateReceivedDocumentNoteCoherence(db.transactionClient, context, note.id))
      .resolves.toMatchObject({ allowed: false, reason: 'original_unknown' });
    expect(db.db.received_documents.findFirst.mock.calls[0][0].where).toEqual({
      organization_id: 8, accounting_entity_id: 12, store_id: 4, id: note.id,
    });
  });

  it('does not resolve an original from another accounting entity', async () => {
    const db = client({ candidates: [{ ...invoice, accounting_entity_id: 99 }] });
    await expect(evaluateReceivedDocumentNoteCoherence(db.transactionClient, context, note.id))
      .resolves.toMatchObject({ allowed: false, reason: 'original_unknown' });
    expect(db.db.$queryRaw).not.toHaveBeenCalled();
    expect(db.db.received_documents.findMany.mock.calls[0][0].where).toMatchObject({ organization_id: 8, accounting_entity_id: 12, store_id: 4 });
  });
});
