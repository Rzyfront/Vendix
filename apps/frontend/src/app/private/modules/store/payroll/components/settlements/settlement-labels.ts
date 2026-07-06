import type { BadgeVariant } from '../../../../../../shared/components/badge/badge.component';

/** Estados posibles de una liquidacion laboral. */
export type SettlementStatus =
  | 'draft'
  | 'calculated'
  | 'approved'
  | 'paid'
  | 'cancelled';

export const SETTLEMENT_STATUS_LABELS: Record<string, string> = {
  draft: 'Borrador',
  calculated: 'Calculada',
  approved: 'Aprobada',
  paid: 'Pagada',
  cancelled: 'Cancelada',
};

/**
 * Colores por estado para el badge de tabla/card (type:'custom').
 * Hex de 7 chars (los inline-styles del badge custom NO aceptan clases Tailwind).
 * `cancelled` es rojo (#ef4444) para NO colisionar con el gris de `draft`.
 */
export const SETTLEMENT_STATUS_COLOR_MAP: Record<string, string> = {
  draft: '#9ca3af',
  calculated: '#3b82f6',
  approved: '#eab308',
  paid: '#22c55e',
  cancelled: '#ef4444',
};

/** Variante semantica del componente <app-badge> (modal de detalle). */
export const SETTLEMENT_STATUS_BADGE_VARIANT: Record<string, BadgeVariant> = {
  draft: 'neutral',
  calculated: 'primary',
  approved: 'warning',
  paid: 'success',
  cancelled: 'error',
};

export const SETTLEMENT_REASON_LABELS: Record<string, string> = {
  voluntary_resignation: 'Renuncia Voluntaria',
  just_cause: 'Despido con Justa Causa',
  without_just_cause: 'Despido sin Justa Causa',
  mutual_agreement: 'Mutuo Acuerdo',
  contract_expiry: 'Vencimiento Contrato',
  retirement: 'Jubilacion',
  death: 'Muerte del Trabajador',
};

export const SETTLEMENT_CONTRACT_LABELS: Record<string, string> = {
  indefinite: 'Indefinido',
  fixed_term: 'Termino Fijo',
  service: 'Prestacion de Servicios',
  apprentice: 'Aprendizaje',
};

export function getSettlementStatusLabel(status: string): string {
  return SETTLEMENT_STATUS_LABELS[status] || status;
}

export function getSettlementStatusBadgeVariant(status: string): BadgeVariant {
  return SETTLEMENT_STATUS_BADGE_VARIANT[status] || 'neutral';
}

export function getSettlementReasonLabel(reason: string): string {
  return SETTLEMENT_REASON_LABELS[reason] || reason || '-';
}

export function getSettlementContractLabel(type: string): string {
  return SETTLEMENT_CONTRACT_LABELS[type] || type || '-';
}
