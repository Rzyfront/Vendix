/**
 * [print-editor-dsk P3.1] — Resumen mínimo de un documento para el selector
 * de documentos recientes del editor del Hub.
 *
 * El compositor (`print-layout-composer.service.ts`) sólo necesita el id para
 * volver a leer el documento completo vía `fetchDocumentData`; el número y la
 * fecha formateada son los datos que el usuario ve en el dropdown del Hub. El
 * total formateado es opcional y no todos los proveedores lo exponen (p.ej.
 * `dispatch_ticket` no imprime totales: es un tiquete de bodega sin precio).
 */
export interface RecentDocumentSummary {
  id: number | string;
  number: string;
  date_formatted: string;
  total_formatted?: string;
}
