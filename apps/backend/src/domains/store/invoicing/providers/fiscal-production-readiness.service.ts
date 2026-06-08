import { Injectable } from '@nestjs/common';
import { StorePrismaService } from '../../../../prisma/services/store-prisma.service';
import { VendixHttpException, ErrorCodes } from 'src/common/errors';
import { certificateNitMatches } from '../dian-config/certificates/nit-match.util';

type DianConfigurationType = 'invoicing' | 'support_document' | 'payroll';
type ReadinessDocumentType =
  | 'sales_invoice'
  | 'credit_note'
  | 'debit_note'
  | 'support_document'
  | 'support_adjustment_note'
  | 'payroll'
  | 'payroll_adjustment';

interface ResolveConfigParams {
  organization_id: number;
  store_id?: number | null;
  accounting_entity_id: number;
  configuration_type: DianConfigurationType;
  document_type?: ReadinessDocumentType;
  requireProduction?: boolean;
}

@Injectable()
export class FiscalProductionReadinessService {
  constructor(private readonly prisma: StorePrismaService) {}

  isProductionRuntime(): boolean {
    return process.env.NODE_ENV === 'production';
  }

  async resolveOwnSoftwareConfig(params: ResolveConfigParams) {
    const requireProduction =
      params.requireProduction ?? this.isProductionRuntime();
    const allowedStatuses = requireProduction
      ? (['enabled'] as const)
      : (['testing', 'test_set_passed', 'enabled'] as const);

    const config = await this.prisma
      .withoutScope()
      .dian_configurations.findFirst({
        where: {
          organization_id: params.organization_id,
          accounting_entity_id: params.accounting_entity_id,
          configuration_type: params.configuration_type,
          operation_mode: 'own_software',
          enablement_status: { in: [...allowedStatuses] },
          ...(requireProduction && { environment: 'production' }),
        },
        orderBy: [{ is_default: 'desc' }, { created_at: 'desc' }],
      });

    if (!config) {
      throw new VendixHttpException(
        ErrorCodes.FISCAL_CONFIG_INCOMPLETE,
        'No DIAN own-software configuration is enabled for this fiscal entity and document type.',
        {
          organization_id: params.organization_id,
          store_id: params.store_id,
          accounting_entity_id: params.accounting_entity_id,
          configuration_type: params.configuration_type,
          require_production: requireProduction,
        },
      );
    }

    if (requireProduction) {
      this.assertProductionReady(config);
      await this.assertResolutionReady(params);
    }

    return config;
  }

  assertProductionReady(config: {
    id: number;
    operation_mode: string;
    environment: string;
    enablement_status: string;
    software_id: string | null;
    software_pin_encrypted: string | null;
    certificate_s3_key: string | null;
    certificate_password_encrypted: string | null;
    certificate_expiry: Date | null;
    certificate_fingerprint?: string | null;
    certificate_nit?: string | null;
    enablement_evidence?: unknown;
    test_set_id: string | null;
    last_test_result: unknown;
    nit?: string | null;
    nit_dv?: string | null;
    accounting_entity_id?: number | null;
  }): void {
    const missing: string[] = [];

    if (config.operation_mode !== 'own_software') {
      throw new VendixHttpException(
        ErrorCodes.DIAN_PROVIDER_OWN_SOFTWARE_REQUIRED,
        undefined,
        { dian_configuration_id: config.id },
      );
    }

    if (config.environment !== 'production') missing.push('environment');
    if (config.enablement_status !== 'enabled') {
      missing.push('enablement_status');
    }
    if (!config.software_id) missing.push('software_id');
    if (!config.software_pin_encrypted) missing.push('software_pin');
    if (!config.accounting_entity_id) missing.push('accounting_entity_id');
    if (!config.test_set_id) missing.push('test_set_id');
    if (!this.hasPassedTestSet(config.last_test_result)) {
      missing.push('test_set_evidence');
    }
    if (!config.enablement_evidence) {
      missing.push('enablement_evidence');
    }
    if (!config.certificate_s3_key) missing.push('certificate_s3_key');
    if (!config.certificate_password_encrypted) {
      missing.push('certificate_password');
    }
    if (!config.certificate_fingerprint) {
      missing.push('certificate_fingerprint');
    }
    if (!config.certificate_nit) {
      missing.push('certificate_nit');
    } else if (
      config.nit &&
      !certificateNitMatches({
        certificateTaxId: config.certificate_nit,
        nit: config.nit,
        dv: config.nit_dv,
      })
    ) {
      throw new VendixHttpException(ErrorCodes.DIAN_CERT_004, undefined, {
        dian_configuration_id: config.id,
        expected_nit: this.onlyDigits(config.nit),
        certificate_nit: this.onlyDigits(config.certificate_nit),
      });
    }
    if (!config.certificate_expiry) {
      missing.push('certificate_expiry');
    } else if (config.certificate_expiry <= new Date()) {
      throw new VendixHttpException(ErrorCodes.DIAN_CERT_003, undefined, {
        dian_configuration_id: config.id,
        certificate_expiry: config.certificate_expiry,
      });
    }
    if (!process.env.DIAN_ENCRYPTION_KEY) {
      missing.push('DIAN_ENCRYPTION_KEY');
    }

    if (missing.length > 0) {
      throw new VendixHttpException(
        ErrorCodes.DIAN_ENABLEMENT_001,
        'DIAN own-software production prerequisites are incomplete.',
        {
          dian_configuration_id: config.id,
          missing,
        },
      );
    }
  }

  private hasPassedTestSet(lastTestResult: unknown): boolean {
    if (!lastTestResult || typeof lastTestResult !== 'object') return false;
    const data = lastTestResult as Record<string, any>;
    return data?.dian_response?.success === true || data?.success === true;
  }

  private async assertResolutionReady(params: ResolveConfigParams): Promise<void> {
    const document_type =
      params.document_type ?? this.defaultDocumentType(params.configuration_type);
    const now = new Date();
    const resolution = await this.prisma.withoutScope().invoice_resolutions.findFirst({
      where: {
        organization_id: params.organization_id,
        accounting_entity_id: params.accounting_entity_id,
        document_type,
        is_active: true,
        valid_from: { lte: now },
        valid_to: { gte: now },
      },
      select: { id: true, current_number: true, range_to: true },
    });

    if (!resolution) {
      throw new VendixHttpException(ErrorCodes.FISCAL_RESOLUTION_MISSING, undefined, {
        organization_id: params.organization_id,
        store_id: params.store_id,
        accounting_entity_id: params.accounting_entity_id,
        document_type,
      });
    }

    if (resolution.current_number >= resolution.range_to) {
      throw new VendixHttpException(
        ErrorCodes.FISCAL_RESOLUTION_EXHAUSTED,
        undefined,
        {
          organization_id: params.organization_id,
          store_id: params.store_id,
          accounting_entity_id: params.accounting_entity_id,
          document_type,
          invoice_resolution_id: resolution.id,
        },
      );
    }
  }

  private defaultDocumentType(
    configuration_type: DianConfigurationType,
  ): ReadinessDocumentType {
    if (configuration_type === 'support_document') return 'support_document';
    if (configuration_type === 'payroll') return 'payroll';
    return 'sales_invoice';
  }

  private onlyDigits(value?: string | null): string {
    return String(value ?? '').replace(/\D/g, '');
  }
}
