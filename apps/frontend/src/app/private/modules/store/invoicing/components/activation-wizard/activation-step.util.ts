import type {
  FiscalReadinessAxis,
  FiscalReadinessResponse,
} from '../../../../../../shared/components/dian/fiscal-readiness.interface';
import { isHabilitationNumbering } from '../../../../../../shared/utils/habilitation-numbering.util';
import type { DianConfig } from '../../interfaces/invoice.interface';
import {
  ACTIVATION_STEPS,
  type ActivationOverallState,
  type ActivationSnapshot,
  type ActivationStepId,
} from './activation-wizard.model';

/** Certificado presente y, si se conoce el vencimiento, todavía vigente. */
export function hasValidCertificate(
  config: DianConfig | null,
  now: Date = new Date(),
): boolean {
  if (!config) return false;
  const present =
    config.certificate_present ?? Boolean(config.certificate_s3_key);
  if (!present) return false;
  if (config.certificate_expiry) {
    const expiry = new Date(config.certificate_expiry).getTime();
    if (Number.isFinite(expiry) && expiry <= now.getTime()) return false;
  }
  return true;
}

/**
 * software_id + PIN + test_set_id. El backend nunca devuelve el PIN: lo
 * enmascara como '****' cuando existe y `null` cuando no
 * (`dian-config.service.ts`), por eso `software_pin_encrypted` truthy basta
 * como señal de presencia.
 */
export function hasSoftwareCredentials(config: DianConfig | null): boolean {
  if (!config) return false;
  return (
    Boolean(config.software_id?.trim()) &&
    Boolean(config.software_pin_encrypted) &&
    Boolean(config.test_set_id?.trim())
  );
}

export function testSetPassed(axis: FiscalReadinessAxis | null): boolean {
  const status = axis?.enablement_status;
  return status === 'test_set_passed' || status === 'enabled';
}

/** Resolución de factura de venta activa, vigente y que no sea de habilitación. */
export function hasProductionResolution(
  axis: FiscalReadinessAxis | null,
  now: Date = new Date(),
): boolean {
  if (!axis) return false;
  return axis.resolutions.some((r) => {
    if (r.document_type !== 'sales_invoice' || !r.is_active) return false;
    const validTo = new Date(r.valid_to).getTime();
    if (!Number.isFinite(validTo) || validTo <= now.getTime()) return false;
    return !isHabilitationNumbering({
      resolution_number: r.resolution_number,
      range_from: r.range_from,
      range_to: r.range_to,
    });
  });
}

export function isProductionActive(axis: FiscalReadinessAxis | null): boolean {
  return (
    axis?.environment === 'production' && axis?.enablement_status === 'enabled'
  );
}

export function nextActivationStep(
  snapshot: ActivationSnapshot,
  now: Date = new Date(),
): ActivationStepId {
  if (!snapshot.legalDataComplete) return 'company';
  if (!snapshot.config || !hasSoftwareCredentials(snapshot.config)) {
    return 'software';
  }
  if (!hasValidCertificate(snapshot.config, now)) return 'certificate';
  if (!testSetPassed(snapshot.axis)) return 'testing';
  if (!hasProductionResolution(snapshot.axis, now)) return 'production_ranges';
  return 'promote';
}

export function activationOverallState(
  snapshot: ActivationSnapshot,
): ActivationOverallState {
  return isProductionActive(snapshot.axis) ? 'completed' : 'in_progress';
}

function stepIndex(step: ActivationStepId): number {
  return ACTIVATION_STEPS.findIndex((s) => s.id === step);
}

export function isStepCompleted(
  step: ActivationStepId,
  snapshot: ActivationSnapshot,
  now: Date = new Date(),
): boolean {
  if (activationOverallState(snapshot) === 'completed') return true;
  return stepIndex(step) < stepIndex(nextActivationStep(snapshot, now));
}

/** Se puede volver a un paso completado o al actual; no saltar hacia adelante. */
export function canEnterStep(
  step: ActivationStepId,
  snapshot: ActivationSnapshot,
  now: Date = new Date(),
): boolean {
  if (activationOverallState(snapshot) === 'completed') return true;
  return stepIndex(step) <= stepIndex(nextActivationStep(snapshot, now));
}

/** El eje de factura de venta es la habilitación invoicing. */
export function selectSalesInvoiceAxis(
  response: FiscalReadinessResponse | null,
): FiscalReadinessAxis | null {
  return (
    response?.axes.find((a) => a.configuration_type === 'invoicing') ?? null
  );
}

/**
 * Paso del asistente que resuelve un check del checklist de producción.
 * `null` cuando el check no tiene un paso propio.
 */
export function stepForReadinessCheck(key: string): ActivationStepId | null {
  if (key === 'software_id' || key === 'software_pin' || key === 'test_set_id') {
    return 'software';
  }
  if (key.startsWith('certificate_')) return 'certificate';
  if (
    key === 'test_set_evidence' ||
    key === 'enablement_evidence' ||
    key.startsWith('test_set_')
  ) {
    return 'testing';
  }
  if (key === 'production_resolution') return 'production_ranges';
  if (key === 'environment' || key === 'enablement_status') return 'promote';
  return null;
}
