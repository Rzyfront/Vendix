import { DianInvoiceControl } from './dian-direct/interfaces/dian-config.interface';

/**
 * Contract for electronic invoice providers (e.g., DIAN, mock, third-party).
 */
export interface InvoiceProviderAdapter {
  /**
   * Sends an invoice to the provider for validation and acceptance.
   */
  sendInvoice(invoiceData: ProviderInvoiceData): Promise<ProviderResponse>;

  /**
   * Sends a credit note to the provider.
   */
  sendCreditNote(
    creditNoteData: ProviderInvoiceData,
  ): Promise<ProviderResponse>;

  /**
   * Sends a debit note to the provider.
   */
  sendDebitNote?(debitNoteData: ProviderInvoiceData): Promise<ProviderResponse>;

  /**
   * Sends a support document for acquisitions from non-obligated suppliers.
   */
  sendSupportDocument?(
    supportDocumentData: ProviderInvoiceData,
  ): Promise<ProviderResponse>;

  /**
   * Sends an adjustment note for a support document.
   */
  sendSupportAdjustmentNote?(
    supportAdjustmentData: ProviderInvoiceData,
  ): Promise<ProviderResponse>;

  /**
   * Sends a POS electronic equivalent document (Res. 000165/2023).
   *
   * Optional on purpose: a provider that is only habilitado for the factura
   * electrónica de venta must be *detectably* unable to emit a DE, so the flow
   * refuses before consuming a consecutive from the DE range. A mandatory method
   * would force every adapter to fake support it does not have.
   */
  sendEquivalentDocument?(
    documentData: ProviderInvoiceData,
    options?: { document_type_code?: string },
  ): Promise<ProviderResponse>;

  /**
   * Sends an adjustment note ('93' débito / '94' crédito) to an equivalent
   * document. The DE has no credit/debit note of its own.
   */
  sendEquivalentAdjustmentNote?(
    adjustmentData: ProviderInvoiceData,
  ): Promise<ProviderResponse>;

  /**
   * Checks the status of a previously sent document.
   */
  checkStatus(trackingId: string): Promise<StatusResponse>;

  /**
   * Cancels or voids a previously sent invoice.
   */
  cancelInvoice(invoiceId: string, reason: string): Promise<ProviderResponse>;
}

export interface ProviderInvoiceData {
  invoice_number: string;
  invoice_type: string;
  issue_date: string;
  issue_time?: string;
  due_date?: string;
  /**
   * Período REALMENTE facturado → `cac:InvoicePeriod`.
   *
   * Antes no existía, y el builder derivaba el grupo de `issue_date` →
   * `due_date`: para una suscripción eso publica «emisión → vencimiento (+7 d)»,
   * que NO es el período del servicio. En una factura de ciclo el período es el
   * dato que dice qué se prestó; derivarlo del vencimiento declara un mes de
   * servicio de siete días.
   *
   * OPCIONAL a propósito: ausente ⇒ el builder conserva EXACTAMENTE la
   * derivación histórica desde `due_date`. El riel de tenant usa el mismo builder
   * y no debe cambiar de comportamiento por este campo.
   */
  invoice_period?: ProviderInvoicePeriod;
  /**
   * CARRIL COMERCIAL DEL DOCUMENTO. Decide cuánto puede exigirle la emisión al
   * adquiriente antes de negarse a emitir.
   *
   * - `'on_demand'` — venta rápida: punto de venta, mesa y tienda en línea. El
   *   comprador da sus datos en el mostrador o en el checkout, y el conjunto
   *   mínimo que se le pide es tipo y número de documento, nombres, apellidos
   *   y correo. NO incluye dirección ni municipio, a propósito: pedirlos
   *   convierte una venta de mostrador en un trámite. Esta venta SIEMPRE tiene
   *   que poder emitir.
   * - `'advanced'` — módulo de facturación electrónica, con el cliente creado
   *   por completo en el módulo de clientes. Ahí sí se exige la identidad
   *   fiscal entera, y el operador tiene dónde y cuándo completarla.
   *
   * OPCIONAL a propósito: ausente ⇒ se conserva EXACTAMENTE el comportamiento
   * anterior (el más estricto). Ningún emisor cambia de conducta por no
   * declararlo.
   */
  sale_rail?: 'on_demand' | 'advanced';
  customer_name?: string;
  customer_tax_id?: string;
  customer_address?: any;
  /**
   * Set when the document is being (re)transmitted after having been expedited
   * under contingency. Drives `cbc:InvoiceTypeCode`: '04' for DIAN
   * unavailability, '03' for a transcribed paper contingency invoice. Absent on a
   * normal transmission, which keeps emitting '01'.
   */
  contingency_type?: string;
  subtotal_amount: string;
  discount_amount: string;
  tax_amount: string;
  withholding_amount: string;
  total_amount: string;
  currency?: string;
  items: ProviderInvoiceItem[];
  taxes: ProviderInvoiceTax[];
  resolution_number?: string;
  technical_key?: string;
  /**
   * Bloque `sts:DianExtensions/InvoiceControl`: autorización de numeración,
   * período de vigencia y rango autorizado.
   *
   * Lo construye `resolveInvoiceControl` (common/helpers/invoice-control.helper.ts)
   * desde la fila `invoice_resolutions`, y lo pueblan los DOS emisores — el de
   * tenant en `invoice-flow.service.ts` y el de la plataforma en
   * `subscription-fiscal.service.ts`—.
   *
   * Antes no existía este campo, y esa era la causa de que la emisión real saliera
   * con el bloque vacío: `resolution_number` y `technical_key` por sí solos no
   * llevan el prefijo ni el rango, así que ningún llamador tenía dónde ponerlos.
   * Sin `sts:Prefix` desaparece el lado derecho de FAB10a y la DIAN rechaza en
   * cascada por FAD05e, FAB24a y FAB27b.
   *
   * Opcional en el tipo porque el documento soporte no cuelga de una resolución
   * de numeración (ver `dian-direct.provider.ts`, nota del documento soporte).
   */
  control?: DianInvoiceControl;
  notes?: string;

  // DIAN-enriched fields (optional — used by DianDirectProvider)
  issuer_nit?: string;
  issuer_legal_name?: string;
  issuer_address?: any;
  customer_email?: string;
  customer_phone?: string;
  customer_document_type?: string;
  customer_regime?: string;
  /** DV of `customer_tax_id` — emitted alongside the bare NIT as `<NIT>-<DV>` per Anexo 19. */
  customer_verification_digit?: string;
  /**
   * STRUCTURAL `cac:Person` vs `cac:PartyLegalEntity` selector for the
   * adquiriente. Translates the legacy '1'/'2' `cbc:AdditionalAccountID` codes
   * ('1'/'juridica' → 'JURIDICA', '2'/'natural' → 'NATURAL'). When absent the
   * provider derives from `document_type` (NIT → 'JURIDICA', else 'NATURAL').
   */
  customer_person_type?: string;
  /**
   * DIAN fiscal responsibilities of the adquiriente (cbc:TaxLevelCode), e.g.
   * ['O-13','O-15']. Absent means the builder falls back to 'R-99-PN'.
   */
  customer_tax_responsibilities?: string[];
  /**
   * CIIU code (RUT casilla 46, 4 digits) of the customer. Emitted as
   * `cac:IndustryClassificationCode` under `cac:Party` per Anexo Técnico 19.
   */
  customer_ciiu_code?: string | null;
  /**
   * Marks the customer as agente de retención; the UBL builder emits an extra
   * `cbc:AdditionalAccountID = "3"` alongside the person-type marker.
   */
  customer_is_withholding_agent?: boolean;
  payment_means?: string;
  payment_form?: string; // DIAN: '1' = contado, '2' = crédito
  payment_method?: string;
  order_reference?: string;
  original_invoice_number?: string;
  original_invoice_cufe?: string;
  original_invoice_issue_date?: string;
  /**
   * Concepto de corrección de una NOTA CRÉDITO o DÉBITO —
   * `cac:DiscrepancyResponse/cbc:ResponseCode`. Sólo lo leen
   * `UblCreditNoteBuilder` y `UblDebitNoteBuilder`.
   *
   * Catálogos DISTINTOS por tipo de nota (Anexo Técnico 1.9, tablas 13.2.4 y
   * 13.2.5): crédito '1'…'5', débito '1'…'4'. El dominio lo cierra el DTO con
   * `@IsIn`; acá llega ya validado y persistido en `invoices.note_concept_code`.
   *
   * Opcional a propósito: ausente ⇒ el builder emite '2', que es el literal que
   * emitía SIEMPRE antes de que este campo existiera. Así las notas creadas
   * antes de la columna se transmiten exactamente igual que antes.
   */
  note_concept_code?: string;
}

/**
 * Extremos del período facturado, para `cac:InvoicePeriod`.
 *
 * Fechas `YYYY-MM-DD` YA resueltas en la zona del obligado a facturar, igual que
 * `issue_date` y `due_date`: el builder las escribe tal cual, sin reinterpretar
 * zonas. Pasar un instante UTC crudo es cómo se llega a un período corrido un día.
 */
export interface ProviderInvoicePeriod {
  /** `cbc:StartDate` — primer día del período facturado. */
  start_date: string;
  /** `cbc:EndDate` — último día del período facturado. */
  end_date: string;
}

export interface ProviderInvoiceItem {
  description: string;
  quantity: string;
  unit_price: string;
  discount_amount: string;
  tax_amount: string;
  total_amount: string;
  /**
   * Código del ítem para `cac:StandardItemIdentification/cbc:ID`, que la DIAN
   * exige en toda línea (regla FAZ09 «StandardItemIdentification no informado»).
   *
   * OPCIONAL a propósito: el builder cae al número de línea cuando falta, así que
   * ningún llamador queda obligado a inventar un código de catálogo. De dónde
   * sale el código real del producto en emisión —SKU, código de barras, UNSPSC—
   * es una decisión de negocio aparte. Se emite con `schemeID="999"`, «estándar
   * de adopción del contribuyente», porque Vendix no publica catálogo UNSPSC.
   */
  item_code?: string;

  /**
   * Código UN/ECE de la unidad realmente vendida (`MTR`, `KGM`, `LTR`, `EA`).
   * La DIAN valida la coherencia entre cantidad y unidad: 3 metros declarados
   * como `EA` dicen "3 unidades". Opcional: el builder cae a `EA`, que es el
   * comportamiento histórico de todo el catálogo por pieza.
   */
  unit_code?: string;

  /**
   * QUI-648 — `products.price_unit_quantity`: a cuántas unidades de `quantity`
   * corresponde `unit_price`. Divide el importe de la línea; sin él, un queso a
   * $28.000 el kilo con el stock en gramos produce un `LineExtensionAmount` mil
   * veces mayor que el dinero cobrado. Opcional: ausente equivale a 1, la
   * aritmética histórica.
   *
   * **No viaja al XML.** En UBL genérico `cac:Price/cbc:BaseQuantity` declararía
   * exactamente esto, pero en el perfil de la DIAN ese campo es la CANTIDAD
   * facturada y la regla FAV06 lo MULTIPLICA, no divide. La escala se consume
   * antes, dentro del precio (`dianPriceAmount`): el documento sale declarando
   * "$28,00 por gramo". Evidencia en `UblCommonBuilder.resolveBaseQuantity`.
   */
  price_unit_quantity?: string;
}

export interface ProviderInvoiceTax {
  tax_name: string;
  tax_rate: string;
  taxable_amount: string;
  tax_amount: string;
  /**
   * Persisted fiscal classification ('iva' | 'inc' | 'ica' | ...). When present
   * it is the authoritative source for the DIAN tax scheme code (01/04/03),
   * taking priority over the tax_name heuristic.
   */
  tax_type?: string;
}

export interface ProviderResponse {
  success: boolean;
  tracking_id: string;
  cufe?: string;
  cude?: string;
  cuds?: string;
  cune?: string;
  qr_code?: string;
  xml_document?: string;
  pdf_url?: string;
  message?: string;
  provider_data?: any;
  /**
   * True when the failure is the DIAN being unavailable rather than the document
   * being invalid (Anexo Técnico 1.9 §12.2).
   *
   * This distinction is load-bearing: an unavailability used to be treated the
   * same as a validation rejection, so an outage marked perfectly valid invoices
   * `rejected` with `accounting_status: blocked` — a terminal state the Anexo
   * never intended. When this flag is set, the document must go to contingency
   * (Type 04) instead: valid, deliverable, and owing a transmission within 48 h.
   */
  contingency_eligible?: boolean;
  /** Anexo §12 failure class, when the failure was a transport/availability one. */
  failure_class?: 'dian_error' | 'timeout' | 'non_retriable';
}

export interface StatusResponse {
  tracking_id: string;
  status: 'pending' | 'accepted' | 'rejected' | 'error';
  message?: string;
  cufe?: string;
  cude?: string;
  cuds?: string;
  cune?: string;
  provider_data?: any;
}

export const INVOICE_PROVIDER = 'INVOICE_PROVIDER';
