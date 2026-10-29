import type { BadgeVariant } from '../../../../../shared/components/badge/badge.component';
import type { LodgingReservationStatus } from '../reservations/interfaces/reservation.interface';
import type { HousekeepingStatus } from '../rooms/interfaces/unit.interface';
import type { HousekeepingTaskStatus } from '../housekeeping/interfaces/housekeeping.interface';
import { HOSPITALITY_TERMS } from './hospitality-labels';

/** Label and `app-badge` variant of one status chip. */
export interface StatusChip {
  label: string;
  variant: BadgeVariant;
}

/**
 * One text and one color per status in every Hospitality screen
 * (ui-ux-rules R-CHIP-02). Front desk, reservations, rack and housekeeping
 * read these maps instead of keeping their own.
 */
export const RESERVATION_STATUS_CHIPS: Record<LodgingReservationStatus, StatusChip> = {
  tentative: { label: 'Pendiente', variant: 'warning' },
  confirmed: { label: 'Confirmada', variant: 'info' },
  checked_in: { label: 'En casa', variant: 'success' },
  checked_out: { label: 'Salida hecha', variant: 'neutral' },
  cancelled: { label: 'Cancelada', variant: 'error' },
  no_show: { label: HOSPITALITY_TERMS.noShow, variant: 'error' },
};

export const HOUSEKEEPING_STATUS_CHIPS: Record<HousekeepingStatus, StatusChip> = {
  dirty: { label: 'Sucia', variant: 'warning' },
  clean: { label: 'Limpia', variant: 'info' },
  inspected: { label: 'Inspeccionada', variant: 'success' },
  out_of_order: { label: HOSPITALITY_TERMS.outOfOrder, variant: 'error' },
  out_of_service: { label: HOSPITALITY_TERMS.outOfService, variant: 'neutral' },
};

export const TASK_STATUS_CHIPS: Record<HousekeepingTaskStatus, StatusChip> = {
  pending: { label: 'Pendiente', variant: 'warning' },
  done: { label: 'Terminada', variant: 'success' },
};

/** H4.1 — status of a guest's TRA report. */
export const TRA_STATUS_CHIPS: Record<'pending' | 'sent' | 'manual' | 'failed', StatusChip> = {
  pending: { label: 'Pendiente', variant: 'warning' },
  sent: { label: 'Enviado ✓', variant: 'success' },
  manual: { label: 'Reportado en el portal', variant: 'info' },
  failed: { label: 'Rechazado', variant: 'error' },
};

/**
 * H4.2 — SIRE movement of a foreign guest. `overdue` is a pending one past the
 * store threshold (24 h by default): red, with its own text (R-CHIP-01).
 */
export const SIRE_STATUS_CHIPS: Record<'pending' | 'overdue' | 'manual', StatusChip> = {
  pending: { label: 'Pendiente', variant: 'warning' },
  overdue: { label: 'Atrasado', variant: 'error' },
  manual: { label: 'Reportado ✓', variant: 'success' },
};

/** Theme color of each badge variant (R-CHIP-03: no loose hex). */
const VARIANT_COLOR: Record<BadgeVariant, string> = {
  success: 'var(--color-success)',
  warning: 'var(--color-warning)',
  error: 'var(--color-error)',
  info: 'var(--color-info)',
  primary: 'var(--color-primary)',
  neutral: 'var(--color-text-secondary)',
  service: 'var(--color-primary)',
};

/** Tailwind left-border class per variant, for status-tinted cards. */
export const VARIANT_BORDER: Record<BadgeVariant, string> = {
  success: 'border-l-success',
  warning: 'border-l-warning',
  error: 'border-l-error',
  info: 'border-l-info',
  primary: 'border-l-primary',
  neutral: 'border-l-border',
  service: 'border-l-primary',
};

/** Inline tint of a variant (same formula as the table badges), for bars. */
export function variantTint(variant: BadgeVariant): Record<string, string> {
  const color = VARIANT_COLOR[variant];
  return {
    'background-color': `color-mix(in srgb, ${color} 15%, transparent)`,
    'border-color': `color-mix(in srgb, ${color} 45%, transparent)`,
    color,
  };
}

function labelsOf<K extends string>(chips: Record<K, StatusChip>): Record<K, string> {
  return Object.fromEntries(
    Object.entries<StatusChip>(chips).map(([key, chip]) => [key, chip.label]),
  ) as Record<K, string>;
}

/**
 * `badgeConfig` for TableComponent / ItemListComponent: the raw status picks
 * a theme color, the column `transform` shows the label.
 */
export function statusBadgeConfig<K extends string>(chips: Record<K, StatusChip>) {
  return {
    type: 'custom' as const,
    size: 'sm' as const,
    colorMap: Object.fromEntries(
      Object.entries<StatusChip>(chips).map(([key, chip]) => [key, VARIANT_COLOR[chip.variant]]),
    ) as Record<string, string>,
  };
}

export const RESERVATION_STATUS_LABELS = labelsOf(RESERVATION_STATUS_CHIPS);
export const HOUSEKEEPING_STATUS_LABELS = labelsOf(HOUSEKEEPING_STATUS_CHIPS);
export const TASK_STATUS_LABELS = labelsOf(TASK_STATUS_CHIPS);
export const TRA_STATUS_LABELS = labelsOf(TRA_STATUS_CHIPS);
export const SIRE_STATUS_LABELS = labelsOf(SIRE_STATUS_CHIPS);
