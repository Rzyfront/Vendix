import { Injectable, UnprocessableEntityException } from '@nestjs/common';
import { GlobalPrismaService } from '../../../prisma/services/global-prisma.service';
import { DIAN_ID_TYPES } from '../../store/invoicing/providers/dian-direct/constants/dian-document-types';
import { DianDocumentEventRequest, DianEventConfigurationSelection } from '../../store/invoicing/providers/dian-direct/interfaces/dian-event.interface';
import { DianEventCode } from '../../store/invoicing/providers/dian-direct/constants/dian-endpoints';
import { DianEventParty } from '../../store/invoicing/providers/dian-direct/xml/ubl-application-response.builder';
import { DEFAULT_STORE_TIMEZONE, fiscalIssueDate, localDateString, localTimeString, resolveOrganizationTimezone, resolveStoreTimezone } from '../../../common/utils/store-timezone.util';
import { normalizeNit } from '../../../common/utils/nit.util';
import { ReceivedDocumentsContext, ReceivedDocumentsService } from '../received-documents.service';

type BuyerCode = '030' | '031' | '032' | '033';
type ReceivedBuyerEventDb = ReturnType<GlobalPrismaService['withoutScope']>;
interface EventSnapshot {
  document_version: number;
  referenced_cufe: string;
  activation_version: number;
  dian_configuration_id: number;
  claim_concept_code?: string | null;
}

@Injectable()
export class ReceivedBuyerEventPayloadService {
  constructor(private readonly prisma: GlobalPrismaService, private readonly documents: ReceivedDocumentsService) {}

  async build(ctx: ReceivedDocumentsContext, eventId: number): Promise<{
    request: DianDocumentEventRequest;
    selection: DianEventConfigurationSelection;
    source: { document_id: number; document_version: number; referenced_cufe: string; activation_version: number };
  }> {
    await this.documents.assertContext(ctx);
    if (!Number.isSafeInteger(eventId) || eventId < 1) this.fail();
    if (!Number.isSafeInteger(ctx.actor_id) || (ctx.actor_id ?? 0) < 1) this.fail();
    const db = this.prisma.withoutScope();
    const entity = await db.accounting_entities.findFirst({
      where: { id: ctx.accounting_entity_id, organization_id: ctx.organization_id, is_active: true },
      select: { id: true, organization_id: true, store_id: true, tax_id: true, legal_name: true },
    });
    if (!entity) this.fail();
    const scopedStoreId = ctx.store_id ?? entity.store_id;
    const event = await db.received_document_events.findFirst({
      where: {
        id: eventId, event_type: 'BUYER_DIAN_EVENT', status: 'preparing', actor_id: { not: null },
        event_code: { in: ['030', '031', '032', '033'] },
        document: { is: {
          organization_id: ctx.organization_id,
          accounting_entity_id: ctx.accounting_entity_id,
          ...(scopedStoreId != null ? { store_id: scopedStoreId } : {}),
        } },
      },
      select: {
        id: true, event_code: true, event_number: true, actor_id: true, result: true,
        document: { select: {
          id: true, organization_id: true, accounting_entity_id: true, store_id: true,
          version: true, document_key: true, invoice_number: true, issue_date: true,
          issuer_tax_id: true, issuer_name: true, receiver_tax_id: true,
        } },
      },
    });
    if (!event || !event.actor_id || event.event_number !== `RD${event.id}` || !event.document) this.fail();
    const code = event.event_code as BuyerCode;
    const snapshot = this.snapshot(event.result);
    const doc = event.document;
    if (
      doc.organization_id !== ctx.organization_id || doc.accounting_entity_id !== ctx.accounting_entity_id ||
      (scopedStoreId != null && doc.store_id !== scopedStoreId) ||
      !Number.isSafeInteger(doc.version) || doc.version !== snapshot.document_version ||
      !doc.document_key || doc.document_key !== snapshot.referenced_cufe ||
      !doc.invoice_number?.trim() || !doc.issue_date || !doc.issuer_name?.trim() || !doc.receiver_tax_id
    ) this.fail();

    const activation = await db.received_buyer_event_enablements.findFirst({
      where: { organization_id: ctx.organization_id, accounting_entity_id: ctx.accounting_entity_id },
      select: { status: true, version: true, dian_configuration_id: true },
    });
    if (!activation || activation.status !== 'verified' || activation.version !== snapshot.activation_version || activation.dian_configuration_id !== snapshot.dian_configuration_id) this.fail();

    const buyerIdentity = this.nit(entity.tax_id);
    const receiverIdentity = this.nit(doc.receiver_tax_id);
    const issuerIdentity = this.nit(doc.issuer_tax_id);
    if (!entity.legal_name?.trim() || !buyerIdentity || !receiverIdentity || !issuerIdentity || buyerIdentity.number !== receiverIdentity.number || buyerIdentity.dv !== receiverIdentity.dv) this.fail();
    const customer: DianEventParty = { document_type: DIAN_ID_TYPES.NIT, document_number: buyerIdentity.number, document_dv: buyerIdentity.dv, legal_name: entity.legal_name.trim() };
    const referenced_issuer: DianEventParty = { document_type: DIAN_ID_TYPES.NIT, document_number: issuerIdentity.number, document_dv: issuerIdentity.dv, legal_name: doc.issuer_name!.trim() };

    const actor = code === '030' ? await this.person(db, event.actor_id, ctx.organization_id) : undefined;
    const receiptPerson = code === '032' ? await this.goodsReceiptPerson(db, ctx, scopedStoreId, doc.id) : actor;
    const now = new Date();
    let timezone = DEFAULT_STORE_TIMEZONE;
    try {
      timezone = scopedStoreId != null
        ? await resolveStoreTimezone(db as never, scopedStoreId)
        : await resolveOrganizationTimezone(db, ctx.organization_id);
    } catch { timezone = DEFAULT_STORE_TIMEZONE; }

    const request: DianDocumentEventRequest = {
      event_code: code as DianEventCode,
      event_number: event.event_number,
      generated_by: 'customer',
      referenced_document_number: doc.invoice_number!.trim(),
      referenced_document_key: doc.document_key!,
      referenced_document_date: fiscalIssueDate(doc.issue_date!, timezone),
      customer,
      referenced_issuer,
      issue_date: localDateString(now, timezone),
      issue_time: localTimeString(now, timezone),
      ...(code === '031' ? { details: { claim_concept_code: this.claimConcept(snapshot.claim_concept_code) } } : {}),
      ...(receiptPerson ? { details: { ...(code === '031' ? { claim_concept_code: this.claimConcept(snapshot.claim_concept_code) } : {}), receipt_person: receiptPerson } } : {}),
    };
    return {
      request,
      selection: { configuration_id: snapshot.dian_configuration_id, accounting_entity_id: ctx.accounting_entity_id, store_id: doc.store_id },
      source: { document_id: doc.id, document_version: snapshot.document_version, referenced_cufe: snapshot.referenced_cufe, activation_version: snapshot.activation_version },
    };
  }

  private snapshot(value: unknown): EventSnapshot {
    if (!value || typeof value !== 'object' || Array.isArray(value)) this.fail();
    const result = value as Record<string, unknown>;
    if (
      !Number.isSafeInteger(result.document_version) || (result.document_version as number) < 1 ||
      !Number.isSafeInteger(result.activation_version) || (result.activation_version as number) < 1 ||
      !Number.isSafeInteger(result.dian_configuration_id) || (result.dian_configuration_id as number) < 1 ||
      typeof result.referenced_cufe !== 'string' || !/^[a-f\d]{96}$/i.test(result.referenced_cufe)
    ) this.fail();
    return result as unknown as EventSnapshot;
  }

  private claimConcept(value: string | null | undefined): '01' | '02' | '03' | '04' {
    if (!['01', '02', '03', '04'].includes(value ?? '')) this.fail();
    return value as '01' | '02' | '03' | '04';
  }

  private nit(value: string | null | undefined) {
    const identity = normalizeNit(value);
    if (!identity.number || !identity.dv || identity.dv_mismatch || (identity.provided_dv !== null && identity.provided_dv !== identity.dv)) return null;
    return identity;
  }

  private async person(db: ReceivedBuyerEventDb, userId: number, organizationId: number) {
    const user = await db.users.findFirst({
      where: { id: userId, organization_id: organizationId, state: 'active' },
      select: { document_type: true, document_number: true, verification_digit: true, first_name: true, last_name: true },
    });
    if (!user) this.fail();
    return this.userPerson(user);
  }

  private async goodsReceiptPerson(db: ReceivedBuyerEventDb, ctx: ReceivedDocumentsContext, storeId: number | null, documentId: number) {
    const allocations = await db.received_document_match_allocations.findMany({
      where: {
        document_id: documentId, organization_id: ctx.organization_id, accounting_entity_id: ctx.accounting_entity_id,
        status: 'active', reception_id: { not: null }, reception_item_id: { not: null },
        ...(storeId != null ? { store_id: storeId } : {}),
      },
      select: { reception: { select: { received_by_user_id: true } } },
    });
    const receiverIds = allocations.map((allocation) => allocation.reception?.received_by_user_id);
    if (receiverIds.some((id) => typeof id !== 'number' || !Number.isSafeInteger(id) || id < 1)) this.fail();
    const userIds: number[] = [...new Set(receiverIds as number[])];
    if (userIds.length !== 1) this.fail();
    return this.person(db, userIds[0], ctx.organization_id);
  }

  private userPerson(user: { document_type: string | null; document_number: string | null; verification_digit: string | null; first_name: string | null; last_name: string | null }) {
    const docType = user.document_type ? DIAN_ID_TYPES[user.document_type] : undefined;
    const raw = user.document_number?.trim();
    const first_name = user.first_name?.trim();
    const family_name = user.last_name?.trim();
    if (!docType || !raw || !first_name || !family_name) this.fail();
    const isNit = user.document_type === 'NIT';
    const identity = isNit ? normalizeNit(`${raw}-${user.verification_digit ?? ''}`) : undefined;
    if (isNit && (!identity?.number || !identity.dv || identity.dv_mismatch || identity.provided_dv !== identity.dv)) this.fail();
    return {
      document_type: docType,
      document_number: isNit ? identity!.number : raw,
      ...(isNit ? { document_dv: identity!.dv } : {}),
      first_name,
      family_name,
    };
  }

  private fail(): never { throw new UnprocessableEntityException('No fue posible construir un payload DIAN seguro con los datos fiscales y de recepción disponibles.'); }
}
