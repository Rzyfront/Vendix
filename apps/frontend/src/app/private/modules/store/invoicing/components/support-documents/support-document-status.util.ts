import type { BadgeVariant } from '../../../../../../shared/components/badge/badge.component';

/**
 * Etiquetas y variantes compartidas por el listado y el detalle de documentos
 * soporte (QUI-684): una sola fuente para que ambos pinten el mismo estado igual.
 *
 * Las etiquetas van en masculino porque el sustantivo es «documento»
 * (Validado/Enviado/Aceptado). La factura electrónica usa femenino
 * («Validada/Enviada/Aceptada»): la diferencia es de concordancia, deliberada.
 */
export const SUPPORT_STATUS_LABELS: Record<string, string> = {
  draft: 'Borrador',
  validated: 'Validado',
  sent: 'Enviado',
  accepted: 'Aceptado',
  rejected: 'Rechazado',
  cancelled: 'Cancelado',
  voided: 'Anulado',
};

/** Mismo criterio de color que la lista de facturas: cancelado gris, anulado ámbar. */
export const SUPPORT_STATUS_VARIANTS: Record<string, BadgeVariant> = {
  draft: 'neutral',
  validated: 'info',
  sent: 'info',
  accepted: 'success',
  rejected: 'error',
  cancelled: 'neutral',
  voided: 'warning',
};

const TYPE_LABELS: Record<string, string> = {
  support_document: 'Documento soporte',
  support_adjustment_note: 'Nota de ajuste al documento soporte',
  purchase_invoice: 'Factura de compra',
};

const SHORT_TYPE_LABELS: Record<string, string> = {
  ...TYPE_LABELS,
  support_adjustment_note: 'Nota de ajuste',
};

export function supportStatusLabel(status: string | null | undefined): string {
  const key = status ?? '';
  return SUPPORT_STATUS_LABELS[key] ?? key;
}

export function supportStatusVariant(status: string | null | undefined): BadgeVariant {
  return SUPPORT_STATUS_VARIANTS[status ?? ''] ?? 'neutral';
}

export function supportTypeLabel(type: string | null | undefined, short = false): string {
  const key = type ?? '';
  return (short ? SHORT_TYPE_LABELS : TYPE_LABELS)[key] ?? key;
}

/** Solo borrador o validado todavía no salieron hacia la DIAN: se pueden emitir. */
export function canEmitSupportDocument(status: string | null | undefined): boolean {
  return status === 'draft' || status === 'validated';
}

/**
 * El PDF solo existe para el documento soporte: `GET :id/pdf` no sabe renderizar
 * la nota de ajuste (no está en la lista de render fiscal del backend).
 */
export function canDownloadSupportPdf(type: string | null | undefined): boolean {
  return type === 'support_document';
}

/** Nombre del archivo XML descargado: `<invoice_number>.xml`. */
export function supportXmlFileName(invoiceNumber: string): string {
  return `${invoiceNumber}.xml`;
}

/**
 * Descarga el XML firmado: el archivo se arma en el navegador con
 * `invoices.xml_document` (no hay endpoint de descarga), igual que en la factura.
 */
export function downloadSupportXml(invoiceNumber: string, xml: string): void {
  const blob = new Blob([xml], { type: 'application/xml;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = supportXmlFileName(invoiceNumber);
  document.body.appendChild(anchor);
  anchor.click();
  document.body.removeChild(anchor);
  // Revocar en el mismo tick aborta la descarga en algunos navegadores.
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
