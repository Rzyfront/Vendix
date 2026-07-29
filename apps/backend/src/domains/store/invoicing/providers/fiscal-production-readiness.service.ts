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

/** One unmet prerequisite, phrased for the merchant (not for a log line). */
export interface ProductionReadinessCheck {
  key: string;
  label: string;
  satisfied: boolean;
  /** What the merchant has to do about it. Empty when already satisfied. */
  action: string;
  /**
   * `tenant` = the merchant can fix it from the panel.
   * `platform` = only Vendix operations can fix it (e.g. a missing env var).
   */
  owner: 'tenant' | 'platform';
}

export interface ProductionReadinessReport {
  ready: boolean;
  dian_configuration_id: number;
  environment: string;
  enablement_status: string;
  checks: ProductionReadinessCheck[];
  missing: string[];
}

/** Shape `assertProductionReady` / `evaluateProductionReadiness` need. */
type ReadinessConfig = {
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
};

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
      // La DIAN no emite resolución de numeración para la nómina electrónica
      // (el DSPNE numera con su propio consecutivo NumNE, no con una
      // invoice_resolutions), por lo que exigir una resolución activa bloquearía
      // el corte a producción de nómina de forma permanente. Facturación de venta
      // y documento soporte sí requieren resolución vigente.
      if (params.configuration_type !== 'payroll') {
        await this.assertResolutionReady(params);
      }
    }

    return config;
  }

  /**
   * Non-throwing counterpart of {@link assertProductionReady}. Returns the full
   * checklist so the UI can show the merchant *what* is missing and *who* has to
   * fix it, instead of a single opaque 412. The predicates are shared, so the
   * checklist can never drift from the gate that actually blocks emission.
   */
  evaluateProductionReadiness(
    config: ReadinessConfig,
  ): ProductionReadinessReport {
    const certNitMatches =
      !!config.certificate_nit &&
      (!config.nit ||
        certificateNitMatches({
          certificateTaxId: config.certificate_nit,
          nit: config.nit,
          dv: config.nit_dv,
        }));
    const certValid =
      !!config.certificate_expiry && config.certificate_expiry > new Date();

    const checks: ProductionReadinessCheck[] = [
      {
        key: 'operation_mode',
        label: 'Modo de operación "software propio"',
        satisfied: config.operation_mode === 'own_software',
        action: 'Vendix debe habilitar el modo software propio para este NIT.',
        owner: 'platform',
      },
      {
        key: 'test_set_evidence',
        label: 'Set de pruebas aprobado por la DIAN',
        satisfied: this.hasPassedTestSet(config.last_test_result),
        action: 'Ejecuta el set de pruebas y espera el visto bueno de la DIAN.',
        owner: 'tenant',
      },
      {
        key: 'enablement_evidence',
        label: 'Evidencia de habilitación almacenada',
        satisfied: !!config.enablement_evidence,
        action:
          'Se guarda automáticamente cuando la DIAN aprueba el set de pruebas.',
        owner: 'tenant',
      },
      {
        key: 'enablement_status',
        label: 'Habilitación marcada como "enabled"',
        satisfied: config.enablement_status === 'enabled',
        action:
          'Promueve la configuración a producción una vez la DIAN apruebe el set.',
        owner: 'tenant',
      },
      {
        key: 'environment',
        label: 'Ambiente en producción',
        satisfied: config.environment === 'production',
        action: 'Cambia el ambiente a Producción en el paso de Ambiente.',
        owner: 'tenant',
      },
      {
        key: 'software_id',
        label: 'Software ID registrado',
        satisfied: !!config.software_id,
        action: 'Copia el Software ID del portal DIAN en el paso 1.',
        owner: 'tenant',
      },
      {
        key: 'software_pin',
        label: 'PIN del software guardado',
        satisfied: !!config.software_pin_encrypted,
        action: 'Ingresa el PIN del software en el paso 1.',
        owner: 'tenant',
      },
      {
        key: 'test_set_id',
        label: 'Test Set ID registrado',
        satisfied: !!config.test_set_id,
        action: 'Copia el TestSetId que la DIAN asignó a tu software.',
        owner: 'tenant',
      },
      {
        key: 'accounting_entity_id',
        label: 'Entidad contable asociada',
        satisfied: !!config.accounting_entity_id,
        action: 'Completa los datos fiscales (NIT) de la entidad.',
        owner: 'tenant',
      },
      {
        key: 'certificate_s3_key',
        label: 'Certificado digital cargado',
        satisfied: !!config.certificate_s3_key,
        action: 'Sube el archivo .p12 en el paso de Certificado.',
        owner: 'tenant',
      },
      {
        key: 'certificate_password',
        label: 'Contraseña del certificado guardada',
        satisfied: !!config.certificate_password_encrypted,
        action: 'Vuelve a subir el certificado con su contraseña.',
        owner: 'tenant',
      },
      {
        key: 'certificate_fingerprint',
        label: 'Huella del certificado calculada',
        satisfied: !!config.certificate_fingerprint,
        action: 'Vuelve a subir el certificado para recalcular su huella.',
        owner: 'tenant',
      },
      {
        key: 'certificate_nit',
        label: 'Certificado emitido para este NIT',
        satisfied: certNitMatches,
        action:
          'El NIT del certificado debe coincidir con el NIT de la entidad fiscal.',
        owner: 'tenant',
      },
      {
        key: 'certificate_expiry',
        label: 'Certificado vigente',
        satisfied: certValid,
        action: 'Renueva el certificado digital: está vencido o sin fecha.',
        owner: 'tenant',
      },
      {
        key: 'DIAN_ENCRYPTION_KEY',
        label: 'Llave de cifrado de secretos configurada',
        satisfied: !!process.env.DIAN_ENCRYPTION_KEY,
        action:
          'Vendix debe definir DIAN_ENCRYPTION_KEY en el entorno del servidor.',
        owner: 'platform',
      },
    ];

    const missing = checks.filter((c) => !c.satisfied).map((c) => c.key);

    return {
      ready: missing.length === 0,
      dian_configuration_id: config.id,
      environment: config.environment,
      enablement_status: config.enablement_status,
      checks,
      missing,
    };
  }

  assertProductionReady(config: ReadinessConfig): void {
    if (config.operation_mode !== 'own_software') {
      throw new VendixHttpException(
        ErrorCodes.DIAN_PROVIDER_OWN_SOFTWARE_REQUIRED,
        undefined,
        { dian_configuration_id: config.id },
      );
    }

    // Certificate identity/expiry keep their dedicated error codes: they are not
    // "incomplete setup" but an actively wrong certificate, and the frontend maps
    // them to specific remediation copy.
    if (
      config.certificate_nit &&
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
    if (config.certificate_expiry && config.certificate_expiry <= new Date()) {
      throw new VendixHttpException(ErrorCodes.DIAN_CERT_003, undefined, {
        dian_configuration_id: config.id,
        certificate_expiry: config.certificate_expiry,
      });
    }

    const report = this.evaluateProductionReadiness(config);
    // `operation_mode` already threw above; drop it so the payload keeps the
    // exact same `missing` semantics it had before this refactor.
    const missing = report.missing.filter((key) => key !== 'operation_mode');

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
