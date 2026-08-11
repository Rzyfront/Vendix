import { apiClient, Endpoints } from '@/core/api';

/**
 * Espejo de `uom_dimension_enum` (`schema.prisma`). `length` entró con QUI-648
 * —base en milímetros: cable, manguera, tubo, cinta— para que una ferretería
 * pueda vender por metro; sin él el catálogo real llega con una dimensión que
 * este tipo dice que no existe.
 */
export type UomDimension = 'mass' | 'volume' | 'length' | 'count';

export interface UnitOfMeasure {
  id: number;
  code: string;
  name: string;
  dimension: UomDimension;
  is_base: boolean;
  factor_to_base: string | number;
  is_active: boolean;
}

export interface UomApiResponse<T> {
  success: boolean;
  message?: string;
  data: T;
}

/**
 * Units of Measure service — Fase UoM.
 *
 * Réplica móvil del web `UomService` (apps/frontend/.../inventory/services/).
 * El catálogo es global / read-only (solo cambia cuando Vendix seed añade
 * una nueva unidad base). Se cachea a nivel de módulo para que cada
 * dropdown de UoM (prebulk, recipes futuras, etc.) re-use la misma promise
 * sin re-pegar al backend en cada mount.
 *
 * Patrón equivalente a `vendix-frontend-cache` — instance-level TTL cache,
 * con un único Promise compartido.
 */
let catalogPromise: Promise<UnitOfMeasure[]> | null = null;

export function getUomCatalog(forceReload = false): Promise<UnitOfMeasure[]> {
  if (!catalogPromise || forceReload) {
    catalogPromise = apiClient
      .get<UomApiResponse<UnitOfMeasure[]>>(Endpoints.STORE.UOM)
      .then((res) => {
        const body = res.data;
        if (body && typeof body === 'object' && 'success' in body) {
          return body.data ?? [];
        }
        return (body as unknown as UnitOfMeasure[]) ?? [];
      })
      .catch((err) => {
        // Reset cache en caso de error para permitir reintento.
        catalogPromise = null;
        throw err;
      });
  }
  return catalogPromise;
}

/**
 * Invalida el cache del catálogo. Pensado para escenarios donde el admin
 * UoM seed cambia (hoy el seed es inmutable en runtime, pero expuesto para
 * simetría con otros servicios del módulo).
 */
export function invalidateUomCatalog(): void {
  catalogPromise = null;
}
