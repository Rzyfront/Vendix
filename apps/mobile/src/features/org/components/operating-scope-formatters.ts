/**
 * Formatters y labels para el módulo Operating Scope.
 * Espejo 1:1 de apps/frontend/.../operating-scope/components/change-scope-wizard.component.ts
 * y operating-scope.component.ts (scopeLabel, blockerTitle).
 */

import type { OperatingScopeValue } from '@/core/models/org-admin/config.types';

// ----------------------------------------------------------------------------
// Scope labels — parity con web scopeLabel()
// ----------------------------------------------------------------------------

export function scopeLabel(value: OperatingScopeValue | string | null | undefined): string {
  return value === 'ORGANIZATION' ? 'Organización (consolidado)' : 'Por tienda';
}

export function scopeShortLabel(value: OperatingScopeValue | string | null | undefined): string {
  return value === 'ORGANIZATION' ? 'Organización' : 'Tienda';
}

export function scopeDescription(value: OperatingScopeValue | string | null | undefined): string {
  return value === 'ORGANIZATION'
    ? 'Inventario consolidado entre tiendas'
    : 'Cada tienda maneja su propio inventario';
}

// ----------------------------------------------------------------------------
// Blocker titles — parity con web blockerTitle()
// ----------------------------------------------------------------------------

export interface BlockerLike {
  code: string;
  message: string;
}

export function blockerTitle(b: BlockerLike): string {
  switch (b.code) {
    case 'OPEN_POS_TO_CENTRAL':
      return 'Órdenes de compra abiertas hacia bodega central';
    case 'OPEN_PURCHASE_ORDERS':
      return 'Órdenes de compra consolidadas abiertas';
    case 'OPEN_CROSS_STORE_TRANSFERS':
      return 'Transferencias inter-tienda abiertas';
    case 'STOCK_AT_CENTRAL':
      return 'Stock en bodega central';
    case 'ACTIVE_RESERVATIONS_AT_CENTRAL':
      return 'Reservas activas en bodega central';
    case 'PARTNER_LOCKED':
      return 'Organización partner bloqueada';
    case 'NOT_ENOUGH_STORES':
      return 'Tiendas activas insuficientes';
    case 'NO_ACTIVE_STORES':
      return 'No hay tiendas activas';
    default:
      return b.code;
  }
}

// ----------------------------------------------------------------------------
// Direction labels
// ----------------------------------------------------------------------------

export function directionLabel(direction: 'NOOP' | 'UP' | 'DOWN' | string): string {
  switch (direction) {
    case 'UP':
      return 'Migración STORE → ORGANIZATION';
    case 'DOWN':
      return 'Migración ORGANIZATION → STORE';
    case 'NOOP':
    default:
      return 'Sin cambios';
  }
}

// ----------------------------------------------------------------------------
// Direction arrow (visual)
// ----------------------------------------------------------------------------

export function directionArrow(from: OperatingScopeValue, to: OperatingScopeValue): string {
  return `${scopeShortLabel(from)} → ${scopeShortLabel(to)}`;
}

// ----------------------------------------------------------------------------
// Force reason helpers
// ----------------------------------------------------------------------------

export const FORCE_REASON_MIN_LENGTH = 10;

export function forceReasonRemaining(input: string): number {
  return Math.max(0, FORCE_REASON_MIN_LENGTH - input.trim().length);
}

export function isForceReasonValid(input: string): boolean {
  return input.trim().length >= FORCE_REASON_MIN_LENGTH;
}

// ----------------------------------------------------------------------------
// Date formatter — para audit log entries
// ----------------------------------------------------------------------------

export function formatAuditDate(input: string | null | undefined): string {
  if (!input) return '—';
  try {
    const d = new Date(input);
    if (Number.isNaN(d.getTime())) return input;
    return d.toLocaleString();
  } catch {
    return input;
  }
}