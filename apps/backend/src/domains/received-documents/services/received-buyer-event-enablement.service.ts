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
export type ReceivedBuyerEventVerificationSource = 'test_set' | 'convalidated' | 'dian_portal';
export interface VerifyReceivedBuyerEventInput {
  expected_version: number;
  verification_source: ReceivedBuyerEventVerificationSource;
  review_note: string;
}
export interface ReceivedBuyerEventVerifiedView {
  status: 'verified';
  version: number;
  event_codes: ReceivedBuyerEventCode[];
  dian_configuration_id: number;
  evidence_id: number;
  verified_at: Date;
}
export interface ReceivedBuyerEventStatusView {
  status: ReceivedBuyerEventReadinessStatus;
  version: number;
  event_codes: string[];
  dian_configuration_id: number | null;
  evidence_id: number | null;
  verified_at: Date | null;
}
export interface SuspendReceivedBuyerEventInput { expected_version: number; reason: string }
export interface ReceivedBuyerEventSuspendedView { status: 'suspended'; version: number; event_codes: string[] }
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

  async getStatus(ctx: ReceivedDocumentsContext): Promise<ReceivedBuyerEventStatusView> {
    await this.receivedDocuments.assertContext(ctx);
    const db = this.prisma.withoutScope();
    const row = await db.received_buyer_event_enablements.findFirst({
      where: { organization_id: ctx.organization_id, accounting_entity_id: ctx.accounting_entity_id },
      select: { status: true, version: true, event_codes: true, dian_configuration_id: true, evidence_id: true, verified_at: true },
    });
    if (!row) return { status: 'not_started', version: 0, event_codes: [], dian_configuration_id: null, evidence_id: null, verified_at: null };
    return {
      status: this.safeStatus(row.status),
      version: row.version,
      event_codes: Array.isArray(row.event_codes) ? row.event_codes.filter((code): code is string => typeof code === 'string') : [],
      dian_configuration_id: row.dian_configuration_id,
      evidence_id: row.evidence_id,
      verified_at: row.verified_at,
    };
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
        await tx.audit_logs.create({ data: { user_id: ctx.actor_id, organization_id: ctx.organization_id, store_id: Number.isSafeInteger(ctx.store_id) && (ctx.store_id as number) > 0 ? ctx.store_id : null, action: existing ? 'UPDATE' : 'CREATE', resource: 'received_buyer_event_enablements', resource_id: row.id, old_values: existing ? auditValues(existing) : undefined, new_values: auditValues(row), metadata: { organization_id: ctx.organization_id, accounting_entity_id: ctx.accounting_entity_id }, request_id: typeof requestId === 'string' && requestId.length >= 1 && requestId.length <= 100 ? requestId : null } });
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

  async verifyAsPlatformReviewer(
    organizationId: number,
    accountingEntityId: number,
    reviewerUserId: number,
    input: VerifyReceivedBuyerEventInput,
  ): Promise<ReceivedBuyerEventVerifiedView> {
    this.assertPositive(organizationId, 'organization');
    this.assertPositive(accountingEntityId, 'accounting entity');
    this.assertPositive(reviewerUserId, 'reviewer');
    if (!Number.isSafeInteger(input?.expected_version) || input.expected_version < 1) throw new BadRequestException('La versión esperada no es válida.');
    if (!['test_set', 'convalidated', 'dian_portal'].includes(input?.verification_source)) throw new BadRequestException('La fuente de verificación no es válida.');
    if (typeof input?.review_note !== 'string' || input.review_note.trim().length < 20 || input.review_note.trim().length > 500) throw new BadRequestException('La nota de revisión debe tener entre 20 y 500 caracteres.');

    const db = this.prisma.withoutScope();
    return db.$transaction(async (tx) => {
      await tx.$queryRaw(Prisma.sql`SELECT "id" FROM "accounting_entities" WHERE "id" = ${accountingEntityId} AND "organization_id" = ${organizationId} AND "is_active" = true FOR UPDATE`);
      const where = { organization_id: organizationId, accounting_entity_id: accountingEntityId };
      const entity = await tx.accounting_entities.findFirst({ where: { id: accountingEntityId, organization_id: organizationId, is_active: true }, select: { id: true, tax_id: true } });
      if (!entity) throw new ConflictException('La entidad fiscal no está activa o no existe.');
      const existing = await tx.received_buyer_event_enablements.findFirst({ where });
      if (!existing) throw new ConflictException('No existe una solicitud de verificación pendiente.');
      if (existing.status !== 'testing' || existing.version !== input.expected_version) throw new ConflictException('La solicitud cambió o ya no está pendiente de verificación.');
      if (!Array.isArray(existing.event_codes) || existing.event_codes.length === 0 || new Set(existing.event_codes).size !== existing.event_codes.length || existing.event_codes.some((code: string) => !['030', '031', '032', '033'].includes(code))) {
        throw new ConflictException('La solicitud no contiene códigos de evento válidos.');
      }
      if (!existing.dian_configuration_id || !existing.evidence_id) throw new ConflictException('La solicitud no tiene configuración y evidencia asociadas.');
      const config = await tx.dian_configurations.findFirst({
        where: { id: existing.dian_configuration_id, ...where },
        select: { id: true, configuration_type: true, operation_mode: true, environment: true, enablement_status: true, software_id: true, certificate_fingerprint: true, certificate_s3_key: true, certificate_password_encrypted: true, certificate_expiry: true, nit: true, nit_dv: true },
      });
      if (!config || config.configuration_type !== 'invoicing' || config.operation_mode !== 'own_software' || config.environment !== 'production' || config.enablement_status !== 'enabled') throw new ConflictException('La configuración DIAN no cumple los requisitos de producción.');
      if (!config.software_id || !config.certificate_fingerprint || !config.certificate_s3_key || !config.certificate_password_encrypted || !config.certificate_expiry || config.certificate_expiry.getTime() <= Date.now()) throw new ConflictException('La configuración DIAN no tiene un certificado de producción vigente.');
      const configNit = normalizeNit(config.nit);
      const entityNit = normalizeNit(entity.tax_id);
      const configDvMismatch = configNit.dv_mismatch || (config.nit_dv != null && configNit.dv !== config.nit_dv);
      if (!configNit.number || configNit.number !== entityNit.number || configDvMismatch || entityNit.dv_mismatch) throw new ConflictException('La identificación tributaria de la configuración no coincide con la entidad fiscal.');
      const evidence = await tx.fiscal_evidences.findFirst({ where: { id: existing.evidence_id, ...where }, select: { id: true, evidence_type: true, storage_key: true, content_hash: true } });
      if (!evidence || !['test_set', 'dian_response', 'manual_support', 'approval_record'].includes(evidence.evidence_type) || (!evidence.storage_key && !evidence.content_hash)) throw new ConflictException('La evidencia asociada no es válida.');

      const verifiedAt = new Date();
      const changed = await tx.received_buyer_event_enablements.updateMany({
        where: { id: existing.id, ...where, version: input.expected_version, status: 'testing' },
        data: { status: 'verified', verification_source: input.verification_source, verified_at: verifiedAt, verified_by_user_id: reviewerUserId, software_id_snapshot: config.software_id, certificate_fingerprint_snapshot: config.certificate_fingerprint, version: { increment: 1 } },
      });
      if (changed.count !== 1) throw new ConflictException('La solicitud cambió durante la verificación.');
      const fresh = await tx.received_buyer_event_enablements.findFirst({ where: { id: existing.id, ...where } });
      if (!fresh) throw new ConflictException('La solicitud cambió durante la verificación.');
      const auditValues = (value: typeof fresh) => ({ organization_id: organizationId, accounting_entity_id: accountingEntityId, status: value.status, version: value.version, dian_configuration_id: value.dian_configuration_id, evidence_id: value.evidence_id, event_codes: value.event_codes, verification_source: value.verification_source, verified_by_user_id: value.verified_by_user_id, verified_at: value.verified_at, has_software_id_snapshot: !!value.software_id_snapshot, has_certificate_fingerprint_snapshot: !!value.certificate_fingerprint_snapshot });
      const requestId = RequestContextService.asyncLocalStorage.getStore()?.request_id;
      try {
        await tx.audit_logs.create({ data: { user_id: reviewerUserId, organization_id: organizationId, store_id: null, action: 'UPDATE', resource: 'received_buyer_event_enablements', resource_id: fresh.id, old_values: auditValues(existing), new_values: auditValues(fresh), metadata: { organization_id: organizationId, accounting_entity_id: accountingEntityId, review_note: input.review_note.trim() }, request_id: typeof requestId === 'string' && requestId.length >= 1 && requestId.length <= 100 ? requestId : null } });
      } catch {
        throw new ServiceUnavailableException('No fue posible registrar de forma segura la verificación.');
      }
      return { status: 'verified' as const, version: fresh.version, event_codes: fresh.event_codes as ReceivedBuyerEventCode[], dian_configuration_id: fresh.dian_configuration_id!, evidence_id: fresh.evidence_id!, verified_at: fresh.verified_at! };
    }).catch((error: unknown) => {
      if (error instanceof ServiceUnavailableException) throw error;
      if (error && typeof error === 'object' && 'code' in error && ['P2002', 'P2004'].includes(String(error.code))) throw new ConflictException('La solicitud de verificación ya cambió o viola una restricción.');
      throw error;
    });
  }

  async suspendAsPlatformReviewer(
    organizationId: number,
    accountingEntityId: number,
    reviewerUserId: number,
    input: SuspendReceivedBuyerEventInput,
  ): Promise<ReceivedBuyerEventSuspendedView> {
    this.assertPositive(organizationId, 'organization');
    this.assertPositive(accountingEntityId, 'accounting entity');
    this.assertPositive(reviewerUserId, 'reviewer');
    if (!Number.isSafeInteger(input?.expected_version) || input.expected_version < 1) throw new BadRequestException('La versión esperada no es válida.');
    if (typeof input?.reason !== 'string' || input.reason.trim().length < 20 || input.reason.trim().length > 500) throw new BadRequestException('La razón debe tener entre 20 y 500 caracteres.');
    const db = this.prisma.withoutScope();
    return db.$transaction(async (tx) => {
      await tx.$queryRaw(Prisma.sql`SELECT "id" FROM "accounting_entities" WHERE "id" = ${accountingEntityId} AND "organization_id" = ${organizationId} FOR UPDATE`);
      const where = { organization_id: organizationId, accounting_entity_id: accountingEntityId };
      const existing = await tx.received_buyer_event_enablements.findFirst({ where });
      if (!existing || existing.organization_id !== organizationId || existing.accounting_entity_id !== accountingEntityId || !['testing', 'verified'].includes(existing.status) || existing.version !== input.expected_version) throw new ConflictException('La activación cambió o no se puede suspender.');
      const changed = await tx.received_buyer_event_enablements.updateMany({
        where: { id: existing.id, ...where, version: input.expected_version, status: existing.status },
        data: { status: 'suspended', version: { increment: 1 } },
      });
      if (changed.count !== 1) throw new ConflictException('La activación cambió durante la suspensión.');
      const fresh = await tx.received_buyer_event_enablements.findFirst({ where: { id: existing.id, ...where } });
      if (!fresh) throw new ConflictException('La activación cambió durante la suspensión.');
      const auditValues = (value: typeof fresh) => ({ organization_id: organizationId, accounting_entity_id: accountingEntityId, status: value.status, version: value.version, dian_configuration_id: value.dian_configuration_id, evidence_id: value.evidence_id, event_codes: value.event_codes, verification_source: value.verification_source, verified_by_user_id: value.verified_by_user_id, verified_at: value.verified_at, has_software_id_snapshot: !!value.software_id_snapshot, has_certificate_fingerprint_snapshot: !!value.certificate_fingerprint_snapshot });
      const requestId = RequestContextService.asyncLocalStorage.getStore()?.request_id;
      try {
        await tx.audit_logs.create({ data: { user_id: reviewerUserId, organization_id: organizationId, store_id: null, action: 'UPDATE', resource: 'received_buyer_event_enablements', resource_id: fresh.id, old_values: auditValues(existing), new_values: auditValues(fresh), metadata: { organization_id: organizationId, accounting_entity_id: accountingEntityId, reason: input.reason.trim() }, request_id: typeof requestId === 'string' && requestId.length >= 1 && requestId.length <= 100 ? requestId : null } });
      } catch {
        throw new ServiceUnavailableException('No fue posible registrar de forma segura la suspensión.');
      }
      return { status: 'suspended' as const, version: fresh.version, event_codes: Array.isArray(fresh.event_codes) ? fresh.event_codes.filter((code): code is string => typeof code === 'string') : [] };
    }).catch((error: unknown) => {
      if (error instanceof ServiceUnavailableException) throw error;
      if (error && typeof error === 'object' && 'code' in error && ['P2002', 'P2004'].includes(String(error.code))) throw new ConflictException('La activación ya cambió o viola una restricción.');
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
