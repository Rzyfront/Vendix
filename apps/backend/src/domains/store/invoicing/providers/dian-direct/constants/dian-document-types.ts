/**
 * Catálogos de la DIAN para tipo de documento, tipo de operación, documento de
 * identificación y medio/forma de pago.
 *
 * FUENTES (ver el detalle por catálogo en cada bloque)
 * ---------------------------------------------------
 * - Anexo Técnico Factura Electrónica de Venta v1.9 (Res. 000165 del 01/NOV/2023).
 * - `Caja_de_herramientas_Factura_Electronica_Validacion_Previa.zip` →
 *   `Version 1.8/Listas de valores/*.gc` (genericode) y
 *   `Version 1.8/Anexo Tecnico/*.xlsx`.
 *
 * ADVERTENCIA SOBRE LAS FUENTES. El anexo 1.9 SACÓ todas las tablas de códigos
 * del PDF (§16.1: «Los listados de códigos, nombres y referencias se sacan del
 * anexo técnico y se dejan de manera independiente… Anexo técnico\Tablas
 * Referenciadas»). El ZIP publicado en la caja de herramientas es el de la v1.8
 * y NO trae esa carpeta: trae `Listas de valores/*.gc`, que es la generación
 * anterior de las mismas tablas. Por eso cada catálogo de abajo dice de qué
 * fuente sale y, cuando dos fuentes discrepan, cuál mandó y por qué.
 */

/**
 * Tipo de documento — `cbc:InvoiceTypeCode`.
 *
 * Fuente 01/02/03/04/91/92: `Listas de valores/TipoDocumento-2.1.gc` (6 filas),
 * confirmada por el Schematron `DIAN_UBL21-listacodigos_v1.6.sch`
 * (`cbc:InvoiceTypeCode` ∈ {01,02,03,91,92}).
 *
 * Los códigos 05/95 (documento soporte) y 20/93/94 (documento equivalente) NO
 * están en el anexo de FEV ni en sus listas: viven en los anexos técnicos
 * hermanos de la Res. 000165/2023 (Documento Soporte v1.0 y Documento
 * Equivalente Electrónico v1.0). No son verificables contra el material de esta
 * carpeta; se conservan con la referencia que ya traían.
 */
export const DIAN_DOCUMENT_TYPES = {
  /** Factura electrónica de venta. */
  INVOICE: '01',
  /** Factura electrónica de venta con propósito de exportación. */
  EXPORT_INVOICE: '02',
  /**
   * Factura por contingencia DEL FACTURADOR (Anexo 1.9 §12.1): se facturó en
   * talonario o papel durante la falla y luego se transcribe cada documento con
   * este código, contra la numeración DE CONTINGENCIA, dentro de 48 h.
   */
  CONTINGENCY_INVOICE: '03',
  /**
   * Factura por contingencia DE LA DIAN (Anexo 1.9 §12.2): el servicio de
   * validación previa no está disponible. Se expide con el MISMO prefijo y número
   * de la numeración normal, re-firmada, y se entrega al adquiriente dentro de un
   * `AttachedDocument` SIN `ApplicationResponse`. Debe transmitirse en 48 h.
   */
  CONTINGENCY_DIAN_INVOICE: '04',
  /** Nota crédito. */
  CREDIT_NOTE: '91',
  /** Nota débito. */
  DEBIT_NOTE: '92',
  /** Documento soporte en adquisiciones a sujetos no obligados a facturar. */
  SUPPORT_DOCUMENT: '05',
  /** Nota de ajuste al documento soporte. */
  SUPPORT_ADJUSTMENT_NOTE: '95',
  /**
   * Documento equivalente electrónico del tiquete de máquina registradora con
   * sistema P.O.S.
   *
   * Res. 000165/2023, Anexo Técnico de documento equivalente electrónico v1.0,
   * numeral 16.3. Note the collision hazard: '20' is ALSO the value of
   * `DIAN_CREDIT_NOTE_OPERATION_TYPES.WITH_REFERENCE`, a `CustomizationID`.
   * They live in different elements and different tables — this one is the
   * `cbc:InvoiceTypeCode` of an equivalent document.
   */
  POS_EQUIVALENT_DOCUMENT: '20',
  /** Nota de ajuste de tipo débito al documento equivalente (numeral 16.3). */
  EQUIVALENT_DEBIT_ADJUSTMENT_NOTE: '93',
  /** Nota de ajuste de tipo crédito al documento equivalente (numeral 16.3). */
  EQUIVALENT_CREDIT_ADJUSTMENT_NOTE: '94',
} as const;

export type DianDocumentTypeCode =
  (typeof DIAN_DOCUMENT_TYPES)[keyof typeof DIAN_DOCUMENT_TYPES];

/**
 * Tipo de operación de una FACTURA — `/Invoice/cbc:CustomizationID`.
 *
 * Fuente: `Listas de valores/TipoOperacionF-2.1.gc` (5 filas). Esta lista es
 * CERRADA: el anexo 1.9 (regla FAD02) rechaza el documento «si contiene un valor
 * distinto a los definidos en el grupo».
 *
 * DEFECTO CORREGIDO. Este objeto traía antes `EXPORT_INVOICE: '20'` y
 * `CONTINGENCY_INVOICE: '30'`. Ninguno de los dos existe en la tabla de tipos de
 * operación de FACTURA: '20' y '30' son valores de las tablas de NOTA CRÉDITO y
 * NOTA DÉBITO respectivamente. Emitir una factura de exportación con
 * `CustomizationID = 20` es rechazo por FAD02 — y el consecutivo autorizado ya
 * se consumió. Ambas claves estaban SIN USAR (el builder de factura siempre
 * emite `STANDARD`), así que eran una trampa esperando al primer desarrollador
 * que implementara exportación. Se eliminan.
 *
 * La factura de exportación se distingue por `cbc:InvoiceTypeCode = '02'`
 * (`DIAN_DOCUMENT_TYPES.EXPORT_INVOICE`), no por el `CustomizationID`.
 */
export const DIAN_INVOICE_OPERATION_TYPES = {
  /** Estándar — el caso normal, y el único que Vendix emite hoy. */
  STANDARD: '10',
  /** AIU (Administración, Imprevistos y Utilidad). */
  AIU: '09',
  /** Mandatos. */
  MANDATE: '11',
  /** Transporte. */
  TRANSPORT: '12',
  /** Cambiario. */
  EXCHANGE: '13',
} as const;

export type DianInvoiceOperationType =
  (typeof DIAN_INVOICE_OPERATION_TYPES)[keyof typeof DIAN_INVOICE_OPERATION_TYPES];

/**
 * Tipo de operación de una NOTA CRÉDITO — `/CreditNote/cbc:CustomizationID`.
 * Fuente: `Listas de valores/TipoOperacionNC-2.1.gc` (3 filas).
 */
export const DIAN_CREDIT_NOTE_OPERATION_TYPES = {
  /** Nota crédito que referencia una factura electrónica. */
  WITH_REFERENCE: '20',
  /** Nota crédito sin referencia a facturas. */
  WITHOUT_REFERENCE: '22',
  /** Nota crédito para facturación electrónica V1 (Decreto 2242). */
  LEGACY_V1: '23',
} as const;

/**
 * Tipo de operación de una NOTA DÉBITO — `/DebitNote/cbc:CustomizationID`.
 * Fuente: `Listas de valores/TipoOperacionND-2.1 - copia.gc` (3 filas).
 */
export const DIAN_DEBIT_NOTE_OPERATION_TYPES = {
  /** Nota débito que referencia una factura electrónica. */
  WITH_REFERENCE: '30',
  /** Nota débito sin referencia a facturas. */
  WITHOUT_REFERENCE: '32',
  /** Nota débito para facturación electrónica V1 (Decreto 2242). */
  LEGACY_V1: '33',
} as const;

/**
 * Tipos de operación agrupados, en el nombre que ya usan los builders.
 *
 * Se conserva la forma plana porque `ubl-credit-note.builder.ts`,
 * `ubl-debit-note.builder.ts`, `ubl-support-document.builder.ts`,
 * `ubl-equivalent-document.builder.ts` y `ubl-invoice.builder.ts` la importan
 * así. Las claves apuntan ahora a las tablas separadas de arriba, que son la
 * definición única.
 */
export const DIAN_OPERATION_TYPES = {
  /** Factura estándar nacional (tabla de FACTURA). */
  STANDARD_INVOICE: DIAN_INVOICE_OPERATION_TYPES.STANDARD,
  /** Nota crédito que referencia una factura electrónica (tabla de NC). */
  CREDIT_NOTE_WITH_REF: DIAN_CREDIT_NOTE_OPERATION_TYPES.WITH_REFERENCE,
  /** Nota crédito sin referencia a facturas (tabla de NC). */
  CREDIT_NOTE_NO_REF: DIAN_CREDIT_NOTE_OPERATION_TYPES.WITHOUT_REFERENCE,
  /** Nota débito que referencia una factura electrónica (tabla de ND). */
  DEBIT_NOTE_WITH_REF: DIAN_DEBIT_NOTE_OPERATION_TYPES.WITH_REFERENCE,
  /** Nota débito sin referencia a facturas (tabla de ND). */
  DEBIT_NOTE_NO_REF: DIAN_DEBIT_NOTE_OPERATION_TYPES.WITHOUT_REFERENCE,
  /**
   * Documento soporte: vendedor residente fiscal colombiano.
   * Anexo Técnico Documento Soporte v1.0 (Res. 000165/2023), tabla de modos.
   */
  SUPPORT_DOCUMENT_RESIDENT_SELLER: '10',
  /** Documento soporte: vendedor NO residente fiscal colombiano. */
  SUPPORT_DOCUMENT_NON_RESIDENT_SELLER: '11',
  /**
   * Documento equivalente electrónico con UN solo modo de operación — que es el
   * caso del tiquete P.O.S. (numeral 16.4.1 lista el código '10' como valor
   * compartido por los tipos de documento 20, 25, 35, 40, 45 y 50).
   */
  EQUIVALENT_DOCUMENT_SINGLE_MODE: '10',
} as const;

/**
 * Documento de identificación de las partes — `cbc:CompanyID/@schemeName`,
 * `cbc:ID/@schemeName` y `sts:ProviderID/@schemeName`.
 *
 * Fuente: `Listas de valores/TipoIdFiscal-2.1.gc` (10 filas: 11, 12, 13, 21, 22,
 * 31, 41, 42, 50, 91), confirmada por el Schematron
 * `DIAN_UBL21-listacodigos_v1.6.sch` con exactamente los mismos 10 valores.
 * Anexo 1.9 §13.2.7.1 remite la tabla a `Tablas Referenciadas`.
 *
 * DEFECTO CORREGIDO — el más caro de los tres que se arreglaron aquí.
 * `PA` valía `'21'`. En el vocabulario de Vendix `PA` es **Pasaporte**
 * (`apps/frontend/src/app/shared/constants/document-types.ts`:
 * `{ code: 'PA', label: 'Pasaporte' }`), pero `21` es **Tarjeta de
 * Extranjería** en la tabla de la DIAN; Pasaporte es `41`. Todo cliente
 * identificado con pasaporte se estaba declarando ante la DIAN como titular de
 * una tarjeta de extranjería. Ahora `PA` → `'41'`, y la tarjeta de extranjería
 * tiene su propia clave `TE` para que el `21` siga siendo alcanzable sin
 * ambigüedad.
 *
 * NO VERIFICADO: `PEP → '47'`. Ni el `.gc` ni el Schematron incluyen el 47, y el
 * control de cambios de la 1.9 (§2.1) solo menciona «Se incluye el código 48 PPT
 * (Permiso Protección Temporal)». El 47 se conserva porque ya estaba en
 * producción y quitarlo rompería a los clientes identificados con PEP, pero
 * queda marcado: confirmar contra `Tablas Referenciadas/13.2.1 Documento de
 * identificación.xlsx` antes de darlo por bueno.
 */
const DIAN_ID_TYPE_TABLE = {
  /** 11 — Registro civil de nacimiento. */
  RC: '11',
  /** 12 — Tarjeta de identidad. */
  TI: '12',
  /** 13 — Cédula de ciudadanía. */
  CC: '13',
  /** 21 — Tarjeta de extranjería. */
  TE: '21',
  /** 22 — Cédula de extranjería. */
  CE: '22',
  /** 31 — NIT. */
  NIT: '31',
  /**
   * 41 — Pasaporte. `PA` es el literal que emite la UI de Vendix
   * (`shared/constants/document-types.ts`).
   *
   * NO añadir aquí un alias `PASSPORT: '41'` (había uno y se quitó): esta tabla
   * se recorre con `Object.values()` en
   * `dto/create-invoice.dto.ts:DIAN_IDENTIFICATION_TYPE_CODES` para construir el
   * `@IsIn` del DTO, así que un alias mete un código REPETIDO en la lista de
   * validación y en su mensaje de error. Un código = una clave.
   */
  PA: '41',
  /** 42 — Documento de identificación extranjero. */
  DIE: '42',
  /** 47 — PEP (Permiso Especial de Permanencia). Ver «NO VERIFICADO» arriba. */
  PEP: '47',
  /** 48 — PPT (Permiso por Protección Temporal). Añadido por el anexo 1.9. */
  PPT: '48',
  /** 50 — NIT de otro país. */
  NIT_EXTRANJERIA: '50',
  /** 91 — NUIP. */
  NUIP: '91',
} as const;

/** Literales de tipo de documento que Vendix persiste en `users.document_type`. */
export type DianIdTypeLiteral = keyof typeof DIAN_ID_TYPE_TABLE;

/** Códigos DIAN válidos para `@schemeName` de identificación. */
export type DianIdTypeCode =
  (typeof DIAN_ID_TYPE_TABLE)[DianIdTypeLiteral];

/**
 * Mapa literal → código DIAN.
 *
 * Se tipa `Record<string, string>` A PROPÓSITO: los llamadores lo indexan con un
 * `string` calculado en runtime (`DIAN_ID_TYPES[normalized] || normalized`), y
 * un `as const` degradaría ese acceso a `any` sin ganar nada. El tipado estricto
 * está en `DianIdTypeLiteral` / `DianIdTypeCode`, que es lo que debe usar el
 * código nuevo.
 */
export const DIAN_ID_TYPES: Record<string, string> = DIAN_ID_TYPE_TABLE;

/** `true` si el código de 2 dígitos pertenece a la tabla de la DIAN. */
export function isDianIdTypeCode(value: unknown): value is DianIdTypeCode {
  return (
    typeof value === 'string' &&
    (Object.values(DIAN_ID_TYPE_TABLE) as readonly string[]).includes(value)
  );
}

/**
 * Medio de pago — `cac:PaymentMeans/cbc:PaymentMeansCode`.
 *
 * Fuente: `Listas de valores/MediosPago-2.1.gc` (75 filas, es la lista UN/CEFACT
 * 4461 adoptada por la DIAN), confirmada por el Schematron
 * `DIAN_UBL21-listacodigos_v1.6.sch` con los mismos 75 valores.
 *
 * DEFECTO CORREGIDO. `DEBIT_TRANSFER` valía `'42'`. En la tabla de la DIAN el
 * `42` es **Consignación bancaria**; **Transferencia Débito Bancaria** es el
 * `47`. Son operaciones distintas y el nombre de la constante prometía la
 * segunda.
 *
 * DEFECTO CORREGIDO (2). La clave `CREDIT: '30'` venía comentada como «Crédito
 * (a plazo)». El `30` de esta tabla es **Transferencia Crédito**, un medio de
 * pago electrónico; el «a plazo» pertenece a OTRA tabla, la de FORMA de pago
 * (`DIAN_PAYMENT_METHODS`, contado/crédito). Confundir las dos tablas es
 * precisamente el error que este archivo debe cerrar, así que la clave se
 * renombra a `CREDIT_TRANSFER` y se documenta el contraste.
 *
 * DEFECTO CORREGIDO (3). `MUTUAL_AGREEMENT: '1'` estaba comentado como
 * «Instrumento no definido». El `1` ES «Instrumento no definido»; «Acuerdo
 * mutuo» es `ZZZ`. Se separan en dos claves con su valor correcto.
 *
 * Solo se listan los medios que un comercio colombiano usa de verdad. La lista
 * completa tiene 75 valores (incluidos ACH, notas promisorias y giros) y
 * enumerarlos aquí sería ruido: `isDianPaymentMeansCode` valida contra el
 * conjunto completo.
 */
export const DIAN_PAYMENT_MEANS = {
  /** 1 — Instrumento no definido. Es el valor por defecto seguro. */
  UNDEFINED_INSTRUMENT: '1',
  /** 10 — Efectivo. */
  CASH: '10',
  /** 20 — Cheque. */
  CHEQUE: '20',
  /** 30 — Transferencia crédito (el pagador empuja los fondos). */
  CREDIT_TRANSFER: '30',
  /** 31 — Transferencia débito. */
  DEBIT_TRANSFER_GENERIC: '31',
  /** 42 — Consignación bancaria. */
  BANK_DEPOSIT: '42',
  /** 45 — Transferencia crédito bancario. */
  BANK_CREDIT_TRANSFER: '45',
  /** 46 — Transferencia débito interbancario. */
  INTERBANK_DEBIT_TRANSFER: '46',
  /** 47 — Transferencia débito bancaria. */
  DEBIT_TRANSFER: '47',
  /** 48 — Tarjeta crédito. */
  CREDIT_CARD: '48',
  /** 49 — Tarjeta débito. */
  DEBIT_CARD: '49',
  /** ZZZ — Acuerdo mutuo entre las partes. */
  MUTUAL_AGREEMENT: 'ZZZ',
} as const;

export type DianPaymentMeansCode =
  (typeof DIAN_PAYMENT_MEANS)[keyof typeof DIAN_PAYMENT_MEANS];

/**
 * Conjunto COMPLETO de los 75 códigos de `MediosPago-2.1.gc`, para validar sin
 * tener que enumerarlos con nombre. Un medio de pago fuera de este conjunto es
 * rechazo seguro.
 */
export const DIAN_PAYMENT_MEANS_ALL: ReadonlySet<string> = new Set([
  '1', '2', '3', '4', '5', '6', '7', '8', '9', '10',
  '11', '12', '13', '14', '15', '16', '17', '18', '19', '20',
  '21', '22', '23', '24', '25', '26', '27', '28', '29', '30',
  '31', '32', '33', '34', '35', '36', '37', '38', '39', '40',
  '41', '42', '43', '44', '45', '46', '47', '48', '49', '50',
  '51', '52', '53', '60', '61', '62', '63', '64', '65', '66',
  '67', '70', '74', '75', '76', '77', '78', '91', '92', '93',
  '94', '95', '96', '97', 'ZZZ',
]);

/** `true` si el código pertenece a la tabla de medios de pago de la DIAN. */
export function isDianPaymentMeansCode(value: unknown): boolean {
  return typeof value === 'string' && DIAN_PAYMENT_MEANS_ALL.has(value);
}

/**
 * Forma de pago — `cac:PaymentMeans/cbc:ID`.
 *
 * Fuente: `Listas de valores/FormasPago-2.1.gc` (2 filas), confirmada por el
 * Schematron (`cac:PaymentMeans/cbc:ID` ∈ {1, 2}).
 *
 * Es la tabla que responde «¿contado o crédito?». NO confundir con
 * `DIAN_PAYMENT_MEANS`, que responde «¿con qué instrumento?». Un pago con
 * tarjeta de crédito es forma `1` (contado, el comercio cobra ya) y medio `48`.
 */
export const DIAN_PAYMENT_METHODS = {
  /** 1 — Contado. */
  CASH: '1',
  /** 2 — Crédito (a plazo). */
  CREDIT: '2',
} as const;

export type DianPaymentMethodCode =
  (typeof DIAN_PAYMENT_METHODS)[keyof typeof DIAN_PAYMENT_METHODS];

/**
 * Tipo de organización jurídica — `cbc:AdditionalAccountID`.
 * Fuente: `Listas de valores/TipoOrganizacion-2.1.gc` (2 filas) + Anexo 1.9
 * §13.2.7.3.
 */
export const DIAN_ORGANIZATION_TYPES = {
  /** 1 — Persona jurídica. */
  LEGAL_ENTITY: '1',
  /** 2 — Persona natural. */
  NATURAL_PERSON: '2',
} as const;

export type DianOrganizationType =
  (typeof DIAN_ORGANIZATION_TYPES)[keyof typeof DIAN_ORGANIZATION_TYPES];

/**
 * Ambiente de destino — `cbc:ProfileExecutionID` y `cbc:UUID/@schemeID`.
 * Fuente: `Listas de valores/TipoAmbiente-2.1.gc` + Anexo 1.9 regla FAD04.
 */
export const DIAN_ENVIRONMENTS = {
  /** 1 — Producción. */
  PRODUCTION: '1',
  /** 2 — Pruebas (habilitación). */
  TESTING: '2',
} as const;

export type DianEnvironment =
  (typeof DIAN_ENVIRONMENTS)[keyof typeof DIAN_ENVIRONMENTS];

/**
 * Estándar del código de producto — `cac:StandardItemIdentification/cbc:ID/@schemeID`.
 * Fuente: `Listas de valores/TipoCodigoProducto-2.1.gc` + Anexo 1.9 §13.3.5.
 */
export const DIAN_PRODUCT_CODE_STANDARDS = {
  /** 001 — UNSPSC. */
  UNSPSC: '001',
  /** 010 — GTIN. */
  GTIN: '010',
  /** 999 — Estándar de adopción del contribuyente. */
  TAXPAYER_OWN: '999',
} as const;

export type DianProductCodeStandard =
  (typeof DIAN_PRODUCT_CODE_STANDARDS)[keyof typeof DIAN_PRODUCT_CODE_STANDARDS];

/**
 * Algoritmo de hash del CUFE/CUDE — `cbc:UUID/@schemeName`.
 * Fuente: Schematron `DIAN_UBL21-listacodigos_v1.6.sch`, regla AA11
 * (`/descendant::cbc:UUID[1]/@schemeName` ∈ {SHA-256, SHA-384, SHA-512}) y
 * `Listas de valores/AlgoritmoCUFE-2.1.gc`.
 */
export const DIAN_CUFE_ALGORITHMS = {
  SHA_256: 'SHA-256',
  SHA_384: 'SHA-384',
  SHA_512: 'SHA-512',
} as const;

export type DianCufeAlgorithm =
  (typeof DIAN_CUFE_ALGORITHMS)[keyof typeof DIAN_CUFE_ALGORITHMS];
