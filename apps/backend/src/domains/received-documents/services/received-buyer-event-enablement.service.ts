import { Injectable } from '@nestjs/common';
import { normalizeNit } from '../../../common/utils/nit.util';
import { GlobalPrismaService } from '../../../prisma/services/global-prisma.service';
import { ReceivedDocumentsContext, ReceivedDocumentsService } from '../received-documents.service';

export type ReceivedBuyerEventCode = '030' | '031' | '032' | '033';
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

  private safeStatus(status: string): ReceivedBuyerEventReadinessStatus {
    if (status === 'verified' || status === 'suspended' || status === 'testing') return status;
    return 'not_started';
  }
}
