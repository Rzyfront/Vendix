import { Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { DianDirectProvider } from '../../store/invoicing/providers/dian-direct/dian-direct.provider';
import { DianPreparedDocumentEvent, DianPreparedEventTransmissionResult } from '../../store/invoicing/providers/dian-direct/interfaces/dian-event.interface';
import { GlobalPrismaService } from '../../../prisma/services/global-prisma.service';
import { ReceivedDocumentsContext } from '../received-documents.service';
import { ReceivedBuyerEventPayloadService } from './received-buyer-event-payload.service';
import { ReceivedBuyerEventReservationService, ReserveReceivedBuyerEventInput } from './received-buyer-event-reservation.service';

type DispatchResult =
  | { status: 'preparation_failed'; duplicate: false; event_id: number; event_number: string }
  | { status: 'unknown'; duplicate: false; event_id: number; event_number: string }
  | { status: 'accepted' | 'rejected'; duplicate: false; event_id: number; event_number: string; result: { success: boolean; tracking_id?: string; status_code?: string; message?: string } }
  | { status: string; duplicate: true; event_id: number; event_number: string; dian_configuration_id: number; activation_version: number };

@Injectable()
export class ReceivedBuyerEventDispatchService {
  constructor(
    private readonly prisma: GlobalPrismaService,
    private readonly reservations: ReceivedBuyerEventReservationService,
    private readonly payloads: ReceivedBuyerEventPayloadService,
    private readonly dian: DianDirectProvider,
  ) {}

  async execute(ctx: ReceivedDocumentsContext, documentId: number, input: ReserveReceivedBuyerEventInput): Promise<DispatchResult> {
    const reservation = await this.reservations.reserve(ctx, documentId, input);
    if (reservation.duplicate) {
      return {
        status: reservation.status, duplicate: true, event_id: reservation.event_id,
        event_number: reservation.event_number, dian_configuration_id: reservation.dian_configuration_id,
        activation_version: reservation.activation_version,
      };
    }

    let payload: Awaited<ReturnType<ReceivedBuyerEventPayloadService['build']>> | undefined;
    let prepared: DianPreparedDocumentEvent | undefined;
    try {
      payload = await this.payloads.build(ctx, reservation.event_id);
      await this.dian.assertReferencedInvoiceAccepted(payload.request.referenced_document_key, payload.selection);
      prepared = await this.dian.prepareDocumentEvent(payload.request, payload.selection);
      if (
        prepared.event_number !== reservation.event_number || prepared.event_code !== payload.request.event_code ||
        prepared.environment !== 'production' ||
        prepared.dian_configuration_id !== payload.selection.configuration_id ||
        prepared.accounting_entity_id !== payload.selection.accounting_entity_id ||
        prepared.store_id !== (payload.selection.store_id ?? null)
      ) throw new Error('Prepared event does not match the reserved selection.');
      await this.freezeAndMarkSending(ctx, reservation.event_id, payload, prepared);
    } catch {
      const status = await this.markPreparationFailed(ctx, reservation.event_id);
      return { status, duplicate: false, event_id: reservation.event_id, event_number: reservation.event_number };
    }

    try {
      const transmission = await this.dian.sendPreparedDocumentEvent(prepared!);
      const status = transmission.delivery_status;
      if (status === 'unknown') {
        await this.persistOutcome(ctx, reservation.event_id, prepared!, transmission, 'unknown');
        return { status: 'unknown', duplicate: false, event_id: reservation.event_id, event_number: reservation.event_number };
      }
      const persisted = await this.persistOutcome(ctx, reservation.event_id, prepared!, transmission, status);
      if (!persisted) return { status: 'unknown', duplicate: false, event_id: reservation.event_id, event_number: reservation.event_number };
      return {
        status, duplicate: false, event_id: reservation.event_id, event_number: reservation.event_number,
        result: { success: transmission.success, ...(transmission.tracking_id ? { tracking_id: transmission.tracking_id } : {}), ...(transmission.status_code ? { status_code: transmission.status_code } : {}), ...(transmission.message ? { message: transmission.message } : {}) },
      };
    } catch {
      // Once SOAP transmission starts, we cannot distinguish a lost response from a lost request.
      await this.persistUnknown(ctx, reservation.event_id);
      return { status: 'unknown', duplicate: false, event_id: reservation.event_id, event_number: reservation.event_number };
    }
  }

  private async freezeAndMarkSending(
    ctx: ReceivedDocumentsContext,
    eventId: number,
    payload: Awaited<ReturnType<ReceivedBuyerEventPayloadService['build']>>,
    prepared: DianPreparedDocumentEvent,
  ): Promise<void> {
    const storeId = payload.selection.store_id;
    await this.prisma.$transaction(async (tx: Prisma.TransactionClient) => {
      const locks = await tx.$queryRaw<Array<{ id: number }>>(Prisma.sql`
        SELECT e."id"
        FROM "received_document_events" e
        JOIN "received_documents" d ON d."id" = e."document_id"
        WHERE e."id" = ${eventId}
          AND e."event_type" = 'BUYER_DIAN_EVENT'
          AND e."status" = 'preparing'
          AND e."event_code" = ${prepared.event_code}
          AND e."event_number" = ${prepared.event_number}
          AND d."id" = ${payload.source.document_id}
          AND d."organization_id" = ${ctx.organization_id}
          AND d."accounting_entity_id" = ${ctx.accounting_entity_id}
          AND d."version" = ${payload.source.document_version}
          AND d."document_key" = ${payload.source.referenced_cufe}
          ${storeId == null ? Prisma.empty : Prisma.sql`AND d."store_id" = ${storeId}`}
        FOR UPDATE OF e, d
      `);
      if (locks.length !== 1) throw new Error('Reserved event or source document changed.');
      const activationLocks = await tx.$queryRaw<Array<{ version: number; dian_configuration_id: number; software_id_snapshot: string | null; certificate_fingerprint_snapshot: string | null }>>(Prisma.sql`
        SELECT "version", "dian_configuration_id", "software_id_snapshot", "certificate_fingerprint_snapshot"
        FROM "received_buyer_event_enablements"
        WHERE "organization_id" = ${ctx.organization_id}
          AND "accounting_entity_id" = ${ctx.accounting_entity_id}
          AND "status" = 'verified'
          AND "version" = ${payload.source.activation_version}
          AND "dian_configuration_id" = ${payload.selection.configuration_id}
        FOR UPDATE
      `);
      if (
        activationLocks.length !== 1 || activationLocks[0].dian_configuration_id !== payload.selection.configuration_id ||
        activationLocks[0].software_id_snapshot !== prepared.software_id ||
        activationLocks[0].certificate_fingerprint_snapshot !== (prepared.certificate_fingerprint ?? null)
      ) throw new Error('Buyer-event activation or signing configuration changed.');

      const tenantDocument = {
        organization_id: ctx.organization_id,
        accounting_entity_id: ctx.accounting_entity_id,
        ...(storeId != null ? { store_id: storeId } : {}),
      };
      const eventUpdate = await tx.received_document_events.updateMany({
        where: { id: eventId, event_type: 'BUYER_DIAN_EVENT', status: 'preparing', event_number: prepared.event_number, document: { is: tenantDocument } },
        data: {
          status: 'sending', cude: prepared.cude, request_xml: prepared.signed_xml,
          attempt_count: { increment: 1 },
        },
      });
      if (eventUpdate.count !== 1) throw new Error('Could not durably freeze reserved event.');
      await tx.received_document_event_attempts.create({
        data: {
          event_id: eventId, attempt_number: 1, status: 'sending', request_xml: prepared.signed_xml,
          result: this.privatePreparedResult(prepared),
        },
      });
    });
  }

  private async persistOutcome(
    ctx: ReceivedDocumentsContext,
    eventId: number,
    prepared: DianPreparedDocumentEvent,
    outcome: DianPreparedEventTransmissionResult,
    status: 'accepted' | 'rejected' | 'unknown',
  ): Promise<boolean> {
    try {
      await this.prisma.$transaction(async (tx: Prisma.TransactionClient) => {
        const scope = { organization_id: ctx.organization_id, accounting_entity_id: ctx.accounting_entity_id, ...(prepared.store_id != null ? { store_id: prepared.store_id } : {}) };
        const locked = await tx.$queryRaw<Array<{ id: number }>>(Prisma.sql`
          SELECT e."id" FROM "received_document_events" e
          JOIN "received_documents" d ON d."id" = e."document_id"
          WHERE e."id" = ${eventId} AND e."event_type" = 'BUYER_DIAN_EVENT' AND e."status" = 'sending'
            AND d."organization_id" = ${ctx.organization_id} AND d."accounting_entity_id" = ${ctx.accounting_entity_id}
            ${prepared.store_id == null ? Prisma.empty : Prisma.sql`AND d."store_id" = ${prepared.store_id}`}
          FOR UPDATE OF e
        `);
        if (locked.length !== 1) throw new Error('Event no longer in sending state.');
        const current = await tx.received_document_events.findFirst({ where: { id: eventId, event_type: 'BUYER_DIAN_EVENT', status: 'sending', document: { is: scope } }, select: { result: true } });
        if (!current) throw new Error('Event result unavailable.');
        const safeOutcome = {
          delivery_status: status,
          success: outcome.success,
          ...(outcome.tracking_id ? { tracking_id: outcome.tracking_id } : {}),
          ...(outcome.status_code ? { status_code: outcome.status_code } : {}),
          ...(status !== 'unknown' && outcome.message ? { message: outcome.message } : {}),
        };
        const eventUpdate = await tx.received_document_events.updateMany({
          where: { id: eventId, event_type: 'BUYER_DIAN_EVENT', status: 'sending', document: { is: scope } },
          data: {
            status, response_xml: outcome.response_xml ?? null,
            result: this.mergeResult(current.result, safeOutcome),
            confirmed_at: status === 'accepted' || status === 'rejected' ? new Date() : null,
          },
        });
        if (eventUpdate.count !== 1) throw new Error('Event no longer in sending state.');
        const attemptUpdate = await tx.received_document_event_attempts.updateMany({
          where: { event_id: eventId, attempt_number: 1, status: 'sending' },
          data: { status, response_xml: outcome.response_xml ?? null, result: { ...this.privatePreparedResult(prepared), ...safeOutcome } },
        });
        if (attemptUpdate.count !== 1) throw new Error('Event attempt no longer in sending state.');
      });
      return true;
    } catch {
      // Keep the durable `sending` row for manual reconciliation if persistence fails.
      return false;
    }
  }

  private async persistUnknown(ctx: ReceivedDocumentsContext, eventId: number): Promise<void> {
    try {
      await this.prisma.$transaction(async (tx: Prisma.TransactionClient) => {
        const locked = await tx.$queryRaw<Array<{ id: number }>>(Prisma.sql`
          SELECT e."id" FROM "received_document_events" e
          JOIN "received_documents" d ON d."id" = e."document_id"
          WHERE e."id" = ${eventId} AND e."event_type" = 'BUYER_DIAN_EVENT' AND e."status" = 'sending'
            AND d."organization_id" = ${ctx.organization_id} AND d."accounting_entity_id" = ${ctx.accounting_entity_id}
            ${ctx.store_id == null ? Prisma.empty : Prisma.sql`AND d."store_id" = ${ctx.store_id}`}
          FOR UPDATE OF e
        `);
        if (locked.length !== 1) return;
        const current = await tx.received_document_events.findFirst({ where: { id: eventId, event_type: 'BUYER_DIAN_EVENT', status: 'sending', document: { is: { organization_id: ctx.organization_id, accounting_entity_id: ctx.accounting_entity_id } } }, select: { result: true } });
        if (!current) return;
        const eventUpdate = await tx.received_document_events.updateMany({
          where: { id: eventId, event_type: 'BUYER_DIAN_EVENT', status: 'sending', document: { is: { organization_id: ctx.organization_id, accounting_entity_id: ctx.accounting_entity_id, ...(ctx.store_id != null ? { store_id: ctx.store_id } : {}) } } },
          data: { status: 'unknown', result: this.mergeResult(current.result, { delivery_status: 'unknown' }) },
        });
        if (eventUpdate.count === 1) await tx.received_document_event_attempts.updateMany({ where: { event_id: eventId, attempt_number: 1, status: 'sending' }, data: { status: 'unknown' } });
      });
    } catch {
      // Do not overwrite `sending`; uncertainty is safer than claiming a failure.
    }
  }

  private async markPreparationFailed(ctx: ReceivedDocumentsContext, eventId: number): Promise<'preparation_failed' | 'unknown'> {
    try {
      return await this.prisma.$transaction(async (tx: Prisma.TransactionClient) => {
        const storeId = ctx.store_id;
        const locked = await tx.$queryRaw<Array<{ id: number; status: string }>>(Prisma.sql`
          SELECT e."id", e."status" FROM "received_document_events" e
          JOIN "received_documents" d ON d."id" = e."document_id"
          WHERE e."id" = ${eventId} AND e."event_type" = 'BUYER_DIAN_EVENT'
            AND d."organization_id" = ${ctx.organization_id} AND d."accounting_entity_id" = ${ctx.accounting_entity_id}
            ${storeId == null ? Prisma.empty : Prisma.sql`AND d."store_id" = ${storeId}`}
          FOR UPDATE OF e
        `);
        if (locked.length !== 1) return 'unknown';
        if (locked[0].status === 'sending' || locked[0].status === 'unknown') return 'unknown';
        if (locked[0].status === 'preparation_failed') return 'preparation_failed';
        if (!['preparing', 'prepared'].includes(locked[0].status)) return 'unknown';
        const where = { id: eventId, event_type: 'BUYER_DIAN_EVENT', status: { in: ['preparing', 'prepared'] }, document: { is: { organization_id: ctx.organization_id, accounting_entity_id: ctx.accounting_entity_id, ...(storeId != null ? { store_id: storeId } : {}) } } };
        const current = await tx.received_document_events.findFirst({ where, select: { result: true } });
        if (!current) return 'unknown';
        const updated = await tx.received_document_events.updateMany({ where, data: { status: 'preparation_failed', result: this.mergeResult(current.result, { failure_stage: 'preparation' }) } });
        return updated.count === 1 ? 'preparation_failed' : 'unknown';
      });
    } catch { return 'unknown'; }
  }

  private mergeResult(current: Prisma.JsonValue | null, patch: Record<string, unknown>): Prisma.InputJsonObject {
    const original = current && typeof current === 'object' && !Array.isArray(current) ? current as Prisma.JsonObject : {};
    return { ...original, ...patch } as Prisma.InputJsonObject;
  }

  private privatePreparedResult(prepared: DianPreparedDocumentEvent): Prisma.InputJsonObject {
    return {
      event_code: prepared.event_code, event_number: prepared.event_number,
      dian_configuration_id: prepared.dian_configuration_id, accounting_entity_id: prepared.accounting_entity_id,
      store_id: prepared.store_id ?? null, environment: prepared.environment, cude: prepared.cude,
      signed_xml_sha256: prepared.signed_xml_sha256, xml_filename: prepared.xml_filename, zip_filename: prepared.zip_filename,
      software_id: prepared.software_id, certificate_s3_key: prepared.certificate_s3_key,
      certificate_kms_key_id: prepared.certificate_kms_key_id, certificate_fingerprint: prepared.certificate_fingerprint ?? null,
    };
  }
}
