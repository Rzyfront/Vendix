import type { PlatformIncidentService } from '@common/incidents/platform-incident.service';
import type { BulkJobType, BulkUploadJobData } from './bulk-upload-job.types';

export const BULK_JOB_TYPE_LABELS: Record<BulkJobType, string> = {
  products: 'productos',
  employees: 'empleados',
  inventory_adjustments: 'ajustes de inventario',
  customers: 'clientes',
};

export const BULK_JOB_TECHNICAL_MESSAGE =
  'Estamos revisando un problema técnico, tu carga no se perdió.';

/**
 * Avisa a Vendix de un fallo técnico del trabajo: UN ticket por trabajo
 * (`dedupeKey` = id de la fila). Nunca lanza. El stack va solo al correo.
 */
export async function reportBulkJobIncident(
  incidents: PlatformIncidentService,
  data: BulkUploadJobData,
  failure: { code: string | null; message: string; stack?: string },
): Promise<string | null> {
  const label = BULK_JOB_TYPE_LABELS[data.upload_type];
  const result = await incidents.report({
    dedupeKey: `bulk-upload-job:${data.log_id}`,
    source: 'bulk_upload_job',
    severity: 'critical',
    title: `Carga masiva de ${label} falló`,
    summary: `La carga masiva de ${label} falló por un error de plataforma, no por los datos del archivo.`,
    details: {
      'Tienda (id)': data.store_id,
      'Usuario (id)': data.user_id ?? null,
      'Tipo de carga': label,
      Archivo: data.file_name,
      Mensaje: failure.message,
    },
    stack: failure.stack,
    tags: ['bulk_upload', data.upload_type],
    organizationId: data.organization_id ?? 0,
    storeId: data.store_id,
    userId: data.user_id ?? null,
    errorCode: failure.code,
    correlationId: `bulk-upload-${data.log_id}${data.request_id ? ` / ${data.request_id}` : ''}`,
  });
  return result.ticketNumber;
}
