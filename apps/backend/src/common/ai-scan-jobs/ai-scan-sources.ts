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
