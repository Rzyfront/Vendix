/**
 * FORMA DEL DOCUMENTO FISCAL QUE DEVUELVEN LOS DOS ENDPOINTS DE DETALLE
 * DEL RIEL SUPER-ADMIN.
 *
 * POR QUÉ EXISTE ESTE ARCHIVO. El detalle se pedía con `any` y eso escondió
 * durante meses que la pantalla llamaba rutas inexistentes: sin tipo, nadie
 * podía notar que `transmission.request_xml` —del que colgaba el botón
 * «Descargar XML»— NUNCA viaja en la respuesta, porque los dos servicios
 * excluyen `xml_document` a propósito para no mandar 500 KB por transmisión.
 *
 * LOS TRES ESPACIOS DE ID NO SON EL MISMO NÚMERO. Está verificado en el
 * backend y es la causa raíz de que el modal mostrara «el documento
 * equivocado»:
 *
 *   · `GET /invoices/:id`            → `subscription_invoices.id`
 *     (`subscription-fiscal.controller.ts:429`)
 *   · `GET /platform-invoices/:id`   → `fiscal_transmissions.id`
 *     (`subscription-fiscal.controller.ts:448`)
 *   · `GET /invoices/:id/pdf`        → `fiscal_transmissions.id`
 *     (`platform-invoice-pdf.service.ts:365` filtra `source_type IN
 *      (platform_invoice, platform_support_document)`)
 *   · `POST /sales-invoices/:id/…`   → `invoices.id`
 *     (`platform-delivery.service.ts:89`, `platform-dian-events.service.ts:133`)
 *
 * Por eso cada método del servicio declara en su comentario QUÉ id espera.
 */

/** De qué riel viene el documento; decide endpoint de detalle y espacio de id. */
export type PlatformInvoiceKind = 'subscription' | 'platform';

/**
 * Una regla que la DIAN nombró al rechazar. Espejo estructural de
 * `DianRejectionReason` del riel tienda; se declara acá para que el servicio
 * no tenga que importar del módulo de tienda.
 */
export interface PlatformDianErrorRow {
  code?: string | null;
  message?: string | null;
  severity?: string | null;
}

/** Una línea del documento, tal como la guarda el snapshot del evidence. */
export interface PlatformInvoiceLine {
  description?: string | null;
  concept?: string | null;
  quantity?: number | string | null;
  unit_price?: number | string | null;
  amount?: number | string | null;
  discount_amount?: number | string | null;
  tax_rate?: number | string | null;
  tax_amount?: number | string | null;
  total?: number | string | null;
  aiu_component?: string | null;
  taxes?: Array<{
    tax_type?: string | null;
    rate?: number | string | null;
    tax_amount?: number | string | null;
    is_inclusive?: boolean | null;
  }> | null;
}

/** Una retención del snapshot (`metadata.withholdings[]`). */
export interface PlatformInvoiceWithholding {
  role?: string | null;
  concept_id?: number | null;
  base_amount?: number | string | null;
  rate?: number | string | null;
  amount?: number | string | null;
}

/** El adquirente congelado al emitir. */
export interface PlatformInvoiceAcquirer {
  kind?: 'store' | 'organization' | string;
  id?: number;
  legal_name?: string | null;
  tax_id?: string | null;
  tax_id_dv?: string | null;
  tax_regime_code?: string | null;
  fiscal_responsibilities?: string[] | null;
  email?: string | null;
  address?: {
    line?: string | null;
    city?: string | null;
    department_code?: string | null;
  } | null;
}

/**
 * La fila `fiscal_transmissions` que devuelven los dos detalles.
 *
 * LO QUE SÍ VIAJA (verificado en los dos `select`, `subscription-fiscal.service.ts`
 * :3327-3342 y :3552-3566): `transmission_status`, `dian_status`,
 * `accounting_status`, `document_number`, `cufe`, `qr_code`, `tracking_id`,
 * `accepted_at`, `rejected_at`, `error_message`, `created_at`.
 *
 * LO QUE NO VIAJA y por eso está declarado OPCIONAL: `dian_errors`,
 * `provider_response`, `delivery_status`, `retry_count` y `xml_document`. El
 * `select` de suscripción excluye los pesados a propósito —«cada uno pesa
 * 100–500 KB por transmisión»— y los otros ni siquiera se piden. La UI los lee
 * defensivamente y degrada con un aviso honesto; declararlos acá documenta el
 * contrato que falta en vez de dejar el hueco invisible.
 */
export interface PlatformInvoiceTransmission {
  id: number;
  transmission_status?: string | null;
  dian_status?: string | null;
  accounting_status?: string | null;
  document_number?: string | null;
  cufe?: string | null;
  qr_code?: string | null;
  tracking_id?: string | null;
  accepted_at?: string | null;
  rejected_at?: string | null;
  error_message?: string | null;
  created_at?: string | null;
  retry_count?: number | null;
  delivery_status?: string | null;
  /**
   * XML firmado (UBL 2.1). Mismo origen que `invoices.xml_document` del riel
   * tienda, que es de donde ESE riel arma la descarga en el cliente porque no
   * hay endpoint de XML en el backend. Acá todavía no llega.
   */
  xml_document?: string | null;
  dian_errors?: PlatformDianErrorRow[] | null;
  provider_response?: {
    message?: string | null;
    provider_data?: {
      dian_errors?: PlatformDianErrorRow[] | null;
      dian_status_code?: string | null;
      dian_status_description?: string | null;
    } | null;
  } | null;
}

/**
 * La cabecera del documento. En el riel plataforma es SINTÉTICA: el backend
 * la arma desde `fiscal_evidences.metadata` porque `fiscal_transmissions` no
 * tiene columnas planas de cliente/líneas/totales
 * (`subscription-fiscal.service.ts:3255`).
 */
export interface PlatformInvoiceDocument {
  id: number;
  invoice_number?: string | null;
  state?: string | null;
  issued_at?: string | null;
  due_at?: string | null;
  due_date?: string | null;
  period_start?: string | null;
  period_end?: string | null;
  subtotal?: number | string | null;
  tax_amount?: number | string | null;
  total?: number | string | null;
  amount_paid?: number | string | null;
  discount_amount?: number | string | null;
  global_discount_amount?: number | string | null;
  withholding_amount?: number | string | null;
  currency?: string | null;
  payment_form?: string | null;
  payment_means_code?: string | null;
  operation_type?: string | null;
  aiu_contract_object?: string | null;
  exchange_rate?: number | string | null;
  exchange_rate_date?: string | null;
  line_items?: PlatformInvoiceLine[] | null;
  items?: PlatformInvoiceLine[] | null;
  withholdings?: PlatformInvoiceWithholding[] | null;
  customer?: PlatformInvoiceAcquirer | null;
}

export interface PlatformInvoiceEvidence {
  id: number;
  fiscal_transmission_id: number;
  evidence_type: string;
  content_hash?: string | null;
  storage_key?: string | null;
  metadata?: Record<string, unknown> | null;
  created_at?: string | null;
}

/** Respuesta de `GET /invoices/:id` y de `GET /platform-invoices/:id`. */
export interface PlatformInvoiceDetailPayload {
  invoice: PlatformInvoiceDocument;
  transmissions: PlatformInvoiceTransmission[];
  evidences: PlatformInvoiceEvidence[];
  plan: { name: string; code: string; billing_cycle: string } | null;
  organization: {
    id: number;
    name: string;
    legal_name: string | null;
    tax_id: string | null;
    email: string | null;
  } | null;
}

/** Lo que devuelve `GET /invoices/:id/pdf`: llave S3 + URL firmada. */
export interface PlatformInvoicePdfLocation {
  key: string;
  url: string;
}

/** Una fila de `dian_document_events` del riel plataforma. */
export interface PlatformDianEvent {
  id: number;
  event_code: string;
  event_number?: string | null;
  cude?: string | null;
  referenced_cufe?: string | null;
  status?: string | null;
  dian_status_code?: string | null;
  dian_status_message?: string | null;
  issued_at?: string | null;
  created_at?: string | null;
}

/** Acuse de `POST /sales-invoices/:id/deliver`. */
export interface PlatformInvoiceDeliveryReceipt {
  invoice_id: number;
  recipient: string;
  zip_name?: string | null;
  status?: string | null;
}
