import { BadRequestException, ConflictException, Injectable, ServiceUnavailableException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { RequestContextService } from '../../../common/context/request-context.service';
import { normalizeNit } from '../../../common/utils/nit.util';
import { GlobalPrismaService } from '../../../prisma/services/global-prisma.service';
import { ReceivedDocumentsContext, ReceivedDocumentsService } from '../received-documents.service';

export type ReceivedBuyerEventCode = '030' | '031' | '032' | '033';
export interface RequestReceivedBuyerEventVerificationInput {
  expected_version: number;
  dian_configuration_id: number;
  evidence_id: number;
  event_codes: ReceivedBuyerEventCode[];
}
export interface ReceivedBuyerEventVerificationRequestView {
  status: 'testing';
  version: number;
  event_codes: ReceivedBuyerEventCode[];
  dian_configuration_id: number;
  evidence_id: number;
}
export type ReceivedBuyerEventReadinessStatus = 'not_started' | 'testing' | 'verified' | 'suspended';

export interface ReceivedBuyerEventReadiness {
  status: ReceivedBuyerEventReadinessStatus;
  ready: boolean;
  blockers: string[];
  event_codes: string[];
}

@Injectable()
export class ReceivedBuyerEventEnablementService {
  constructor(
    private readonly prisma: GlobalPrismaService,
    private readonly receivedDocuments: ReceivedDocumentsService,
  ) {}

  async getReadiness(ctx: ReceivedDocumentsContext, eventCode: ReceivedBuyerEventCode): Promise<ReceivedBuyerEventReadiness> {
    await this.receivedDocuments.assertContext(ctx);

    const db = this.prisma.withoutScope();
    const row = await db.received_buyer_event_enablements.findFirst({
      where: { organization_id: ctx.organization_id, accounting_entity_id: ctx.accounting_entity_id },
      select: {
        organization_id: true,
        accounting_entity_id: true,
        status: true,
        event_codes: true,
        verification_source: true,
        software_id_snapshot: true,
        certificate_fingerprint_snapshot: true,
        verified_by_user_id: true,
        verified_at: true,
        dian_configuration: {
          select: {
            organization_id: true,
            accounting_entity_id: true,
            configuration_type: true,
            operation_mode: true,
            environment: true,
            enablement_status: true,
            software_id: true,
            certificate_fingerprint: true,
            certificate_s3_key: true,
            certificate_password_encrypted: true,
            certificate_kms_key_id: true,
            certificate_expiry: true,
            nit: true,
            nit_dv: true,
          },
        },
        evidence: {
          select: {
            organization_id: true,
            accounting_entity_id: true,
            evidence_type: true,
            storage_key: true,
            content_hash: true,
          },
        },
      },
    });

    if (!row) return { status: 'not_started', ready: false, blockers: ['not_configured'], event_codes: [] };

    const blockers: string[] = [];
    const status = this.safeStatus(row.status);
    if (status !== 'verified') blockers.push(status === 'suspended' ? 'suspended' : 'not_verified');
    const eventCodes = Array.isArray(row.event_codes) ? row.event_codes.filter((code): code is string => typeof code === 'string') : [];
    if (!eventCodes.includes(eventCode)) blockers.push('event_code_not_approved');

    const config = row.dian_configuration;
    if (!config || config.organization_id !== ctx.organization_id || config.accounting_entity_id !== ctx.accounting_entity_id) {
      blockers.push('configuration_missing');
    } else {
      if (config.configuration_type !== 'invoicing') blockers.push('configuration_type_invalid');
      if (config.operation_mode !== 'own_software') blockers.push('operation_mode_invalid');
      if (config.environment !== 'production') blockers.push('environment_invalid');
      if (config.enablement_status !== 'enabled') blockers.push('dian_not_enabled');
      if (!row.software_id_snapshot || config.software_id !== row.software_id_snapshot) blockers.push('software_id_mismatch');
      if (!row.certificate_fingerprint_snapshot || !config.certificate_fingerprint || config.certificate_fingerprint !== row.certificate_fingerprint_snapshot) blockers.push('certificate_fingerprint_mismatch');
      if (!config.certificate_s3_key) blockers.push('certificate_missing');
      if (!config.certificate_password_encrypted) blockers.push('credentials_missing');
      if (!config.certificate_expiry || config.certificate_expiry.getTime() <= Date.now()) blockers.push('certificate_expired');

      const entity = await db.accounting_entities.findFirst({
        where: { id: ctx.accounting_entity_id, organization_id: ctx.organization_id, is_active: true },
        select: { tax_id: true },
      });
      if (!entity) blockers.push('accounting_entity_missing');
      else {
        const configNit = normalizeNit(config.nit);
        const entityNit = normalizeNit(entity.tax_id);
        const configDvMismatch = configNit.dv_mismatch || (config.nit_dv != null && configNit.dv !== config.nit_dv);
        if (!configNit.number || configNit.number !== entityNit.number || configDvMismatch || entityNit.dv_mismatch) blockers.push('nit_mismatch');
      }
    }

    const evidence = row.evidence;
    if (!evidence || evidence.organization_id !== ctx.organization_id || evidence.accounting_entity_id !== ctx.accounting_entity_id || (!evidence.storage_key && !evidence.content_hash)) blockers.push('evidence_missing');
    else if (!['test_set', 'dian_response', 'manual_support', 'approval_record'].includes(evidence.evidence_type)) blockers.push('evidence_type_invalid');
    if (!['test_set', 'convalidated', 'dian_portal'].includes(row.verification_source ?? '')) blockers.push('verification_source_invalid');
    if (!row.verified_by_user_id || !row.verified_at) blockers.push('verification_incomplete');

    return { status, ready: blockers.length === 0, blockers, event_codes: eventCodes };
  }

  async requestVerification(ctx: ReceivedDocumentsContext, input: RequestReceivedBuyerEventVerificationInput): Promise<ReceivedBuyerEventVerificationRequestView> {
    await this.receivedDocuments.assertContext(ctx);
    if (!Number.isSafeInteger(ctx.actor_id) || (ctx.actor_id as number) <= 0) throw new BadRequestException('Se requiere un usuario válido para solicitar la verificación.');
    if (!Number.isSafeInteger(input?.expected_version) || input.expected_version < 0) throw new BadRequestException('La versión esperada no es válida.');
    this.assertPositive(input?.dian_configuration_id, 'DIAN configuration');
    this.assertPositive(input?.evidence_id, 'evidence');
    if (!Array.isArray(input?.event_codes) || input.event_codes.length === 0 || new Set(input.event_codes).size !== input.event_codes.length || input.event_codes.some((code) => !['030', '031', '032', '033'].includes(code))) {
      throw new BadRequestException('Los códigos de evento deben ser una lista única válida (030, 031, 032, 033).');
    }

    const db = this.prisma.withoutScope();
    return db.$transaction(async (tx) => {
      await tx.$queryRaw(Prisma.sql`SELECT "id" FROM "accounting_entities" WHERE "id" = ${ctx.accounting_entity_id} AND "organization_id" = ${ctx.organization_id} FOR UPDATE`);
      const where = { organization_id: ctx.organization_id, accounting_entity_id: ctx.accounting_entity_id };
      const existing = await tx.received_buyer_event_enablements.findFirst({ where });
      if (!existing && input.expected_version !== 0) throw new ConflictException('La configuración cambió; vuelva a cargarla.');
      if (existing && existing.version !== input.expected_version) throw new ConflictException('La configuración cambió; vuelva a cargarla.');
      const config = await tx.dian_configurations.findFirst({ where: { id: input.dian_configuration_id, ...where }, select: { id: true, configuration_type: true, operation_mode: true } });
      if (!config || config.configuration_type !== 'invoicing' || config.operation_mode !== 'own_software') throw new BadRequestException('La configuración DIAN no es válida para esta entidad.');
      const evidence = await tx.fiscal_evidences.findFirst({ where: { id: input.evidence_id, ...where }, select: { id: true, evidence_type: true, storage_key: true, content_hash: true } });
      if (!evidence || !['test_set', 'dian_response', 'manual_support', 'approval_record'].includes(evidence.evidence_type) || (!evidence.storage_key && !evidence.content_hash)) throw new BadRequestException('La evidencia no es válida para esta entidad.');

      const data = { status: 'testing', event_codes: input.event_codes, dian_configuration_id: input.dian_configuration_id, evidence_id: input.evidence_id, verification_source: null, verified_at: null, verified_by_user_id: null, software_id_snapshot: null, certificate_fingerprint_snapshot: null };
      let row;
      if (existing) {
        const changed = await tx.received_buyer_event_enablements.updateMany({
          where: { id: existing.id, ...where, version: input.expected_version },
          data: { ...data, version: { increment: 1 } },
        });
        if (changed.count !== 1) throw new ConflictException('La configuración cambió; vuelva a cargarla.');
        const fresh = await tx.received_buyer_event_enablements.findFirst({ where: { id: existing.id, ...where } });
        if (!fresh) throw new ConflictException('La configuración cambió; vuelva a cargarla.');
        row = fresh;
      } else {
        row = await tx.received_buyer_event_enablements.create({ data: { ...where, ...data, version: 1 } });
      }
      const auditValues = (value: typeof row) => ({ organization_id: value.organization_id, accounting_entity_id: value.accounting_entity_id, status: value.status, version: value.version, dian_configuration_id: value.dian_configuration_id, evidence_id: value.evidence_id, event_codes: value.event_codes });
      const requestId = RequestContextService.asyncLocalStorage.getStore()?.request_id;
      try {
        await tx.audit_logs.create({ data: { user_id: ctx.actor_id, action: existing ? 'UPDATE' : 'CREATE', resource: 'received_buyer_event_enablements', resource_id: row.id, old_values: existing ? auditValues(existing) : undefined, new_values: auditValues(row), metadata: { organization_id: ctx.organization_id, accounting_entity_id: ctx.accounting_entity_id }, request_id: typeof requestId === 'string' && requestId.length >= 1 && requestId.length <= 100 ? requestId : null } });
      } catch {
        throw new ServiceUnavailableException('No fue posible registrar de forma segura la solicitud.');
      }
      return { status: 'testing' as const, version: row.version, event_codes: input.event_codes, dian_configuration_id: input.dian_configuration_id, evidence_id: input.evidence_id };
    }).catch((error: unknown) => {
      if (error instanceof ServiceUnavailableException) throw error;
      if (error && typeof error === 'object' && 'code' in error && error.code === 'P2002') {
        throw new ConflictException('La configuración o evidencia ya está asociada a otra activación.');
      }
      throw error;
    });
  }

  private assertPositive(value: unknown, label: string): asserts value is number {
    if (!Number.isSafeInteger(value) || (value as number) <= 0) throw new BadRequestException(`El identificador de ${label} no es válido.`);
  }

  private safeStatus(status: string): ReceivedBuyerEventReadinessStatus {
    if (status === 'verified' || status === 'suspended' || status === 'testing') return status;
    return 'not_started';
  }
}
