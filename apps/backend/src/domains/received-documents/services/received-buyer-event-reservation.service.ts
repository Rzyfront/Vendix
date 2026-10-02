import { BadRequestException, ConflictException, Injectable, UnprocessableEntityException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { GlobalPrismaService } from '../../../prisma/services/global-prisma.service';
import { ReceivedDocumentsContext, ReceivedDocumentsService } from '../received-documents.service';
import { ReceivedBuyerEventEnablementService } from './received-buyer-event-enablement.service';
import { evaluateBuyerEventReadiness } from './received-document-buyer-event-policy';

export type ReceivedBuyerDianEventCode = '030' | '031' | '032' | '033';

export interface ReserveReceivedBuyerEventInput {
  event_code: ReceivedBuyerDianEventCode;
  idempotency_key: string;
  description?: string;
}

export interface ReceivedBuyerEventReservation {
  event_id: number;
  event_number: string;
  duplicate: boolean;
  status: string;
  dian_configuration_id: number;
  activation_version: number;
}

const EVENT_CODES: readonly string[] = ['030', '031', '032', '033'];
const UNCERTAIN_STATUSES = ['preparing', 'prepared', 'sending', 'unknown'];
const CUFE_PATTERN = /^[a-fA-F0-9]{96}$/;
const IDEMPOTENCY_PATTERN = /^[A-Za-z0-9:_-]{1,120}$/;
const MAX_DESCRIPTION_LENGTH = 1000;

@Injectable()
export class ReceivedBuyerEventReservationService {
  constructor(
    private readonly prisma: GlobalPrismaService,
    private readonly documents: ReceivedDocumentsService,
    private readonly enablement: ReceivedBuyerEventEnablementService,
  ) {}

  async reserve(
    ctx: ReceivedDocumentsContext,
    documentId: number,
    input: ReserveReceivedBuyerEventInput,
  ): Promise<ReceivedBuyerEventReservation> {
    this.validateInput(documentId, input);
    await this.documents.assertContext(ctx);
    if (!ctx.actor_id || !Number.isSafeInteger(ctx.actor_id) || ctx.actor_id < 1) {
      throw new BadRequestException('Se requiere un actor autenticado para registrar el evento.');
    }

    const idempotencyKey = `buyer:${input.idempotency_key}`;
    try {
      return await this.prisma.$transaction(async (tx: Prisma.TransactionClient) => {
        const entity = await tx.accounting_entities.findFirst({
          where: { id: ctx.accounting_entity_id, organization_id: ctx.organization_id, is_active: true },
          select: { tax_id: true, store_id: true },
        });
        if (!entity) throw new ConflictException('La entidad fiscal dejó de estar disponible.');
        // Match ReceivedDocumentsService.resolveScope: organization context without
        // a selected store still narrows a store-owned fiscal entity to its store.
        const scopedStoreId = ctx.store_id ?? entity.store_id;
        const storeFilter = scopedStoreId == null
          ? Prisma.empty
          : Prisma.sql`AND "store_id" = ${scopedStoreId}`;
        const locked = await tx.$queryRaw<Array<{ id: number }>>(Prisma.sql`
          SELECT "id" FROM "received_documents"
          WHERE "id" = ${documentId}
            AND "organization_id" = ${ctx.organization_id}
            AND "accounting_entity_id" = ${ctx.accounting_entity_id}
            ${storeFilter}
          FOR UPDATE
        `);
        if (locked.length !== 1) throw new ConflictException('Documento recibido no encontrado en el contexto fiscal actual.');

        const document = await tx.received_documents.findFirst({
          where: {
            id: documentId,
            organization_id: ctx.organization_id,
            accounting_entity_id: ctx.accounting_entity_id,
            ...(scopedStoreId != null ? { store_id: scopedStoreId } : {}),
          },
          select: {
            id: true, document_type: true, document_key: true, invoice_number: true,
            issue_date: true, issuer_tax_id: true, issuer_name: true,
            receiver_tax_id: true, receiver_name: true, validation_status: true,
            review_status: true,
          },
        });
        if (!document) throw new ConflictException('Documento recibido no encontrado en el contexto fiscal actual.');

        const events = await tx.received_document_events.findMany({
          where: { document_id: documentId, event_type: 'BUYER_DIAN_EVENT' },
          select: { id: true, event_code: true, idempotency_key: true, status: true, result: true, event_number: true },
        });
        const existingKey = events.find((event) => event.idempotency_key === idempotencyKey);
        if (existingKey) {
          const result = this.resultRecord(existingKey.result);
          if (
            existingKey.event_code !== input.event_code ||
            result.description !== (input.description?.trim() ?? null)
          ) throw new ConflictException('La clave de idempotencia ya fue usada con una acción distinta.');
          const originalConfigurationId = result.dian_configuration_id;
          const originalActivationVersion = result.activation_version;
          if (!Number.isSafeInteger(originalConfigurationId) || !Number.isSafeInteger(originalActivationVersion)) {
            throw new ConflictException('La reserva existente no contiene su configuración DIAN original; requiere reconciliación.');
          }
          return {
            event_id: existingKey.id,
            event_number: existingKey.event_number ?? `RD${existingKey.id}`,
            duplicate: true,
            status: existingKey.status,
            dian_configuration_id: originalConfigurationId as number,
            activation_version: originalActivationVersion as number,
          };
        }

        const enablementRows = await tx.$queryRaw<Array<{
          id: number;
          status: string;
          version: number;
          dian_configuration_id: number | null;
        }>>(Prisma.sql`
          SELECT "id", "status", "version", "dian_configuration_id"
          FROM "received_buyer_event_enablements"
          WHERE "organization_id" = ${ctx.organization_id}
            AND "accounting_entity_id" = ${ctx.accounting_entity_id}
          FOR SHARE
        `);
        const activation = enablementRows[0];
        if (
          enablementRows.length !== 1 || !activation || activation.status !== 'verified' ||
          !Number.isSafeInteger(activation.version) || activation.version < 1 ||
          !Number.isSafeInteger(activation.dian_configuration_id) || (activation.dian_configuration_id ?? 0) < 1
        ) {
          throw new UnprocessableEntityException('No existe una configuración DIAN verificada para eventos del adquiriente.');
        }

        // Idempotent replay is a read of a historical reservation. A later
        // suspension/certificate rotation must not hide its reconciliation state.
        // New reservations, however, always require live enablement checks.
        const readiness = await this.enablement.getReadiness(ctx, input.event_code);
        if (!readiness.ready) {
          throw new UnprocessableEntityException({
            message: 'La habilitación de eventos DIAN no permite registrar este evento.',
            blockers: readiness.blockers,
          });
        }
        const activeEvent = events.find((event) => UNCERTAIN_STATUSES.includes(event.status));
        if (activeEvent) {
          throw new ConflictException('Ya existe un evento DIAN pendiente de transmisión o reconciliación para este documento.');
        }
        if (events.some((event) => event.event_code === input.event_code && event.status === 'accepted')) {
          throw new ConflictException('Este evento DIAN ya fue aceptado para el documento recibido.');
        }

        if (!CUFE_PATTERN.test(document.document_key ?? '')) {
          throw new UnprocessableEntityException('El documento recibido no tiene un CUFE de 96 caracteres hexadecimales.');
        }
        if (!document.invoice_number?.trim() || !document.issue_date || !document.issuer_name?.trim() || !document.receiver_name?.trim()) {
          throw new UnprocessableEntityException('Faltan datos obligatorios del documento para construir el evento DIAN.');
        }

        const receiptEvidence = await tx.received_document_match_allocations.findFirst({
            where: {
              document_id: documentId,
              organization_id: ctx.organization_id,
              accounting_entity_id: ctx.accounting_entity_id,
              status: 'active',
              reception_id: { not: null },
              reception_item_id: { not: null },
              ...(scopedStoreId != null ? { store_id: scopedStoreId } : {}),
            },
            select: { id: true },
          });
        const acceptedEvents = events.filter((event) => event.status === 'accepted');
        const acceptedCodes = new Set(acceptedEvents.map((event) => event.event_code));
        const policy = evaluateBuyerEventReadiness({
          event_code: input.event_code,
          document_type: document.document_type,
          issuer_tax_id: document.issuer_tax_id,
          receiver_tax_id: document.receiver_tax_id,
          document_key: document.document_key,
          tenant_tax_id: entity.tax_id,
          validation_status: document.validation_status,
          review_status: document.review_status,
          actor_id: ctx.actor_id,
          has_prior_acknowledgement: acceptedCodes.has('030'),
          has_prior_acceptance: acceptedCodes.has('033'),
          has_goods_receipt_evidence: Boolean(receiptEvidence),
          claim_reason: input.description,
          has_prior_goods_receipt: acceptedCodes.has('032'),
          has_prior_claim: acceptedCodes.has('031'),
        });
        if (!policy.ready) {
          throw new UnprocessableEntityException({
            message: 'El documento no está listo para registrar este evento DIAN.',
            blockers: policy.blockers,
          });
        }

        const created = await tx.received_document_events.create({
          data: {
            document_id: documentId,
            event_type: 'BUYER_DIAN_EVENT',
            event_code: input.event_code,
            idempotency_key: idempotencyKey,
            status: 'preparing',
            actor_id: ctx.actor_id,
            result: {
              description: input.description?.trim() ?? null,
              activation_version: activation.version,
              dian_configuration_id: activation.dian_configuration_id,
            },
          },
          select: { id: true },
        });
        const eventNumber = `RD${created.id}`;
        await tx.received_document_events.update({
          where: { id: created.id },
          data: { event_number: eventNumber },
        });
        return {
          event_id: created.id,
          event_number: eventNumber,
          duplicate: false,
          status: 'preparing',
          dian_configuration_id: activation.dian_configuration_id,
          activation_version: activation.version,
        };
      });
    } catch (error) {
      if (this.isUniqueViolation(error)) {
        throw new ConflictException('Ya existe un evento de este tipo reservado para el documento.');
      }
      throw error;
    }
  }

  private validateInput(documentId: number, input: ReserveReceivedBuyerEventInput): void {
    if (!Number.isSafeInteger(documentId) || documentId < 1) throw new BadRequestException('document_id debe ser un entero positivo.');
    if (!input || !EVENT_CODES.includes(input.event_code)) throw new BadRequestException('Código de evento DIAN no soportado.');
    if (typeof input.idempotency_key !== 'string' || !IDEMPOTENCY_PATTERN.test(input.idempotency_key)) {
      throw new BadRequestException('idempotency_key debe tener de 1 a 120 caracteres seguros.');
    }
    if (input.description !== undefined && (typeof input.description !== 'string' || input.description.length > MAX_DESCRIPTION_LENGTH)) {
      throw new BadRequestException(`description no puede superar ${MAX_DESCRIPTION_LENGTH} caracteres.`);
    }
    const description = input.description?.trim();
    if (input.event_code === '031' && !description) throw new BadRequestException('El evento 031 requiere una justificación.');
  }

  private resultRecord(value: Prisma.JsonValue | null): Record<string, unknown> {
    return value !== null && typeof value === 'object' && !Array.isArray(value)
      ? value as Record<string, unknown>
      : {};
  }

  private isUniqueViolation(error: unknown): boolean {
    return typeof error === 'object' && error !== null && 'code' in error && error.code === 'P2002';
  }
}
