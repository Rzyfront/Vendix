/**
 * XML namespaces used in Colombian UBL 2.1 electronic invoicing.
 * These are required by the DIAN for valid document generation.
 */
export const UBL_NAMESPACES = {
  /** Main invoice namespace */
  INVOICE: 'urn:oasis:names:specification:ubl:schema:xsd:Invoice-2',
  /** Credit note namespace */
  CREDIT_NOTE: 'urn:oasis:names:specification:ubl:schema:xsd:CreditNote-2',
  /** Debit note namespace */
  DEBIT_NOTE: 'urn:oasis:names:specification:ubl:schema:xsd:DebitNote-2',
  /**
   * ApplicationResponse namespace — the envelope RADIAN uses for document
   * events (acuse de recibo 030, reclamo 031, recibo del bien 032,
   * aceptación 033/034). It is the same element DIAN returns to us when it
   * validates a document, used here in the opposite direction.
   */
  APPLICATION_RESPONSE:
    'urn:oasis:names:specification:ubl:schema:xsd:ApplicationResponse-2',
  /**
   * `AttachedDocument` namespace — el «contenedor electrónico» que envuelve el
   * documento ya validado (factura/nota/documento soporte), su representación
   * gráfica y la respuesta de validación de la DIAN, para su entrega al
   * adquiriente (Anexo 1.9 pág. 263 AE01, §8.5 pág. 598/638).
   *
   * ✅ CONFIRMADO contra el XSD propio del repositorio:
   * `schemas/maindoc/UBL-AttachedDocument-2.1.xsd:15`
   * (`targetNamespace="urn:oasis:names:specification:ubl:schema:xsd:AttachedDocument-2"`),
   * copia literal de la Caja de Herramientas de la DIAN — no es un valor
   * buscado en internet sin verificar contra la fuente que ya vive en este
   * repositorio.
   */
  ATTACHED_DOCUMENT:
    'urn:oasis:names:specification:ubl:schema:xsd:AttachedDocument-2',
  /** Common Aggregate Components */
  CAC: 'urn:oasis:names:specification:ubl:schema:xsd:CommonAggregateComponents-2',
  /** Common Basic Components */
  CBC: 'urn:oasis:names:specification:ubl:schema:xsd:CommonBasicComponents-2',
  /** Common Extension Components */
  EXT: 'urn:oasis:names:specification:ubl:schema:xsd:CommonExtensionComponents-2',
  /** DIAN extensions (Software Security) */
  STS: 'dian:gov:co:facturaelectronica:Structures-2-1',
  /** XML Digital Signature */
  DS: 'http://www.w3.org/2000/09/xmldsig#',
  /** XAdES */
  XADES: 'http://uri.etsi.org/01903/v1.3.2#',
  /** XAdES v1.4.1 */
  XADES141: 'http://uri.etsi.org/01903/v1.4.1#',
} as const;

/**
 * Colombia-specific constants for UBL documents.
 */
export const UBL_CONSTANTS = {
  /** UBL version for Colombia */
  UBL_VERSION: 'UBL 2.1',
  /**
   * NOTE: `cbc:CustomizationID` is NOT a fixed constant. DIAN requires the
   * document's *operation type* code (e.g. '10' Estándar for a national sales
   * invoice, '20'/'22' for credit notes, '30'/'32' for debit notes). Each
   * builder sets it from `DIAN_OPERATION_TYPES` per document + reference.
   */
  /**
   * `@schemeID` de `cac:StandardItemIdentification/cbc:ID` en toda línea de todo
   * documento. `999` = «estándar de adopción del contribuyente».
   *
   * La DIAN exige el elemento (regla FAZ09 «StandardItemIdentification no
   * informado»), y el esquema declara de DÓNDE sale el código: 001 UNSPSC, 010
   * GTIN, 999 el propio del contribuyente. Vendix no publica catálogo UNSPSC ni
   * GTIN, así que declarar cualquiera de esos sería afirmar un origen falso.
   */
  ITEM_IDENTIFICATION_SCHEME_ID: '999',
  /** Profile ID for standard invoicing */
  PROFILE_ID: 'DIAN 2.1: Factura Electrónica de Venta',
  /**
   * `cbc:ProfileID` de la NOTA CRÉDITO — ⚠️ DECLARADO Y TODAVÍA NO EMITIDO.
   *
   * `UblCreditNoteBuilder` emite hoy `PROFILE_ID`, el de la factura, y la DIAN lo
   * observa con **CAD03** — NOTIFICACIÓN, no rechazo, así que no bloquea el set ni
   * la emisión. Por eso quedó fuera del alcance del arreglo de las notas, que se
   * limitó a los rechazos.
   *
   * El literal se captura AQUÍ y no en un plan porque es el dato caro: viene del
   * texto que la DIAN nos devolvió en el veredicto del lote de habilitación
   * (2026-08-09, ZipKey e2d19623-3d0a-4cc9-9954-8a70886ab9a7). Un aviso no urge,
   * pero ensucia el diagnóstico de la corrida siguiente: cada regla observada que
   * ya conocemos es ruido sobre las que no.
   */
  PROFILE_ID_CREDIT_NOTE:
    'DIAN 2.1: Nota Crédito de Factura Electrónica de Venta',
  /**
   * `cbc:ProfileID` de la NOTA DÉBITO — ⚠️ DECLARADO Y TODAVÍA NO EMITIDO.
   * Mismo estado que el de la nota crédito; su regla es **DAD03**.
   */
  PROFILE_ID_DEBIT_NOTE: 'DIAN 2.1: Nota Débito de Factura Electrónica de Venta',
  /**
   * `cbc:ProfileID` of the POS electronic equivalent document.
   *
   * ✅ CONFIRMED against **Anexo Técnico de documento equivalente electrónico v1.0
   * (Res. 000165/2023), rule DEAD03**: the literal is `"DIAN 2.1: Documento
   * Equivalente + Nombre Documento"`, and the annex's own Ejemplo 1 spells the POS
   * case out as `"DIAN 2.1: Documento Equivalente POS"`.
   */
  PROFILE_ID_POS_EQUIVALENT: 'DIAN 2.1: Documento Equivalente POS',
  /**
   * `cbc:ProfileID` of every RADIAN `ApplicationResponse` (events 030–051).
   *
   * ✅ CONFIRMED against **Anexo Técnico RADIAN v1.1 (Res. 000085/2022), rule
   * AAD03**, which states: *"Rechazo: si este elemento no contiene el literal
   * «DIAN 2.1: ApplicationResponse de Factura Electrónica de Venta»"* and declares
   * `Tam = 61`. Two independent confirmations: the verbatim literal in the rule
   * text, and the declared length — 61 characters matches this string exactly,
   * while the plausible variant with "de **la** Factura" is 64. That arithmetic is
   * what settles which of the two readings is right.
   *
   * The previous value, `'DIAN 2.1: Nodo Radian'`, was taken from public examples
   * and is NOT what the annex demands — AAD03 is a hard rejection rule, so every
   * event emitted with it was rejected by RADIAN regardless of the rest of the
   * document. Fixing it here fixes the whole 030–034 family too, which shipped
   * before the annex could be read.
   */
  PROFILE_ID_EVENT:
    'DIAN 2.1: ApplicationResponse de Factura Electrónica de Venta',
  /** Profile execution ID: 1=Production, 2=Test */
  PROFILE_EXECUTION_ID_TEST: '2',
  PROFILE_EXECUTION_ID_PROD: '1',
  /** Country code */
  COUNTRY_CODE: 'CO',
  /** Currency */
  DEFAULT_CURRENCY: 'COP',
  /** DIAN technical provider NIT */
  DIAN_NIT: '800197268',
} as const;
