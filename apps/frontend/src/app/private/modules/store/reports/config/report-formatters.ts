/**
 * Formatea una FRACCION (0.08) como porcentaje de pantalla ("8,0%").
 * La API de tasas devuelve fracciones (el XLSX `percent` las necesita asi);
 * el tipo 'percentage' de `formatCellValue` espera unidades 0-100, por eso las
 * columnas de fraccion usan este helper via `transform`.
 *
 * Vive fuera de report-viewer.component a proposito: report-registry lo usa y
 * VexiUiCommandService (cargado al arrancar todas las apps) importa
 * report-registry. Importarlo desde el componente metia el visor, el barrel de
 * shared/components y ECharts en el bundle inicial.
 */
export function formatPercentFromFraction(value: unknown): string {
  if (value === null || value === undefined || value === '') return '—';
  const num = Number(value);
  if (isNaN(num)) return '—';
  return (
    (num * 100).toLocaleString('es-CO', {
      minimumFractionDigits: 1,
      maximumFractionDigits: 1,
    }) + '%'
  );
}
