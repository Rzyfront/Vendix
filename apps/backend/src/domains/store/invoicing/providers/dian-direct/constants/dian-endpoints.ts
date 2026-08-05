/**
 * DIAN SOAP web service endpoints for electronic invoicing.
 *
 * Test (habilitación): Used during the enablement/testing phase.
 * Production: Used once the company is fully enabled with DIAN.
 */
export const DIAN_ENDPOINTS = {
  test: {
    url: 'https://vpfe-hab.dian.gov.co/WcfDianCustomerServices.svc',
    wsdl: 'https://vpfe-hab.dian.gov.co/WcfDianCustomerServices.svc?wsdl',
  },
  production: {
    url: 'https://vpfe.dian.gov.co/WcfDianCustomerServices.svc',
    wsdl: 'https://vpfe.dian.gov.co/WcfDianCustomerServices.svc?wsdl',
  },
} as const;

/**
 * SOAP actions for the DIAN web service operations.
 */
export const DIAN_SOAP_ACTIONS = {
  SendBillSync:
    'http://wcf.dian.colombia/IWcfDianCustomerServices/SendBillSync',
  SendTestSetAsync:
    'http://wcf.dian.colombia/IWcfDianCustomerServices/SendTestSetAsync',
  GetStatus: 'http://wcf.dian.colombia/IWcfDianCustomerServices/GetStatus',
  GetStatusZip:
    'http://wcf.dian.colombia/IWcfDianCustomerServices/GetStatusZip',
  SendNominaSync:
    'http://wcf.dian.colombia/IWcfDianCustomerServices/SendNominaSync',
  /**
   * RADIAN / document events. Carries an `ApplicationResponse` (acuse de recibo
   * 030, recibo del bien o servicio 032, aceptación 033/034, reclamo 031) in the
   * same ZIP+Base64 envelope shape as `SendBillSync`.
   */
  SendEventUpdateStatus:
    'http://wcf.dian.colombia/IWcfDianCustomerServices/SendEventUpdateStatus',
} as const;

/**
 * DIAN document event codes.
 *
 * Source: **Anexo Técnico RADIAN v1.1 (Res. 000085 de 2022), numeral 14.2.1**
 * ("Eventos de un Documento Electrónico"), transcribed verbatim from the official
 * PDF at `dian.gov.co/normatividad/Normatividad/Anexo 85 - Resolución 000085 de
 * 2022.pdf`. The table maps to
 * `/ApplicationResponse/cac:DocumentResponse/cac:Response/cbc:ResponseCode`.
 *
 * 030–034 are the reception family (they turn the invoice INTO a negotiable
 * instrument); 035–051 are the negotiable-instrument family (endorsement,
 * factoring, mandate, payment).
 */
export const DIAN_EVENT_CODES = {
  /** Acuse de recibo de la factura electrónica de venta. */
  ACKNOWLEDGEMENT: '030',
  /** Reclamo / rechazo de la FEV por el adquiriente (potestativo). */
  CLAIM: '031',
  /** Recibo del bien o prestación del servicio — dispara los 3 días hábiles. */
  GOODS_RECEIVED: '032',
  /** Aceptación expresa — convierte la factura en título valor. */
  EXPRESS_ACCEPTANCE: '033',
  /** Aceptación tácita — la genera el emisor al vencer los 3 días hábiles. */
  TACIT_ACCEPTANCE: '034',
  /** Aval. Responsable: avalista. */
  GUARANTEE: '035',
  /** Inscripción en el RADIAN de la FEV como título valor que circula. */
  REGISTRATION: '036',
  /** Endoso en propiedad. */
  ENDORSEMENT_OWNERSHIP: '037',
  /** Endoso en garantía. */
  ENDORSEMENT_COLLATERAL: '038',
  /** Endoso en procuración. */
  ENDORSEMENT_PROXY: '039',
  /** Cancelación de endoso. */
  ENDORSEMENT_CANCELLATION: '040',
  /** Limitación para circulación de la FEV como título. Autoridad competente. */
  CIRCULATION_LIMIT: '041',
  /** Terminación de la limitación para circulación. Autoridad competente. */
  CIRCULATION_LIMIT_END: '042',
  /** Mandato. */
  MANDATE: '043',
  /** Terminación del mandato. */
  MANDATE_END: '044',
  /** Pago de la factura electrónica de venta como título valor. */
  PAYMENT: '045',
  /** Informe para el pago. Responsable: tenedor legítimo. */
  PAYMENT_REPORT: '046',
  /** Endoso con efectos de cesión ordinaria. */
  ENDORSEMENT_ORDINARY_ASSIGNMENT: '047',
  /** Protesto. */
  PROTEST: '048',
  /** Transferencia de los derechos económicos. */
  ECONOMIC_RIGHTS_TRANSFER: '049',
  /** Notificación al deudor sobre la transferencia de los derechos económicos. */
  ECONOMIC_RIGHTS_TRANSFER_NOTICE: '050',
  /** Pago de la transferencia de los derechos económicos. */
  ECONOMIC_RIGHTS_TRANSFER_PAYMENT: '051',
} as const;

export type DianEventCode =
  (typeof DIAN_EVENT_CODES)[keyof typeof DIAN_EVENT_CODES];

/**
 * Reception family. These are the only events the adquiriente/emisor exchange on
 * an ordinary invoice, and the only ones Vendix registers without extra
 * negotiation data.
 */
export const DIAN_RECEPTION_EVENT_CODES: readonly string[] = [
  DIAN_EVENT_CODES.ACKNOWLEDGEMENT,
  DIAN_EVENT_CODES.CLAIM,
  DIAN_EVENT_CODES.GOODS_RECEIVED,
  DIAN_EVENT_CODES.EXPRESS_ACCEPTANCE,
  DIAN_EVENT_CODES.TACIT_ACCEPTANCE,
];

/**
 * Negotiable-instrument family (035–051): endorsement, factoring, mandate,
 * payment. Each one carries data the reception family does not, so they are
 * validated separately — see `DIAN_EVENT_REQUIRED_NEGOTIATION_FIELDS`.
 */
export const DIAN_NEGOTIABLE_EVENT_CODES: readonly string[] = Object.values(
  DIAN_EVENT_CODES,
).filter((code) => !DIAN_RECEPTION_EVENT_CODES.includes(code));

/** Spanish labels for UI and audit trails — verbatim from numeral 14.2.1. */
export const DIAN_EVENT_LABELS: Record<string, string> = {
  '030': 'Acuse de recibo de la factura',
  '031': 'Reclamo de la factura',
  '032': 'Recibo del bien o servicio',
  '033': 'Aceptación expresa',
  '034': 'Aceptación tácita',
  '035': 'Aval',
  '036':
    'Inscripción en el RADIAN de la factura electrónica de venta como título valor que circula en el territorio nacional',
  '037': 'Endoso en propiedad',
  '038': 'Endoso en garantía',
  '039': 'Endoso en procuración',
  '040': 'Cancelación de endoso',
  '041':
    'Limitación para circulación de la factura electrónica de venta como título',
  '042':
    'Terminación de la limitación para circulación de la factura electrónica de venta como título',
  '043': 'Mandato',
  '044': 'Terminación del mandato',
  '045': 'Pago de la factura electrónica de venta como título valor',
  '046': 'Informe para el pago',
  '047': 'Endoso con efectos de cesión ordinaria',
  '048': 'Protesto',
  '049': 'Transferencia de los derechos económicos',
  '050':
    'Notificación al deudor sobre la transferencia de los derechos económicos',
  '051': 'Pago de la transferencia de los derechos económicos',
};

/**
 * Who the annex authorises to generate each event (numeral 14.2.1, column
 * "Responsable"). Kept because RADIAN rejects an event generated by a party the
 * table does not name — the message it returns is far less readable than the
 * check this table enables.
 */
export const DIAN_EVENT_RESPONSIBLE: Record<string, string> = {
  '030': 'Adquiriente',
  '031': 'Adquiriente',
  '032': 'Adquiriente',
  '033': 'Adquiriente',
  '034': 'Emisor/Facturador electrónico',
  '035': 'Avalista',
  '036': 'Emisor/Tenedor legítimo',
  '037': 'Emisor/Tenedor legítimo',
  '038': 'Emisor/Tenedor legítimo',
  '039': 'Emisor/Tenedor legítimo',
  '040': 'Emisor/Tenedor legítimo',
  '041': 'Autoridad competente',
  '042': 'Autoridad competente',
  '043': 'Emisor/Tenedor Legítimo/Adquirente-Deudor/Avalista',
  '044': 'Mandante o mandatario',
  '045': 'Emisor/Tenedor Legítimo o adquirente',
  '046': 'Tenedor legítimo',
  '047': 'Emisor/legítimo tenedor',
  '048': 'Emisor/legítimo tenedor',
  '049': 'Enajenante/Cedente o endosante',
  '050': 'Enajenante/Cedente o endosante',
  '051': 'Adquiriente/deudor/aceptante',
};

/**
 * `cbc:CustomizationID` — "Tipo de operación", numeral **14.1.2** of the same
 * annex. NOT the event code.
 *
 * This is the subtlety that makes 035–051 different from 030–034: an event with
 * variants (an endorsement WITH or WITHOUT the endorser's liability; a partial or
 * total payment) carries a THREE-DIGIT operation code that says which variant,
 * while `cbc:ResponseCode` stays the event code. Sending the event code as the
 * CustomizationID for one of those is a rejection on rule AAD02.
 *
 * Events absent from 14.1.2 have a single operation, and there the annex reuses
 * the event code itself (035, 038, 039, 046, 047, 050 appear that way in the
 * table) — which is why the reception family keeps working with `[code]`.
 */
export const DIAN_EVENT_OPERATION_CODES: Record<string, readonly string[]> = {
  '030': ['030'],
  '031': ['031'],
  '032': ['032'],
  '033': ['033'],
  '034': ['034'],
  '035': ['035'],
  // 036 — first vs later registration × general vs prior-direct negotiation.
  '036': ['361', '362', '363', '364'],
  // 037 — with / without the endorser's liability (art. 657 C.Co.).
  '037': ['371', '372'],
  '038': ['038'],
  '039': ['039'],
  // 040 — which endorsement is being cancelled, or a return endorsement.
  '040': ['401', '402', '403'],
  // 041 — attachment order vs payment order.
  '041': ['411', '412'],
  // 042 — by judgment vs early termination.
  '042': ['421', '422'],
  // 043 — general/limited document × limited/unlimited time.
  '043': ['431', '432', '433', '434'],
  // 044 — revocation / resignation / rejection.
  '044': ['441', '442', '443'],
  // 045 — partial vs total payment.
  '045': ['451', '452'],
  '046': ['046'],
  '047': ['047'],
  // 048 — protest for lack of acceptance vs lack of payment.
  '048': ['481', '482'],
  // 049 — partial/total × with/without liability.
  '049': ['491', '492', '493', '494'],
  '050': ['050'],
  // 051 — partial vs total payment of the transfer.
  '051': ['511', '512'],
};

/** Human-readable name of every operation type in numeral 14.1.2. */
export const DIAN_EVENT_OPERATION_LABELS: Record<string, string> = {
  '361':
    'Primera inscripción de la factura electrónica de venta como título valor para Negociación General',
  '362':
    'Primera inscripción de la factura electrónica de venta como título valor para Negociación Directa Previa',
  '363':
    'Inscripción posterior de la factura electrónica de venta como título valor para Negociación General',
  '364':
    'Inscripción posterior de la factura electrónica de venta como título valor para Negociación Directa Previa',
  '371': 'Endoso con responsabilidad del endosante',
  '372': 'Endoso sin responsabilidad del endosante',
  '401': 'Cancelación del Endoso en Garantía',
  '402': 'Cancelación del Endoso en Procuración',
  '403': 'Tacha de Endosos por Endoso en Retorno',
  '411': 'Auto que decreta medida cautelar por embargo',
  '412': 'Auto que decreta medida cautelar por mandamiento de pago',
  '421': 'Terminación de limitación por sentencia',
  '422': 'Terminación de limitación por terminación anticipada',
  '431': 'Mandato por documento General por Tiempo limitado',
  '432': 'Mandato por documento General por Tiempo Ilimitado',
  '433': 'Mandato por documento limitado por tiempo limitado',
  '434': 'Mandato por documento limitado por tiempo Ilimitado',
  '441': 'Terminación del Mandato por Revocación del Mandante',
  '442': 'Terminación del Mandato por Renuncia del mandatario',
  '443': 'Terminación del Mandato por Rechazo del mandante',
  '451': 'Pago parcial de la factura electrónica de venta como título valor',
  '452': 'Pago total de la factura electrónica de venta como título valor',
  '481': 'Protesto por falta de aceptación',
  '482': 'Protesto por falta de pago',
  '491':
    'Transferencia parcial de los derechos económicos con responsabilidad',
  '492': 'Transferencia total de los derechos económicos con responsabilidad',
  '493':
    'Transferencia parcial de los derechos económicos sin responsabilidad',
  '494': 'Transferencia total de los derechos económicos sin responsabilidad',
  '511': 'Pago parcial de la transferencia de los derechos económicos',
  '512': 'Pago total de la transferencia de los derechos económicos',
};

/**
 * `@listID` of the endorsement — numeral **14.2.3**. Art. 654 C.Co. allows an
 * endorsement signed in blank, which is why the shape is a code and not a boolean
 * on the endorsee's presence.
 */
export const DIAN_ENDORSEMENT_LIST_IDS = {
  /** Date, name and signature of the endorser + name and ID of the endorsee. */
  COMPLETE: '1',
  /** Endorser's signature + the endorsee's identification number only. */
  BLANK: '2',
} as const;

/**
 * `Name` literals of the `InformacionNegociacion` extension, verbatim from the
 * annex's validation rules (AAI04b, AAI06b and siblings). They are emitted as
 * `Name`/`Value` pairs inside
 * `ext:UBLExtension/ext:ExtensionContent/CustomTagGeneral/InformacionNegociacion`.
 *
 * The literals are load-bearing: the annex rejects on the literal, not on the
 * position, so a typo here is a rejected event.
 */
export const DIAN_NEGOTIATION_FIELDS = {
  TOTAL_ENDORSEMENT: 'ValorTotalEndoso',
  PRICE_TO_PAY: 'PrecioPagarseFEV',
  DISCOUNT_RATE: 'TasaDescuento',
  PAYMENT_MEANS: 'MedioPago',
  CURRENT_VALUE: 'ValorActualTituloValor',
  PENDING_VALUE: 'ValorPendienteTituloValor',
  TRANSFER_VALUE: 'ValorTransferenciaDerechos',
  PAID_VALUE: 'ValorPagado',
  GUARANTEED_VALUE: 'ValorFEVavala',
  ACCEPTED_VALUE: 'ValorAceptado',
  ATTACHMENT_AMOUNT: 'MontoMedidaCautelar',
  NEW_INSTRUMENT_VALUE: 'NuevoValorTV',
  DESCRIPTION: 'Descripcion',
} as const;

/**
 * Negotiation fields the annex declares REQUIRED per event.
 *
 * Only the sets the annex states explicitly are listed. Anything else stays
 * optional pass-through on purpose: enforcing a requirement the annex does not
 * state would block a legitimate event, and that is worse than letting RADIAN
 * answer — the caller can retry a rejected event with the same consecutive, but
 * cannot register one Vendix refuses.
 */
export const DIAN_EVENT_REQUIRED_NEGOTIATION_FIELDS: Record<
  string,
  readonly string[]
> = {
  // AAI04 / AAI06 / AAI07b: the price must equal total × discount rate.
  '037': [
    DIAN_NEGOTIATION_FIELDS.TOTAL_ENDORSEMENT,
    DIAN_NEGOTIATION_FIELDS.PRICE_TO_PAY,
    DIAN_NEGOTIATION_FIELDS.DISCOUNT_RATE,
    DIAN_NEGOTIATION_FIELDS.PAYMENT_MEANS,
  ],
  '038': [DIAN_NEGOTIATION_FIELDS.TOTAL_ENDORSEMENT],
  '039': [DIAN_NEGOTIATION_FIELDS.TOTAL_ENDORSEMENT],
  '047': [
    DIAN_NEGOTIATION_FIELDS.TOTAL_ENDORSEMENT,
    DIAN_NEGOTIATION_FIELDS.PRICE_TO_PAY,
    DIAN_NEGOTIATION_FIELDS.DISCOUNT_RATE,
    DIAN_NEGOTIATION_FIELDS.PAYMENT_MEANS,
  ],
  '035': [DIAN_NEGOTIATION_FIELDS.GUARANTEED_VALUE],
  '048': [DIAN_NEGOTIATION_FIELDS.ACCEPTED_VALUE],
  '051': [DIAN_NEGOTIATION_FIELDS.CURRENT_VALUE],
};

/** Events whose `@listID` must say whether the endorsement is complete or blank. */
export const DIAN_ENDORSEMENT_EVENT_CODES: readonly string[] = [
  DIAN_EVENT_CODES.ENDORSEMENT_OWNERSHIP,
  DIAN_EVENT_CODES.ENDORSEMENT_COLLATERAL,
  DIAN_EVENT_CODES.ENDORSEMENT_PROXY,
  DIAN_EVENT_CODES.ENDORSEMENT_ORDINARY_ASSIGNMENT,
];

/**
 * `cbc:ResponseCode` values that the ApplicationResponse carries per event.
 * Identical to the event code across the whole 030–051 range; only
 * `cbc:CustomizationID` varies (see `DIAN_EVENT_OPERATION_CODES`).
 */
export const DIAN_EVENT_RESPONSE_CODES = DIAN_EVENT_CODES;

/**
 * DIAN validation response codes — numeral 14.1.1 of the RADIAN annex. Present so
 * a response parser can name them instead of echoing a bare number.
 */
export const DIAN_VALIDATION_RESPONSE_CODES = {
  VALIDATED: '02',
  REJECTED: '04',
} as const;
