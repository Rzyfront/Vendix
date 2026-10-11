import { ConflictException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { normalizeNit } from '../../../common/utils/nit.util';

export interface ReceivedNoteTenantContext {
  organization_id: number;
  accounting_entity_id: number;
  store_id?: number | null;
}

type ReceivedNoteDocumentClient = Pick<Prisma.TransactionClient, '$queryRaw' | 'received_documents' | 'received_document_events'>;

interface NoteDocumentProjection {
  id: number;
  document_type: string;
  issuer_tax_id: string | null;
  document_key: string | null;
  invoice_number: string | null;
  original_reference_key: string | null;
  original_reference_number: string | null;
  accepted_at: Date | null;
}

interface OriginalDocumentProjection {
  id: number;
  document_type: string;
  issuer_tax_id: string | null;
  accepted_at: Date | null;
  document_key: string | null;
  invoice_number: string | null;
}

export interface ReceivedDocumentNoteCoherenceResult {
  allowed: boolean;
  reason?: 'original_unknown' | 'original_ambiguous' | 'original_accepted';
  note_document_id?: number;
  original_document_id?: number;
  message?: string;
}

const NOTE_TYPES = new Set(['credit_note', 'debit_note']);
const NOTE_SELECT = {
  id: true,
  document_type: true,
  issuer_tax_id: true,
  document_key: true,
  invoice_number: true,
  original_reference_key: true,
  original_reference_number: true,
  accepted_at: true,
} as const;
const ORIGINAL_SELECT = {
  id: true,
  document_type: true,
  issuer_tax_id: true,
  accepted_at: true,
  document_key: true,
  invoice_number: true,
} as const;

function tenantWhere(context: ReceivedNoteTenantContext): Prisma.received_documentsWhereInput {
  return {
    organization_id: context.organization_id,
    accounting_entity_id: context.accounting_entity_id,
    ...(context.store_id != null ? { store_id: context.store_id } : {}),
  };
}

function normalizedNit(value: string | null | undefined): string {
  return normalizeNit(value).number;
}

function isNote(document: Pick<NoteDocumentProjection, 'document_type'>): boolean {
  return NOTE_TYPES.has(document.document_type.trim().toLowerCase());
}

/**
 * Resolve only the original of the requested note. This is not an inverse scan:
 * an invoice is never blocked because some note happens to reference it.
 *
 * The caller must supply a transaction client after locking the effect document.
 * The original is then locked (document → document) before acceptance is read,
 * matching the buyer-event dispatch document → event lock order.
 */
export async function evaluateReceivedDocumentNoteCoherence(
  client: ReceivedNoteDocumentClient,
  context: ReceivedNoteTenantContext,
  documentId: number,
): Promise<ReceivedDocumentNoteCoherenceResult> {
  const scope = tenantWhere(context);
  const note = await client.received_documents.findFirst({
    where: { ...scope, id: documentId },
    select: NOTE_SELECT,
  }) as NoteDocumentProjection | null;
  if (!note) {
    return {
      allowed: false,
      reason: 'original_unknown',
      message: 'No fue posible resolver el documento recibido en el contexto fiscal actual.',
    };
  }
  if (!isNote(note)) return { allowed: true };

  const originalKey = note.original_reference_key?.trim().toLowerCase() ?? '';
  const originalNumber = note.original_reference_number?.trim() ?? '';
  const noteSupplierNit = normalizedNit(note.issuer_tax_id);
  if (!originalKey && (!originalNumber || !noteSupplierNit)) {
    return {
      allowed: false,
      reason: 'original_unknown',
      note_document_id: note.id,
      message: 'La nota recibida no identifica su factura original por CUFE o por número y NIT del proveedor; no se permiten efectos ni conciliación.',
    };
  }

  // A supplied CUFE is authoritative. A miss or wrong-issuer CUFE must not
  // fall back to a weaker number match that could conceal a spoofed reference.
  const candidates = originalKey
    ? await client.received_documents.findMany({
      where: { ...scope, document_key: originalKey },
      select: ORIGINAL_SELECT,
      take: 2,
    }) as OriginalDocumentProjection[]
    : (await client.received_documents.findMany({
      where: { ...scope, invoice_number: originalNumber, document_type: 'invoice' },
      select: ORIGINAL_SELECT,
    }) as OriginalDocumentProjection[]).filter((candidate) => normalizedNit(candidate.issuer_tax_id) === noteSupplierNit);

  if (candidates.length !== 1) {
    const ambiguous = candidates.length > 1;
    return {
      allowed: false,
      reason: ambiguous ? 'original_ambiguous' : 'original_unknown',
      note_document_id: note.id,
      message: ambiguous
        ? 'La factura original de la nota recibida es ambigua en la entidad fiscal actual; no se permiten efectos ni conciliación.'
        : 'No se encontró la factura original de la nota recibida en la entidad fiscal actual; no se permiten efectos ni conciliación.',
    };
  }

  const candidate = candidates[0];
  if (
    candidate.document_type.trim().toLowerCase() !== 'invoice' ||
    normalizedNit(candidate.issuer_tax_id) !== noteSupplierNit
  ) {
    return {
      allowed: false,
      reason: 'original_unknown',
      note_document_id: note.id,
      original_document_id: candidate.id,
      message: 'La factura indicada por la nota no coincide con el tipo de documento o el NIT normalizado del proveedor; no se permiten efectos ni conciliación.',
    };
  }

  const originalScope = { ...scope, id: candidate.id };
  const originalLock = await client.$queryRaw<Array<{ id: number }>>(Prisma.sql`
    SELECT "id" FROM "received_documents"
    WHERE "id" = ${candidate.id}
      AND "organization_id" = ${context.organization_id}
      AND "accounting_entity_id" = ${context.accounting_entity_id}
      ${context.store_id == null ? Prisma.empty : Prisma.sql`AND "store_id" = ${context.store_id}`}
    FOR UPDATE
  `);
  if (originalLock.length !== 1) {
    return {
      allowed: false,
      reason: 'original_unknown',
      note_document_id: note.id,
      original_document_id: candidate.id,
      message: 'La factura original dejó de estar disponible en el contexto fiscal actual; no se permiten efectos ni conciliación.',
    };
  }

  // Re-read after acquiring the original lock so a concurrent accepted 032/033
  // projection or DIAN event cannot race the matching effect.
  const original = await client.received_documents.findFirst({ where: originalScope, select: ORIGINAL_SELECT }) as OriginalDocumentProjection | null;
  if (
    !original || original.document_type.trim().toLowerCase() !== 'invoice' ||
    normalizedNit(original.issuer_tax_id) !== noteSupplierNit ||
    (originalKey ? original.document_key?.trim().toLowerCase() !== originalKey : original.invoice_number !== originalNumber)
  ) {
    return {
      allowed: false,
      reason: 'original_unknown',
      note_document_id: note.id,
      original_document_id: candidate.id,
      message: 'La factura original no coincide con la referencia fiscal de la nota; no se permiten efectos ni conciliación.',
    };
  }

  const acceptedBuyerEvent = await client.received_document_events.findFirst({
    where: {
      document_id: original.id,
      event_type: 'BUYER_DIAN_EVENT',
      event_code: { in: ['033', '034'] },
      status: 'accepted',
    },
    select: { id: true },
  });
  if (original.accepted_at != null || acceptedBuyerEvent) {
    return {
      allowed: false,
      reason: 'original_accepted',
      note_document_id: note.id,
      original_document_id: original.id,
      message: 'La factura original tiene aceptación expresa o tácita registrada; la nota recibida se conserva como evidencia, pero no se permiten efectos ni conciliación incompatibles.',
    };
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
