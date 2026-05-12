import {
  FiscalArea,
  FiscalWizardStepId,
  isFiscalArea,
  isFiscalWizardStep,
} from '../interfaces/fiscal-status.interface';

export const FISCAL_STATUS_STEP_ORDER: FiscalWizardStepId[] = [
  'area_selection',
  'legal_data',
  'dian_config',
  'puc',
  'accounting_period',
  'default_taxes',
  'accounting_mappings',
  'initial_inventory',
  'payroll_config',
  'validation',
];

export const REQUIRED_STEPS_BY_FISCAL_AREA: Record<
  FiscalArea,
  FiscalWizardStepId[]
> = {
  invoicing: ['legal_data', 'dian_config', 'default_taxes', 'validation'],
  accounting: [
    'legal_data',
    'puc',
    'accounting_period',
    'default_taxes',
    'accounting_mappings',
    'initial_inventory',
    'validation',
  ],
  payroll: ['legal_data', 'payroll_config', 'validation'],
};

export function buildFiscalWizardSequence(
  areas: Iterable<FiscalArea>,
): FiscalWizardStepId[] {
  const selected = new Set(Array.from(areas).filter(isFiscalArea));
  const required = new Set<FiscalWizardStepId>(['area_selection']);

  for (const area of selected) {
    for (const step of REQUIRED_STEPS_BY_FISCAL_AREA[area]) {
      required.add(step);
    }
  }

  return FISCAL_STATUS_STEP_ORDER.filter((step) => required.has(step));
}

export function assertFiscalWizardStep(value: unknown): FiscalWizardStepId {
  if (!isFiscalWizardStep(value)) {
    throw new Error(`Invalid fiscal wizard step: ${String(value)}`);
  }
  return value;
}
