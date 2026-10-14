import { Prisma } from '@prisma/client';
import type { ReceivedDocumentQueryDto } from '../dto/received-document.dto';

export const INBOX_STATES = ['new', 'requires_review', 'accepted', 'reclaimed'] as const;
export type ReceivedDocumentInboxState = typeof INBOX_STATES[number];
export const LEGAL_STATUSES = ['none', 'accepted', 'reclaimed', 'conflict', 'not_applicable'] as const;
export type ReceivedDocumentLegalStatus = typeof LEGAL_STATUSES[number];
export type ReceivedDocumentEventDeliveryStatus = 'none' | 'accepted' | 'rejected' | 'in_progress' | 'unknown' | 'failed';

export interface ReceivedDocumentInboxScope {
  organization_id: number;
  accounting_entity_id: number | null;
  store_id: number | null;
}

export interface InboxEvent {
  event_type: string;
  event_code: string | null;
  status: string;
  confirmed_at?: Date | null;
  event_date?: Date | null;
}

export interface InboxDocument {
  document_type: string;
  processing_status: string;
  validation_status: string;
  structural_validation_status?: string;
  accepted_at: Date | null;
  created_at: Date;
  events?: InboxEvent[];
}

const BUYER_EVENT = 'BUYER_DIAN_EVENT';
const SETTLED_EVENT_STATUSES = ['accepted', 'rejected', 'preparation_failed'];
const IN_PROGRESS_EVENT_STATUSES = ['pending', 'preparing', 'prepared', 'sending'];
const PROBLEM_VALIDATION_STATUSES = ['invalid', 'needs_review'];

const eventSome = (where: Prisma.received_document_eventsWhereInput): Prisma.received_documentsWhereInput => ({
  events: { some: { event_type: BUYER_EVENT, ...where } },
});
const all = (...AND: Prisma.received_documentsWhereInput[]): Prisma.received_documentsWhereInput => ({ AND });
const any = (...OR: Prisma.received_documentsWhereInput[]): Prisma.received_documentsWhereInput => ({ OR });
const not = (NOT: Prisma.received_documentsWhereInput): Prisma.received_documentsWhereInput => ({ NOT });

/** The same evidence atoms drive row projection and the exclusive database predicates. */
export const inboxEvidenceWhere = {
  acceptance: any(
    { accepted_at: { not: null } },
    eventSome({ event_code: { in: ['033', '034'] }, status: 'accepted' }),
  ),
  claim: eventSome({ event_code: '031', status: 'accepted' }),
  uncertain: eventSome({ status: { notIn: SETTLED_EVENT_STATUSES } }),
  rejected: eventSome({ status: 'rejected' }),
  failed: eventSome({ status: 'preparation_failed' }),
  documentProblem: any(
    { processing_status: 'error' },
    { validation_status: { in: PROBLEM_VALIDATION_STATUSES } },
    { structural_validation_status: { in: PROBLEM_VALIDATION_STATUSES } },
  ),
} satisfies Record<string, Prisma.received_documentsWhereInput>;

export function inboxStateWhere(state: ReceivedDocumentInboxState): Prisma.received_documentsWhereInput {
  const e = inboxEvidenceWhere;
  const conflict = all(e.acceptance, e.claim);
  const priorityProblem = any(conflict, e.uncertain, e.rejected, e.failed);
  switch (state) {
    case 'requires_review':
      return any(priorityProblem, all(not(e.claim), not(e.acceptance), e.documentProblem));
    case 'reclaimed':
      return all(not(priorityProblem), e.claim);
    case 'accepted':
      return all(not(priorityProblem), not(e.claim), e.acceptance);
    case 'new':
      return all(not(priorityProblem), not(e.claim), not(e.acceptance), not(e.documentProblem));
  }
}

export function legalStatusWhere(status: ReceivedDocumentLegalStatus): Prisma.received_documentsWhereInput {
  const { acceptance, claim } = inboxEvidenceWhere;
  switch (status) {
    case 'not_applicable': return { document_type: { not: 'invoice' } };
    case 'conflict': return all({ document_type: 'invoice' }, acceptance, claim);
    case 'accepted': return all({ document_type: 'invoice' }, acceptance, not(claim));
    case 'reclaimed': return all({ document_type: 'invoice' }, claim, not(acceptance));
    case 'none': return all({ document_type: 'invoice' }, not(acceptance), not(claim));
  }
}

export function inboxBaseWhere(
  scope: ReceivedDocumentInboxScope,
  query: Pick<ReceivedDocumentQueryDto, 'source_channel' | 'document_type' | 'search'>,
): Prisma.received_documentsWhereInput {
  return {
    organization_id: scope.organization_id,
    // Missing fiscal identity never means "omit the entity filter".
    accounting_entity_id: scope.accounting_entity_id ?? { in: [] },
    ...(scope.store_id != null ? { store_id: scope.store_id } : {}),
    ...(query.source_channel ? { source_channel: query.source_channel } : {}),
    ...(query.document_type ? { document_type: query.document_type } : {}),
    ...(query.search ? {
      OR: [
        { invoice_number: { contains: query.search, mode: 'insensitive' } },
        { issuer_name: { contains: query.search, mode: 'insensitive' } },
        { issuer_tax_id: { contains: query.search, mode: 'insensitive' } },
      ],
    } : {}),
  };
}

export function inboxListWhere(scope: ReceivedDocumentInboxScope, query: ReceivedDocumentQueryDto): Prisma.received_documentsWhereInput {
  return all(
    inboxBaseWhere(scope, query),
    ...(query.inbox_state ? [inboxStateWhere(query.inbox_state)] : []),
    ...(query.legal_status ? [legalStatusWhere(query.legal_status)] : []),
    ...(query.processing_status ? [{ processing_status: query.processing_status }] : []),
    ...(query.validation_status ? [{ validation_status: query.validation_status }] : []),
    ...(query.review_status ? [{ review_status: query.review_status }] : []),
    ...(query.fiscal_status ? [{ fiscal_status: query.fiscal_status }] : []),
  );
}

export function projectReceivedDocumentInbox(document: InboxDocument) {
  const events = (document.events ?? []).filter((event) => event.event_type === BUYER_EVENT);
  const acceptedCodes = new Set(events.filter((event) => event.status === 'accepted').map((event) => event.event_code));
  const accepted = document.accepted_at != null || acceptedCodes.has('033') || acceptedCodes.has('034');
  const reclaimed = acceptedCodes.has('031');
  const uncertain = events.some((event) => !SETTLED_EVENT_STATUSES.includes(event.status));
  const rejected = events.some((event) => event.status === 'rejected');
  const failed = events.some((event) => event.status === 'preparation_failed');
  const conflict = accepted && reclaimed;
  const documentProblem = document.processing_status === 'error' ||
    PROBLEM_VALIDATION_STATUSES.includes(document.validation_status) ||
    PROBLEM_VALIDATION_STATUSES.includes(document.structural_validation_status ?? '');
  const priorityProblem = conflict || uncertain || rejected || failed;
  const inbox_state: ReceivedDocumentInboxState = priorityProblem ? 'requires_review'
    : reclaimed ? 'reclaimed' : accepted ? 'accepted' : documentProblem ? 'requires_review' : 'new';
  const legal_status: ReceivedDocumentLegalStatus = document.document_type !== 'invoice' ? 'not_applicable'
    : conflict ? 'conflict' : reclaimed ? 'reclaimed' : accepted ? 'accepted' : 'none';
  const event_delivery_status: ReceivedDocumentEventDeliveryStatus =
    events.some((event) => ![...SETTLED_EVENT_STATUSES, ...IN_PROGRESS_EVENT_STATUSES].includes(event.status)) ? 'unknown'
    : events.some((event) => IN_PROGRESS_EVENT_STATUSES.includes(event.status)) ? 'in_progress'
    : rejected ? 'rejected' : failed ? 'failed' : events.length ? 'accepted' : 'none';
  const blocking_reasons: string[] = [];
  if (conflict) blocking_reasons.push('legal_evidence_conflict');
  if (uncertain) blocking_reasons.push('event_delivery_uncertain');
  if (rejected) blocking_reasons.push('event_delivery_rejected');
  if (failed) blocking_reasons.push('event_preparation_failed');
  if (document.processing_status === 'error') blocking_reasons.push('processing_error');
  if (document.processing_status === 'pending_ocr' || document.processing_status === 'processing') blocking_reasons.push('document_reading_pending');
  if (document.validation_status === 'pending' || document.structural_validation_status === 'pending') blocking_reasons.push('validation_pending');
  if (PROBLEM_VALIDATION_STATUSES.includes(document.validation_status) || PROBLEM_VALIDATION_STATUSES.includes(document.structural_validation_status ?? '')) blocking_reasons.push('document_validation_requires_review');
  return {
    arrived_at: document.created_at,
    inbox_state,
    legal_status,
    legal_flags: { accepted, reclaimed },
    event_delivery_status,
    blocking_reasons,
  };
}

export const inboxEventsSelect = {
  where: { event_type: BUYER_EVENT },
  select: { event_type: true, event_code: true, status: true, confirmed_at: true, event_date: true },
} satisfies Prisma.received_document_eventsFindManyArgs;
