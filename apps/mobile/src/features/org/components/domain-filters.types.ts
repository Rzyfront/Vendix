import type { DomainOwnership, DomainStatus } from '@/core/models/org-admin/domains.types';

/**
 * Estado de los filtros de la lista de dominios.
 *
 * Espejo de los signals `selectedStatus / selectedOwnership / selectedStoreId`
 * en `domains.component.ts` de la web. Un valor vacío significa "sin filtro".
 *
 * `store_id` admite el sentinel `__organization__` para dominios de la
 * organización sin tienda asociada (también en la web).
 */
export interface DomainFilters {
  status: DomainStatus | '';
  ownership: DomainOwnership | '';
  /** string vacío = sin filtro, `__organization__` = solo org, number-string = tienda. */
  storeId: string;
}

export const EMPTY_FILTERS: DomainFilters = {
  status: '',
  ownership: '',
  storeId: '',
};

export function hasActiveFilters(f: DomainFilters): boolean {
  return !!(f.status || f.ownership || f.storeId);
}
