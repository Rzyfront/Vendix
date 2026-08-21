/**
 * Shim de transición.
 *
 * `vendix-date-range-filter` dejó de ser exclusivo del módulo de analíticas y
 * vive ahora en `shared/components/date-range-filter/`, porque el
 * `<app-options-dropdown>` lo proyecta para el `FilterType` `'date-range'` y
 * cualquier módulo (analíticas o reportes) puede declararlo.
 *
 * Este archivo mantiene vivos los imports legacy mientras se migran los
 * consumidores restantes. No agregar lógica aquí.
 *
 * NO reexporta el tipo `DateRangeFilter`: el barrel `analytics/index.ts` ya lo
 * publica desde `analytics/interfaces`, y hacerlo aquí también volvía ambiguo
 * el nombre (TS2308). El tipo compartido vive en
 * `shared/interfaces/date-range-filter.interface.ts` y es estructuralmente
 * idéntico, así que ambos son intercambiables.
 */
export {
  DateRangeFilterComponent,
} from '../../../../../../shared/components/date-range-filter/date-range-filter.component';
