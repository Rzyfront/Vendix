import type { ReceivedDocument, ReceivedDocumentReceiptEvidence, ReceivedDocumentReceptionStatus } from './received-documents.interface';

export const RECEIVED_INBOX_LABELS: Readonly<Record<string, string>> = {
  new: 'Nueva', requires_review: 'Requiere revisión', accepted: 'Aceptada', reclaimed: 'Reclamada',
};
export const RECEIVED_LEGAL_LABELS: Readonly<Record<string, string>> = {
  none: 'Sin aceptación ni reclamo', accepted: 'Aceptada', reclaimed: 'Reclamada',
  conflict: 'Evidencia legal en conflicto', not_applicable: 'No aplica',
};
export const RECEIVED_TYPE_LABELS: Readonly<Record<string, string>> = {
  invoice: 'Factura', credit_note: 'Nota crédito', debit_note: 'Nota débito', non_electronic: 'No electrónico',
};
export const RECEIVED_CHANNEL_LABELS: Readonly<Record<string, string>> = {
  api_poll: 'API de proveedor', webhook: 'Webhook', api: 'API de proveedor', automated: 'Webhook', manual: 'Captura manual', xml: 'XML',
  xml_import: 'XML', scan: 'PDF/foto (OCR)', ocr: 'PDF/foto (OCR)', email: 'Correo (origen declarado)',
};
export function receivedInboxLabel(value: unknown): string {
  return RECEIVED_INBOX_LABELS[String(value)] ?? 'Estado no disponible';
}
export function receivedLegalLabel(value: unknown): string {
  return RECEIVED_LEGAL_LABELS[String(value)] ?? 'Estado legal no disponible';
}
export function receivedTypeLabel(value: unknown): string {
  return RECEIVED_TYPE_LABELS[String(value)] ?? 'Tipo no disponible';
}
export function receivedChannelLabel(value: unknown): string {
  return RECEIVED_CHANNEL_LABELS[String(value)] ?? 'Otro origen';
}
export function receivedOcrLabel(processingStatus: string): string {
  if (processingStatus === 'processing' || processingStatus === 'pending' || processingStatus === 'pending_ocr') return 'Lectura pendiente';
  if (processingStatus === 'failed' || processingStatus === 'error') return 'Error de lectura';
  return 'Documento disponible';
}
export interface ReceivedInboxEmptyState {
  title: string;
  description: string;
  configure: boolean;
  clearFilters: boolean;
}
export function receivedInboxEmptyState(
  health: ReceivedDocumentReceptionStatus | null,
  filtered: boolean,
  canConfigure: boolean,
): ReceivedInboxEmptyState {
  if (filtered) return {
    title: 'Ninguna factura coincide con los filtros', description: 'Prueba otra búsqueda o limpia los filtros.',
    configure: false, clearFilters: true,
  };
  if (!health) return {
    title: 'No hay facturas para mostrar', description: 'Actualiza para consultar el estado de recepción.',
    configure: false, clearFilters: false,
  };
  if (!health.dian_active) return {
    title: 'Configura la DIAN para recibir automáticamente',
    description: canConfigure ? 'Completa la configuración DIAN. El historial y la importación manual siguen disponibles.' : 'Solicita configuración al administrador. El historial sigue disponible.',
    configure: canConfigure, clearFilters: false,
  };
  if (!health.configured) return {
    title: 'Conecta un proveedor compatible',
    description: canConfigure ? 'Configura una conexión API o webhook para recibir automáticamente. También puedes importar manualmente.' : 'Solicita configuración al administrador para recibir automáticamente.',
    configure: canConfigure, clearFilters: false,
  };
  if (health.active_connections === 0) return {
    title: 'Activa un canal de recepción',
    description: canConfigure ? 'Revisa y activa una conexión compatible para recibir automáticamente.' : 'Solicita al administrador que active un canal de recepción. El historial sigue disponible.',
    configure: canConfigure, clearFilters: false,
  };
  return {
    title: 'Tu buzón está listo', description: 'Aquí aparecerán las próximas facturas recibidas.',
    configure: false, clearFilters: false,
  };
}

/** Classification is display-only; absence never invents a fiscal type or a positive verification. */
export function receivedIsElectronicPos(doc: Pick<ReceivedDocument, 'fiscal_document_type_code' | 'email_reception'>): boolean {
  return doc.fiscal_document_type_code === '20' || doc.email_reception?.document_type_code === '20';
}
export function receivedDianLabel(_doc: unknown): string {
  return 'Sin verificar ante la DIAN';
}
export function receivedReceiptEvidence(doc: Pick<ReceivedDocument, 'email_reception'>): ReceivedDocumentReceiptEvidence | null {
  const evidence = doc.email_reception?.receipt_evidence;
  if (!evidence || typeof evidence.included !== 'boolean' || typeof evidence.reference_matches !== 'boolean') return null;
  return {
    included: evidence.included,
    reference_matches: evidence.reference_matches,
    response_code: typeof evidence.response_code === 'string' && /^[a-z\d._-]{1,32}$/i.test(evidence.response_code) ? evidence.response_code : null,
  };
}
export function receivedDocumentSourceLabel(doc: Pick<ReceivedDocument, 'source_channel' | 'email_transport_received'>): string {
  if (doc.email_transport_received !== true) return doc.source_channel === 'email' ? 'Correo (origen declarado)' : receivedChannelLabel(doc.source_channel);
  return doc.source_channel === 'email' ? 'Correo' : `Correo · origen inicial: ${receivedChannelLabel(doc.source_channel)}`;
}
/** Mobile has one composed badge: attention remains visible beside honest DIAN wording. */
export function receivedMobileInboxLabel(value: unknown): string {
  return `${receivedInboxLabel(value)} · ${receivedDianLabel(null)}`;
}
