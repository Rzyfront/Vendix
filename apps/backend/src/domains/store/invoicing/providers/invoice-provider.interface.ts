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
