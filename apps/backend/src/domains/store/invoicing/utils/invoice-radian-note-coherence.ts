import { Prisma } from '@prisma/client';
import { ErrorCodes, VendixHttpException } from '../../../../common/errors';

const NOTE_TYPES = new Set(['credit_note', 'debit_note']);
const ACCEPTANCE_EVENT_CODES = ['033', '034'] as const;

export interface InvoiceRadianNoteScope {
  note_type: string;
  related_invoice_id: number | null | undefined;
  organization_id: number;
  store_id: number;
  accounting_entity_id: number;
}

type InvoiceRadianNoteReader = Pick<
  Prisma.TransactionClient,
  'invoices' | 'dian_document_events'
>;

/**
 * Fail closed before creating or transmitting an issuer NC/ND when its original
 * has a persisted accepted RADIAN 033/034 event. DIAN invoice `status=accepted`
 * is deliberately not treated as RADIAN acceptance evidence.
 */
export async function assertNoteOriginalHasNoAcceptedRadianEvent(
  prisma: InvoiceRadianNoteReader,
  scope: InvoiceRadianNoteScope,
): Promise<void> {
  if (!NOTE_TYPES.has(scope.note_type)) return;
  if (!Number.isSafeInteger(scope.related_invoice_id) || (scope.related_invoice_id ?? 0) <= 0) {
    throw radianNoteConflict(
      'La nota crédito o débito no tiene una factura original vinculada; no se puede verificar su estado de aceptación RADIAN.',
      { related_invoice_id: scope.related_invoice_id ?? null },
    );
  }

  const original = await prisma.invoices.findFirst({
    where: {
      id: scope.related_invoice_id!,
      organization_id: scope.organization_id,
      store_id: scope.store_id,
      accounting_entity_id: scope.accounting_entity_id,
    },
    select: { id: true },
  });
  if (!original) {
    throw radianNoteConflict(
      'No se pudo resolver la factura original de la nota dentro de la misma organización, tienda y entidad fiscal.',
      { related_invoice_id: scope.related_invoice_id },
    );
  }

  const acceptedEvent = await prisma.dian_document_events.findFirst({
    where: {
      invoice_id: original.id,
      organization_id: scope.organization_id,
      OR: [{ store_id: scope.store_id }, { store_id: null }],
      event_code: { in: [...ACCEPTANCE_EVENT_CODES] },
      status: 'accepted',
    },
    select: { id: true, event_code: true },
  });
  if (acceptedEvent) {
    throw radianNoteConflict(
      `No se puede crear ni emitir la nota: la factura original tiene un evento RADIAN ${acceptedEvent.event_code} aceptado (aceptación expresa 033 o tácita 034). El estado «accepted» de la factura ante DIAN no sustituye esta evidencia.`,
      { related_invoice_id: original.id, event_code: acceptedEvent.event_code },
    );
  }
}

function radianNoteConflict(message: string, details: Record<string, unknown>) {
  return new VendixHttpException(ErrorCodes.INVOICING_STATUS_002, message, details);
}
