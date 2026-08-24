/**
 * El tipo se toma del ESPEJO DEL CONTRATO, no de una unión escrita aquí: la
 * tabla de requisitos por documento (`fiscal-document-requirements.ts`) es la
 * que decide qué campos aplican a cada tipo, y una segunda copia de la unión
 * sería el sitio donde se olvidaría un tipo nuevo. Se importa del archivo del
 * contrato y no del barril `shared/components/dian` a propósito: el barril
 * arrastra los componentes, y estos importan de vuelta este archivo.
 */
import {
  DIAN_CONFIGURATION_TYPES,
  type DianConfigurationType,
  type FiscalDocumentType,
} from '../../../../../shared/components/dian/fiscal-document-requirements';
/**
 * La gravabilidad AIU se lee del ESPEJO DEL CONTRATO, igual que arriba y por la
 * misma razon: `resolveAiuTaxableBasis` ya sabe tolerar un snapshot sin
 * `taxable_basis` derivandolo de `regime`, y ya cae hacia la base MAS AMPLIA
 * ante un valor desconocido. Reescribir esa cascada aca crearia la segunda
 * copia de la regla que decide cuanto IVA declara un documento fiscal.
 */
import {
  resolveAiuTaxableBasis,
  type AiuBucket,
  type AiuTaxableBasis,
  type AiuVatRegimeLiteral,
} from '../../../../../core/utils/invoice-profile-config.contract';

/**
 * Estrecha el `configuration_type` que llega del backend a la unión del
 * contrato.
 *
 * Las columnas de enum viajan como `string`, y los tipos de las filas se
 * declaran así a propósito: hay consumidores que las ensanchan con su propia
 * forma (`string | null`) y un tipo estricto en la fila les rompería la
 * herencia. El estrechamiento se hace en el borde, una vez, con la misma tabla
 * que usa el backend — nunca con un `as`, que aceptaría un valor que ninguna
 * pantalla sabe pintar.
 */
export function toDianConfigurationType(
  value: string | null | undefined,
): DianConfigurationType | null {
  if (!value) return null;
  return DIAN_CONFIGURATION_TYPES.find((type) => type === value) ?? null;
}

export interface Invoice {
  id: number;
  organization_id: number;
  store_id: number;
  invoice_number: string;
  invoice_type: InvoiceType;
  status: InvoiceStatus;
  customer_id?: number;
  supplier_id?: number;
  customer_name?: string;
  customer_tax_id?: string;
  customer_email?: string;
  customer_phone?: string;
  /**
   * JSONB. El histórico guardó aquí tanto un objeto con municipio y país como
   * una cadena suelta con la línea de dirección, así que se declara ancho y se
   * aplana en el borde — leer `.city` de un `string` devuelve `undefined` sin
   * un solo error.
   */
  customer_address?: string | Record<string, unknown> | null;

  /**
   * Identidad fiscal CONGELADA al emitir (Fase 1.1 del plan). Es un snapshot:
   * lo que viajó a la DIAN, no lo que dice hoy la ficha del cliente.
   */
  customer_document_type?: string | null;
  customer_verification_digit?: string | number | null;
  customer_tax_regime?: string | null;
  customer_fiscal_responsibilities?: string | string[] | null;

  subtotal_amount: number;
  discount_amount: number;
  tax_amount: number;
  withholding_amount: number;
  total_amount: number;
  send_status: string;
  issue_date: string;
  due_date?: string;
  notes?: string;
  order_id?: number;
  sales_order_id?: number;
  resolution_id?: number;
  created_at: string;
  updated_at: string;

  // Relations
  /**
   * OJO — ESTOS DOS NOMBRES NO SON LOS DEL BACKEND.
   *
   * `GET /store/invoicing/:id` devuelve la fila de Prisma tal cual, e `include`
   * nombra las relaciones como la tabla: `invoice_items` / `invoice_taxes`.
   * Nada en el frontend las renombra. `items` y `taxes` se quedan por los
   * consumidores que ya los declaran, pero el detalle lee PRIMERO los nombres
   * reales — leyendo sólo `items` la tabla de productos salía siempre vacía
   * («Sin productos») sobre facturas que sí tenían líneas.
   */
  invoice_items?: InvoiceItem[];
  invoice_taxes?: InvoiceTax[];
  items?: InvoiceItem[];
  taxes?: InvoiceTax[];
  resolution?: InvoiceResolution;

  /**
   * FICHA VIVA del adquiriente, distinta del SNAPSHOT (`customer_name`,
   * `customer_tax_id`…) que congela la factura al emitirse.
   *
   * Las dos conviven a propósito y hay que leerlas en ese orden: el snapshot es
   * lo que viajó a la DIAN y manda para cualquier cosa fiscal; la ficha viva es
   * la que sabe cómo se llama hoy el cliente. Una factura creada desde el modal
   * sin escribir el nombre a mano tiene el snapshot en `null` y el cliente
   * asociado por `customer_id`: leer sólo el snapshot pinta una factura «Sin
   * cliente» que sí tiene cliente.
   */
  customer?: {
    id: number;
    first_name?: string | null;
    last_name?: string | null;
    email?: string | null;
    phone?: string | null;
  } | null;

  // DIAN fields
  cufe?: string;
  qr_code?: string;
  pdf_url?: string;
  sent_at?: string;
  accepted_at?: string;

  /**
   * Los TRES estados fiscales que conviven con `status`, verificados en
   * `schema.prisma` (modelo `invoices`). Son columnas NOT NULL con DEFAULT, así
   * que el backend siempre las manda; se declaran opcionales sólo porque hay
   * consumidores que construyen `Invoice` parciales.
   *
   * `status` dice dónde está el documento en el flujo de Vendix;
   * `transmission_status` qué pasó con el envío; `dian_status` qué dijo la DIAN;
   * `accounting_status` si el asiento quedó posteado. Confundirlos es lo que
   * hacía que una factura en contingencia —válida y entregada— se viera igual
   * que una que nadie envió.
   */
  transmission_status?: InvoiceTransmissionStatus | string;
  dian_status?: InvoiceDianStatus | string;
  accounting_status?: InvoiceAccountingStatus | string;

  /**
   * Contingencia (Anexo Técnico 1.9 §12). `contingency_deadline` lo PERSISTE el
   * backend (`InvoiceRetryQueueService.declareContingency`), no se calcula en el
   * navegador: el plazo de 48 h corre desde la PRIMERA declaración y un
   * reintento no lo empuja hacia adelante.
   */
  contingency_type?: string | null;
  contingency_declared_at?: string | null;
  contingency_deadline?: string | null;
  contingency_reason?: string | null;

  /**
   * XML firmado del documento electrónico (`invoices.xml_document`, columna
   * `String?`). Viaja en el payload de la factura porque el backend hace
   * `include` sin `select`; NO existe un endpoint dedicado para descargarlo, así
   * que la descarga se arma en el cliente con este contenido.
   */
  xml_document?: string | null;

  /**
   * EVIDENCIA PERSISTIDA DE LO QUE DIJO EL PROVEEDOR / LA DIAN.
   *
   * Es la columna `invoices.provider_response` (Json?), y viaja entera en el
   * payload porque `INVOICE_INCLUDE` no lleva `select` a nivel de factura —
   * verificado por `curl` sobre `GET /store/invoicing/:id` y sobre la lista: la
   * clave llega siempre, con `null` cuando el documento nunca se transmitió.
   *
   * POR QUÉ IMPORTA QUE ESTÉ DECLARADA. El motivo real del rechazo («Valor del
   * CUFE no está calculado correctamente») vive acá dentro, en
   * `provider_data.dian_errors[]`. Mientras el frontend no la declaró, el panel
   * de reglas sólo se alimentaba del error EN VIVO de la petición: recargar la
   * página, o abrir una factura rechazada de ayer, dejaba el badge «Rechazado
   * por la DIAN» sin una sola regla que corregir.
   */
  provider_response?: InvoiceProviderResponse | null;

  /**
   * Estado de la cola de reintentos DIAN (`invoice_retry_queue`).
   *
   * LO ADJUNTAN LOS DOS ENDPOINTS. `findAll` y `findOne` de
   * `apps/backend/src/domains/store/invoicing/invoicing.service.ts` aplican HOY el
   * MISMO criterio de elegibilidad (`RETRY_ELIGIBLE_SEND_STATUSES` ∪
   * `RETRY_ELIGIBLE_TRANSMISSION_STATUSES`) y devuelven la clave en la raíz de la
   * factura. El hueco que este comentario describía —«sólo la lista lo trae»— se
   * cerró en el backend; se corrigió aquí tras releer `findOne`, porque una nota
   * caducada sobre de dónde sale un dato es la que hace que el próximo lector
   * conserve un apaño que ya no hace falta.
   *
   * `null` NO significa «no vino»: significa «esta factura no es candidata a
   * reintento». Por eso el panel se pinta sobre la presencia del objeto y nunca
   * sobre la presencia de la clave.
   */
  retry_status?: InvoiceRetryStatus | null;

  /**
   * Moneda del documento. SIEMPRE `COP`: el Art. 73 de la Res. 000042/2020
   * exige peso colombiano, y `DocumentCurrencyCode` distinto de COP es rechazo
   * directo. Una operación pactada en divisa se declara aparte, con los cuatro
   * campos de abajo.
   */
  currency?: string;

  /** Divisa en que se pactó la operación (ISO 4217), si no fue COP. */
  foreign_currency?: string | null;

  /** El total en esa divisa, el que ve el cliente en su contrato. */
  foreign_total_amount?: number | string | null;

  /**
   * Cuántos pesos vale UNA unidad de la divisa (la TRM). Va al XML como
   * `cbc:CalculationRate`, y el anexo RECHAZA el valor `1.00`: si la tasa fuera
   * uno, la operación no sería en divisa.
   */
  exchange_rate?: number | string | null;

  /** El día al que corresponde esa tasa (`cbc:Date` del grupo de cambio). */
  exchange_rate_date?: string | null;

  /**
   * `CustomizationID` — tipo de operación DIAN. `'10'` estándar, `'09'` AIU,
   * `'11'` mandatos, `'12'` transporte. Tiene que ser coherente con el
   * contenido: declarar `'10'` sobre líneas con `aiu_component` es un documento
   * que la DIAN rechaza.
   */
  operation_type?: string | null;

  /** Flete facturado, ya incluido en `total_amount`. */
  shipping_amount?: number | string | null;

  // ─── AIU congelado en el documento ─────────────────────────────────────
  //
  // Las cuatro columnas de abajo son la VERDAD EMITIDA, no configuración. El
  // backend las escribe una vez, al calcular los importes, y no vuelve a
  // derivarlas: `invoice-flow` decide con ellas qué línea lleva
  // `cac:TaxTotal` en el XML. Faltaban en esta interfaz, así que el detalle no
  // podía mostrar con qué reglas salió el documento — y una factura AIU cuya
  // gravabilidad no se puede leer desde la propia factura no es auditable.

  /**
   * Lo que la COLUMNA trae, que ya no es sólo un régimen legal.
   *
   * El backend escribe `regimeFromTaxableBasis(basis) ?? basis`, así que bajo
   * la base `'subtotal'` —la que declina el tratamiento AIU y grava el valor
   * total del contrato— la columna guarda el literal `'subtotal'`, que ningún
   * régimen legal representa. Por eso el tipo es {@link PersistedAiuRegime} y
   * no {@link AiuRegime}: ver el docblock de éste para por qué se separaron en
   * vez de ampliar uno solo.
   *
   * NULL en documentos que no son AIU. Nunca se compara contra un literal a
   * mano: se lee con {@link resolveInvoiceAiuTaxableBasis}.
   */
  aiu_regime?: PersistedAiuRegime | null;

  /**
   * Piso legal aplicado sobre la base gravable, en porcentaje del valor total
   * del contrato. Sólo existe bajo `et_462_1`: el Decreto 1372/1992 no fija
   * piso sobre la utilidad del constructor.
   */
  aiu_minimum_percent?: number | string | null;

  /** Objeto del contrato. Va al XML como la nota exigida por el Anexo §CAV03. */
  aiu_contract_object?: string | null;

  /**
   * Radiografía de la gravabilidad, componente por componente, tal como quedó
   * al calcular. Es el espejo de lo que el XML declara.
   */
  aiu_taxable_matrix?: AiuTaxableMatrix | null;

  // ─── Perfil de facturación congelado ───────────────────────────────────

  /**
   * Perfil con el que se emitió, congelado en el par `(profile_id,
   * profile_version)`. Ambas columnas o ninguna — lo impone un CHECK en base,
   * porque la FK compuesta de Postgres no valida el par cuando una mitad es
   * NULL.
   *
   * NULL significa emitida SIN perfil: la configuración vino de
   * `store_settings.invoicing.aiu`, que es mutable. Es un dato relevante para
   * auditoría, no un hueco: dice que el documento no tiene una versión
   * inmutable que respalde su gravabilidad.
   */
  profile_id?: number | null;
  profile_version?: number | null;

  /** Identidad del perfil congelado, para poder nombrarlo y enlazarlo. */
  profile_snapshot?: InvoiceProfileSnapshot | null;
}

/**
 * Los dos regímenes LEGALES de IVA sobre AIU.
 *
 * Se toma del espejo del contrato en vez de reescribir la unión: es la misma
 * que gobiernan `regimeFromTaxableBasis` y `taxableBasisFromRegime`, y una
 * segunda copia sería el sitio donde se olvidaría un valor nuevo.
 */
export type AiuRegime = AiuVatRegimeLiteral;

/**
 * Lo que la columna `invoices.aiu_regime` puede traer.
 *
 * SE SEPARA de {@link AiuRegime} en vez de ampliarlo, y la decisión es lo
 * importante: `'subtotal'` no es un régimen legal —es la AUSENCIA de
 * tratamiento AIU—, y ampliar `AiuRegime` lo colaría en cada
 * `regime === 'et_462_1' ? … : …` del código como si fuera uno. Ésa es
 * exactamente la rama que acaba diciendo «sólo la utilidad grava» sobre un
 * documento que gravó el contrato entero, costo reembolsable incluido.
 *
 * Con dos tipos, quien lea la columna tiene que decidir explícitamente qué hace
 * con el tercer valor y el compilador no lo deja pasar por descuido. La lectura
 * correcta es {@link resolveInvoiceAiuTaxableBasis}.
 *
 * Es la MISMA decisión que el backend tomó, con las mismas palabras, en
 * `AiuRegimeSnapshot` (`invoice-flow/invoice-flow.service.ts`): «no se amplía
 * `AiuVatRegime` en su archivo de origen porque esa interfaz sólo describe el
 * ajuste de tienda». Las dos superficies quedan alineadas sin compartir código.
 */
export type PersistedAiuRegime = AiuRegime | 'subtotal';

/**
 * Base gravable EFECTIVA de un documento AIU, con tolerancia a las dos
 * generaciones del dato persistido.
 *
 * Es el ÚNICO punto de lectura de la gravabilidad de una factura emitida: nadie
 * compara literales de `aiu_regime` ni de `aiu_taxable_matrix.regime` a mano.
 * Precedencia: la clave nueva de la matriz, luego la columna del documento,
 * luego el `regime` viejo de la matriz.
 *
 * El valor encontrado se ofrece a `resolveAiuTaxableBasis` en LAS DOS ranuras a
 * propósito. La columna guarda `regimeFromTaxableBasis(basis) ?? basis`, o sea
 * a veces un régimen legal (`'et_462_1'`) y a veces una base (`'subtotal'`), y
 * no hay forma de saber cuál sin probar: la ranura `taxable_basis` sólo acepta
 * el valor si está en `AIU_TAXABLE_BASES`, y si no cae a `regime`. Pasarlo sólo
 * como régimen convertiría un `'subtotal'` en `'aiu'` —y el panel afirmaría un
 * piso del 10 % sobre un documento que se calculó sin piso—; pasarlo sólo como
 * base perdería `'et_462_1'` y `'decreto_1372_1992'`, que son los dos únicos
 * literales de régimen que la columna llega a guardar (`AiuVatRegimeLiteral`
 * tiene exactamente esos dos; el tercer valor de la columna es la base
 * `'subtotal'`, no un régimen).
 *
 * Sin ninguna de las tres fuentes devuelve `'aiu'`, la base MÁS AMPLIA, que es
 * el default conservador del contrato: declarar de más se corrige con nota
 * crédito, declarar de menos se sanciona.
 */
export function resolveInvoiceAiuTaxableBasis(
  invoice:
    | Pick<Invoice, 'aiu_regime' | 'aiu_taxable_matrix'>
    | null
    | undefined,
): AiuTaxableBasis {
  const matrix = invoice?.aiu_taxable_matrix ?? null;
  const persisted =
    matrix?.taxable_basis ?? invoice?.aiu_regime ?? matrix?.regime ?? null;
  return resolveAiuTaxableBasis({
    taxable_basis: persisted as AiuTaxableBasis | null,
    regime: (persisted as AiuRegime | null) ?? 'et_462_1',
  });
}

/**
 * Una tarifa concreta que un componente declaró. `rate_basis` distingue la
 * base sobre la que se aplicó el porcentaje, que bajo AIU no es el total de la
 * línea sino la porción gravable.
 */
export interface AiuTaxableMatrixRate {
    tax_type?: string | null;
    dian_tax_code?: string | null;
    tax_rate?: number | string | null;
    rate_basis?: number | string | null;
}

export interface AiuTaxableMatrixComponent {
    /**
     * `AiuBucket` y no `AiuComponent`: bajo la base `'subtotal'` el COSTO
     * reembolsable entra a la base gravable, así que la matriz declara una
     * cuarta fila `'costo'` que la unión de tres componentes no podía nombrar
     * —y la fila se pintaba con su clave cruda—.
     */
    component: AiuBucket;
    /** Si la base gravable declarada lo metió en el impuesto. */
    taxable: boolean;
    /** Cuántas líneas del documento aportaron a este componente. */
    lines: number;
    taxable_amount: number | string;
    tax_amount: number | string;
    rates: AiuTaxableMatrixRate[];
}

export interface AiuTaxableMatrix {
    /**
     * Base gravable con la que se calculó. Es la clave que el backend escribe
     * hoy (`buildAiuTaxableMatrix`) y la única que puede representar
     * `'subtotal'`.
     *
     * OPCIONAL a propósito, aunque el servidor la mande siempre: este `jsonb`
     * es INMUTABLE y hay filas escritas antes de que el campo existiera.
     * Declararlo requerido le diría a `tsc` que `matrix.taxable_basis` está
     * presente en toda matriz, y un `AIU_TAXABLE_BUCKETS_BY_BASIS[…]` sobre una
     * matriz vieja daría `undefined` sin una sola queja del compilador.
     */
    taxable_basis?: AiuTaxableBasis | null;
    /**
     * Régimen legal equivalente, cuando existe.
     *
     * Pasó de requerido a opcional porque ya nunca es la única fuente: las
     * matrices viejas sólo tienen esta clave, y en las nuevas viaja derivada
     * —o `null`, porque bajo `'subtotal'` no hay régimen que citar—. Leerla
     * directamente es el defecto; la lectura correcta es
     * {@link resolveInvoiceAiuTaxableBasis}.
     */
    regime?: AiuRegime | null;
    /** En qué momento se construyó: `invoice:create`, `invoice:update:{id}`… */
    stage?: string | null;
    minimum?: {
        /** Si el piso legal se aplicó de verdad, no si estaba configurado. */
        enforced: boolean;
        percent: number | string | null;
    } | null;
    components: AiuTaxableMatrixComponent[];
    /**
     * Buckets que la base gravable SÍ grava y que aun así no declararon
     * ninguna tarifa. Cada entrada es IVA que el documento debía declarar y no
     * declara: vacío es lo correcto, no vacío es un rechazo FAU04 esperando.
     *
     * `AiuBucket` por lo mismo que la fila de arriba: bajo `'subtotal'` el
     * costo reembolsable grava, así que puede aparecer aquí.
     */
    taxable_without_rate?: AiuBucket[];
}

export interface InvoiceProfileSnapshot {
    profile_id: number;
    version: number;
    created_at?: string | null;
    profile?: {
        id: number;
        name: string;
        operation_type: string;
        state: string;
        /**
         * La versión VIGENTE del perfil hoy. Si es mayor que la congelada, el
         * perfil cambió después de emitir — que es exactamente lo que el
         * congelado protege, y merece decirse en pantalla.
         */
        current_version: number;
    } | null;
}

/**
 * `invoices.provider_response` — la evidencia que el backend guarda de CADA
 * transmisión (rechazo, aceptación, contingencia y respuesta sin CUFE).
 *
 * FORMA REAL, NO SUPUESTA. La escribe un único constructor,
 * `toProviderEvidence()` en `invoice-flow.service.ts` (gemelo exacto de
 * `providerEvidence()` en `fiscal-transmission-ledger.service.ts`), que aplana
 * `ProviderResponse` con `?? null` campo por campo. Por eso los escalares se
 * declaran `| null` y no opcionales: cuando ese constructor corre, las claves
 * SIEMPRE están, y su ausencia sólo puede venir de una fila escrita por otra
 * cosa.
 *
 * TODO SE DECLARA OPCIONAL DE TODAS FORMAS porque la columna es un `Json?` sin
 * validación: en la base de desarrollo conviven filas con una forma
 * completamente distinta (`{ date, status, tracking_id }`, sembradas por el
 * seed). El tipo documenta el contrato; el lector
 * (`readPersistedDianRejection`) no se fía de él y valida en runtime.
 */
export interface InvoiceProviderResponse {
  success?: boolean;
  tracking_id?: string | null;
  cufe?: string | null;
  cude?: string | null;
  cuds?: string | null;
  cune?: string | null;
  qr_code?: string | null;
  xml_document?: string | null;
  pdf_url?: string | null;
  /**
   * Mensaje compuesto por el proveedor. En un rechazo del `DianDirectProvider`
   * ya viene con los motivos concatenados («Documento rechazado: …»), así que
   * NO se pinta junto a las viñetas: sería la misma información dos veces.
   */
  message?: string | null;
  provider_data?: InvoiceProviderData | null;
}

/**
 * `provider_response.provider_data` — la bolsa libre del proveedor.
 *
 * Las cuatro claves nombradas son las que pone `DianDirectProvider` en sus siete
 * puntos de emisión. NO son un contrato firme: `sendCreditNote` omite
 * `dian_status_description` y otro proveedor podría no poner ninguna. De ahí el
 * índice `unknown` (nunca `any`): lo que no reconocemos se deja pasar sin
 * pretender saber qué es.
 */
export interface InvoiceProviderData {
  /** Código de estado de la DIAN («00» = aceptado). */
  dian_status_code?: string | null;
  dian_status_description?: string | null;
  /** Las reglas violadas. Es EL dato que el comerciante necesita corregir. */
  dian_errors?: DianProviderError[] | null;
  /** `'test'` | `'production'`, tal como lo guarda el proveedor. */
  environment?: string | null;
  [key: string]: unknown;
}

/**
 * Un motivo tal como lo deja `DianResponseParserService.extractErrors()`:
 * `{ code, message, severity }` con `severity: 'error' | 'warning'`.
 *
 * Todo opcional a propósito. Ese parser barre el XML con dos expresiones
 * regulares —una por `Regla: …` y otra por CADA `<cbc:Description>`— y la
 * segunda arrastra ruido: en el incidente real llegó un elemento cuyo `message`
 * era literalmente `"0"`. El tipo admite la basura; el lector la descarta.
 */
export interface DianProviderError {
  code?: string | null;
  message?: string | null;
  severity?: string | null;
}

/** Espejo de `fiscal_transmission_status_enum` (schema.prisma). */
export type InvoiceTransmissionStatus =
  | 'draft'
  | 'queued'
  | 'signing'
  | 'signed'
  | 'submitted'
  | 'accepted'
  | 'rejected'
  | 'error'
  | 'retrying'
  | 'cancelled'
  | 'contingency';

/** Espejo de `dian_document_status_enum` (schema.prisma). */
export type InvoiceDianStatus =
  | 'pending'
  | 'accepted'
  | 'rejected'
  | 'error'
  | 'not_applicable';

/** Espejo de `fiscal_accounting_status_enum` (schema.prisma). */
export type InvoiceAccountingStatus =
  | 'blocked'
  | 'provisional'
  | 'posted'
  | 'reversed'
  | 'not_applicable';

/**
 * `invoice_retry_queue.status`. `contingency` faltaba: es el estado terminal de
 * la cola cuando se agotan los reintentos reglamentados y el documento se
 * expide bajo contingencia (`RETRY_STATUS` en `invoice-retry-queue.service.ts`).
 */
export type InvoiceRetryQueueStatus =
  | 'pending'
  | 'processing'
  | 'failed'
  | 'completed'
  | 'contingency';

export interface InvoiceRetryStatus {
  status: InvoiceRetryQueueStatus | string;
  attempts: number;
  max_attempts: number;
  last_error: string | null;
  /** ISO timestamp of the next scheduled retry attempt. */
  next_retry_at: string | null;
}

/**
 * Un evento RADIAN registrado contra la factura (Res. 000085/2022), tal como lo
 * devuelve `GET /store/invoicing/:id/events`.
 *
 * Espejo de la tabla `dian_document_events` VERIFICADA en `schema.prisma`. El
 * endpoint hace `findMany` sin `select`, así que la respuesta TAMBIÉN trae
 * `request_xml` y `response_xml`: se dejan deliberadamente fuera de este tipo —
 * son documentos completos que nadie lee en una lista y que sólo engordarían el
 * árbol de componentes.
 */
export interface DianDocumentEvent {
  id: number;
  invoice_id: number;
  /** '030'…'051'. Numeral 14.2.1 del Anexo Técnico. */
  event_code: string;
  event_number: string | null;
  /** CUDE del propio ApplicationResponse, no el CUFE de la factura. */
  cude: string | null;
  referenced_cufe: string | null;
  /** `pending` | `accepted` | `rejected` | `error` (VarChar, no enum). */
  status: string;
  dian_status_code: string | null;
  dian_status_message: string | null;
  issued_at: string | null;
  created_at: string | null;
  updated_at: string | null;
}

/**
 * Un tercero identificado sólo por su registro tributario, como los nombran los
 * eventos RADIAN. Espejo de `DianEventPartyDto`
 * (`apps/backend/.../invoicing/dto/register-dian-event.dto.ts`).
 */
export interface DianEventPartyRequest {
  /** Código DIAN de tipo de identificación ('31' NIT, '13' CC…). */
  document_type: string;
  /** Identificación SIN puntos, guiones ni dígito de verificación. */
  document_number: string;
  document_dv?: string;
  legal_name: string;
}

/**
 * Cuerpo de `POST /store/invoicing/:id/events` — espejo de
 * `RegisterDianEventDto`.
 *
 * Sólo `event_code` es obligatorio SIEMPRE. El resto lo exige el backend según el
 * código: `operation_code` cuando el evento admite más de un «tipo de operación»
 * (numeral 14.1.2), y `issuer_party` / `endorsement_list_id` / `negotiation_info`
 * en la familia de título valor. Enviar un evento incompleto NO es gratis —
 * gasta el consecutivo del evento y RADIAN lo rechaza igual—, así que la puerta
 * está en el backend (`DIAN_EVENT_005`) y la UI no adivina.
 */
export interface RegisterDianEventRequest {
  /** '030'…'051'. Numeral 14.2.1 del Anexo Técnico. */
  event_code: string;
  /** Justificación. RADIAN espera una en el reclamo (031). */
  description?: string;
  /** «Tipo de operación» del numeral 14.1.2 ('361', '451', …). */
  operation_code?: string;
  issuer_party?: DianEventPartyRequest;
  /** '1' endoso completo · '2' endoso en blanco (numeral 14.2.3). */
  endorsement_list_id?: string;
  /** `InformacionNegociacion` con los literales del anexo como claves. */
  negotiation_info?: Record<string, string>;
  /** `YYYY-MM-DD`. Las dos ausentes = mandato ilimitado. */
  validity_start_date?: string;
  validity_end_date?: string;
}

/**
 * Respuesta de `POST /store/invoicing/:id/pdf/regenerate`. `key` es la llave S3
 * persistida en `invoices.pdf_url`; `url` es la firmada, la ÚNICA que se puede
 * abrir en el navegador.
 */
export interface InvoicePdfResult {
  key: string;
  url: string;
}

/**
 * Respuesta de `GET /store/invoicing/:id/pdf`.
 *
 * OJO: `invoices.pdf_url` NO es una URL, es una LLAVE S3
 * (`stores/{id}/invoices/{id}/invoice-XXX.pdf`, ver `invoice-pdf.service.ts`).
 * Abrirla directamente desde el navegador produce una ruta relativa rota. Este
 * endpoint es el que la firma; si la factura todavía no tiene PDF, lo genera.
 */
export interface InvoicePdfUrl {
  url: string;
}

export type InvoiceType =
  | 'sales_invoice'
  | 'purchase_invoice'
  | 'credit_note'
  | 'debit_note'
  | 'export_invoice';

export type InvoiceStatus =
  | 'draft'
  | 'validated'
  | 'sent'
  | 'accepted'
  | 'rejected'
  | 'cancelled'
  | 'voided';

export interface InvoiceItem {
  id: number;
  invoice_id: number;
  product_id?: number;
  product_name: string;
  description?: string;
  quantity: number;
  unit_price: number;
  discount_amount: number;
  tax_amount: number;
  total_amount: number;
  tax_rate?: number;
  // "Empaque por tarifa" snapshot — applied price tier label and the real
  // stock units consumed when packaging expands the sold quantity.
  applied_price_tier_name?: string | null;
  stock_units_consumed?: number | null;

  /**
   * Componente AIU de la línea (Anexo 1.9 §CAV03/§CAX01). `null` en toda línea
   * que no participa de un contrato AIU.
   *
   * NO es decorativo: gobierna qué se grava. Bajo el Art. 462-1 ET la base es
   * el AIU completo; bajo el Decreto 1372/1992 sólo la Utilidad. Las líneas
   * fuera de base gravable se emiten SIN `cac:TaxTotal`, así que una línea
   * marcada como `imprevistos` con impuesto sería un documento que la DIAN
   * rechaza — y sin pintar la marca en pantalla nadie puede verlo.
   */
  aiu_component?: AiuComponent | null;

  /**
   * Unidad de medida UN/ECE del `@unitCode` (`EA`, `KGM`, `MTR`…). `null`
   * cuando la línea no la declaró: el emisor cae a `EA`, que en una línea por
   * pieza es correcto y en una línea por metros no.
   */
  unit_code?: string | null;

  /**
   * Subcuenta PUC congelada al facturar. Es un SNAPSHOT a propósito: que el
   * producto cambie de cuenta mañana no puede reescribir un asiento ya
   * contabilizado. `null` ⇒ la línea cae a la cuenta de ingreso por defecto.
   */
  account_code?: string | null;

  /**
   * Cuántas unidades de stock representa una unidad de precio. Lo que evita la
   * sobrefacturación de QUI-648 (queso a $28.000/kg con stock en gramos).
   */
  price_unit_quantity?: number | string | null;

  /** El precio de la línea ya trae el impuesto dentro. */
  is_inclusive?: boolean | null;
}

/** Los tres componentes de un contrato AIU. */
export type AiuComponent = 'administracion' | 'imprevistos' | 'utilidad';

export interface InvoiceTax {
  id: number;
  invoice_id: number;
  tax_name: string;
  tax_rate: number;
  tax_amount: number;
  taxable_amount: number;
  /**
   * Clasificación fiscal del tributo (`iva`, `inc`, `ica`…). La columna existe
   * en `invoice_taxes` desde el contrato tipado y el backend la devuelve; el
   * frontend no la declaraba, así que una nota crédito que copiara el desglose
   * de la factura no tenía forma de saber que estaba corrigiendo un INC y lo
   * habría rebautizado IVA.
   */
  tax_type?: string;
}

export interface InvoiceResolution {
  id: number;
  organization_id: number;
  store_id: number;
  resolution_number: string;
  resolution_date: string;
  prefix: string;
  range_from: number;
  range_to: number;
  current_number: number;
  valid_from: string;
  valid_to: string;
  is_active: boolean;
  /**
   * Qué documento numera esta fila.
   *
   * Sin este campo, una resolución de documento soporte creada desde la UI se
   * guardaba como factura de venta y secuestraba la numeración de FEV: el
   * generador de consecutivos busca la fila POR `document_type`, así que la
   * primera factura de venta emitida salía con el rango del documento soporte y
   * la DIAN la rechazaba con el consecutivo ya gastado.
   *
   * Opcional y `string` en el tipo, no en la base: la columna es NOT NULL y
   * `GET {rail}/resolutions` siempre la devuelve. Se declara así para no romper
   * a los consumidores que derivan de esta interfaz con su propia forma (la
   * consola de super admin extiende `InvoiceResolution`). Quien lo necesite
   * tipado lo estrecha en el borde con `isFiscalDocumentType`.
   */
  document_type?: string | null;
  technical_key?: string;
  /**
   * ⚠️ AMBOS SE DERIVAN SÓLO DE LA COLUMNA PLANA `technical_key`.
   *
   * `toPublicResolution` los calcula sobre esa columna, pero el emisor lee la
   * clave por bóveda y PREFIERE `technical_key_encrypted`. Consecuencia: no son
   * prueba de nada por sí solos.
   *
   *  - `technical_key_length === 0` NO significa que falte la clave: puede estar
   *    únicamente cifrada y ser perfectamente válida.
   *  - `technical_key_length !== 40` tampoco prueba un fallo: la plana puede
   *    estar rancia mientras la cifrada está bien.
   *
   * Sirven para AVISAR, nunca para filtrar, ordenar ni bloquear.
   */
  technical_key_set?: boolean;
  technical_key_length?: number;
  created_at: string;
  updated_at: string;
}

/**
 * QUI-690 — Payload del selector de impuestos `app-tax-selector`. La forma
 * viaje hasta `CreateInvoiceItemDto.taxes[]` y al backend `CreateInvoiceDto`.
 */
export interface CreateInvoiceTaxDto {
  tax_rate_id?: number;
  tax_name: string;
  tax_rate: number;
  taxable_amount: number;
  tax_amount: number;
  /** Fiscal classification (iva/inc/ica/...). Defaults to iva when omitted. */
  tax_type?: string;
  /**
   * INCLUDED in `unit_price` (true) o ADDITIONAL on top (false). Defaults to
   * false (additional) when omitted. Drives the UBL DIAN builder's
   * `TaxInclusiveIndicator` XML attribute.
   */
  is_inclusive?: boolean;
}

/**
 * QUI-690 — Mirror frontend del `CreateCustomerDto` del backend (DIAN
 * completo). El backend acepta `inline_customer?: CreateCustomerDto` en
 * `CreateInvoiceDto`; cuando el usuario hace click en "Crear cliente" en
 * el modal XXL, este envelope viaja con la factura para que el server
 * materialice el row `users.role='customer'` y devuelva el `customer_id`.
 */
export interface CreateCustomerRequest {
  email?: string | null;
  first_name: string;
  last_name: string;
  legal_name?: string | null;
  document_number?: string | null;
  document_type?: string | null;
  verification_digit?: string | null;
  phone?: string | null;
  tax_regime?: string | null;
  person_type?: string | null;
  fiscal_responsibilities?: string[];
  ciiu_code?: string | null;
  is_withholding_agent?: boolean;
}

export interface CreateInvoiceDto {
  invoice_type: InvoiceType;
  customer_name?: string;
  customer_tax_id?: string;
  customer_email?: string;
  customer_phone?: string;
  customer_address?: string;
  customer_id?: number;
  /** QUI-690 — Inline customer creation. See `CreateCustomerRequest`. */
  inline_customer?: CreateCustomerRequest;
  supplier_id?: number;
  issue_date: string;
  due_date?: string;
  notes?: string;
  resolution_id?: number;
  items: CreateInvoiceItemDto[];
  /**
   * Header-aggregated taxes (legacy). New flows use per-line `items[].taxes[]`.
   */
  taxes?: CreateInvoiceTaxDto[];
  /**
   * Retenciones declaradas explícitamente. Si vienen, el backend las valida y
   * las persiste en `withholding_calculations` AL CREAR; el agregado de
   * `withholding_amount` se recalcula desde este array. Vacío u omitido ⇒
   * sólo el agregado, y la validación automática del tenant corre al aceptar.
   *
   * Espejo de `InvoiceWithholdingInputDto` del backend.
   */
  withholdings?: InvoiceWithholdingInput[];
}

/**
 * Una retención DECLARADA en el payload de creación.
 *
 * `amount` es opcional: si llega, el backend valida que cuadre con
 * `base × rate` dentro de la tolerancia de 1 centavo; si no llega, se
 * recalcula server-side con el mismo truncado que `dian-money.util.ts`.
 */
export interface InvoiceWithholdingInput {
  role: 'practiced' | 'suffered';
  concept_id: number;
  base_amount: number;
  rate: number;
  amount?: number;
  customer_id?: number;
}

export interface CreateInvoiceItemDto {
  product_id?: number;
  /**
   * QUI-690 — Inline product creation payload. Backend AÚN NO lo implementa
   * (responde SYS_VALIDATION_001); el picker lo expone pero la creación
   * real se hace vía el módulo de productos.
   */
  inline_product?: any;
  description: string;
  quantity: number;
  unit_price: number;
  discount_amount?: number;
  /** Legacy single tax rate (still honored for backward compat). */
  tax_rate?: number;
  /**
   * Cuota AFIRMADA de la línea. `CreateInvoiceItemDto` del backend la declara
   * (`@IsOptional @IsNumber @Min(0)`) y el frontend no.
   *
   * La NECESITA la nota crédito/débito parcial: `credit-notes.service.ts` no
   * pasa por `InvoiceCalculatorService` —una nota copia importes, no los
   * recalcula— y suma la cabecera leyendo `item.tax_amount` (`:186`). Sin este
   * campo, una nota parcial viajaría con impuesto cero.
   *
   * En una FACTURA sigue sin usarse: allá manda el calculador del servidor.
   */
  tax_amount?: number;
  /** Variante del producto, cuando la línea corregida la tenía. */
  product_variant_id?: number;
  /** QUI-690 — Per-line typed taxes with inclusive/additional flag. */
  taxes?: CreateInvoiceTaxDto[];
  /** QUI-690 — Per-line INCLUDED / ADDITIONAL shortcut. */
  is_inclusive?: boolean;
}

export interface UpdateInvoiceDto {
  customer_name?: string;
  customer_tax_id?: string;
  customer_email?: string;
  customer_phone?: string;
  customer_address?: string;
  issue_date?: string;
  due_date?: string;
  notes?: string;
  items?: CreateInvoiceItemDto[];
}

/**
 * Nota crédito.
 *
 * El campo es `related_invoice_id`, igual que la columna y que
 * `CreateCreditNoteDto` del backend. Se llamó `original_invoice_id` y ese
 * nombre no existe en el DTO: con `forbidNonWhitelisted` activo la petición se
 * rechazaba con 400 antes de llegar al servicio, así que crear una nota desde
 * la UI era imposible.
 *
 * Sin `items` la nota es TOTAL y el backend copia las líneas de la factura que
 * corrige. Sin `issue_date` la fecha la pone el backend en el huso de la
 * tienda, que es donde debe calcularse una fecha fiscal.
 */
export interface CreateCreditNoteDto {
  related_invoice_id: number;
  reason?: string;
  /**
   * Concepto de corrección DIAN — el CÓDIGO, no la prosa. Termina en
   * `cac:DiscrepancyResponse/cbc:ResponseCode` del XML.
   * Nota crédito: '1'…'5'. Nota débito: '1'…'4' (catálogos distintos, ver
   * `components/invoice-note-create/dian-note-concepts.ts`).
   *
   * Viaja ADEMÁS del prefijo `[Concepto DIAN …]` que `reason` sigue llevando:
   * el código es lo que un validador lee, el texto es lo que una persona lee en
   * `cbc:Description`. No se sustituyen.
   */
  note_concept_code?: string;
  issue_date?: string;
  currency?: string;
  notes?: string;
  items?: CreateInvoiceItemDto[];
  taxes?: CreateInvoiceTaxDto[];
}

/** Nota débito. Mismo contrato que {@link CreateCreditNoteDto}. */
export interface CreateDebitNoteDto {
  related_invoice_id: number;
  reason?: string;
  /** Concepto DIAN de nota DÉBITO: '1'…'4'. Ver {@link CreateCreditNoteDto}. */
  note_concept_code?: string;
  issue_date?: string;
  currency?: string;
  notes?: string;
  items?: CreateInvoiceItemDto[];
  taxes?: CreateInvoiceTaxDto[];
}

export interface CreateResolutionDto {
  resolution_number: string;
  resolution_date: string;
  prefix: string;
  range_from: number;
  range_to: number;
  valid_from: string;
  valid_to: string;
  /**
   * Qué documento numera la resolución. Ausente = `sales_invoice` (lo aplica el
   * backend). Ese defecto silencioso es exactamente el que hacía que la
   * resolución del documento soporte creada desde la UI se guardara como
   * factura de venta.
   */
  document_type?: FiscalDocumentType;
  /** Alta inactiva: se registra el rango sin ponerlo a numerar todavía. */
  is_active?: boolean;
  technical_key?: string;
}

export interface UpdateResolutionDto {
  resolution_number?: string;
  resolution_date?: string;
  prefix?: string;
  range_from?: number;
  range_to?: number;
  valid_from?: string;
  valid_to?: string;
  document_type?: FiscalDocumentType;
  /**
   * Desactivar es la ÚNICA vía para retirar del uso una resolución que ya
   * consumió numeración: el backend rechaza su borrado porque es evidencia
   * fiscal de documentos ya reportados a la DIAN.
   */
  is_active?: boolean;
  technical_key?: string;
}

export interface QueryInvoiceDto {
  search?: string;
  page?: number;
  limit?: number;
  sort_by?: string;
  sort_order?: 'asc' | 'desc';
  status?: string;
  invoice_type?: string;
  date_from?: string;
  date_to?: string;
}

export interface InvoiceStats {
  total_accepted_amount: number;
  total_accepted_count: number;
  total_pending_amount: number;
  total_pending_count: number;
  counts_by_status: Record<string, { count: number; amount: number }>;
}

export interface InvoiceListResponse {
  data: Invoice[];
  meta: {
    total: number;
    page: number;
    limit: number;
    totalPages: number;
  };
}

export interface ApiResponse<T> {
  success: boolean;
  data: T;
  message?: string;
  timestamp?: string;
  path?: string;
}

// ── DIAN Configuration ────────────────────────────────────

export type DianNitType = 'NIT' | 'CC' | 'CE' | 'TI' | 'PP' | 'NIT_EXTRANJERIA';

export interface DianConfig {
  id: number;
  organization_id: number;
  store_id: number;
  name: string;
  nit: string;
  nit_type: DianNitType;
  nit_dv: string | null;
  is_default: boolean;
  /**
   * Qué habilitación DIAN cubre esta configuración.
   *
   * Cada una es una habilitación INDEPENDIENTE ante la DIAN, con su propio set
   * de pruebas y su propio estado. Sin este campo, el panel sólo sabía hablar
   * de facturación de venta y el documento soporte, el documento equivalente
   * POS y la nómina electrónica sólo se podían activar por `curl`.
   *
   * Opcional y `string` porque las respuestas antiguas no lo traen y porque hay
   * consumidores que extienden esta interfaz con su propia forma. El backend lo
   * asume `'invoicing'` cuando falta, igual que hace `DianConfigService.create`;
   * la UI lo estrecha con `toDianConfigurationType`.
   */
  configuration_type?: string | null;
  software_id: string;
  software_pin_encrypted: string; // Always '****' from API
  certificate_s3_key: string | null;
  /**
   * Sustituye a `certificate_s3_key` en la consola de tenants del super admin,
   * que redacta la clave del objeto: nombra dónde vive el material
   * criptográfico de un tercero y quien mira ahí no es el dueño del NIT.
   * Ausente en el panel del comerciante, donde la clave sí viaja.
   */
  certificate_present?: boolean;
  certificate_password_encrypted: string | null; // Always '****' from API
  certificate_expiry: string | null;
  environment: 'test' | 'production';
  /**
   * Mirrors the backend enum. `test_set_passed` is the state DIAN's approval
   * leaves behind and the only one that unlocks the production transition — it
   * was missing here, so the UI could not tell "approved" from "still testing".
   */
  enablement_status:
    | 'not_started'
    | 'testing'
    | 'test_set_passed'
    | 'enabled'
    | 'suspended'
    | 'expired';
  test_set_id: string | null;
  last_test_result: any;
  created_at: string;
  updated_at: string;
}

export interface DianTestResult {
  success: boolean;
  environment: string;
  response_time_ms: number;
  message: string;
  dian_status?: string;
  tracking_id?: string;
  /**
   * Documentos GENERADOS. Conserva ese significado por compatibilidad, así que
   * NO es lo que salió: con el envío en dos fases se generan 50 y pueden salir 30.
   * Para el reparto real, leer `generated_documents` / `transmitted_documents`.
   */
  total_documents?: number;
  /**
   * El reparto explícito, porque generado ≠ transmitido desde el envío en dos
   * fases. La UI decía «50 documentos» sobre un lote del que salieron 30 y las 20
   * notas retenidas eran invisibles: el backend las guardaba y su proyección de
   * estado las descartaba.
   */
  generated_documents?: number | null;
  transmitted_documents?: number | null;
  /** Rastro de la fase de notas. `null` cuando no hubo dos fases. */
  note_phase?: DianTestSetNotePhase | null;
  invoices_count?: number;
  debit_notes_count?: number;
  credit_notes_count?: number;
  /**
   * Tri-state verdict. `pending` means DIAN acknowledged the batch (ZipKey issued)
   * but has not judged it yet — it is NOT a failure, and re-sending would burn a
   * second block of resolution numbers. `rejected` is a real DIAN "no".
   */
  pending?: boolean;
  rejected?: boolean;
  /** DIAN's batch handle; the only way to re-poll without re-sending. */
  zip_key?: string | null;
  /**
   * Resolución con la que se envió el último set. El wizard la usa para
   * preseleccionar el selector: elegirla mal quema un bloque de consecutivos
   * autorizados que no se recupera, así que la elección del usuario debe
   * sobrevivir a recargar la página.
   */
  resolution_id?: number | null;
  error_messages?: string[];
  executed_at?: string | null;
  rechecked_at?: string | null;
  number_from?: number | null;
  number_to?: number | null;
  enablement_status?: string;
  status_message?: string;
  poll_history?: Array<{
    attempt: number;
    status_code: string;
    status_message: string;
    success: boolean;
  }>;
  /**
   * Bounded reading of the wait, computed by the backend from `pending` +
   * `executed_at`. Without it the UI can only say "pending", which after a few
   * hours reads as an infinite loop: `stalled` is the state that turns waiting
   * into a decision, and `diagnosable` says whether asking DIAN per document is
   * even possible for this batch.
   */
  wait?: DianTestSetWait;
}

/**
 * La fase de notas del set, en la VISTA que el backend expone.
 *
 * Una nota solo puede referenciar una factura que la DIAN ya tenga registrada, así
 * que el set transmite primero las facturas, sondea, y solo entonces manda las
 * notas. Si la DIAN no las registra dentro del tope de espera, las notas quedan
 * generadas, firmadas y sin transmitir — con su consecutivo ya reservado dentro
 * del XML, que es la razón por la que no se regeneran.
 *
 * El XML firmado NO viaja acá: el backend lo guarda y expone solo los recuentos.
 * El asistente sondea cada 15 s y 20 documentos firmados por sondeo es tráfico que
 * nadie lee.
 */
export interface DianTestSetNotePhase {
  /** `false` = las notas quedaron retenidas. */
  sent: boolean;
  /** Texto del backend. La UI lo muestra, no lo reescribe. */
  reason: string;
  polls: number;
  deferred_count: number;
  /** Numeración autorizada que quedó reservada y sin usar. */
  deferred_consecutives: number[];
}

export type DianTestSetWaitState =
  | 'idle'
  | 'processing'
  | 'stalled'
  | 'passed'
  | 'rejected'
  | 'abandoned';

export type DianTestSetNextAction =
  | 'run_test_set'
  | 'recheck'
  | 'diagnose_documents'
  | 'abandon_and_resend';

export interface DianTestSetWait {
  state: DianTestSetWaitState;
  waiting_ms: number | null;
  stalled: boolean;
  diagnosable: boolean;
  reason: string | null;
  next_actions: DianTestSetNextAction[];
}

/**
 * Answer of `GET /store/invoicing/uvt-threshold`: the 5 UVT ceiling for the POS
 * equivalent document (Art. 616-1 ET / Res. 000165 de 2023).
 *
 * `enforced: false` means the limit does not apply right now — electronic
 * invoicing is inactive for the store, or no UVT is configured for the year. It
 * mirrors exactly when the sale transaction also lets an anonymous sale through,
 * so the POS hint and the server gate cannot disagree.
 */
export interface PosUvtThreshold {
  enforced: boolean;
  uvt_value: number | null;
  uvt_limit: number;
  limit_cop: number | null;
  year: number;
}

/** One prerequisite in `GET dian-config/:id/production-readiness`. */
export interface DianReadinessCheck {
  key: string;
  label: string;
  satisfied: boolean;
  action: string;
  owner: 'tenant' | 'platform';
  /**
   * `warning` = early alert; it still works today and must NOT be rendered as a
   * blocker. Absent means `blocking` (the historical behavior).
   */
  severity?: 'blocking' | 'warning';
  /**
   * `dian` = our part is done and the DIAN has not ruled. Rendered as "esperando
   * a la DIAN", never as a to-do: presenting it as actionable is what makes a
   * merchant re-send a test set that is still under review. Absent means `vendix`.
   */
  blocked_by?: 'vendix' | 'dian';
  /** Days left, on the certificate-expiry alert. */
  days_remaining?: number;
  /** Share of the numbering range still available, on the range alert. */
  percent_remaining?: number;
}

export interface DianProductionReadiness {
  ready: boolean;
  dian_configuration_id: number;
  environment: string;
  enablement_status: string;
  checks: DianReadinessCheck[];
  missing: string[];
  /** Early alerts. Never affect `ready`. */
  warnings: DianReadinessCheck[];
  /** Blocking and actionable now. */
  actionable: DianReadinessCheck[];
  /** Blocking, pending a DIAN verdict. */
  waiting_on_dian: DianReadinessCheck[];
  resolutions: Array<{
    id: number;
    prefix: string;
    resolution_number: string;
    range_from: number;
    range_to: number;
    current_number: number;
    valid_from: string;
    valid_to: string;
    technical_key: string | null;
    is_habilitacion_range: boolean;
    is_expired: boolean;
    is_exhausted: boolean;
  }>;
}

export interface DianAuditLog {
  id: number;
  action: string;
  document_type: string | null;
  document_number: string | null;
  status: string;
  error_message: string | null;
  cufe: string | null;
  duration_ms: number | null;
  created_at: string;
}

/**
 * Answer of `GET /store/invoicing/dian-config/emission-status`: whether the
 * store is actually issuing electronic invoices, and if not, why.
 *
 * `is_live` mirrors the backend emission gate (`environment='production'` and
 * `enablement_status='enabled'`) — NOT `fiscal_status.invoicing.state`, which
 * only reports that the fiscal wizard was completed.
 */
export interface DianEmissionStatus {
  is_live: boolean;
  configuration_id: number | null;
  environment: string | null;
  enablement_status: string | null;
  /** Human explanation of the current stage; `null` when already live. */
  reason: string | null;
  /**
   * Unsatisfied production-readiness checks, empty when live. Mirrors the
   * backend `ProductionReadinessCheck`: `action` is what the merchant has to do,
   * and `owner` says whether they can do it at all (`platform` means only
   * Vendix operations can).
   */
  blockers: DianReadinessCheck[];
  /** Early alerts that do NOT stop emission (certificate/range about to run out). */
  warnings: DianReadinessCheck[];
  /** Blockers the merchant or Vendix can act on right now. */
  actionable: DianReadinessCheck[];
  /** Blockers waiting on a DIAN verdict. */
  waiting_on_dian: DianReadinessCheck[];
}
