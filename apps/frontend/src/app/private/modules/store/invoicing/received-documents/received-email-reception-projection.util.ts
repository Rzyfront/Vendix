import {
  RECEIVED_EMAIL_REASON_CODES,
  type ReceivedEmailGmailCode, type ReceivedEmailMessage, type ReceivedEmailReasonCode,
  type ReceivedEmailReasonCopy, type ReceivedEmailReasonDetails, type ReceivedEmailStatus,
  type ReceivedEmailWarning,
} from './received-email-reception.interface';

const copy = (title: string, description: string, action: ReceivedEmailReasonCopy['action'], actionLabel: string): ReceivedEmailReasonCopy => ({ title, description, action, actionLabel });

export const RECEIVED_EMAIL_REASON_COPY = {
  RECEIVER_MISMATCH: copy('La factura está a nombre de otro NIT', 'Pide al proveedor que la emita a la identificación de tu negocio.', 'supplier', 'Pedir factura corregida'),
  FINAL_CONSUMER: copy('Factura a consumidor final', 'Pide al proveedor que la emita a tu NIT.', 'supplier', 'Ver qué pedir al proveedor'),
  MISSING_FISCAL_XML: copy('Falta el archivo de la factura', 'El correo sólo traía PDF o el ZIP no contenía XML. Pide el ZIP/XML o agrégala manualmente.', 'manual', 'Importar manualmente'),
  PROVIDER_SENT_LINK: copy('El proveedor envió un enlace en vez del archivo', 'Vendix no abre enlaces de descarga de los correos.', 'supplier', 'Pedir el ZIP/XML'),
  CORRUPT_OR_ENCRYPTED_FILE: copy('Archivo dañado o con contraseña', 'No pudimos abrirlo de forma segura.', 'supplier', 'Pedir un archivo nuevo, sin contraseña'),
  TEST_DOCUMENT: copy('Documento de pruebas', 'Es de habilitación y no tiene validez fiscal para este Buzón.', 'supplier', 'Pedir la factura de producción'),
  INVALID_ENVIRONMENT: copy('No pudimos identificar si es una factura real', 'El archivo no indica un ambiente válido o tiene datos contradictorios.', 'supplier', 'Pedir un archivo corregido'),
  SUPPORT_DOCUMENT_NOT_RECEIVABLE: copy('Este documento no es una factura de tu proveedor', 'Es un documento soporte del comprador y no corresponde a esta recepción.', 'history', 'Ver correo'),
  UNSUPPORTED_DOCUMENT_TYPE: copy('Tipo de documento aún no admitido', 'Este archivo necesita revisión manual.', 'manual', 'Importar manualmente'),
  INVALID_FISCAL_XML: copy('No pudimos leer la factura', 'El XML está incompleto, el código único no es válido o los datos son inconsistentes.', 'supplier', 'Pedir el archivo original'),
  RECEIVER_ID_AMBIGUOUS: copy('No pudimos confirmar a quién pertenece', 'La identificación del comprador está incompleta o no es comparable.', 'supplier', 'Pedir la factura corregida'),
  UNSUPPORTED_ENCODING: copy('No pudimos leer el texto del archivo', 'La codificación del XML no está admitida o es contradictoria.', 'supplier', 'Pedir el XML original en UTF-8'),
  DUPLICATE: copy('Esta factura ya estaba en tu buzón', 'No la agregamos otra vez.', 'document', 'Ver factura'),
  DUPLICATE_OTHER_STORE: copy('Esta factura ya se recibió en otra tienda de tu empresa', 'Consulta a tu administrador. No se muestran los documentos de otra tienda.', 'administrator', 'Consultar al administrador'),
  DOCUMENT_KEY_CONFLICT: copy('El código de la factura ya aparece con otros datos', 'No reemplazamos el documento recibido anteriormente.', 'supplier', 'Revisar con el proveedor'),
  NOT_AN_INVOICE: copy('Correo sin factura', 'Puede ser publicidad u otro mensaje sin archivos fiscales.', 'history', 'Ver correo'),
  VIRUS_BLOCKED: copy('Posible virus, bloqueado', 'Por seguridad no abrimos los adjuntos de este correo.', 'supplier', 'Pedir un envío nuevo'),
  SECURITY_SCAN_UNAVAILABLE: copy('No pudimos comprobar la seguridad del archivo', 'No se procesó automáticamente. No abras sus adjuntos por otra vía.', 'support', 'Contactar soporte'),
  SUSPICIOUS_EMAIL: copy('Correo sospechoso', 'La revisión de seguridad detectó una señal que requiere revisión.', 'history', 'Ver correo'),
  TNEF_UNSUPPORTED: copy('Outlook envió el archivo en formato winmail.dat', 'Cambia el formato del mensaje a HTML y vuelve a enviarlo.', 'forwarding', 'Ver cómo reenviar'),
  ARCHIVE_FORMAT_UNSUPPORTED: copy('Archivo comprimido no admitido', 'Recibimos RAR o 7z; pide el ZIP o XML original.', 'supplier', 'Pedir el ZIP/XML'),
  LIMIT_EXCEEDED: copy('El envío es demasiado grande', 'Divide las facturas en grupos pequeños: hasta 20 correos adjuntos y 20 MB por envío.', 'limits', 'Ver límites'),
  NESTING_LIMIT_EXCEEDED: copy('Demasiados correos o archivos dentro de otros', 'Reenvía los mensajes originales en un solo nivel.', 'forwarding', 'Ver cómo reenviar'),
  PDF_ASSOCIATION_AMBIGUOUS: copy('No sabemos a qué factura pertenece este PDF', 'Se recibieron varias facturas; no asignamos el archivo por su nombre o asunto.', 'history', 'Ver correo'),
  EMAIL_RECEPTION_PAUSED: copy('La recepción está pausada', 'Este correo no agregó documentos nuevos. Las facturas guardadas siguen disponibles.', 'configure', 'Reanudar'),
  FISCAL_GATE_BLOCKED: copy('Falta completar la configuración del negocio', 'La recepción necesita facturación electrónica activa y una entidad fiscal válida.', 'configure', 'Ver configuración'),
  SUBSCRIPTION_BLOCKED: copy('La recepción no puede agregar documentos ahora', 'Revisa tu suscripción; las facturas guardadas siguen disponibles.', 'subscription', 'Ver suscripción'),
  DAILY_QUOTA_EXCEEDED: copy('Llegaste al límite de recepción de hoy', 'Vuelve a enviar la factura mañana o pide ayuda para ampliar el límite.', 'support', 'Contactar soporte'),
  GMAIL_VERIFICATION_CODE: copy('Gmail envió un código de confirmación', 'Sólo quien configura la recepción puede consultar el código vigente.', 'configure', 'Abrir configuración'),
  GMAIL_CODE_UNAVAILABLE: copy('No pudimos leer el código de Gmail', 'No confirmamos ningún reenvío por ti. Puedes dar esta dirección a tus proveedores.', 'forwarding', 'Ver alternativa con proveedores'),
  TECHNICAL_PROCESSING_ERROR: copy('No pudimos procesar el correo todavía', 'Volveremos a intentarlo. Si es posible, puedes solicitar un reintento.', 'retry', 'Reintentar'),
  RAW_EXPIRED: copy('El correo original ya no está disponible', 'Vuelve a reenviar la factura. Sus archivos fiscales guardados no se borraron.', 'forwarding', 'Ver cómo reenviar'),
} satisfies Record<ReceivedEmailReasonCode, ReceivedEmailReasonCopy>;

export const RECEIVED_EMAIL_WARNING_COPY = {
  DIAN_RECEIPT_MISSING: 'No incluye constancia de validación DIAN',
  DIAN_RECEIPT_REFERENCE_MISMATCH: 'La constancia incluida no coincide con esta factura',
  RECEIVER_DV_ATTACHED: 'La identificación incluía el dígito de verificación; se comparó con el NIT de tu negocio',
  COMPLEMENT_ARCHIVE_NOT_EXPANDED: 'Archivo complementario guardado sin abrir',
} satisfies Record<ReceivedEmailWarning, string>;
export const RECEIVED_EMAIL_DIAN_BADGE = 'Sin verificar ante la DIAN';

function safeIdentity(value: unknown): string | null {
  return typeof value === 'string' && /^[\d. -]{1,50}$/.test(value) ? value : null;
}

export function receivedEmailReason(reason: ReceivedEmailReasonCode | null | undefined, details?: ReceivedEmailReasonDetails): ReceivedEmailReasonCopy {
  const item = reason && RECEIVED_EMAIL_REASON_CODES.includes(reason) ? RECEIVED_EMAIL_REASON_COPY[reason] : RECEIVED_EMAIL_REASON_COPY.INVALID_FISCAL_XML;
  const receiver = safeIdentity(details?.receiver_tax_id);
  const expected = safeIdentity(details?.expected_receiver_tax_id);
  return reason === 'RECEIVER_MISMATCH' && receiver && expected
    ? { ...item, description: `El archivo indica ${receiver}; tu negocio usa ${expected}. Pide una factura corregida al proveedor.` }
    : { ...item };
}

export function receivedEmailElapsed(timestamp: string | null, now = Date.now()): string {
  const time = timestamp ? Date.parse(timestamp) : NaN;
  if (!Number.isFinite(time)) return 'fecha no disponible';
  const minutes = Math.max(0, Math.floor((now - time) / 60_000));
  if (minutes < 1) return 'un momento';
  if (minutes < 60) return `${minutes} min`;
  const hours = Math.floor(minutes / 60);
  return hours < 24 ? `${hours} h` : `${Math.floor(hours / 24)} días`;
}

export function receivedEmailStatusCopy(status: ReceivedEmailStatus | null, now = Date.now()): { title: string; description: string } {
  if (!status) return { title: 'Consultando recepción por correo', description: 'Espera un momento.' };
  if (!status.pilot_available) return { title: 'Recepción por correo no disponible para esta tienda', description: 'Consulta con tu administrador.' };
  if (status.last_error_code === 'FISCAL_GATE_BLOCKED') return { title: 'La recepción está pausada hasta completar la configuración de facturación electrónica', description: 'Las facturas guardadas siguen en tu Buzón.' };
  if (!status.configured) return { title: 'Recibe tus facturas automáticamente por correo', description: 'Activa tu dirección para recibir los archivos de tus proveedores.' };
  if (!status.enabled || status.state === 'paused') return { title: 'Pausado', description: 'Las facturas guardadas siguen en tu Buzón.' };
  if (status.not_processed_count > 0 || status.state === 'attention') return { title: `Recibimos correos que no pudimos leer (${Math.max(0, status.not_processed_count)})`, description: status.last_valid_received_at ? `Última factura hace ${receivedEmailElapsed(status.last_valid_received_at, now)}.` : 'Revisa qué pasó con el envío.' };
  return status.first_valid_received_at && Number.isFinite(Date.parse(status.first_valid_received_at))
    ? { title: `Funcionando · última factura hace ${receivedEmailElapsed(status.last_valid_received_at, now)}`, description: 'La recepción funciona; los documentos no están verificados ante la DIAN.' }
    : { title: 'Esperando tu primera factura', description: 'Reenvía una factura con su archivo ZIP o XML.' };
}

export function receivedEmailUsableCode(view: ReceivedEmailGmailCode | null, now = Date.now()): string | null {
  return view?.available && typeof view.code === 'string' && /^\d{6,12}$/.test(view.code) && view.expires_at && Date.parse(view.expires_at) > now ? view.code : null;
}

const boundedText = (value: unknown, size: number): string | null => typeof value === 'string' ? value.replace(/[\u0000-\u001f\u007f]/g, '').slice(0, size) : null;
const reasonCode = (value: unknown): ReceivedEmailReasonCode | null => RECEIVED_EMAIL_REASON_CODES.includes(value as ReceivedEmailReasonCode) ? value as ReceivedEmailReasonCode : null;

/** Deliberate HTTP whitelist: future transport fields cannot accidentally enter display state. */
export function projectReceivedEmailMessage(message: ReceivedEmailMessage): ReceivedEmailMessage {
  return {
    id: message.id, version: message.version, received_at: message.received_at, processed_at: message.processed_at,
    status: message.status, reason_code: reasonCode(message.reason_code), retryable: message.retryable === true,
    can_retry: message.can_retry === true, archived_at: message.archived_at,
    sender: boundedText(message.sender, 255), subject: boundedText(message.subject, 255),
    parts: (message.parts ?? []).slice(0, 40).map((part) => ({
      message_index: part.message_index, ordinal: part.ordinal, filename: boundedText(part.filename, 120) ?? 'Archivo',
      kind: part.kind, ...(part.role ? { role: part.role } : {}), status: part.status,
      ...(reasonCode(part.reason_code) ? { reason_code: reasonCode(part.reason_code)! } : {}),
      ...(part.reason_details ? { reason_details: {
        ...(safeIdentity(part.reason_details.receiver_tax_id) ? { receiver_tax_id: safeIdentity(part.reason_details.receiver_tax_id)! } : {}),
        ...(safeIdentity(part.reason_details.expected_receiver_tax_id) ? { expected_receiver_tax_id: safeIdentity(part.reason_details.expected_receiver_tax_id)! } : {}),
      } } : {}),
      ...(part.warnings ? { warnings: part.warnings.filter((warning) => Object.prototype.hasOwnProperty.call(RECEIVED_EMAIL_WARNING_COPY, warning)).slice(0, 4) } : {}),
      ...(message.reason_code !== 'DUPLICATE_OTHER_STORE' && part.reason_code !== 'DUPLICATE_OTHER_STORE' && Number.isSafeInteger(part.document_id) && (part.document_id ?? 0) > 0 ? { document_id: part.document_id } : {}),
    })),
  };
}
