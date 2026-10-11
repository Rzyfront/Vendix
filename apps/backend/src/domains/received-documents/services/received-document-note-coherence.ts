import { ConflictException } from '@nestjs/common';

export interface ReceivedNoteTenantContext {
  organization_id: number;
  accounting_entity_id: number;
  store_id?: number | null;
}

interface ReceivedNoteDocumentClient {
  received_documents: {
    findFirst(args: any): Promise<any>;
    findMany(args: any): Promise<any[]>;
  };
  received_document_events: {
    findFirst(args: any): Promise<any>;
  };
}

export interface ReceivedDocumentNoteCoherenceResult {
  allowed: boolean;
  reason?: 'original_unknown' | 'original_ambiguous' | 'original_accepted';
  note_document_id?: number;
  original_document_id?: number;
  message?: string;
}

const NOTE_TYPES = ['credit_note', 'debit_note'];

/**
 * Conservative guard for effects on received supplier documents. It only
 * trusts explicit buyer-event rows and the durable accepted timestamp; XML,
 * imported ApplicationResponses, and unrelated event families are not proof.
 */
export async function evaluateReceivedDocumentNoteCoherence(
  client: ReceivedNoteDocumentClient,
  context: ReceivedNoteTenantContext,
  documentId: number,
): Promise<ReceivedDocumentNoteCoherenceResult> {
  const scope = {
    id: documentId,
    organization_id: context.organization_id,
    accounting_entity_id: context.accounting_entity_id,
    ...(context.store_id != null ? { store_id: context.store_id } : {}),
  };
  const document = await client.received_documents.findFirst({
    where: scope,
    select: {
      id: true, document_type: true, issuer_tax_id: true, document_key: true,
      original_reference_key: true, original_reference_number: true,
      accepted_at: true,
    },
  });
  if (!document) return { allowed: false, reason: 'original_unknown', message: 'No fue posible resolver el documento recibido en el contexto fiscal actual.' };

  const notes = NOTE_TYPES.includes(String(document.document_type).toLowerCase())
    ? [document]
    : await client.received_documents.findMany({
      where: {
        organization_id: context.organization_id,
        accounting_entity_id: context.accounting_entity_id,
        ...(context.store_id != null ? { store_id: context.store_id } : {}),
        document_type: { in: NOTE_TYPES },
        OR: [
          ...(document.document_key ? [{ original_reference_key: document.document_key }] : []),
          ...(document.invoice_number ? [{ original_reference_number: document.invoice_number }] : []),
        ],
      },
      select: {
        id: true, document_type: true, issuer_tax_id: true, document_key: true,
        original_reference_key: true, original_reference_number: true,
      },
    });

  for (const note of notes) {
    const key = String(note.original_reference_key ?? '').trim();
    const number = String(note.original_reference_number ?? '').trim();
    const issuer = String(note.issuer_tax_id ?? '').trim();
    if (!key && (!number || !issuer)) {
      return { allowed: false, reason: 'original_unknown', note_document_id: note.id, message: 'La nota recibida no identifica de forma suficiente su factura original; no se permiten efectos ni conciliación.' };
    }

    const originalWhere = {
      organization_id: context.organization_id,
      accounting_entity_id: context.accounting_entity_id,
      ...(context.store_id != null ? { store_id: context.store_id } : {}),
      ...(key ? { document_key: key } : { invoice_number: number, issuer_tax_id: issuer }),
    };
    const originals = await client.received_documents.findMany({
      where: originalWhere,
      select: { id: true, document_type: true, issuer_tax_id: true, accepted_at: true },
      take: 2,
    });
    if (originals.length !== 1) {
      return {
        allowed: false,
        reason: originals.length > 1 ? 'original_ambiguous' : 'original_unknown',
        note_document_id: note.id,
        message: originals.length > 1
          ? 'La factura original de la nota recibida es ambigua; no se permiten efectos ni conciliación.'
          : 'No se encontró la factura original de la nota recibida en la entidad fiscal actual; no se permiten efectos ni conciliación.',
      };
    }
    const original = originals[0];
    if (String(original.document_type).toLowerCase() !== 'invoice' || (issuer && String(original.issuer_tax_id ?? '').trim() !== issuer)) {
      return { allowed: false, reason: 'original_unknown', note_document_id: note.id, original_document_id: original.id, message: 'La referencia de la nota no coincide con la identidad de su factura original; no se permiten efectos ni conciliación.' };
    }
    const acceptedEvent = await client.received_document_events.findFirst({
      where: {
        document_id: original.id,
        event_type: 'BUYER_DIAN_EVENT',
        event_code: { in: ['033', '034'] },
        status: 'accepted',
      },
      select: { id: true },
    });
    if (original.accepted_at != null || acceptedEvent) {
      return { allowed: false, reason: 'original_accepted', note_document_id: note.id, original_document_id: original.id, message: 'La factura original tiene aceptación expresa o tácita registrada; la nota recibida se conserva como evidencia, pero no se permite conciliación ni efectos incompatibles.' };
    }
  }
  return { allowed: true };
}

export async function assertReceivedDocumentNoteCoherentForEffects(
  client: ReceivedNoteDocumentClient,
  context: ReceivedNoteTenantContext,
  documentId: number,
): Promise<void> {
  const result = await evaluateReceivedDocumentNoteCoherence(client, context, documentId);
  if (!result.allowed) {
    throw new ConflictException({
      message: result.message,
      code: result.reason,
      note_document_id: result.note_document_id,
      original_document_id: result.original_document_id,
    });
  }
}
