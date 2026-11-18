import type { AiJobSource } from './ai-job-monitor.service';
import type { AiScanKind } from './interfaces/ai-scan-job.interface';

/** Spanish name of each `ai-scan` kind, for incidents (QUI-1020). */
export const AI_SCAN_KIND_LABELS: Record<AiScanKind, string> = {
  rut: 'escaneo del RUT',
  dian_habilitation: 'escaneo de la habilitación DIAN',
  dian_resolution: 'escaneo de la resolución DIAN',
  route_sheet: 'escaneo de planilla de ruta',
  inventory_count: 'escaneo de hoja de reconteo',
  member_roster: 'carga de miembros con IA',
  customer_import: 'carga de clientes con IA',
  product_image_enhance: 'mejora de imagen de producto con IA',
  product_image_generate: 'generación de imagen de producto con IA',
  invoice_draft: 'borrador de factura con IA',
};

export function aiScanSource(kind: AiScanKind | string): AiJobSource {
  return {
    queue: 'ai-scan',
    kind,
    label: AI_SCAN_KIND_LABELS[kind as AiScanKind] ?? `proceso de IA (${kind})`,
  };
}

/**
 * The per-domain AI queues that predate `ai-scan` (QUI-1020). Their
 * processors and status endpoints report through `AiJobMonitorService` with
 * these sources, so incidents and dedupe keys name the right process.
 */
export const LEGACY_AI_SOURCES = {
  invoiceScan: {
    queue: 'invoice-scan',
    kind: 'purchase_invoice',
    label: 'escaneo de factura de compra',
  },
  invoiceRevalidate: {
    queue: 'invoice-revalidate',
    kind: 'purchase_invoice_revalidate',
    label: 'revalidación de factura de compra',
  },
  paymentReceiptScan: {
    queue: 'payment-receipt-scan',
    kind: 'payment_receipt',
    label: 'escaneo de comprobante de pago',
  },
  expenseScan: {
    queue: 'expense-scan',
    kind: 'expense',
    label: 'escaneo de factura de gasto',
  },
  receiptScan: {
    queue: 'receipt-scan',
    kind: 'dispatch_receipt',
    label: 'escaneo de remisión',
  },
  receivedDocumentScan: {
    queue: 'received-document-scan',
    kind: 'received_document',
    label: 'escaneo de documento recibido',
  },
  crmLanding: {
    queue: 'crm-landing',
    kind: 'crm_landing',
    label: 'generación de landing con IA',
  },
} as const satisfies Record<string, AiJobSource>;
