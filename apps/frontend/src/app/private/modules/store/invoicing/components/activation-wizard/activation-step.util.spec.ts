import type {
  FiscalReadinessAxis,
  FiscalReadinessResolution,
  FiscalReadinessResponse,
} from '../../../../../../shared/components/dian/fiscal-readiness.interface';
import type { DianConfig } from '../../interfaces/invoice.interface';
import type { ActivationSnapshot } from './activation-wizard.model';
import {
  activationOverallState,
  canEnterStep,
  hasValidCertificate,
  isStepCompleted,
  nextActivationStep,
  selectSalesInvoiceAxis,
  stepForReadinessCheck,
} from './activation-step.util';

const NOW = new Date('2026-06-01T12:00:00Z');

function config(over: Partial<DianConfig> = {}): DianConfig {
  return {
    id: 1,
    software_id: 'sw-1',
    software_pin_encrypted: '****',
    test_set_id: 'ts-1',
    certificate_s3_key: 'k.p12',
    certificate_expiry: '2027-01-01T00:00:00Z',
    environment: 'test',
    enablement_status: 'testing',
    ...over,
  } as DianConfig;
}

function resolution(
  over: Partial<FiscalReadinessResolution> = {},
): FiscalReadinessResolution {
  return {
    id: 1,
    document_type: 'sales_invoice',
    prefix: 'FE',
    range_from: 1,
    range_to: 5000,
    current_number: 1,
    valid_from: '2026-01-01',
    valid_to: '2028-01-01',
    is_active: true,
    technical_key_set: true,
    resolution_number: '18764000000001',
    ...over,
  };
}

const SETP = resolution({
  id: 2,
  prefix: 'SETP',
  range_from: 990000000,
  range_to: 995000000,
  resolution_number: '18760000001',
});

function axis(over: Partial<FiscalReadinessAxis> = {}): FiscalReadinessAxis {
  return {
    configuration_type: 'invoicing',
    label: 'Factura',
    config_id: 1,
    environment: 'test',
    enablement_status: 'testing',
    readiness: null,
    resolutions: [],
    ...over,
  };
}

function snap(over: Partial<ActivationSnapshot> = {}): ActivationSnapshot {
  return {
    legalDataComplete: true,
    axis: axis(),
    config: config(),
    ...over,
  };
}

describe('activation-step.util', () => {
  it('sin datos legales -> company', () => {
    expect(nextActivationStep(snap({ legalDataComplete: false }), NOW)).toBe('company');
  });

  it('sin config -> software', () => {
    expect(nextActivationStep(snap({ config: null }), NOW)).toBe('software');
  });

  it('config sin software_id -> software', () => {
    expect(nextActivationStep(snap({ config: config({ software_id: '' }) }), NOW)).toBe('software');
  });

  it('sin certificado -> certificate', () => {
    const c = config({ certificate_s3_key: null, certificate_present: false });
    expect(nextActivationStep(snap({ config: c }), NOW)).toBe('certificate');
  });

  it('certificado vencido -> certificate', () => {
    const c = config({ certificate_expiry: '2026-05-01T00:00:00Z' });
    expect(hasValidCertificate(c, NOW)).toBeFalse();
    expect(nextActivationStep(snap({ config: c }), NOW)).toBe('certificate');
  });

  it('not_started y testing -> testing', () => {
    for (const status of ['not_started', 'testing']) {
      expect(
        nextActivationStep(snap({ axis: axis({ enablement_status: status }) }), NOW),
      ).toBe('testing');
    }
  });

  it('test_set_passed solo con SETP -> production_ranges', () => {
    const s = snap({ axis: axis({ enablement_status: 'test_set_passed', resolutions: [SETP] }) });
    expect(nextActivationStep(s, NOW)).toBe('production_ranges');
  });

  it('resolución de producción vencida -> production_ranges', () => {
    const s = snap({
      axis: axis({
        enablement_status: 'test_set_passed',
        resolutions: [resolution({ valid_to: '2026-03-01' })],
      }),
    });
    expect(nextActivationStep(s, NOW)).toBe('production_ranges');
  });

  it('con resolución de producción -> promote', () => {
    const s = snap({
      axis: axis({ enablement_status: 'test_set_passed', resolutions: [SETP, resolution()] }),
    });
    expect(nextActivationStep(s, NOW)).toBe('promote');
    expect(activationOverallState(s)).toBe('in_progress');
  });

  it('production + enabled -> completed', () => {
    const s = snap({
      axis: axis({ environment: 'production', enablement_status: 'enabled', resolutions: [resolution()] }),
    });
    expect(activationOverallState(s)).toBe('completed');
    expect(isStepCompleted('promote', s, NOW)).toBeTrue();
  });

  it('canEnterStep no permite saltar hacia adelante', () => {
    const s = snap(); // paso actual: testing
    expect(canEnterStep('company', s, NOW)).toBeTrue();
    expect(canEnterStep('certificate', s, NOW)).toBeTrue();
    expect(canEnterStep('testing', s, NOW)).toBeTrue();
    expect(canEnterStep('production_ranges', s, NOW)).toBeFalse();
    expect(canEnterStep('promote', s, NOW)).toBeFalse();
    expect(isStepCompleted('certificate', s, NOW)).toBeTrue();
    expect(isStepCompleted('testing', s, NOW)).toBeFalse();
  });

  it('selectSalesInvoiceAxis elige el eje invoicing', () => {
    const resp = {
      fiscal_scope: 'STORE',
      axes: [axis({ configuration_type: 'payroll' }), axis()],
    } as FiscalReadinessResponse;
    expect(selectSalesInvoiceAxis(resp)?.configuration_type).toBe('invoicing');
    expect(selectSalesInvoiceAxis(null)).toBeNull();
  });

  it('stepForReadinessCheck mapea cada check a su paso', () => {
    expect(stepForReadinessCheck('software_id')).toBe('software');
    expect(stepForReadinessCheck('software_pin')).toBe('software');
    expect(stepForReadinessCheck('test_set_id')).toBe('software');
    expect(stepForReadinessCheck('certificate_s3_key')).toBe('certificate');
    expect(stepForReadinessCheck('certificate_expiry')).toBe('certificate');
    expect(stepForReadinessCheck('test_set_evidence')).toBe('testing');
    expect(stepForReadinessCheck('enablement_evidence')).toBe('testing');
    expect(stepForReadinessCheck('test_set_other')).toBe('testing');
    expect(stepForReadinessCheck('production_resolution')).toBe('production_ranges');
    expect(stepForReadinessCheck('environment')).toBe('promote');
    expect(stepForReadinessCheck('enablement_status')).toBe('promote');
    expect(stepForReadinessCheck('accounting_entity_id')).toBeNull();
    expect(stepForReadinessCheck('')).toBeNull();
  });
});
