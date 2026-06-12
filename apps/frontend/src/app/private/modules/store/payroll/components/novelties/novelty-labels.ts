import { NoveltyType, NoveltyStatus } from '../../interfaces/payroll.interface';

/** Unidad de captura/visualización de cada tipo de novedad. */
export type NoveltyUnit = 'hours' | 'days' | 'amount';

export interface NoveltyTypeConfig {
  label: string;
  unit: NoveltyUnit;
  /** Grupo visual para el badge de tipo. */
  group: 'overtime' | 'surcharge' | 'incapacity' | 'leave' | 'earning' | 'deduction';
}

export const NOVELTY_TYPE_CONFIG: Record<NoveltyType, NoveltyTypeConfig> = {
  overtime_diurna: { label: 'H.E. Diurna', unit: 'hours', group: 'overtime' },
  overtime_nocturna: { label: 'H.E. Nocturna', unit: 'hours', group: 'overtime' },
  overtime_dominical_diurna: { label: 'H.E. Dominical Diurna', unit: 'hours', group: 'overtime' },
  overtime_dominical_nocturna: { label: 'H.E. Dominical Nocturna', unit: 'hours', group: 'overtime' },
  surcharge_nocturno: { label: 'Recargo Nocturno', unit: 'hours', group: 'surcharge' },
  surcharge_dominical: { label: 'Recargo Dominical', unit: 'hours', group: 'surcharge' },
  incapacity_general: { label: 'Incapacidad General', unit: 'days', group: 'incapacity' },
  incapacity_laboral: { label: 'Incapacidad Laboral', unit: 'days', group: 'incapacity' },
  vacation: { label: 'Vacaciones', unit: 'days', group: 'leave' },
  leave_paid: { label: 'Licencia Remunerada', unit: 'days', group: 'leave' },
  leave_unpaid: { label: 'Licencia No Remunerada', unit: 'days', group: 'leave' },
  bonus: { label: 'Bonificación', unit: 'amount', group: 'earning' },
  commission: { label: 'Comisión', unit: 'amount', group: 'earning' },
  other_deduction: { label: 'Otra Deducción', unit: 'amount', group: 'deduction' },
};

export const NOVELTY_TYPE_COLOR_MAP: Record<string, string> = {
  overtime_diurna: '#3b82f6',
  overtime_nocturna: '#6366f1',
  overtime_dominical_diurna: '#0ea5e9',
  overtime_dominical_nocturna: '#8b5cf6',
  surcharge_nocturno: '#a855f7',
  surcharge_dominical: '#d946ef',
  incapacity_general: '#f97316',
  incapacity_laboral: '#ef4444',
  vacation: '#14b8a6',
  leave_paid: '#22c55e',
  leave_unpaid: '#9ca3af',
  bonus: '#eab308',
  commission: '#f59e0b',
  other_deduction: '#64748b',
};

export const NOVELTY_STATUS_LABELS: Record<NoveltyStatus, string> = {
  pending: 'Pendiente',
  applied: 'Aplicada',
  cancelled: 'Cancelada',
};

export const NOVELTY_STATUS_COLOR_MAP: Record<string, string> = {
  pending: '#eab308',
  applied: '#22c55e',
  cancelled: '#9ca3af',
};

export function getNoveltyTypeLabel(type: string): string {
  return NOVELTY_TYPE_CONFIG[type as NoveltyType]?.label || type;
}

export function getNoveltyStatusLabel(status: string): string {
  return NOVELTY_STATUS_LABELS[status as NoveltyStatus] || status;
}

export function getNoveltyUnit(type: string): NoveltyUnit {
  return NOVELTY_TYPE_CONFIG[type as NoveltyType]?.unit || 'amount';
}
