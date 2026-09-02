import { create } from 'xmlbuilder2';
import { UBL_NAMESPACES, UBL_CONSTANTS } from './xml-namespaces';
import { DIAN_TAX_CODES, DIAN_TAX_NAMES } from '../constants/dian-tax-codes';
import {
  DIAN_ID_TYPES,
  DIAN_ORGANIZATION_TYPES,
} from '../constants/dian-document-types';
import { toDianTaxLevelCode } from '../constants/dian-tax-level-codes';
import {
  DianIssuerData,
  DianCustomerData,
  DianSoftwareSecurity,
  DianInvoiceControl,
} from '../interfaces/dian-config.interface';
import {
  ProviderInvoiceTax,
  ProviderInvoiceItem,
} from '../../invoice-provider.interface';
import {
  DIAN_DEPARTMENTS,
  DianMunicipality,
  isDianDepartmentCode,
  resolveDianMunicipality,
} from '../constants/dian-geography';
import { VendixHttpException, ErrorCodes } from 'src/common/errors';
import { DIAN_FINAL_CONSUMER_NAME } from '../../../validators/customer-fiscal-identity.validator';
import { createHash } from 'crypto';
import {
  DianNumericInput,
  dianAmount,
  dianArithmetic,
  dianLineExtension,
  dianLineExtensionTotal,
  dianLineGross,
  dianPriceAmount,
  dianRate,
  dianSum,
  toDecimal,
} from '../../../utils/dian-money.util';

/**
 * Campos de dirección que los builders UBL saben emitir. Es el subconjunto
 * común de `DianIssuerData` y `DianCustomerData`, extraído para que las dos
 * formas de dirección —envuelta en `cac:Address` y plana— compartan firma.
 */
export interface DianAddressFields {
  address_line?: string;
  city_code?: string;
  city_name?: string;
  department_code?: string;
  department_name?: string;
  country_code?: string;
  postal_code?: string;
}

/**
 * De quién es la dirección que se está emitiendo.
 *
 * NO cambia CÓMO se resuelve el municipio —emisor y adquiriente pasan por la
 * misma cascada, a propósito: que uno tolerara lo que el otro rechaza es cómo
 * se llega a un documento que cuadra de un lado y no del otro—. Cambia sólo
 * dos cosas que el anexo distingue por rol:
 *
 *  1. El emisor DEBE estar en Colombia. FAJ16 (pág. 36-37, línea 1947): «Si este
 *     es un grupo con Información con respeto a la dirección del emisor de un
 *     documento electrónico, debe contener el literal "CO"», y FAJ09 lo repite
 *     sobre el municipio. El adquiriente puede ser extranjero.
 *  2. Los cuatro elementos Divipola son `1..1` para el emisor (FAJ09-FAJ12) y
 *     `0..1` para el adquiriente (FAK09-FAK12, FAK29-FAK32), así que sólo en el
 *     adquiriente se pueden omitir cuando la dirección no es colombiana.
 */
export type DianAddressRole = 'emisor' | 'adquiriente';

/** ISO 3166-1 alfa-2 de Colombia. Único país con municipios Divipola. */
const DIAN_COLOMBIA_COUNTRY_CODE = 'CO';

/**
 * Dónde se corrige la dirección, por rol. El mensaje de una excepción que
 * bloquea una emisión tiene que decir QUÉ falta y DÓNDE llenarlo; si no, el
 * usuario sólo sabe que no puede facturar.
 *
 * El texto del adquiriente es el mismo que ya usa
 * `customer-fiscal-identity.validator.ts` (`SCREEN_ADDRESS`), para que el aviso
 * preventivo y el bloqueo final manden al mismo sitio. El del emisor apunta a
 * la fila `type='billing'` porque es la que `loadIssuerData` elige como
 * dirección fiscal (`dian-direct.provider.ts`), no la marcada como principal.
 */
const DIAN_ADDRESS_SCREEN: Readonly<Record<DianAddressRole, string>> = {
  emisor:
    'Configuración → Direcciones → la dirección de tipo «Facturación» de la tienda u organización que emite',
  adquiriente:
    'Clientes → abre la ficha del cliente → pestaña «Direcciones» → dirección principal',
};

/**
 * Colapsa un nombre geográfico a su forma comparable: sin tildes, en minúscula
 * y con cualquier separador vuelto un espacio simple. Réplica intencional de la
 * normalización interna de `dian-geography.ts` (que no la exporta), para que
 * «Bogotá D.C.», «BOGOTA DC» y «bogota d c» comparen igual.
 *
 * Las marcas combinantes se ELIMINAN, no se sustituyen por espacio: un
 * `replace(/[^a-z0-9]+/g, ' ')` a secas partiría «Medellín» en «medelli n» y
 * ningún departamento volvería a resolver.
 */
function normalizeGeoName(value: string): string {
  return value
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
}

/** Índice perezoso nombre-normalizado → código de departamento (33 entradas). */
let department_code_by_name: Map<string, string> | null = null;

/**
 * Código de departamento a partir de su NOMBRE, contra la enumeración cerrada
 * de 33 valores del anexo. No es adivinar: o el nombre está en la lista oficial
 * o la función devuelve `undefined`.
 */
function findDianDepartmentCodeByName(
  name: string | null | undefined,
): string | undefined {
  const key = normalizeGeoName(name || '');
  if (!key) return undefined;
  if (!department_code_by_name) {
    department_code_by_name = new Map(
      Object.entries(DIAN_DEPARTMENTS).map(([code, label]) => [
        normalizeGeoName(label),
        code,
      ]),
    );
  }
  return department_code_by_name.get(key);
}

/**
 * DECLARACIÓN de la conversión de un documento que SIGUE EMITIÉNDOSE EN PESOS.
 *
 * La factura electrónica colombiana no cambia de moneda: `cbc:DocumentCurrencyCode`
 * y todos los `@currencyID` siguen en COP (Res. DIAN 000042/2020 art. 73; Oficios
 * 901544 y 903436 de 2020; Concepto 1509 de 2024). `cac:PaymentExchangeRate` es el
 * ÚNICO sitio del documento donde la divisa aparece, y lo que declara es a cuánto
 * se pactó la conversión — no en qué moneda se cobró.
 *
 * Sin este grupo, una operación pactada en dólares sale al XML sin decir a cuánto
 * se convirtió, y eso no se corrige después: sólo con nota crédito y reemisión.
 */
export interface DianExchangeRateDeclaration {
  /** Divisa pactada, ISO 4217 en mayúsculas. Va a `cbc:TargetCurrencyCode` (FAR04). */
  foreign_currency: string;
  /**
   * PESOS POR UNA UNIDAD de la divisa —la TRM—, con 2 decimales (`dianAmount`).
   *
   * El sentido es el contrario al que uno escribiría espontáneamente y es el que
   * fija el anexo para la tasa: «para COP-USD puede ser el valor de la TRM o tasa
   * acordada entre las partes» (FAR06). Invertirla declara una operación miles de
   * veces menor sin que nada la rechace.
   */
  rate: string;
  /** `AAAA-MM-DD` en que se fijó la tasa. Va a `cbc:Date` (FAR07). */
  date?: string;
}

/**
 * Una retención tal como viaja a `cac:WithholdingTaxTotal`.
 *
 * ## LA TARIFA NO ESTÁ EN LA MISMA UNIDAD QUE EN EL DOMINIO CONTABLE
 *
 * `WithholdingLine.rate` (el contrato de contabilidad) es una FRACCIÓN — `0.025`,
 * que es como la guarda `withholding_concepts.rate` y como la multiplica el
 * calculador—. `rate` de acá es un PORCENTAJE YA FORMATEADO (`'2.50'`) porque va
 * directo a `cbc:Percent` sin pasar por ninguna otra conversión.
 *
 * La traducción entre las dos vive en `InvoiceFlowService.toProviderWithholdings`.
 * Sin el `× 100` el documento declara una retención del 0,025 % donde hubo una del
 * 2,5 %, y el XML sigue siendo sintácticamente válido —el importe retenido viaja
 * aparte y es correcto—, así que nada lo rechaza: la tarifa equivocada sólo
 * aparece al cruzar la declaración, meses después.
 */
export interface ProviderInvoiceWithholding {
  /** Tipo fiscal. Espeja `withholding_type_enum`; decide el esquema DIAN 05/06/07. */
  withholding_type: 'retefuente' | 'reteiva' | 'reteica';
  /** Concepto que produjo la línea (honorarios, servicios, compras…). */
  concept_code: string;
  /** PORCENTAJE formateado (`'2.50'`), NO fracción. Ver el bloque de arriba. */
  rate: string;
  /** Base sobre la que se practicó, 2 decimales. */
  base: string;
  /** Importe retenido, 2 decimales. */
  amount: string;
}

/**
 * Lo que el Anexo Técnico DIAN exige DE MÁS sobre el contrato de cualquier
 * proveedor de facturación.
 *
 * Vive aquí y no en `ProviderInvoiceData` porque aquel es el contrato de CUALQUIER
 * proveedor, mientras que estos tres bloques describen exigencias de la DIAN.
 * Todos sus campos son opcionales, así que un `ProviderInvoiceData` pelado sigue
 * siendo asignable y ningún llamador histórico cambia.
 */
export interface DianDocumentExtras {
  /**
   * `cbc:CustomizationID` — tipo de operación. `'09'` es contrato de servicios
   * AIU. Ausente ≡ `'10'` (estándar), que es lo que el builder resuelve.
   */
  operation_type?: string;
  /** `cac:PaymentExchangeRate`. Ausente ⇒ el grupo no se emite. */
  exchange_rate?: DianExchangeRateDeclaration;
  /** `cac:WithholdingTaxTotal`. Vacío o ausente ⇒ el grupo no se emite. */
  withholdings?: ProviderInvoiceWithholding[];
}

/**
 * La línea tal como la consume el emisor: `ProviderInvoiceItem` MÁS lo que el
 * flujo le adjunta justo antes de transmitir.
 *
 * Los tres campos son opcionales a propósito: una línea que no los trae produce
 * EXACTAMENTE el mismo XML que producía antes de que existieran. Hay facturas ya
 * emitidas que se reenvían tal cual años después, y no pueden cambiar de forma.
 */
export interface UblDocumentLine extends ProviderInvoiceItem {
  /**
   * Desglose multi-impuesto DE ESTA LÍNEA. Sin él, en una factura mixta IVA + INC
   * todas las líneas heredan el esquema del PRIMER tributo de la cabecera y una
   * cuenta de restaurante sale entera como IVA 19 %.
   */
  taxes?: ProviderInvoiceTax[];
  /**
   * `cbc:Note` de línea (FAV03 / CAV03). Hoy su único emisor es la línea de
   * ADMINISTRACIÓN de un contrato AIU, donde la nota es OBLIGATORIA.
   */
  note?: string;
  /**
   * `true` ⇒ la línea NO emite el grupo `cac:TaxTotal` (FAX01 / CAX01).
   *
   * Es distinto de «no tiene impuestos»: un bien EXENTO sí lo emite, con
   * `cbc:Percent` en 0,00. Por eso viaja como bandera explícita y no se deduce de
   * que el importe sea cero.
   */
  omit_tax_total?: boolean;
}

/**
 * Lo que el grupo de totales monetarios necesita saber del documento.
 *
 * `taxes` son los tributos de CABECERA, y están acá porque la base imponible de
 * la cabecera se DERIVA de lo que van a emitir las líneas: una línea sin
 * desglose propio hereda su tributo de `taxes[0]`, así que sin ese dato el grupo
 * de totales no puede saber si la línea emitirá `cac:TaxTotal` o callará — y eso
 * es exactamente lo que decide si aporta base. Ver `lineTaxableContribution`.
 *
 * Es un tipo con nombre y no tres literales repetidos porque los tres puntos de
 * entrada (`buildMonetaryTotal`, `buildLegalMonetaryTotal`,
 * `buildRequestedMonetaryTotal`) tienen que pedir lo MISMO: cuando la forma
 * estaba escrita tres veces, agregar un campo en una sola era invisible.
 */
export interface UblMonetaryTotalInput {
  discount_amount: string;
  tax_amount: string;
  items: ProviderInvoiceItem[];
  taxes: ProviderInvoiceTax[];
}

/**
 * Literal EXACTO con el que debe EMPEZAR el `cbc:Note` de la línea de
 * Administración de un contrato AIU.
 *
 * Anexo Técnico 1.9, FAV03 (pág. 88, espejo CAV03 pág. 165 en la nota crédito):
 * «Obligatorio: de informar para el caso de ítems de contratos de servicio tipo
 * AIU. Para el ítem Administración. En este caso la cbc:Note debe empezar por el
 * texto: “Contrato de servicios AIU por concepto de:” El contribuyente debe
 * incluir el objeto del contrato facturado.»
 *
 * La regla valida el PREFIJO, no el contenido: una tilde de más, la mayúscula
 * inicial o los dos puntos ausentes convierten el documento en rechazable.
 *
 * Tiene un ESPEJO EXACTO en el frontend
 * (`private/modules/store/settings/fiscal/aiu-note.constants.ts`), que mide la
 * longitud mientras el comerciante escribe el objeto del contrato. Cualquier
 * cambio acá tiene que replicarse allá: si las dos cadenas divergen, la pantalla
 * diría «cumple» sobre una nota que el backend arma distinta y la DIAN rechaza.
 */
export const DIAN_AIU_NOTE_PREFIX = 'Contrato de servicios AIU por concepto de:';

/**
 * Cota INFERIOR del nodo `cbc:Note` COMPLETO, prefijo incluido (FAV03: `20..5000`).
 *
 * Es menor que el prefijo (42 caracteres), así que por sí sola nunca frenaría un
 * objeto de contrato vacío. Quien lo frena es `buildAiuNote`, que devuelve cadena
 * vacía cuando no hay objeto — ver su nota.
 */
export const DIAN_AIU_NOTE_MIN_LENGTH = 20;

/** Cota SUPERIOR del nodo `cbc:Note` COMPLETO, prefijo incluido (FAV03: `20..5000`). */
export const DIAN_AIU_NOTE_MAX_LENGTH = 5000;

/**
 * Compone la nota AIU: prefijo obligatorio + UN espacio + objeto del contrato.
 *
 * ## Por qué devuelve cadena VACÍA cuando no hay objeto
 *
 * El prefijo solo ya mide 42 caracteres, o sea que pasaría el mínimo de 20 de
 * FAV03 sin describir contrato alguno. Devolver el prefijo pelado haría que las
 * dos validaciones que dependen de esta función —`InvoicingService` al crear el
 * documento y `InvoiceFlowService` antes de transmitirlo— aprobaran una nota que
 * declara «Contrato de servicios AIU por concepto de:» y nada más. La cadena
 * vacía las hace fallar, que es lo correcto: el objeto del contrato es un dato de
 * negocio que sólo el comerciante conoce.
 *
 * ## Por qué la componen las DOS capas con esta misma función
 *
 * La nota no se persiste en ninguna columna. `InvoicingService` la valida al
 * crear —fallar ahí es lo que ahorra el consecutivo— y la emisión la RECOMPONE
 * desde la misma configuración. Que las dos llamen a esta función es lo que hace
 * imposible que lo validado y lo emitido sean cadenas distintas.
 */
export function buildAiuNote(contract_object?: string | null): string {
  const object = (contract_object || '').trim();
  return object ? `${DIAN_AIU_NOTE_PREFIX} ${object}` : '';
}

/**
 * `withholding_type` → esquema DIAN de `cac:WithholdingTaxTotal`.
 *
 * Se declara UNA vez y en el módulo, no en el sitio de uso: el código del tributo
 * es lo que la DIAN compara contra su tabla 13.2.2 y un valor equivocado es un
 * RECHAZO que quema un consecutivo autorizado e irrecuperable.
 */
const DIAN_WITHHOLDING_SCHEME_BY_TYPE: Readonly<
  Record<ProviderInvoiceWithholding['withholding_type'], string>
> = {
  retefuente: DIAN_TAX_CODES.RETE_FUENTE,
  reteiva: DIAN_TAX_CODES.RETE_IVA,
  reteica: DIAN_TAX_CODES.RETE_ICA,
};

/**
 * Valores de `invoice_taxes.tax_type` que YA SON una retención.
 *
 * OJO CON LOS DOS ENUMS. `tax_type_enum` (el de `invoice_taxes`) trae
 * `iva | inc | ica | withholding | reteiva | reteica` — nótese el genérico
 * `withholding` y la AUSENCIA de `retefuente`—, mientras que
 * `withholding_type_enum` (el del dominio de retenciones) trae
 * `retefuente | reteiva | reteica`. Se aceptan los valores de LOS DOS porque una
 * fila puede haber llegado por cualquiera de las dos puertas, y `retecree` porque
 * la tabla de tributos lo mantiene aunque la figura esté derogada.
 */
const DIAN_WITHHOLDING_TAX_TYPES: ReadonlySet<string> = new Set([
  'withholding',
  'retefuente',
  'reteiva',
  'reteica',
  'retecree',
]);

/**
 * Un cubo `(esquema, tarifa)` con los valores CRUDOS de sus filas.
 *
 * ## Por qué guarda LISTAS y no un acumulado
 *
 * `dianSum` trunca a dos decimales UNA VEZ POR LLAMADA. Acumular con
 * `dianSum([acumulado, siguiente])` trunca en CADA paso, así que la deriva se
 * multiplica por el número de filas del cubo. Guardando las filas se formatea
 * una sola vez, al emitir, y el resultado no depende de en cuántos trozos llegó
 * el importe.
 *
 * Es la trampa que aparece justo al agrupar: agrupar multiplica las llamadas a
 * `dianSum`, y la Σ global puede separarse de la Σ de las Σ por grupo. Se cierra
 * en el sitio donde nace, no en cada llamador.
 */
interface DianTaxRateBucket {
  base: DianNumericInput[];
  amount: DianNumericInput[];
}

/** Cómo se clasifica UNA fila de tributo o de retención para agruparla. */
interface DianTaxGrouping {
  /** Código de tributo de la tabla 13.2.2 (`cac:TaxScheme/cbc:ID`). */
  code: string;
  /** Tarifa YA FORMATEADA como va a salir en `cbc:Percent`. Es la clave. */
  percent: string;
  base: DianNumericInput;
  amount: DianNumericInput;
}

/**
 * Shared UBL 2.1 element builders for Colombian electronic invoicing.
 * Used by both invoice and credit note builders.
 */
export class UblCommonBuilder {
  /** DIAN scheme agency attributes shared by every sts:* identifier. */
  private static readonly DIAN_SCHEME_AGENCY_NAME =
    'CO, DIAN (Dirección de Impuestos y Aduanas Nacionales)';

  /**
   * Builds the UBLExtensions element with the full DIAN `sts:DianExtensions`
   * block that DIAN validates, in the mandated order:
   *   1. InvoiceControl  (InvoiceAuthorization, AuthorizationPeriod, AuthorizedInvoices)
   *   2. InvoiceSource   (country code 'CO')
   *   3. SoftwareProvider (ProviderID = software provider NIT, SoftwareID = DIAN GUID)
   *   4. SoftwareSecurityCode
   *   5. AuthorizationProvider (always the DIAN NIT 800197268)
   *   6. QRCode          (document consultation URL, contains the CUFE/CUDE/CUDS)
   * A second empty UBLExtension is appended as the placeholder for the XAdES
   * digital signature (inserted later by dian-xml-signer.service.ts).
   *
   * `options.control`, `options.issuer_nit`/`issuer_nit_dv` and
   * `options.qr_code` are optional so existing callers keep compiling; the
   * orchestrator populates them from the numbering resolution + CUFE.
   */
  static buildExtensions(
    parent: any,
    software_security: DianSoftwareSecurity,
    options?: {
      control?: DianInvoiceControl;
      issuer_nit?: string;
      issuer_nit_dv?: string;
      qr_code?: string;
      /**
       * `Name`/`Value` pairs for the RADIAN `InformacionNegociacion` block. Emitted
       * as its OWN `ext:UBLExtension`, between the DIAN extension and the signature
       * placeholder, because that is where the annex's XPath puts it:
       * `ext:UBLExtension/ext:ExtensionContent/CustomTagGeneral/InformacionNegociacion`.
       */
      negotiation_info?: ReadonlyArray<{ name: string; value: string }>;
    },
  ): void {
    const agency_name = UblCommonBuilder.DIAN_SCHEME_AGENCY_NAME;
    const dian = parent
      .ele(UBL_NAMESPACES.EXT, 'UBLExtensions')
      .ele(UBL_NAMESPACES.EXT, 'UBLExtension')
      .ele(UBL_NAMESPACES.EXT, 'ExtensionContent')
      .ele(UBL_NAMESPACES.STS, 'DianExtensions');

    // 1. InvoiceControl — numbering resolution authorization + range.
    const control = options?.control;
    const invoice_control = dian.ele(UBL_NAMESPACES.STS, 'InvoiceControl');
    invoice_control
      .ele(UBL_NAMESPACES.STS, 'InvoiceAuthorization')
      .txt(control?.invoice_authorization ?? '');
    const period = invoice_control.ele(
      UBL_NAMESPACES.STS,
      'AuthorizationPeriod',
    );
    period
      .ele(UBL_NAMESPACES.CBC, 'StartDate')
      .txt(control?.authorization_start_date ?? '');
    period
      .ele(UBL_NAMESPACES.CBC, 'EndDate')
      .txt(control?.authorization_end_date ?? '');
    const authorized = invoice_control.ele(
      UBL_NAMESPACES.STS,
      'AuthorizedInvoices',
    );
    // Prefix is optional (0..1) — omit the element when the resolution has none.
    if (control?.prefix) {
      authorized.ele(UBL_NAMESPACES.STS, 'Prefix').txt(control.prefix);
    }
    authorized.ele(UBL_NAMESPACES.STS, 'From').txt(control?.range_from ?? '');
    authorized.ele(UBL_NAMESPACES.STS, 'To').txt(control?.range_to ?? '');

    // 2. InvoiceSource — ISO 3166-1 country code of the document source.
    dian
      .ele(UBL_NAMESPACES.STS, 'InvoiceSource')
      .ele(UBL_NAMESPACES.CBC, 'IdentificationCode')
      .att('listAgencyID', '6')
      .att('listAgencyName', 'United Nations Economic Commission for Europe')
      .att(
        'listSchemeURI',
        'urn:oasis:names:specification:ubl:codelist:gc:CountryIdentificationCode-2.1',
      )
      .txt(UBL_CONSTANTS.COUNTRY_CODE);

    // 3. SoftwareProvider — ProviderID is the software provider NIT (falls back
    //    to the issuer NIT for self-developed software); SoftwareID is the DIAN
    //    software GUID.
    const software = dian.ele(UBL_NAMESPACES.STS, 'SoftwareProvider');
    // ProviderID: NIT of the software provider WITHOUT its DV (the DV is the
    // schemeID). schemeAgencyID/@schemeName/@schemeID are all mandatory (1..1).
    software
      .ele(UBL_NAMESPACES.STS, 'ProviderID')
      .att('schemeAgencyID', '195')
      .att('schemeAgencyName', agency_name)
      .att(
        'schemeID',
        software_security.provider_nit_dv ?? options?.issuer_nit_dv ?? '',
      )
      .att('schemeName', '31') // 31 = NIT
      .txt(software_security.provider_nit ?? options?.issuer_nit ?? '');

    // `sts:SoftwareID` con S MAYÚSCULA.
    //
    // Aquí decía `softwareID` en minúscula, con un comentario que afirmaba que la
    // mayúscula «falla la validación de esquema» — sin citar fuente. La medición
    // dice lo contrario: la validación sincrónica del 2026-08-08 devolvió TRES
    // reglas del mismo bloque diciendo «no informado» sobre valores que el XML SÍ
    // llevaba:
    //
    //   FAB24a  «No se encuentra informado el código de software»
    //   FAB25   «No informado el literal “195”»          <- schemeAgencyID
    //   FAB26   «No informado el literal “CO, DIAN (…)”» <- schemeAgencyName
    //
    // Los dos literales están presentes y son exactos, y van pegados como
    // atributos de ESTE elemento. Que la DIAN los declare ausentes significa que
    // su XPath no encuentra el elemento que los porta: tres reglas, un nombre mal
    // escrito. Es el mismo patrón que FAB10a con `CorporateRegistrationScheme`.
    //
    // Corrobora la mayúscula el propio repositorio: los builders de nómina
    // (`nomina-individual.builder.ts`, `nomina-adjustment.builder.ts`) emiten
    // `SoftwareID`. Y el comentario anterior es exactamente la forma de error que
    // `dian-test-set-composition.ts` documenta: una afirmación sin fuente que cada
    // relectura confirmaba.
    software
      .ele(UBL_NAMESPACES.STS, 'SoftwareID')
      .att('schemeAgencyID', '195')
      .att('schemeAgencyName', agency_name)
      .txt(software_security.software_id);

    // 4. SoftwareSecurityCode.
    dian
      .ele(UBL_NAMESPACES.STS, 'SoftwareSecurityCode')
      .att('schemeAgencyID', '195')
      .att('schemeAgencyName', agency_name)
      .txt(software_security.software_security_code);

    // 5. AuthorizationProvider — always the DIAN NIT.
    dian
      .ele(UBL_NAMESPACES.STS, 'AuthorizationProvider')
      .ele(UBL_NAMESPACES.STS, 'AuthorizationProviderID')
      .att('schemeAgencyID', '195')
      .att('schemeAgencyName', agency_name)
      .att('schemeID', '4')
      .att('schemeName', '31')
      .txt(UBL_CONSTANTS.DIAN_NIT);

    // 6. QRCode — document consultation URL (embeds the CUFE/CUDE/CUDS).
    if (options?.qr_code) {
      dian.ele(UBL_NAMESPACES.STS, 'QRCode').txt(options.qr_code);
    }

    // dian → .up() ExtensionContent → .up() UBLExtension → .up() UBLExtensions
    const extensions = dian
      .up() // → ExtensionContent
      .up() // → UBLExtension (first)
      .up(); // → UBLExtensions

    // Optional UBLExtension: RADIAN negotiation data. Goes BEFORE the signature
    // placeholder so the signature stays the last extension — the signer replaces
    // the last empty ExtensionContent, and inserting after it would leave the
    // negotiation block unsigned.
    const negotiation_info = options?.negotiation_info;
    if (negotiation_info?.length) {
      // NO namespace, matching the annex XPath
      // (`.../ext:ExtensionContent/CustomTagGeneral/InformacionNegociacion`: the
      // last two segments carry no prefix while every DIAN element around them
      // does). The explicit `null` is load-bearing — `ele('CustomTagGeneral')`
      // INHERITS the parent's `ext:` prefix in xmlbuilder2, which silently emits
      // `<ext:CustomTagGeneral>` and no longer matches the XPath the annex
      // validates. Passing null undeclares the namespace instead.
      const negotiation = extensions
        .ele(UBL_NAMESPACES.EXT, 'UBLExtension')
        .ele(UBL_NAMESPACES.EXT, 'ExtensionContent')
        .ele(null, 'CustomTagGeneral')
        .ele(null, 'InformacionNegociacion');

      for (const { name, value } of negotiation_info) {
        negotiation.ele(null, 'Name').txt(name);
        negotiation.ele(null, 'Value').txt(value);
      }
    }

    // Last UBLExtension: placeholder ExtensionContent for the XAdES signature.
    extensions
      .ele(UBL_NAMESPACES.EXT, 'UBLExtension')
      .ele(UBL_NAMESPACES.EXT, 'ExtensionContent');
  }

  /**
   * Builds the DIAN document consultation (QR) URL. Habilitación and production
   * use different catalog hosts.
   */
  static buildQrUrl(
    environment: 'test' | 'production',
    document_key: string,
  ): string {
    const base =
      environment === 'production'
        ? 'https://catalogo-vpfe.dian.gov.co'
        : 'https://catalogo-vpfe-hab.dian.gov.co';
    return `${base}/document/searchqr?documentkey=${document_key}`;
  }

  /**
   * Builds the supplier (emisor) party element.
   *
   * `numbering_prefix` es el prefijo de la resolución de numeración (el mismo
   * que viaja en `sts:AuthorizedInvoices/sts:Prefix`). Identifica el PUNTO DE
   * FACTURACIÓN y va en `cac:PartyLegalEntity/cac:CorporateRegistrationScheme`
   * — ver la nota de FAJ49/FAJ50 más abajo. Es opcional porque el documento
   * soporte construye su emisor a partir de un tercero no obligado a facturar,
   * que no tiene resolución propia: ahí el grupo se omite.
   */
  static buildSupplierParty(
    parent: any,
    issuer: DianIssuerData,
    numbering_prefix?: string,
  ): void {
    const supplier = parent.ele(UBL_NAMESPACES.CAC, 'AccountingSupplierParty');
    // AdditionalAccountID = tipo de persona/organización ('1' Jurídica default,
    // '2' Natural). The tax regime ('48'/'49') belongs in TaxLevelCode, not here.
    supplier
      .ele(UBL_NAMESPACES.CBC, 'AdditionalAccountID')
      .txt(issuer.person_type ?? '1');

    const party = supplier.ele(UBL_NAMESPACES.CAC, 'Party');

    // Party name
    party
      .ele(UBL_NAMESPACES.CAC, 'PartyName')
      .ele(UBL_NAMESPACES.CBC, 'Name')
      .txt(issuer.trade_name || issuer.legal_name);

    // Physical location
    UblCommonBuilder.buildAddress(
      party.ele(UBL_NAMESPACES.CAC, 'PhysicalLocation'),
      issuer,
      'emisor',
    );

    // Tax scheme
    const tax_scheme = party.ele(UBL_NAMESPACES.CAC, 'PartyTaxScheme');
    tax_scheme
      .ele(UBL_NAMESPACES.CBC, 'RegistrationName')
      .txt(issuer.legal_name);
    tax_scheme
      .ele(UBL_NAMESPACES.CBC, 'CompanyID')
      .att('schemeAgencyID', '195')
      .att(
        'schemeAgencyName',
        'CO, DIAN (Dirección de Impuestos y Aduanas Nacionales)',
      )
      .att('schemeID', issuer.nit_dv)
      .att('schemeName', issuer.document_type || '31') // NIT by default
      .txt(issuer.nit);

    // cbc:TaxLevelCode carries the fiscal responsibilities of the issuer (its
    // value, e.g. 'O-13;O-15' or 'R-99-PN'), which already encode the tax
    // regime. Per the DIAN annex (FAJ26/CAJ27) the @listName attribute is the
    // literal 'No aplica'. The regime is NOT emitted as a 48/49 code, and it no
    // longer lives in AdditionalAccountID (which is now the person type).
    const tax_level = tax_scheme.ele(UBL_NAMESPACES.CBC, 'TaxLevelCode');
    tax_level
      .att('listName', 'No aplica')
      .txt(toDianTaxLevelCode(issuer.tax_scheme));

    UblCommonBuilder.buildRegistrationAddress(tax_scheme, issuer, 'emisor');

    // `cac:TaxScheme` se valida como PAR (ID, Name). El anexo exige `cbc:Name`
    // junto a `cbc:ID` y la DIAN notifica FAJ41 «el contenido de este elemento
    // no corresponde al nombre y código valido» cuando el nombre falta —
    // XPath `/Invoice/cac:AccountingSupplierParty/…/cac:TaxScheme/cbc:Name`.
    const issuer_scheme = tax_scheme.ele(UBL_NAMESPACES.CAC, 'TaxScheme');
    issuer_scheme.ele(UBL_NAMESPACES.CBC, 'ID').txt(DIAN_TAX_CODES.IVA);
    issuer_scheme
      .ele(UBL_NAMESPACES.CBC, 'Name')
      .txt(DIAN_TAX_NAMES[DIAN_TAX_CODES.IVA]);

    // Party legal entity
    const legal = party.ele(UBL_NAMESPACES.CAC, 'PartyLegalEntity');
    legal.ele(UBL_NAMESPACES.CBC, 'RegistrationName').txt(issuer.legal_name);
    legal
      .ele(UBL_NAMESPACES.CBC, 'CompanyID')
      .att('schemeAgencyID', '195')
      .att(
        'schemeAgencyName',
        'CO, DIAN (Dirección de Impuestos y Aduanas Nacionales)',
      )
      .att('schemeID', issuer.nit_dv)
      .att('schemeName', issuer.document_type || '31')
      .txt(issuer.nit);

    // FAJ49 + FAJ50 (espejos CAJ49/CAJ50 en nota crédito y DAJ49/DAJ50 en nota
    // débito, las tres de severidad RECHAZO). `cac:CorporateRegistrationScheme`
    // identifica el PUNTO DE FACTURACIÓN, y de ese punto cuelgan la autorización
    // de numeración y el software habilitado para usarla. El anexo define
    // FAB10a como la comparación
    //
    //   sts:AuthorizedInvoices/sts:Prefix
    //     == cac:PartyLegalEntity/cac:CorporateRegistrationScheme/cbc:ID
    //
    // Sin el grupo no hay lado derecho contra el que comparar, así que la DIAN
    // no resuelve el punto — y en cascada no resuelve la autorización (FAD05e
    // «el número no existe para la autorización») ni el software autorizado
    // para ella (FAB24a presencia, FAB27b huella, FAB25/FAB26 atributos). Es el
    // mismo racimo de un solo XPath ausente que ya produjo FAJ28/29/32 con la
    // dirección fiscal: siete reglas, un elemento.
    //
    // En la vía asincrónica el efecto era peor que un rechazo: la DIAN devolvía
    // ZipKey y no clasificaba el lote en el set de pruebas, así que el portal
    // quedaba en «Recibidos 0» y `GetStatus` respondía código 66 —«TrackId no
    // existe en los registros de la DIAN»— sobre un CUFE que ella misma había
    // validado como correcto por la vía sincrónica.
    //
    // `cbc:Name` (FAJ51) es el número de matrícula mercantil: 6-12 dígitos,
    // 0..1, solo notificación. NO se emite. Vendix no almacena la matrícula, y
    // declarar un número inventado afirmaría un registro que no existe.
    if (numbering_prefix) {
      legal
        .ele(UBL_NAMESPACES.CAC, 'CorporateRegistrationScheme')
        .ele(UBL_NAMESPACES.CBC, 'ID')
        .txt(numbering_prefix);
    }

    // Contact
    if (issuer.email || issuer.phone) {
      const contact = party.ele(UBL_NAMESPACES.CAC, 'Contact');
      if (issuer.phone) {
        contact.ele(UBL_NAMESPACES.CBC, 'Telephone').txt(issuer.phone);
      }
      if (issuer.email) {
        contact.ele(UBL_NAMESPACES.CBC, 'ElectronicMail').txt(issuer.email);
      }
    }
  }

  /**
   * Builds the customer (adquirente) party element — Anexo Técnico 19 compliant.
   *
   * The previous implementation had three defects that DIAN rejects:
   *
   *   1. `@schemeID` carried the verification digit (`customer.document_dv`).
   *      Anexo 19 fixes `@schemeID` to the DIAN document-type code (e.g.
   *      '31' for NIT, '13' for CC) — `@schemeName` is the literal type name
   *      ('NIT', 'CC'). The DV never belongs at `@schemeID`.
   *
   *   2. `cac:PartyLegalEntity` was emitted for every customer, including
   *      personas naturales. UBL distinguishes
   *      `cac:PartyLegalEntity`/`CompanyID` from `cac:Person`/`FirstName`+
   *      `FamilyName` structurally; emitting the legal entity for a natural
   *      person is a rejection (no `RegistrationName` is honest when the
   *      taxpayer is a person).
   *
   *   3. `TaxLevelCode` carried only the first responsibility
   *      (`tax_responsibilities?.[0]`). Anexo 19 accepts `;`-separated
   *      responsibility codes — concatenating all is the conformant form.
   *
   * Fix:
   *
   *   - @schemeID  = dígito de verificación (vacío cuando el documento no lo
   *                  lleva). Es la MISMA convención del emisor.
   *   - @schemeName= DIAN_ID_TYPES[document_type] (código DIAN: '31', '13', …).
   *   - Structural branch by `person_type`:
   *       JURIDICA  → `cac:PartyLegalEntity` with `cbc:RegistrationName` +
   *                   `cbc:CompanyID`.
   *       NATURAL   → `cac:Person` with `cbc:FirstName` + `cbc:FamilyName` +
   *                   `cbc:ID`.
   *       null      → derive from `document_type` (NIT → JURIDICA, else NATURAL).
   *   - `cbc:AdditionalAccountID` es 1..1 en el perfil DIAN: UN solo código de
   *     tipo de persona/organización ('1' jurídica / '2' natural), tomado de
   *     `DIAN_ORGANIZATION_TYPES` — su dominio es la lista oficial
   *     `TipoOrganizacion-2.1.gc`, que tiene exactamente dos filas. La versión
   *     anterior emitía además hermanos extra como si el elemento aceptara
   *     1..N (gran contribuyente=1 si O-13, autorretenedor=2 si O-15, agente
   *     de retención=3 si `is_withholding_agent`), y un documento con dos
   *     `cbc:AdditionalAccountID` fue rechazado en producción con «Receptor
   *     debe ser persona natural o jurídica
   *     (cac:AccountingCustomerParty/cbc:AdditionalAccountID)» (FVJL7/FVJL8).
   *     Gran contribuyente, autorretenedor y agente de retención se declaran
   *     en `cbc:TaxLevelCode` (códigos O-13 / O-15 / O-23), NUNCA en este
   *     elemento.
   *   - `cbc:IndustryClassificationCode` emitted when `ciiu_code` is present.
   *   - El número de documento viaja DESNUDO en `cbc:CompanyID`/`cbc:ID`; el
   *     DV va en `@schemeID`. La forma `<NIT>-<DV>` que se usó antes rompía el
   *     CUFE: §11.2 toma `NumAdq` de `cac:PartyTaxScheme/cbc:CompanyID` y lo
   *     exige sin DV, así que la DIAN recomputaba el hash sobre otro valor.
   */
  static buildCustomerParty(parent: any, customer: DianCustomerData): void {
    const customer_party = parent.ele(
      UBL_NAMESPACES.CAC,
      'AccountingCustomerParty',
    );

    // Structural branch selector — see method JSDoc for the rule.
    const resolved_person_type: 'NATURAL' | 'JURIDICA' =
      customer.person_type ??
      (customer.document_type === 'NIT' ? 'JURIDICA' : 'NATURAL');

    const dian_scheme_id =
      DIAN_ID_TYPES[customer.document_type] || customer.document_type;

    // `cbc:AdditionalAccountID` del adquiriente — tipo de persona/organización
    // ÚNICAMENTE. El elemento es 1..1 en el perfil DIAN; su dominio es la lista
    // oficial `TipoOrganizacion-2.1.gc` (dos filas: '1' jurídica, '2' natural —
    // ver `DIAN_ORGANIZATION_TYPES`). Gran contribuyente (O-13), autorretenedor
    // (O-15) y agente de retención (O-23) se declaran más abajo en
    // `cbc:TaxLevelCode`, nunca como hermanos extra de este elemento (ver el
    // JSDoc del método).
    const person_code =
      resolved_person_type === 'JURIDICA'
        ? DIAN_ORGANIZATION_TYPES.LEGAL_ENTITY
        : DIAN_ORGANIZATION_TYPES.NATURAL_PERSON;
    customer_party
      .ele(UBL_NAMESPACES.CBC, 'AdditionalAccountID')
      .txt(person_code);

    // Responsabilidades fiscales del adquiriente (RUT) — se consumen más abajo
    // para `cbc:TaxLevelCode`, no aquí.
    const responsibilities = customer.tax_responsibilities ?? [];

    const party = customer_party.ele(UBL_NAMESPACES.CAC, 'Party');

    // Identificación del adquiriente: el número DESNUDO en el texto, el DV en
    // `@schemeID` y el código DIAN del tipo de documento en `@schemeName`.
    //
    // Esto NO es una preferencia de estilo: `cac:PartyTaxScheme/cbc:CompanyID`
    // es el XPath del que el Anexo Técnico 1.9 §11.2 toma `NumAdq` para el
    // CUFE, y lo exige «sin puntos, sin guiones, SIN dígito de verificación».
    // Emitir aquí `<NIT>-<DV>` mientras `cufe-calculator` hashea el número
    // desnudo hace que la DIAN recompute el hash sobre otro valor y rechace —
    // el mismo modo de fallo que costó un consecutivo autorizado en agosto.
    //
    // Es además la convención que ya usa el EMISOR tres métodos más arriba
    // (`schemeID = issuer.nit_dv`, `schemeName = '31'`, texto = `issuer.nit`).
    // Que las dos partes del mismo documento se identificaran con convenciones
    // opuestas era el defecto.
    const id_value = customer.document_number;
    const id_scheme_dv = customer.verification_digit || '';

    // `cac:PartyIdentification` es obligatorio cuando el adquiriente es
    // consumidor final, es decir cuando `AdditionalAccountID = "2"`. La DIAN
    // rechaza con FAK61 «Si el valor de AdditionalAccountID es igual a "2" y el
    // grupo no es informado» — XPath
    // `//cac:AccountingCustomerParty/cac:Party/cac:PartyIdentification`.
    //
    // Se emite siempre y no solo para el tipo "2": el documento del adquiriente
    // es información legítima en ambos casos, y condicionarlo al tipo de persona
    // reintroduciría la misma clase de defecto en cuanto el tipo se derive mal.
    // En UBL `PartyIdentification` precede a `PartyName` en la secuencia.
    //
    // CIIU — opcional según Anexo 19 (RUT casilla 46, 4 dígitos). Va AQUÍ, antes
    // de `cac:PartyIdentification`: en `PartyType` el esquema ubica
    // `cbc:IndustryClassificationCode` entre los `cbc:` de cabecera, no junto a
    // los grupos fiscales. Emitirlo después de `cac:PartyTaxScheme` —donde
    // estaba— produce un documento con el contenido correcto y el orden
    // inválido, que la DIAN rechaza por esquema; y sólo se manifestaba cuando el
    // cliente tenía CIIU cargado, así que pasaba desapercibido en pruebas.
    if (customer.ciiu_code) {
      party
        .ele(UBL_NAMESPACES.CBC, 'IndustryClassificationCode')
        .txt(customer.ciiu_code);
    }

    party
      .ele(UBL_NAMESPACES.CAC, 'PartyIdentification')
      .ele(UBL_NAMESPACES.CBC, 'ID')
      .att('schemeAgencyID', '195')
      .att('schemeAgencyName', UblCommonBuilder.DIAN_SCHEME_AGENCY_NAME)
      .att('schemeID', id_scheme_dv)
      .att('schemeName', dian_scheme_id)
      .txt(id_value);

    // Party name (commercial name when present, else legal name / first+last).
    party
      .ele(UBL_NAMESPACES.CAC, 'PartyName')
      .ele(UBL_NAMESPACES.CBC, 'Name')
      .txt(
        customer.trade_name ||
          customer.legal_name ||
          `${customer.first_name ?? ''} ${customer.last_name ?? ''}`.trim() ||
          DIAN_FINAL_CONSUMER_NAME,
      );

    // Physical location
    if (customer.city_code) {
      UblCommonBuilder.buildAddress(
        party.ele(UBL_NAMESPACES.CAC, 'PhysicalLocation'),
        customer,
        'adquiriente',
      );
    }

    // Tax scheme
    const tax_scheme = party.ele(UBL_NAMESPACES.CAC, 'PartyTaxScheme');
    tax_scheme
      .ele(UBL_NAMESPACES.CBC, 'RegistrationName')
      .txt(customer.legal_name || '');
    tax_scheme
      .ele(UBL_NAMESPACES.CBC, 'CompanyID')
      .att('schemeAgencyID', '195')
      .att(
        'schemeAgencyName',
        'CO, DIAN (Dirección de Impuestos y Aduanas Nacionales)',
      )
      .att('schemeID', id_scheme_dv)
      .att('schemeName', dian_scheme_id)
      .txt(id_value);

    // cbc:TaxLevelCode — fiscal responsibilities of the acquirer; the
    // @listName is the literal 'No aplica' per the DIAN annex. A consumidor
    // final / natural person reports 'R-99-PN'. ALL responsibilities are
    // concatenated with `;`; `toDianTaxLevelCode` enforces the closed
    // enumeration and falls back to 'R-99-PN' when the list is empty or
    // invalid. This is also where O-23 (agente de retención IVA) flows when
    // the customer's RUT carries it — never through AdditionalAccountID.
    const tax_level = tax_scheme.ele(UBL_NAMESPACES.CBC, 'TaxLevelCode');
    tax_level
      .att('listName', 'No aplica')
      .txt(
        toDianTaxLevelCode(
          responsibilities.length ? responsibilities.join(';') : 'R-99-PN',
        ),
      );

    if (customer.city_code) {
      UblCommonBuilder.buildRegistrationAddress(
        tax_scheme,
        customer,
        'adquiriente',
      );
    }

    const customer_scheme = tax_scheme.ele(UBL_NAMESPACES.CAC, 'TaxScheme');
    customer_scheme.ele(UBL_NAMESPACES.CBC, 'ID').txt(DIAN_TAX_CODES.IVA);
    customer_scheme
      .ele(UBL_NAMESPACES.CBC, 'Name')
      .txt(DIAN_TAX_NAMES[DIAN_TAX_CODES.IVA]);

    // Rama estructural (ver el JSDoc del método). Sólo el lado JURÍDICO se emite
    // aquí: `cac:PartyLegalEntity` ocupa la posición 12 de `PartyType` y
    // `cac:Person` la 14, con `cac:Contact` en medio. Los tres se emiten en ese
    // orden — legal entity, contacto, persona— porque UBL fija la secuencia por
    // `xsd:sequence` y la DIAN rechaza por esquema aunque el contenido sea
    // correcto. Antes se emitía la persona natural antes del contacto, lo que
    // invertía las posiciones 13 y 14 en todo documento con adquiriente persona
    // natural que además tuviera correo o teléfono — es decir, en la práctica,
    // en todos.
    if (resolved_person_type === 'JURIDICA') {
      const legal = party.ele(UBL_NAMESPACES.CAC, 'PartyLegalEntity');
      legal
        .ele(UBL_NAMESPACES.CBC, 'RegistrationName')
        .txt(customer.legal_name || '');
      legal
        .ele(UBL_NAMESPACES.CBC, 'CompanyID')
        .att('schemeAgencyID', '195')
        .att(
          'schemeAgencyName',
          'CO, DIAN (Dirección de Impuestos y Aduanas Nacionales)',
        )
        .att('schemeID', id_scheme_dv)
        .att('schemeName', dian_scheme_id)
        .txt(id_value);
    }

    // Contact — posición 13, entre `cac:PartyLegalEntity` y `cac:Person`.
    if (customer.email || customer.phone) {
      const contact = party.ele(UBL_NAMESPACES.CAC, 'Contact');
      if (customer.phone) {
        contact.ele(UBL_NAMESPACES.CBC, 'Telephone').txt(customer.phone);
      }
      if (customer.email) {
        contact.ele(UBL_NAMESPACES.CBC, 'ElectronicMail').txt(customer.email);
      }
    }

    if (resolved_person_type !== 'JURIDICA') {
      // NATURAL — `cac:Person`. Los dos hermanos estructurales (`cac:Person`,
      // `cac:PartyLegalEntity`) son mutuamente excluyentes en UBL para el rol de
      // adquiriente.
      //
      // Dentro de `PersonType` la secuencia es cbc:ID → cbc:FirstName →
      // cbc:FamilyName. El identificador iba de último y el esquema lo ubica de
      // primero.
      const person = party.ele(UBL_NAMESPACES.CAC, 'Person');
      person
        .ele(UBL_NAMESPACES.CBC, 'ID')
        .att('schemeAgencyID', '195')
        .att(
          'schemeAgencyName',
          'CO, DIAN (Dirección de Impuestos y Aduanas Nacionales)',
        )
        .att('schemeID', id_scheme_dv)
        .att('schemeName', dian_scheme_id)
        .txt(id_value);
      person
        .ele(UBL_NAMESPACES.CBC, 'FirstName')
        .txt(customer.first_name || customer.legal_name || '');
      person
        .ele(UBL_NAMESPACES.CBC, 'FamilyName')
        .txt(customer.last_name || '');
    }
  }

  /**
   * `cac:PhysicalLocation` es un `LocationType`: CONTIENE un `cac:Address`.
   *
   * No sirve para `cac:RegistrationAddress`, que ya ES un `AddressType` — para
   * ese usar `buildRegistrationAddress`. Los dos compartían este método y el
   * envoltorio de más dejaba la dirección fiscal del emisor fuera de la ruta
   * donde la DIAN la busca (ver `buildAddressFields`).
   */
  static buildAddress(
    parent: any,
    address: DianAddressFields,
    role: DianAddressRole,
  ): void {
    UblCommonBuilder.buildAddressFields(
      parent.ele(UBL_NAMESPACES.CAC, 'Address'),
      address,
      role,
    );
  }

  /**
   * `cac:RegistrationAddress` ES un `AddressType`, así que sus campos cuelgan
   * DIRECTAMENTE de él: los XPath del anexo son
   * `…/cac:PartyTaxScheme/cac:RegistrationAddress/cbc:ID` y
   * `…/cac:RegistrationAddress/cbc:CountrySubentityCode`.
   *
   * Antes se reutilizaba `buildAddress`, que interpone un `cac:Address`. El dato
   * viajaba completo pero un nivel más abajo del que la DIAN consulta, así que
   * los tres XPath resolvían a nada y respondía con tres reglas por una sola
   * causa: FAJ28 «no fue informado el conjunto de elementos …» sobre el grupo,
   * más FAJ29 y FAJ32 «este código no corresponde a un valor válido de la
   * lista» sobre el municipio y el departamento que sí estaban informados.
   */
  static buildRegistrationAddress(
    parent: any,
    address: DianAddressFields,
    role: DianAddressRole,
  ): void {
    UblCommonBuilder.buildAddressFields(
      parent.ele(UBL_NAMESPACES.CAC, 'RegistrationAddress'),
      address,
      role,
    );
  }

  /**
   * Código de departamento con el que buscar el municipio POR NOMBRE, probando
   * de más fiable a menos:
   *
   *   1. `department_code` declarado, si es uno de los 33 del anexo;
   *   2. los 2 primeros dígitos del código DANE del municipio — invariante
   *      verificada sobre los 1122 registros del catálogo;
   *   3. el NOMBRE del departamento contra la enumeración cerrada de 33.
   *
   * Nunca inventa: si ninguna de las tres resuelve, devuelve `undefined` y la
   * búsqueda por nombre no se intenta. Buscar el municipio SÓLO por nombre no
   * es una cuarta opción aceptable: hay homónimos en departamentos distintos
   * (varios «San Juan», varios «La Unión») y elegir el primero es exactamente
   * la clase de invención que este cableado existe para eliminar.
   */
  private static resolveDepartmentCode(
    address: DianAddressFields,
  ): string | undefined {
    const declared = (address.department_code || '').trim();
    if (isDianDepartmentCode(declared)) return declared;

    const from_municipality = (address.city_code || '').trim().slice(0, 2);
    if (isDianDepartmentCode(from_municipality)) return from_municipality;

    return findDianDepartmentCodeByName(address.department_name);
  }

  /**
   * Municipio DIAN de una dirección, o `null` cuando la dirección no es
   * colombiana y por tanto no tiene municipio Divipola.
   *
   * ## POR QUÉ LANZA EN VEZ DE RELLENAR
   *
   * Hasta acá el emisor rellenaba `11001 / Bogotá / 110111 / Bogotá / 11` y el
   * adquiriente lo mismo. Ese relleno no produce un documento rechazado: produce
   * uno ACEPTADO que afirma que la operación ocurrió en Bogotá. La DIAN cruza el
   * municipio del emisor y del adquiriente; un documento aceptado con el
   * municipio equivocado no se corrige, se anula con nota crédito y se reemite,
   * gastando dos consecutivos autorizados. Fallar antes de firmar no cuesta
   * ninguno.
   *
   * Es además lo que ya dice el propio catálogo (`dian-geography.ts`): el `null`
   * de `resolveDianMunicipality` significa «no sé en qué municipio está», y el
   * llamador debe decidir explícitamente — «NUNCA rellenar Bogotá en silencio».
   *
   * ## POR QUÉ EL PAÍS DECIDE ANTES QUE EL MUNICIPIO
   *
   * Las listas Divipola sólo aplican a Colombia. El anexo lo condiciona
   * literalmente en FAK30 (tabla de rechazos, pág. 406, línea 20752): «Si IdentificationCode es
   * "CO", CountrySubentity debe corresponder a uno de los valores de la Columna
   * Nombre Municipio de la lista de municipios». Exigir municipio DANE a un
   * adquiriente extranjero bloquearía toda factura de exportación — es el mismo
   * criterio que ya aplica `customer-fiscal-identity.validator.ts`.
   *
   * El emisor no tiene esa salida: FAJ16 (pág. 36-37, línea 1947) exige el literal
   * «CO» en su país y FAJ09 exige que su municipio esté en la lista. Un emisor
   * declarado fuera de Colombia es una configuración imposible, no un caso de
   * negocio, y por eso también lanza.
   */
  private static resolveAddressMunicipality(
    address: DianAddressFields,
    role: DianAddressRole,
    country_code: string,
  ): DianMunicipality | null {
    if (country_code !== DIAN_COLOMBIA_COUNTRY_CODE) {
      if (role === 'adquiriente') return null;
      throw new VendixHttpException(
        ErrorCodes.INVOICING_VALIDATE_001,
        `No se puede emitir: la dirección fiscal del emisor declara el país «${country_code}», y la factura electrónica colombiana exige que el emisor esté en Colombia. Corrige el país en ${DIAN_ADDRESS_SCREEN.emisor}.`,
        { role, country_code },
      );
    }

    const municipality = resolveDianMunicipality({
      city_code: address.city_code,
      city_name: address.city_name,
      department_code: UblCommonBuilder.resolveDepartmentCode(address),
    });
    if (municipality) return municipality;

    const declared_city = (address.city_code || address.city_name || '').trim();
    throw new VendixHttpException(
      ErrorCodes.INVOICING_VALIDATE_001,
      declared_city
        ? `No se puede emitir: «${declared_city}» no corresponde a ningún municipio de la lista DANE que la DIAN valida. Vuelve a seleccionar el municipio en ${DIAN_ADDRESS_SCREEN[role]} para que se cargue con su código DANE.`
        : `No se puede emitir: la dirección ${role === 'emisor' ? 'fiscal del emisor' : 'del adquiriente'} no tiene municipio. Sin él el documento tendría que afirmar un municipio que nadie declaró. Selecciónalo en ${DIAN_ADDRESS_SCREEN[role]}.`,
      {
        role,
        city_code: address.city_code ?? null,
        city_name: address.city_name ?? null,
        department_code: address.department_code ?? null,
        department_name: address.department_name ?? null,
      },
    );
  }

  /**
   * ¿Esta dirección se puede emitir SIN inventar nada? Misma pregunta que
   * `buildAddressFields` responde lanzando, pero contestada con un booleano y
   * sin efectos.
   *
   * Existe para que la cascada de respaldo del adquiriente
   * (`acquirer-address.resolver.ts`) pueda PROBAR un candidato antes de
   * elegirlo. Lo importante es que delega en el MISMO
   * `resolveAddressMunicipality` que usa la emisión: una segunda definición de
   * «dirección utilizable» escrita aparte se desincroniza el primer día, y la
   * forma en que se desincronizaría es la peor posible — la cascada declarando
   * un candidato bueno que el emisor rechaza medio segundo después, ya dentro
   * del `try` que gasta el consecutivo.
   *
   * `true` para una dirección extranjera de adquiriente: el resolvedor devuelve
   * `null` sin lanzar porque los cuatro elementos Divipola son `0..1` en
   * FAK09-FAK12, y omitirlos es válido. Eso es utilizable, no defectuoso.
   */
  static canEmitAddress(
    address: DianAddressFields,
    role: DianAddressRole,
  ): boolean {
    const country_code = (address.country_code || DIAN_COLOMBIA_COUNTRY_CODE)
      .trim()
      .toUpperCase();
    try {
      UblCommonBuilder.resolveAddressMunicipality(address, role, country_code);
      return true;
    } catch {
      return false;
    }
  }

  /**
   * Emite el conjunto de campos de dirección DENTRO del elemento recibido, sin
   * crear envoltorio. Es el cuerpo común de las dos formas de arriba.
   *
   * Los cinco campos geográficos salen TODOS del municipio resuelto, no de lo
   * que traiga la dirección. Es deliberado: FAJ32 y FAK32 no validan cada
   * elemento por separado sino su COHERENCIA («CountrySubentity debe
   * corresponder a…»), y un `city_code` correcto junto a un `department_name`
   * escrito a mano es justo la combinación que la rompe. Tomándolos del
   * catálogo, los cinco son coherentes por construcción y `cbc:CityName` sale
   * verbatim de la columna que la DIAN compara (FAJ10, FAK30).
   */
  private static buildAddressFields(
    addr: any,
    address: DianAddressFields,
    role: DianAddressRole,
  ): void {
    const country_code = (
      address.country_code || DIAN_COLOMBIA_COUNTRY_CODE
    ).trim().toUpperCase();
    const municipality = UblCommonBuilder.resolveAddressMunicipality(
      address,
      role,
      country_code,
    );
    const declared_postal_code = (address.postal_code || '').trim();

    if (municipality) {
      addr.ele(UBL_NAMESPACES.CBC, 'ID').txt(municipality.code);
      addr.ele(UBL_NAMESPACES.CBC, 'CityName').txt(municipality.name);
      // El postal declarado gana al del catálogo: el del catálogo es el urbano
      // de referencia del municipio, útil como respaldo pero menos preciso que
      // el que el usuario informó. FAJ73 es notificación, no rechazo.
      addr
        .ele(UBL_NAMESPACES.CBC, 'PostalZone')
        .txt(declared_postal_code || municipality.postal_code);
      addr
        .ele(UBL_NAMESPACES.CBC, 'CountrySubentity')
        .txt(municipality.department_name);
      addr
        .ele(UBL_NAMESPACES.CBC, 'CountrySubentityCode')
        .txt(municipality.department_code);
    } else {
      // Adquiriente extranjero. Los cuatro elementos Divipola son `0..1` en
      // FAK09-FAK12 y FAK29-FAK32, así que OMITIRLOS es válido; poner un código
      // DANE aquí sería afirmar un municipio colombiano de un cliente que no
      // está en Colombia. Ciudad y región van tal como se declararon: son texto
      // libre fuera de Colombia, y no hay lista contra la cual normalizarlos.
      const city_name = (address.city_name || '').trim();
      if (city_name) {
        addr.ele(UBL_NAMESPACES.CBC, 'CityName').txt(city_name);
      }
      if (declared_postal_code) {
        addr.ele(UBL_NAMESPACES.CBC, 'PostalZone').txt(declared_postal_code);
      }
      const department_name = (address.department_name || '').trim();
      if (department_name) {
        addr.ele(UBL_NAMESPACES.CBC, 'CountrySubentity').txt(department_name);
      }
    }

    addr
      .ele(UBL_NAMESPACES.CAC, 'AddressLine')
      .ele(UBL_NAMESPACES.CBC, 'Line')
      .txt(address.address_line || 'N/A');

    const country = addr.ele(UBL_NAMESPACES.CAC, 'Country');
    country
      .ele(UBL_NAMESPACES.CBC, 'IdentificationCode')
      .txt(country_code);
    // `cbc:Name` es `0..1` (FAJ17, FAK17) y el anexo sólo fija su valor para
    // Colombia: «Debe informar literal "Colombia"». Estaba CABLEADO a
    // «Colombia» pase lo que pase, así que una dirección con
    // `IdentificationCode` extranjero salía nombrando a Colombia — el mismo
    // defecto que el municipio inventado, un nivel más arriba. No hay catálogo
    // de nombres de país en el repo, así que fuera de Colombia se omite en vez
    // de traducir el ISO a un nombre a ojo.
    if (country_code === DIAN_COLOMBIA_COUNTRY_CODE) {
      country
        .ele(UBL_NAMESPACES.CBC, 'Name')
        .att('languageID', 'es')
        .txt('Colombia');
    }
  }

  /**
   * `cac:PaymentExchangeRate` — la DECLARACIÓN de la conversión cuando la
   * operación se pactó en divisa. Sólo se emite si hay declaración.
   *
   * ## EL DOCUMENTO NO CAMBIA DE MONEDA
   *
   * Sigue en COP: `cbc:DocumentCurrencyCode` y todos los `@currencyID` también
   * (Res. DIAN 000042/2020 art. 73; Oficios 901544 y 903436 de 2020; Concepto
   * 1509 de 2024). Este grupo es una declaración de a cuánto se convirtió, no la
   * moneda en que se cobró. Por eso no recibe ni toca ningún importe.
   *
   * ## Reglas del Anexo 1.9 (FAR01-FAR07, pág. 73-74) y sus rechazos
   *
   * · FAR02 `cbc:SourceCurrencyCode`  1..1 — «Rechazo: Si no es igual al COP»
   *   (la tabla de rechazos de la pág. 425 lo enuncia como «Sí no es igual a
   *   cbc:DocumentCurrencyCode», que en un documento colombiano es lo mismo).
   * · FAR04 `cbc:TargetCurrencyCode`  1..1 — la divisa: «si el
   *   cbc:DocumentCurrencyCode es igual a COP debe contener un valor valido de la
   *   lista de tipos de moneda extranjera».
   * · FAR05 `cbc:TargetCurrencyBaseRate` 1..1 — «Base monetaria para la
   *   conversión. Debe ser 1.00». «Rechazo: Si trae valor diferente a 1.00».
   * · FAR06 `cbc:CalculationRate` 1..1 — «Se debe diligenciar con el valor de la
   *   tasa de cambio. Por ejemplo, para COP-USD puede ser el valor de la TRM o
   *   tasa acordada entre las partes». Su rechazo es por AUSENCIA («No es
   *   informado el elemento»), no por valor.
   * · FAR07 `cbc:Date` 1..1 — «Fecha en la que se fijó la tasa de cambio».
   *
   * El ORDEN de los hijos lo fija UBL y un elemento fuera de secuencia rompe la
   * validación XSD antes de que ninguna regla de la DIAN llegue a mirarlo.
   *
   * ## POR QUÉ NO SE EMITE `cbc:SourceCurrencyBaseRate` (FAR03)
   *
   * Porque el anexo se contradice a sí mismo sobre su valor, y el elemento es
   * OPCIONAL (`0..1`) en los tres tipos de documento:
   *
   *   · Tabla de campos de la FACTURA (pág. 74): «Base monetaria de la divisa COP
   *     que se deberá convertir a moneda extranjera, ejemplo: si es USD el valor
   *     a informar es el valor equivalente de un dólar en pesos» —
   *     «Rechazo: Si trae valor IGUAL a 1.00».
   *   · Tabla de RECHAZOS de la misma factura (pág. 425): «Base monetaria de la
   *     divisa extranjera para el cambio. Debe ser 1.00» —
   *     «SourceCurrencyBaseRate trae valor DIFERENTE a 1.00».
   *   · CAR03 en la nota crédito (pág. 297) y DAR03 en la nota débito (pág. 233)
   *     dicen lo mismo que la segunda: «Debe ser 1.00», rechazo si es distinto.
   *
   * Tres de las cuatro tablas exigen 1.00 y una exige que NO sea 1.00. Cualquier
   * valor que se escriba viola una de las dos lecturas, y un rechazo acá quema el
   * consecutivo. OMITIRLO no dispara ninguna de las dos —las dos están redactadas
   * sobre «si TRAE valor»— y no pierde información: la tasa viaja completa en
   * `cbc:CalculationRate`, que es obligatorio y es donde el propio anexo dice que
   * va «el valor de la TRM».
   */
  static buildPaymentExchangeRate(
    parent: any,
    declaration?: DianExchangeRateDeclaration,
  ): void {
    if (!declaration) return;

    const exchange = parent.ele(UBL_NAMESPACES.CAC, 'PaymentExchangeRate');

    // FAR02 — la divisa BASE es siempre el peso: el documento se emite en COP.
    exchange
      .ele(UBL_NAMESPACES.CBC, 'SourceCurrencyCode')
      .txt(UBL_CONSTANTS.DEFAULT_CURRENCY);

    // FAR03 deliberadamente ausente — ver la nota del método.

    // FAR04 — la divisa DESTINO es la pactada. Llega ya normalizada a mayúsculas
    // por el productor (`buildExchangeRateDeclaration`).
    exchange
      .ele(UBL_NAMESPACES.CBC, 'TargetCurrencyCode')
      .txt(declaration.foreign_currency);

    // FAR05 — literal 1.00. No es la tasa: es la unidad de la divisa destino
    // sobre la que se expresa `CalculationRate`.
    exchange
      .ele(UBL_NAMESPACES.CBC, 'TargetCurrencyBaseRate')
      .txt(dianAmount(1));

    // FAR06 — la tasa. `dianAmount` y no el crudo: el productor ya la formateó
    // con la misma función, y volver a pasarla es idempotente, pero deja el
    // formato garantizado si alguna vez llega por otra puerta.
    exchange
      .ele(UBL_NAMESPACES.CBC, 'CalculationRate')
      .txt(dianAmount(declaration.rate));

    // FAR07 — fecha en que se fijó la tasa. Se OMITE cuando no la hay en vez de
    // emitirla vacía: `cbc:Date` es un `xsd:date` y un elemento sin contenido no
    // es una fecha válida, así que el documento fallaría la validación de esquema
    // —un fallo duro, antes de cualquier regla— en lugar de arrastrar sólo la
    // ausencia de FAR07.
    if (declaration.date) {
      exchange.ele(UBL_NAMESPACES.CBC, 'Date').txt(declaration.date);
    }
  }

  /**
   * `cbc:Percent` de un tributo, con el saneamiento que depende del ESQUEMA.
   *
   * El ICA se guarda POR MIL —un 7 significa 7 ‰— y el XML declara porcentajes,
   * así que se divide por 10 y se conservan 4 decimales: 7 ‰ es 0,7000 %, y dos
   * decimales lo aplanarían. Cualquier otro esquema usa el contrato de 2
   * decimales de la DIAN.
   *
   * Está extraído para que la cabecera y las líneas apliquen LA MISMA regla. Con
   * dos copias, una tarifa de ICA saldría diez veces mayor en un sitio que en el
   * otro y el documento se contradiría a sí mismo.
   */
  private static resolveSchemePercent(
    scheme_code: string,
    tax_rate: string,
  ): string {
    return scheme_code === DIAN_TAX_CODES.ICA
      ? toDecimal(tax_rate).dividedBy(10).toFixed(4)
      : dianRate(tax_rate);
  }

  /**
   * Agrupa filas de tributo por `(esquema, tarifa)` — LA ÚNICA copia.
   *
   * ## Por qué el anexo exige las DOS claves, y no una
   *
   * Los dos ejes son reglas distintas y las dos son de rechazo:
   *
   * · **Por ESQUEMA** — «Un bloque para cada código de tributo» (FAX01 pág. 95
   *   para la línea, FAT01 pág. 80 para las retenciones). Dos tributos distintos
   *   NO caben en el mismo bloque.
   * · **Por TARIFA dentro del esquema** — «si hay más de una tarifa del mismo
   *   impuesto se deben informar en `TaxSubtotal` diferentes dentro del mismo
   *   `TaxTotal`» (FAS01a pág. 428), «debe ser informado un grupo de estos para
   *   cada tarifa» (FAS04 pág. 429, FAX04 pág. 96, FAT04 pág. 83). Fundir dos
   *   tarifas en un subtotal publica la tarifa de UNA de ellas sobre la base de
   *   las DOS, y entonces `base × tarifa` deja de dar el importe declarado — que
   *   es literalmente el rechazo de FAS07 (pág. 78-79 / 430).
   *
   * ## Por qué está extraído
   *
   * Porque la misma agrupación la necesitan la cabecera (`buildTaxTotals`), la
   * línea (`buildLineTaxTotal`) y las retenciones (`buildWithholdingTaxTotal`).
   * Cuando sólo las retenciones la tenían, la cabecera agrupaba por esquema a
   * secas y emitía un IVA 19 % + IVA 5 % como un subtotal al 19 % sobre la suma
   * de las dos bases. La asimetría vivía DENTRO de un archivo, no entre
   * archivos: una segunda copia es exactamente cómo vuelve.
   *
   * `resolve` devolviendo `null` DESCARTA la fila —lo usa la retención cuyo tipo
   * no tiene código conocido: el documento sale sin ella, que es recuperable, en
   * vez de salir con un esquema inventado, que es rechazo y consecutivo quemado.
   *
   * El orden de iteración de los `Map` es el de PRIMERA APARICIÓN, así que el
   * XML conserva el orden en que el productor mandó los tributos, y las tarifas
   * del mismo esquema salen contiguas.
   */
  private static groupTaxRowsBySchemeAndRate<T>(
    rows: readonly T[],
    resolve: (row: T) => DianTaxGrouping | null,
  ): Map<string, Map<string, DianTaxRateBucket>> {
    const by_scheme = new Map<string, Map<string, DianTaxRateBucket>>();

    for (const row of rows) {
      const grouping = resolve(row);
      if (!grouping) continue;

      const by_rate =
        by_scheme.get(grouping.code) ?? new Map<string, DianTaxRateBucket>();
      const bucket =
        by_rate.get(grouping.percent) ??
        ({ base: [], amount: [] } as DianTaxRateBucket);

      bucket.base.push(grouping.base);
      bucket.amount.push(grouping.amount);

      by_rate.set(grouping.percent, bucket);
      by_scheme.set(grouping.code, by_rate);
    }

    return by_scheme;
  }

  /** Todos los cubos de una agrupación, en orden de documento. */
  private static flattenTaxBuckets(
    by_scheme: Map<string, Map<string, DianTaxRateBucket>>,
  ): DianTaxRateBucket[] {
    return [...by_scheme.values()].flatMap((by_rate) => [...by_rate.values()]);
  }

  /**
   * Emite UN `cac:TaxSubtotal` de un cubo `(esquema, tarifa)`.
   *
   * Comparte forma la cabecera, la línea y —salvo el nombre del elemento padre,
   * que decide el llamador— la retención: el par `(ID, Name)` sale SIEMPRE de la
   * tabla del repositorio, nunca del nombre libre que el comerciante escribió,
   * porque FAS08/FAX07/FAT12-13 comparan contra la tabla 13.2.2.
   */
  private static emitTaxSubtotal(
    parent: any,
    code: string,
    percent: string,
    bucket: DianTaxRateBucket,
    currency: string,
  ): void {
    const subtotal = parent.ele(UBL_NAMESPACES.CAC, 'TaxSubtotal');
    subtotal
      .ele(UBL_NAMESPACES.CBC, 'TaxableAmount')
      .att('currencyID', currency)
      .txt(dianSum(bucket.base));
    subtotal
      .ele(UBL_NAMESPACES.CBC, 'TaxAmount')
      .att('currencyID', currency)
      .txt(dianSum(bucket.amount));

    const category = subtotal.ele(UBL_NAMESPACES.CAC, 'TaxCategory');
    category.ele(UBL_NAMESPACES.CBC, 'Percent').txt(percent);

    const scheme = category.ele(UBL_NAMESPACES.CAC, 'TaxScheme');
    scheme.ele(UBL_NAMESPACES.CBC, 'ID').txt(code);
    scheme.ele(UBL_NAMESPACES.CBC, 'Name').txt(DIAN_TAX_NAMES[code] || code);
  }

  /**
   * `cac:TaxTotal` de CABECERA — un `cac:TaxSubtotal` por (esquema, tarifa).
   *
   * ## La cardinalidad de los SUBTOTALES: por tarifa, no por esquema
   *
   * FAS01a (pág. 428): «si hay más de una tarifa del mismo impuesto se deben
   * informar en `TaxSubtotal` diferentes dentro del mismo `TaxTotal`». FAS04
   * (pág. 78 / 429): «debe ser informado un grupo de estos para cada tarifa». Y
   * FAS07 (pág. 78-79 / 430) lo hace de rechazo definiendo el nodo como «el
   * resultado del porcentaje aplicado sobre la base imponible»: un subtotal que
   * publica UNA tarifa sobre la suma de bases de DOS afirma una identidad que él
   * mismo no cumple. La agrupación la resuelve `groupTaxRowsBySchemeAndRate`,
   * compartida con la línea y las retenciones.
   *
   * `cbc:TaxAmount` del grupo se computa DESDE los cubos ya truncados, no desde
   * la Σ cruda de las filas: FAS02 (pág. 77 / 428) exige que sea la Σ de los
   * subtotales, y con los subtotales partidos las dos cifras pueden separarse un
   * céntimo (ver `DianTaxRateBucket`).
   *
   * ## FAS01 DECIDIDA: UN grupo de cabecera con TODOS los esquemas (F.7)
   *
   * Este método abre UN solo `cac:TaxTotal` aunque el documento traiga varios
   * tributos, y esa es la forma que el plan (F.7) dejó decidida el 2026-08-25,
   * no una divergencia pendiente: el rechazo ENUMERADO de FAS01 (pág. 76)
   * castiga la forma contraria — «si existe más de un grupo con el mismo valor
   * en …TaxScheme/cbc:ID» — y FAS01b (pág. 428) exige «existe solo un grupo con
   * información de totales para un mismo tributo». El grupo único multi-esquema
   * cumple las dos lecturas; los esquemas viajan como `cac:TaxSubtotal`.
   *
   * ## Política de redondeo del grupo (decisión escrita, F.7)
   *
   * CADA subtotal se cuantifica al centavo con `dianSum` —el mismo cuantizador
   * de todo el pipeline— y el `cbc:TaxAmount` del grupo es la SUMA EXACTA de
   * los subtotales YA cuantificados. NUNCA se recalcula el total desde las
   * filas crudas: agrupar multiplica las llamadas de truncado y un recálculo
   * aparte puede separar el total de sus propios subtotales en un céntimo
   * (KG-17), mientras que la identidad que la DIAN ejecuta (FAS02) compara
   * contra los subtotales. Cumplirla POR CONSTRUCCIÓN es lo único que no
   * depende de la suerte.
   *
   * ## Un documento SIN tributos no informa el grupo
   *
   * FAS01b rechaza «cuando una factura no tiene impuestos pero aparece el nodo
   * `<cac:TaxTotal>`», y enumera entre sus causas «se reportan ítems excluidos de
   * impuestos, pero se detalla una totalización de impuestos con tarifa igual a
   * 0 %». Sin la guarda, un arreglo vacío emitía el elemento con `TaxAmount` en
   * 0,00 y CERO `cac:TaxSubtotal` dentro: un grupo de totales que no declara
   * ninguna base. La DIAN recompone la base gravable desde los subtotales, no
   * encuentra ninguno, y lo contrasta contra la suma de las líneas → rechazo.
   *
   * La señal es la LISTA VACÍA, no el importe en cero, porque las dos figuras
   * jurídicas se distinguen justo ahí:
   *
   *   · EXCLUIDO (art. 476 ET) — no sujeto. NO informa tributo en ninguna parte
   *     y no aporta base gravable. Llega como `taxes: []`.
   *   · EXENTO (art. 477 ET) — gravado a tarifa 0 %. SÍ informa su
   *     `cac:TaxSubtotal` con `cbc:Percent` en 0,00 y SÍ aporta base. Llega como
   *     una fila con `tax_amount: '0.00'`, que esta guarda no toca.
   *
   * Es la misma guarda que `buildWithholdingTaxTotal` ya tenía. La asimetría
   * entre las dos funciones hermanas era el defecto: la línea sabía callarse
   * (`UblDocumentLine.omit_tax_total`, FAX01) y la cabecera no.
   */
  static buildTaxTotals(
    parent: any,
    taxes: ProviderInvoiceTax[],
    currency: string,
  ): void {
    if (!taxes?.length) return;

    // UN `cac:TaxSubtotal` por (esquema, tarifa) — la MISMA agrupación que usan
    // la línea y las retenciones, extraída para que no pueda haber dos criterios.
    // Antes se agrupaba SÓLO por esquema y `cbc:Percent` salía de la PRIMERA fila
    // del grupo: un IVA 19 % + IVA 5 % se emitía como un subtotal al 19,00 %
    // sobre la suma de las dos bases (2.000,00) con el importe de las dos
    // (240,00). `base × tarifa` daba 380,00 y el XML se contradecía a sí mismo,
    // que es el rechazo de FAS07 (pág. 78-79 / 430) y lo que FAS04 (pág. 78 /
    // 429) y FAS01a (pág. 428) prohíben.
    //
    // UN solo `cac:TaxTotal` de cabecera con TODOS los esquemas como subtotales:
    // es la forma DECIDIDA de FAS01 (ver el docblock), no una divergencia. El
    // rechazo enumerado castiga grupos DUPLICADOS del mismo ID, no el grupo
    // único multi-esquema; FAS02 abajo garantiza el total contra los subtotales.
    const by_scheme = UblCommonBuilder.groupTaxRowsBySchemeAndRate(
      taxes,
      (tax) => {
        // tax_type-aware: IVA→01, INC→04, ICA→03.
        const code = UblCommonBuilder.resolveTaxCodeFromTax(tax);
        return {
          code,
          // ICA rates are stored in "per mil" (‰) — convert to percentage for
          // UBL. ICA keeps 4 decimals because a 7‰ rate is 0.7000 %, which 2
          // decimals would flatten; every other scheme uses the DIAN 2-decimal
          // contract. `resolveSchemePercent` es la única copia de esa regla, y la
          // tarifa YA FORMATEADA es la clave del cubo: dos filas que van a
          // publicar el mismo `cbc:Percent` son la misma tarifa.
          percent: UblCommonBuilder.resolveSchemePercent(code, tax.tax_rate),
          base: tax.taxable_amount,
          amount: tax.tax_amount,
        };
      },
    );

    const tax_total = parent.ele(UBL_NAMESPACES.CAC, 'TaxTotal');

    // FAS02 (pág. 77 / 428) — el importe del grupo es la Σ DE SUS SUBTOTALES ya
    // truncados, NO la Σ cruda de las filas. Con los subtotales partidos por
    // tarifa las dos cifras pueden separarse un céntimo (`dianSum` trunca una vez
    // por llamada, y agrupar multiplica las llamadas), y la que la DIAN ejecuta
    // es la de los subtotales: se computa desde los cubos para que la identidad
    // se cumpla POR CONSTRUCCIÓN y no por coincidencia.
    tax_total
      .ele(UBL_NAMESPACES.CBC, 'TaxAmount')
      .att('currencyID', currency)
      .txt(
        dianSum(
          UblCommonBuilder.flattenTaxBuckets(by_scheme).map((bucket) =>
            dianSum(bucket.amount),
          ),
        ),
      );

    for (const [code, by_rate] of by_scheme) {
      for (const [percent, bucket] of by_rate) {
        UblCommonBuilder.emitTaxSubtotal(
          tax_total,
          code,
          percent,
          bucket,
          currency,
        );
      }
    }
  }

  /**
   * `cac:WithholdingTaxTotal` — las retenciones que el documento DECLARA.
   *
   * ## ⚠️ LAS RETENCIONES NO RESTAN DE `cbc:PayableAmount`
   *
   * Anexo Técnico 1.9 §11.9.1 (pág. 677), «Método incluye las retenciones en la
   * fuente y las autorretenciones»:
   *
   *   «Observación 21 de junio de 2019: Se informa que los cálculos aplicados por
   *   la validación previa de facturas electrónicas de la DIAN no incluyen en el
   *   fragmento <cac:LegalMonetaryTotal/> operaciones con el elemento
   *   <cac:WithholdingTaxTotal/>.»
   *
   * O sea: la DIAN valida `base + tributos = total` SIN mirar este grupo. Restar
   * lo retenido del `cbc:PayableAmount` descuadra esa identidad y el documento se
   * rechaza por aritmética. Vale para los tres roles, autorretención incluida.
   * Por eso esta función SÓLO emite el grupo y no toca ningún total: no recibe
   * `LegalMonetaryTotal` ni nada de lo que él calcula.
   *
   * ## Cómo se agrupa, y por qué así
   *
   * · **Un `cac:WithholdingTaxTotal` POR ESQUEMA** (FAT01, pág. 80): «Si
   *   informado debe contener: Un bloque para cada código de tributo. Rechazo: Si
   *   existe más de un grupo /Invoice/WhitHoldingTaxl con el mismo valor en el
   *   elemento /Invoice/WithholdingTaxTotal/TaxSubtotal/cac:TaxCategory/
   *   cac:TaxScheme/cbc:ID». Emitir una retefuente de honorarios y otra de
   *   servicios como dos grupos separados es, literalmente, un rechazo.
   * · **Un `cac:TaxSubtotal` POR TARIFA** dentro del grupo (FAT04, pág. 82):
   *   «Debe ser informado un grupo de estos para cada tarifa». Dos conceptos de
   *   la misma tarifa se suman en un solo subtotal, lo que además mantiene exacta
   *   la aritmética que valida FAT07 (`TaxAmount = TaxableAmount × Percent`):
   *   sumar bases de la misma tarifa da la suma de los importes.
   * · `cbc:TaxAmount` del grupo = Σ de sus subtotales (FAT02, pág. 81-82):
   *   «Rechazo: Si ../cac:WithholdingTaxTotal/cbc:TaxAmount <> sumatoria de todas
   *   las ocurrencias de ../cac:WithholdingTaxTotal/TaxSubtotal/cbc:TaxAmount».
   *
   * ## La tarifa NO se divide por 10 aunque sea reteICA
   *
   * El «por mil» es de `invoice_taxes.tax_rate`, la tarifa del TRIBUTO ICA.
   * `withholding_concepts.rate` es una fracción normal, y quien la trae acá ya la
   * multiplicó por 100 (`toProviderWithholdings`), así que llega en porcentaje.
   * Aplicarle el saneamiento del ICA la dividiría por diez.
   *
   * ## Posición en el documento
   *
   * Entre `cac:TaxTotal` y el grupo de totales, que es donde la secuencia de
   * `InvoiceType` lo pone (FAT01 … FAT13, luego FAU01 `cac:LegalMonetaryTotal`).
   * Los llamadores ya lo invocan ahí.
   */
  static buildWithholdingTaxTotal(
    parent: any,
    withholdings: ProviderInvoiceWithholding[] | undefined,
    currency: string,
  ): void {
    if (!withholdings?.length) return;

    // MISMA agrupación `(esquema, tarifa)` que la cabecera y la línea. Era la
    // única función del archivo que la tenía bien, y ahora es la ÚNICA copia:
    // vive en `groupTaxRowsBySchemeAndRate`, no acá.
    const by_scheme = UblCommonBuilder.groupTaxRowsBySchemeAndRate(
      withholdings,
      (withholding) => {
        const code =
          DIAN_WITHHOLDING_SCHEME_BY_TYPE[withholding.withholding_type];
        // Un tipo que no esté en el mapa no tiene código de tributo conocido, y
        // adivinarlo sería declarar una figura tributaria que nadie verificó. Se
        // descarta: el documento sale sin esa retención —recuperable— en vez de
        // salir con un esquema inventado, que es rechazo y consecutivo quemado.
        if (!code) return null;
        // `dianRate` y NO `resolveSchemePercent`: la tarifa de la retención llega
        // ya en porcentaje (ver la nota de arriba sobre el por-mil), así que el
        // saneamiento del ICA la dividiría por diez.
        return {
          code,
          percent: dianRate(withholding.rate),
          base: withholding.base,
          amount: withholding.amount,
        };
      },
    );

    for (const [code, by_rate] of by_scheme) {
      const total = parent.ele(UBL_NAMESPACES.CAC, 'WithholdingTaxTotal');

      // FAT02 — el importe del grupo es la suma de sus subtotales, no el total
      // retenido del documento: cada esquema publica el suyo. Se computa desde
      // los MISMOS cubos que emiten los subtotales, así que la identidad se
      // cumple por construcción incluso cuando un cubo trunca un céntimo.
      total
        .ele(UBL_NAMESPACES.CBC, 'TaxAmount')
        .att('currencyID', currency)
        .txt(dianSum([...by_rate.values()].map((row) => dianSum(row.amount))));

      // Mismo par (ID, Name) que exige FAT12/FAT13, y la misma emisión de
      // subtotal que la cabecera: el identificador y el nombre tienen que ser los
      // de la tabla 13.2.2 de la DIAN, y los dos salen de la misma tabla del
      // repositorio para que no puedan divergir.
      for (const [percent, bucket] of by_rate) {
        UblCommonBuilder.emitTaxSubtotal(
          total,
          code,
          percent,
          bucket,
          currency,
        );
      }
    }
  }

  /**
   * Document-level discount not already represented on the lines.
   *
   * Vendix originates discounts per line (`order_items.discount_amount`), so in
   * the normal case this is zero. It is non-zero only when the document carries a
   * footer discount that no line accounts for — e.g. a conditional discount
   * (Anexo §13.2.8.8) — and that is the only case where a document-level
   * `cac:AllowanceCharge` is legitimate.
   */
  private static documentDiscount(data: {
    discount_amount: string;
    items: ProviderInvoiceItem[];
  }): string {
    const line_discounts = dianSum(
      data.items.map((item) => item.discount_amount),
    );
    const remainder = toDecimal(data.discount_amount).minus(
      toDecimal(line_discounts),
    );
    // A negative remainder means the lines already discount more than the
    // document total claims — never emit a negative allowance, which the DIAN
    // rejects; the line-level truth wins.
    return remainder.isNegative() ? dianAmount(0) : dianAmount(remainder);
  }

  /**
   * Emits the document-level `cac:AllowanceCharge` backing
   * `AllowanceTotalAmount`, and only when there is something to back.
   *
   * The Anexo requires every document allowance to be supported by an
   * `AllowanceCharge`; emitting `AllowanceTotalAmount` alone (which is what this
   * codebase used to do) leaves an unsupported allowance. Must be called BEFORE
   * `buildTaxTotals` because UBL fixes the element order
   * `PaymentTerms → AllowanceCharge → TaxTotal → LegalMonetaryTotal`.
   */
  static buildDocumentAllowanceCharge(
    parent: any,
    data: { discount_amount: string; items: ProviderInvoiceItem[] },
    currency: string,
  ): void {
    const discount = UblCommonBuilder.documentDiscount(data);
    if (toDecimal(discount).isZero()) return;

    const line_extension = dianLineExtensionTotal(data.items);
    const allowance = parent.ele(UBL_NAMESPACES.CAC, 'AllowanceCharge');
    allowance.ele(UBL_NAMESPACES.CBC, 'ID').txt('1');
    // false = allowance (discount); true would make it a charge.
    allowance.ele(UBL_NAMESPACES.CBC, 'ChargeIndicator').txt('false');
    allowance
      .ele(UBL_NAMESPACES.CBC, 'AllowanceChargeReason')
      .txt('Descuento a nivel de documento');
    allowance
      .ele(UBL_NAMESPACES.CBC, 'Amount')
      .att('currencyID', currency)
      .txt(discount);
    allowance
      .ele(UBL_NAMESPACES.CBC, 'BaseAmount')
      .att('currencyID', currency)
      .txt(line_extension);
  }

  /**
   * Builds `cac:PaymentMeans`, the payment group the DIAN requires on every
   * document with cardinality `1..N`.
   *
   * WHY THIS IS SHARED AND NOT INLINE
   *
   * The invoice, the equivalent document and the support document each grew
   * their own inline copy of this block, and the two notes grew NONE. The DIAN
   * rejected all 20 notes of the habilitación set for exactly that:
   *
   *   CAN01  «Rechazo si grupo no informado»  /CreditNote/cac:PaymentMeans
   *   DAN01  «Rechazo si grupo no informado»  /DebitNote/cac:PaymentMeans
   *
   * A group that four document types need is not a per-builder detail. The two
   * notes consume it from here so a fifth omission cannot happen the same way.
   *
   * The three existing inline copies are deliberately NOT migrated in this
   * change: they are the code path the DIAN accepted 30 times during the
   * habilitación, and this ships against a live habilitación that must not
   * regress. Migrating them is a separate, independently verifiable change.
   *
   * UBL fixes the order `Delivery → DeliveryTerms → PaymentMeans →
   * PaymentTerms → AllowanceCharge → TaxTotal → (monetary total)`, so callers
   * must invoke this AFTER the parties and BEFORE the tax totals.
   *
   * Field defaults follow the same convention the invoice builder already uses:
   * `payment_form` '1' = contado, `payment_means` '10' = efectivo. `DAN04`
   * makes `PaymentDueDate` mandatory on credit sales, so it is always emitted,
   * falling back to the issue date when no due date exists.
   */
  static buildPaymentMeans(
    parent: any,
    data: {
      payment_form?: string;
      payment_means?: string;
      due_date?: string;
      issue_date: string;
    },
  ): void {
    const payment_means = parent.ele(UBL_NAMESPACES.CAC, 'PaymentMeans');
    payment_means.ele(UBL_NAMESPACES.CBC, 'ID').txt(data.payment_form || '1');
    payment_means
      .ele(UBL_NAMESPACES.CBC, 'PaymentMeansCode')
      .txt(data.payment_means || '10');
    payment_means
      .ele(UBL_NAMESPACES.CBC, 'PaymentDueDate')
      .txt(data.due_date || data.issue_date);
  }

  /**
   * Builds the document's monetary-total group so it satisfies the DIAN
   * arithmetic rules.
   *
   * The defect this replaces: the header published the GROSS subtotal as
   * `LineExtensionAmount` while every line published its NET amount
   * (`qty × price − discount`), so any invoice carrying a discount broke rule
   * `FAU02` (header ≠ Σ lines) and was rejected. `TaxExclusiveAmount` carried the
   * same gross value even though the taxable base is net, and
   * `AllowanceTotalAmount` restated a discount the lines had already applied.
   *
   * Invariants enforced here:
   * - `LineExtensionAmount` = Σ line `LineExtensionAmount` (same function, so
   *   the two cannot drift) — rule `FAU02`.
   * - `TaxExclusiveAmount` = base gravable REALMENTE DECLARADA — rule `FAU04`,
   *   ver abajo.
   * - `TaxInclusiveAmount` = `LineExtensionAmount + data.tax_amount` — rule
   *   `FAU06`. ⚠️ `data.tax_amount` es un ESCALAR y los grupos de tributos de
   *   cabecera los publica `buildTaxTotals` desde `data.taxes`, un ARREGLO: son
   *   dos entradas independientes del mismo hecho y nada acá las obliga a
   *   coincidir. FAU06 suma `//cac:TaxTotal[not(ancestor::cac:InvoiceLine)]`, es
   *   decir el arreglo, así que un escalar que no sea su Σ es rechazo. Lo
   *   comprueba `DianTotalsValidator` sobre el XML armado, que es el único sitio
   *   donde las dos entradas ya se ven juntas.
   * - `PayableAmount` = `TaxInclusiveAmount − AllowanceTotalAmount + ChargeTotalAmount`
   *   (el cargo total no se emite hoy, así que vale 0,00), computed rather than
   *   copied, so the identity holds by construction — rule `FAU14`. El ANTICIPO
   *   no se resta: el anexo liga `$PrepaidAmount` y no lo usa.
   *
   * ## `TaxExclusiveAmount` NO es el bruto de líneas
   *
   * FAU04 no compara contra el subtotal: compara contra la SUMA DE LAS BASES QUE
   * LAS LÍNEAS DECLARAN.
   *
   *   round(//cbc:TaxExclusiveAmount)
   *     == round(sum(//cac:InvoiceLine/cac:TaxTotal/cac:TaxSubtotal/cbc:TaxableAmount))
   *
   * Una línea que OMITE su grupo de tributos (`omit_tax_total`, FAX01: ítems
   * excluidos, régimen simple grupo I, conceptos de AIU fuera de la base
   * gravable) no aporta ningún `cbc:TaxableAmount`, así que tampoco puede sumar
   * acá. Publicar el bruto mientras las líneas callan es exactamente el descuadre
   * que la DIAN reporta como «Base Imponible es distinto a la suma de los valores
   * de las bases imponibles de todas líneas de detalle».
   *
   * Con TODAS las líneas gravadas el filtro no descarta ninguna y el valor es
   * idéntico al anterior — por eso este cambio es un no-op sobre los documentos
   * que hoy se aceptan. Sólo cambia para el documento 100 % excluido (pasa a
   * 0,00) y para el mixto (pasa a declarar sólo la porción gravada).
   *
   * `LineExtensionAmount` sigue siendo el bruto de TODAS las líneas: la identidad
   * FAU14 (cabecera = Σ líneas) es otra regla y no se toca.
   *
   * Shared by invoice, credit note, debit note and support document — the block
   * was duplicated four times and drifted independently.
   *
   * THE WRAPPER ELEMENT IS NOT THE SAME FOR EVERY DOCUMENT. UBL 2.1 names the
   * debit note's group `cac:RequestedMonetaryTotal`; every other document uses
   * `cac:LegalMonetaryTotal`. It is not a synonym and not a mirror — the DIAN
   * publishes a different XPath per document type (Anexo Técnico 1.9 §11.4.6):
   *
   *   CAU01  /CreditNote/cac:LegalMonetaryTotal
   *   DAU01  /DebitNote/cac:RequestedMonetaryTotal        <- 1..1, obligatorio
   *
   * Emitting `LegalMonetaryTotal` inside a `DebitNote` therefore publishes the
   * amounts where nothing reads them. That single wrong name produced FOUR
   * rejections at once on all 10 debit notes of the set, because the CUDE and
   * the arithmetic rules both resolve through it:
   *
   *   DAD06  CUDE mal calculado — ValFac and ValTot resolve to
   *          /DebitNote/cac:RequestedMonetaryTotal/{LineExtensionAmount,PayableAmount};
   *          absent, the DIAN hashes empty strings and gets another key
   *   DAU02  bruto no cuadra con las líneas
   *   DAU04  base imponible no cuadra
   *   DAU06  bruto + tributos no cuadra
   *
   * The arithmetic was never wrong: it is the same function that backed the 30
   * accepted invoices. Only the envelope was misnamed.
   */
  /**
   * Base imponible que UNA línea aporta a la cabecera — exactamente la Σ de los
   * `cbc:TaxableAmount` que esa línea va a emitir. `null` ⇒ la línea NO emite
   * `cac:TaxTotal`, así que no aporta nada.
   *
   * ## Por qué existe
   *
   * FAU04 compara `round(//cbc:TaxExclusiveAmount)` contra
   * `round(sum(<línea>/cac:TaxTotal/cac:TaxSubtotal/cbc:TaxableAmount))`, y cada
   * lado se calculaba con un criterio propio:
   *
   * · la CABECERA admitía la línea con UNA condición — `!omit_tax_total`;
   * · la LÍNEA emitía su grupo con DOS — `!omit_tax_total` **y** tener tributo
   *   propio o de cabecera del que heredar (ver `buildLineTaxTotal`).
   *
   * Un documento sin NINGÚN tributo cae en la grieta: es el caso natural de una
   * factura 100 % excluida que no marca la bandera —un tenant que sólo vende
   * excluido no tiene por qué marcarla, porque no hay régimen AIU de por medio—.
   * Ninguna línea emite subtotal, la suma de líneas es 0,00, y la cabecera
   * declara el bruto entero. La DIAN rechaza por FAU04 antes de firmar, así que
   * no se quema consecutivo, pero la emisión queda bloqueada sin diagnóstico en
   * el emisor.
   *
   * Derivar los DOS lados de esta función hace ese desacuerdo irrepresentable.
   *
   * ## Sobre el doble conteo
   *
   * Cuando una línea trae dos tributos sobre la MISMA base, la Σ de subtotales
   * cuenta esa base dos veces. Se replica TAL CUAL, a propósito: la regla suma
   * NODOS `cbc:TaxableAmount`, no bases distintas. El objetivo de esta función es
   * igualar lo que la DIAN calcula sobre el XML transmitido, no lo que sería
   * contablemente más justo — si la cabecera "corrigiera" el doble conteo, el
   * documento sería rechazado por declarar menos base de la que suman sus líneas.
   */
  static lineTaxableContribution(
    item: ProviderInvoiceItem,
    header_taxes: ProviderInvoiceTax[],
  ): string | null {
    const line = item as UblDocumentLine;
    if (line.omit_tax_total) return null;

    const line_taxes = line.taxes ?? [];

    // MISMA guarda que `buildLineTaxTotal`: sin tributo propio NI de cabecera del
    // que heredar, la línea calla, y una línea callada no tiene ningún
    // `cbc:TaxableAmount` que sumar.
    if (line_taxes.length === 0 && header_taxes.length === 0) return null;

    // Sin desglose propio la línea emite UN subtotal cuya base es su importe.
    if (line_taxes.length === 0) return dianLineExtension(line);

    // Con desglose, un `cac:TaxSubtotal` por tributo, cada uno con SU base.
    return dianSum(line_taxes.map((tax) => tax.taxable_amount));
  }

  static buildMonetaryTotal(
    parent: any,
    data: UblMonetaryTotalInput,
    currency: string,
    /**
     * UBL name of the group. Defaults to `LegalMonetaryTotal`, which is correct
     * for every document type EXCEPT the debit note.
     */
    element_name:
      | 'LegalMonetaryTotal'
      | 'RequestedMonetaryTotal' = 'LegalMonetaryTotal',
  ): void {
    const line_extension = dianLineExtensionTotal(data.items);

    // FAU04 — la base de la cabecera es la Σ EXACTA de los `cbc:TaxableAmount`
    // que van a emitir las líneas, derivada de la MISMA función que decide qué
    // emite cada línea. Antes cada lado tenía su propio criterio y podían
    // discrepar; ver `lineTaxableContribution`.
    const taxable_base = dianSum(
      data.items
        .map((item) =>
          UblCommonBuilder.lineTaxableContribution(item, data.taxes ?? []),
        )
        .filter((amount): amount is string => amount !== null),
    );

    const document_discount = UblCommonBuilder.documentDiscount(data);
    const tax_inclusive = dianArithmetic([
      { value: line_extension, sign: 1 },
      { value: data.tax_amount, sign: 1 },
    ]);
    const payable = dianArithmetic([
      { value: tax_inclusive, sign: 1 },
      { value: document_discount, sign: -1 },
    ]);

    const monetary = parent.ele(UBL_NAMESPACES.CAC, element_name);
    monetary
      .ele(UBL_NAMESPACES.CBC, 'LineExtensionAmount')
      .att('currencyID', currency)
      .txt(line_extension);
    monetary
      .ele(UBL_NAMESPACES.CBC, 'TaxExclusiveAmount')
      .att('currencyID', currency)
      .txt(taxable_base);
    monetary
      .ele(UBL_NAMESPACES.CBC, 'TaxInclusiveAmount')
      .att('currencyID', currency)
      .txt(tax_inclusive);
    monetary
      .ele(UBL_NAMESPACES.CBC, 'AllowanceTotalAmount')
      .att('currencyID', currency)
      .txt(document_discount);
    monetary
      .ele(UBL_NAMESPACES.CBC, 'PayableAmount')
      .att('currencyID', currency)
      .txt(payable);
  }

  /**
   * `cac:LegalMonetaryTotal` — the group name every document uses EXCEPT the
   * debit note. Kept as the named entry point so the four callers that are
   * legitimately `LegalMonetaryTotal` (invoice, credit note, equivalent document,
   * support document) read as a statement of which group they emit rather than
   * as a default they happen to inherit.
   */
  static buildLegalMonetaryTotal(
    parent: any,
    data: UblMonetaryTotalInput,
    currency: string,
  ): void {
    UblCommonBuilder.buildMonetaryTotal(
      parent,
      data,
      currency,
      'LegalMonetaryTotal',
    );
  }

  /**
   * `cac:RequestedMonetaryTotal` — the debit note's group, and ONLY the debit
   * note's. See `buildMonetaryTotal` for why using the wrong one costs four
   * rejection rules (DAD06, DAU02, DAU04, DAU06) at once.
   */
  static buildRequestedMonetaryTotal(
    parent: any,
    data: UblMonetaryTotalInput,
    currency: string,
  ): void {
    UblCommonBuilder.buildMonetaryTotal(
      parent,
      data,
      currency,
      'RequestedMonetaryTotal',
    );
  }

  /**
   * Builds invoice line items.
   */
  static buildInvoiceLines(
    parent: any,
    items: UblDocumentLine[],
    taxes: ProviderInvoiceTax[],
    currency: string,
  ): void {
    UblCommonBuilder.buildDocumentLines(parent, items, taxes, currency, {
      line_element: 'InvoiceLine',
      quantity_element: 'InvoicedQuantity',
    });
  }

  /**
   * Emite las líneas de un documento —cantidad, descuento, `cac:TaxTotal` de
   * línea, ítem y precio— para los tres tipos que comparten estructura en UBL.
   *
   * `InvoiceLineType`, `CreditNoteLineType` y `DebitNoteLineType` difieren SOLO
   * en el nombre del elemento de cantidad (`InvoicedQuantity` /
   * `CreditedQuantity` / `DebitedQuantity`); el resto de la secuencia UBL es
   * idéntico, incluido el orden `AllowanceCharge → TaxTotal → Item → Price`.
   *
   * Antes cada builder escribía su propia línea, y esa duplicación ya dejó
   * arreglos afuera dos veces:
   *
   *   - FAZ09 (`cac:StandardItemIdentification`) se arregló en la factura y hubo
   *     que replicarlo a mano en las notas.
   *   - `cac:TaxTotal` de línea nunca llegó a ellas — reglas CAS01b y DAS01b,
   *     que alcanzan a 20 de los 50 documentos que exige el set de habilitación.
   *
   * Un solo cuerpo hace imposible que la próxima regla alcance a un tipo de
   * documento y no a los otros.
   *
   * ## Lo que la línea declara ADEMÁS de su importe
   *
   * Los tres campos que `UblDocumentLine` añade sobre `ProviderInvoiceItem` son
   * opcionales, y una línea que no los trae produce EXACTAMENTE el XML de antes:
   *
   * · `taxes` — desglose multi-impuesto. Sin él la línea hereda el PRIMER tributo
   *   de la cabecera, que es el camino histórico y el único que sirve a las
   *   facturas ya emitidas: se reenvían tal cual años después y sus tributos
   *   nunca van a estar desglosados por línea.
   * · `note` — `cbc:Note` de línea.
   * · `omit_tax_total` — la línea no emite `cac:TaxTotal`.
   */
  static buildDocumentLines(
    parent: any,
    items: UblDocumentLine[],
    taxes: ProviderInvoiceTax[],
    currency: string,
    options: {
      line_element: 'InvoiceLine' | 'CreditNoteLine' | 'DebitNoteLine';
      quantity_element:
        | 'InvoicedQuantity'
        | 'CreditedQuantity'
        | 'DebitedQuantity';
    },
  ): void {
    items.forEach((item, index) => {
      const line = parent.ele(UBL_NAMESPACES.CAC, options.line_element);
      line.ele(UBL_NAMESPACES.CBC, 'ID').txt(String(index + 1));

      // `cbc:Note` va INMEDIATAMENTE DESPUÉS del `cbc:ID`. La secuencia de
      // `InvoiceLineType` es cbc:ID → cbc:Note → cantidad →
      // cbc:LineExtensionAmount → …, y UBL la fija: un elemento fuera de orden
      // rompe la validación de esquema antes de que ninguna regla de la DIAN
      // llegue a leerlo.
      //
      // Su único emisor hoy es la línea de ADMINISTRACIÓN de un contrato AIU,
      // donde FAV03 (pág. 88; espejos CAV03 pág. 165 y su equivalente en la nota
      // débito) la declara «Obligatorio: de informar para el caso de ítems de
      // contratos de servicio tipo AIU. Para el ítem Administración». La cadena
      // llega YA COMPUESTA por `buildAiuNote` —con su literal obligatorio— porque
      // la misma función la validó al crear el documento: recomponerla acá con
      // otro criterio permitiría que lo validado y lo emitido divergieran.
      if (item.note) {
        line.ele(UBL_NAMESPACES.CBC, 'Note').txt(item.note);
      }

      line
        .ele(UBL_NAMESPACES.CBC, options.quantity_element)
        // Unidad realmente vendida; `EA` (each) cuando el producto no declara
        // unidad, que es todo el catálogo por pieza.
        .att('unitCode', item.unit_code || 'EA')
        .txt(item.quantity);

      // Same function the header uses, so header and lines cannot disagree.
      line
        .ele(UBL_NAMESPACES.CBC, 'LineExtensionAmount')
        .att('currencyID', currency)
        .txt(dianLineExtension(item));

      // Allowance/charge for discount
      if (!toDecimal(item.discount_amount).isZero()) {
        const allowance = line.ele(UBL_NAMESPACES.CAC, 'AllowanceCharge');
        allowance.ele(UBL_NAMESPACES.CBC, 'ChargeIndicator').txt('false');
        allowance
          .ele(UBL_NAMESPACES.CBC, 'Amount')
          .att('currencyID', currency)
          .txt(dianAmount(item.discount_amount));
        // Importe sobre el que se calculó el descuento: la línea ANTES de
        // restarlo. Se deriva del mismo helper que el importe neto para que
        // lleve el divisor de la *price unit*; escrito a mano como
        // `cantidad × precio` declaraba una base N veces mayor que el
        // `cbc:LineExtensionAmount` de su propia línea.
        allowance
          .ele(UBL_NAMESPACES.CBC, 'BaseAmount')
          .att('currencyID', currency)
          .txt(dianLineGross(item));
      }

      // `cac:TaxTotal` de línea — ausente cuando la línea lo pide.
      //
      // FAX01 (pág. 94; espejo CAX01 pág. 172) enumera los casos en que el grupo
      // «NO debe ser informado»: «para ítems excluidos de acuerdo a lo
      // establecido en el ET. Adicionalmente, NO debe ser informado para facturas
      // del régimen simple grupo I, ni para ítems cuyo concepto en contratos de
      // AIU no haga parte de la base gravable».
      //
      // Quién decide cuál de esos casos aplica NO es este builder: depende del
      // régimen de IVA del contrato AIU y del componente de la línea, que es una
      // lectura de configuración del tenant. Llega ya resuelto en la bandera para
      // que el emisor no tenga que reconstruir esa decisión — y para que no se
      // confunda con «no tiene impuestos»: un bien EXENTO sí emite el grupo, con
      // `cbc:Percent` en 0,00.
      if (!item.omit_tax_total) {
        UblCommonBuilder.buildLineTaxTotal(line, item, taxes, currency);
      }

      // Item description + identificación estándar del ítem.
      //
      // `cac:StandardItemIdentification` es obligatorio: la DIAN rechaza la línea
      // sin él con la regla FAZ09 «StandardItemIdentification no informado». No se
      // emitía en ningún tipo de documento, así que el defecto alcanzaba también a
      // la emisión real, no solo a la habilitación.
      //
      // `schemeID="999"` = «estándar de adopción del contribuyente». Es el valor
      // correcto mientras Vendix no publique catálogo UNSPSC (001) ni GTIN (010):
      // declarar uno de esos sin tenerlo sería una afirmación falsa sobre el
      // origen del código. El número de línea es la caída cuando el llamador no
      // aporta código — identifica el ítem dentro del documento, que es lo que la
      // regla pide, sin inventar un catálogo que no existe.
      const ubl_item = line.ele(UBL_NAMESPACES.CAC, 'Item');
      ubl_item.ele(UBL_NAMESPACES.CBC, 'Description').txt(item.description);
      ubl_item
        .ele(UBL_NAMESPACES.CAC, 'StandardItemIdentification')
        .ele(UBL_NAMESPACES.CBC, 'ID')
        .att('schemeID', UBL_CONSTANTS.ITEM_IDENTIFICATION_SCHEME_ID)
        .txt(item.item_code?.trim() || String(index + 1));

      // Price
      const price = line.ele(UBL_NAMESPACES.CAC, 'Price');
      price
        .ele(UBL_NAMESPACES.CBC, 'PriceAmount')
        .att('currencyID', currency)
        // `dianPriceAmount`, no el precio unitario crudo: FAV06 contrasta este
        // número MULTIPLICADO por `cbc:BaseQuantity` contra el importe de la
        // línea, y `BaseQuantity` es la cantidad facturada (ver
        // `resolveBaseQuantity`). El helper despeja el precio para que la
        // igualdad se cumpla por construcción, incluida la línea con escala de
        // precio (QUI-648) y la de impuesto incluido. Admite 0-6 decimales
        // —único campo monetario del perfil que no está fijado en 2—, así que
        // el residuo de una división inexacta cabe en el propio campo.
        .txt(dianPriceAmount(item));
      // MISMA cadena que el elemento de cantidad de arriba. No es una copia por
      // comodidad: es la invariante que hace verdadera la igualdad de FAV06. Si
      // los dos números divergen, el documento afirma un precio por unidad que
      // no reproduce su propio importe de línea.
      price
        .ele(UBL_NAMESPACES.CBC, 'BaseQuantity')
        .att('unitCode', item.unit_code || 'EA')
        .txt(UblCommonBuilder.resolveBaseQuantity(item));
    });
  }

  /**
   * El grupo `cac:TaxTotal` de UNA línea, por sus dos caminos.
   *
   * ## 1. Con desglose propio (`item.taxes`) — un `cac:TaxTotal` POR ESQUEMA
   *
   * Es lo que hace representable una cuenta mixta. Sin él, TODAS las líneas
   * heredan el esquema del PRIMER tributo de la cabecera y una cuenta de
   * restaurante con IVA e INC sale entera declarada como IVA 19 % — la DIAN
   * recompone los impuestos desde lo que recibe, así que el documento afirma un
   * reparto de tributos que no ocurrió.
   *
   * La cardinalidad es POR CÓDIGO DE TRIBUTO, no una por línea. FAX01 (pág. 95 /
   * 448) pide «un bloque para cada código de tributo», y FAX02 (pág. 95-96 /
   * 449) lo vuelve aritmético SELECCIONANDO el bloque por esquema: el
   * `cbc:TaxAmount` de cada bloque tiene que ser la Σ de los subtotales DE ESE
   * ESQUEMA. Con un único bloque que sumara los dos, una cuenta con IVA 190 +
   * INC 80 declaraba 270,00 donde el predicado de IVA exige 190,00 — el rechazo
   * está en la aritmética, no en la forma.
   *
   * Dentro del bloque, un `cac:TaxSubtotal` POR TARIFA (FAX04, pág. 96), cada uno
   * con SU base: en una línea, IVA e INC gravan LA MISMA base, y como van a
   * bloques distintos ninguna base se suma dos veces. Dos filas de la misma
   * tarifa sí se funden —sumando bases—, que es exactamente lo que
   * `lineTaxableContribution` suma para la base gravable de cabecera (FAU04), así
   * que las dos caras siguen leyendo el mismo número.
   *
   * La otra mitad de FAX01 —«NO debe ser informado … ni para ítems cuyo concepto
   * en contratos de AIU no haga parte de la base gravable»— la resuelve
   * `UblDocumentLine.omit_tax_total`, que hace callar la línea entera antes de
   * llegar acá.
   *
   * ## 2. Sin desglose — el camino histórico, byte por byte
   *
   * La línea hereda el primer tributo de la cabecera. NO se toca ni se "mejora":
   * es la forma con la que se emitieron las facturas que ya están aceptadas, y
   * esas se reenvían tal cual años después. Incluida su tarifa: acá se formatea
   * con `dianRate` sin el saneamiento por-mil del ICA, al contrario que el camino
   * nuevo. Cambiarlo alteraría documentos históricos.
   *
   * ## 3. Sin desglose Y sin cabecera — la línea NO emite el grupo
   *
   * Antes este caso caía a una tarifa cableada de IVA 19 % con cuota 0,00, así
   * que una factura sin ningún tributo salía afirmando un impuesto inexistente en
   * cada línea. Ningún documento aceptado tomó esa rama —el camino histórico
   * hereda de `header_taxes[0]`, que acá por definición no existe—, de modo que
   * callar la línea no altera nada ya emitido. Ver FAS01b y la guarda espejo de
   * `buildTaxTotals`.
   */
  private static buildLineTaxTotal(
    line: any,
    item: UblDocumentLine,
    header_taxes: ProviderInvoiceTax[],
    currency: string,
  ): void {
    const line_taxes = item.taxes ?? [];

    // Sin tributo de línea Y sin tributo de cabecera del que heredar, la línea no
    // tiene NADA que declarar. Antes se emitía igual, heredando una tarifa
    // cableada de IVA 19 % con cuota 0,00: el XML afirmaba un impuesto que la
    // operación no causa. Una tienda que vende sólo productos excluidos salía con
    // 19 % en todas sus líneas, y FAS01b rechaza justamente «se reportan ítems
    // excluidos de impuestos, pero se detalla una totalización de impuestos con
    // tarifa igual a 0 %».
    //
    // Callar la línea la deja como las que ya usan `omit_tax_total` (FAX01), y es
    // coherente con la guarda de cabecera de `buildTaxTotals`. NO afecta al camino
    // histórico: ése hereda de `header_taxes[0]`, que acá por definición no existe.
    if (line_taxes.length === 0 && header_taxes.length === 0) {
      return;
    }

    if (line_taxes.length === 0) {
      const line_tax_total = line.ele(UBL_NAMESPACES.CAC, 'TaxTotal');
      line_tax_total
        .ele(UBL_NAMESPACES.CBC, 'TaxAmount')
        .att('currencyID', currency)
        .txt(dianAmount(item.tax_amount));

      // Line-level tax code/rate. invoice_taxes is header-level (not persisted
      // per item), so a line inherits the invoice's primary tax. The code is
      // resolved tax_type-first for correctness on single-tax invoices (a pure
      // INC restaurant bill emits scheme 04, not 01).
      //
      // UNA CUENTA MIXTA NO LLEGA ACÁ, y no porque la cabecera la concilie. Esa
      // era la afirmación anterior de este comentario y era falsa: FAX02 es una
      // regla POR LÍNEA y el `cac:TaxTotal` de cabecera es otra (FAS02), así que
      // conciliar arriba no exime a la línea de nada. Lo que hace correcto este
      // camino es que un documento con ≥2 tributos SIEMPRE persiste el desglose
      // por línea (`InvoicingService.needsPersistedLineTaxes`), de modo que acá
      // sólo cae el documento de un tributo único — donde heredar el primero es
      // heredar el único.
      const tax_rate = header_taxes[0].tax_rate;
      const tax_code = UblCommonBuilder.resolveTaxCodeFromTax(header_taxes[0]);

      const subtotal = line_tax_total.ele(UBL_NAMESPACES.CAC, 'TaxSubtotal');
      subtotal
        .ele(UBL_NAMESPACES.CBC, 'TaxableAmount')
        .att('currencyID', currency)
        .txt(dianLineExtension(item));
      subtotal
        .ele(UBL_NAMESPACES.CBC, 'TaxAmount')
        .att('currencyID', currency)
        .txt(dianAmount(item.tax_amount));

      const category = subtotal.ele(UBL_NAMESPACES.CAC, 'TaxCategory');
      // dianRate, not the raw string: tax_rate arrives from a Decimal(5,2), so
      // 19.00 serialized as '19' and reached the XML without decimals.
      category.ele(UBL_NAMESPACES.CBC, 'Percent').txt(dianRate(tax_rate));
      // Mismo par (ID, Name) que en la cabecera. FAS01b compara «Porcentaje,
      // Nombre y ID» de la línea contra el TaxTotal de cabecera para exigir que
      // exista uno por cada tributo de línea «con las características
      // correspondiente al mismo impuesto». La cabecera sí emitía el nombre y la
      // línea no, así que la línea no coincidía con su propio impuesto.
      const line_scheme = category.ele(UBL_NAMESPACES.CAC, 'TaxScheme');
      line_scheme.ele(UBL_NAMESPACES.CBC, 'ID').txt(tax_code);
      line_scheme
        .ele(UBL_NAMESPACES.CBC, 'Name')
        .txt(DIAN_TAX_NAMES[tax_code] || tax_code);
      return;
    }

    // UN BLOQUE `cac:TaxTotal` POR ESQUEMA, cada uno con su propio importe.
    //
    // FAX01 (pág. 95 / 448): «Un bloque para cada código de tributo. Rechazo: Si
    // existe más de un bloque con el mismo valor en el elemento de:TaxTotal/
    // TaxSubtotal/cac:TaxCategory/cac:TaxScheme/cbc:ID».
    //
    // FAX02 (pág. 95-96 / 449) lo hace ARITMÉTICO, y por línea:
    //   `every $i in //cac:InvoiceLine satisfies if (…cbc:ID='01') then
    //    round($i/cac:TaxTotal[…cbc:ID='01']/cbc:TaxAmount) =
    //    round(sum($i/…/cac:TaxSubtotal[…='01']/cbc:TaxAmount)) else true()`
    // con la nota «01 representa un código, pero se deben considerar todos los
    // tipos que apliquen a esta línea». El predicado SELECCIONA el bloque por
    // esquema y lo compara contra los subtotales DE ESE ESQUEMA.
    //
    // Antes se abría UN bloque por línea con un subtotal por tributo y su
    // `cbc:TaxAmount` era la suma de TODOS los esquemas: en una cuenta mixta con
    // IVA 190 + INC 80 el bloque quedaba seleccionado por los dos esquemas y el
    // lado izquierdo valía 270,00 donde el derecho valía 190,00 — rechazo
    // aritmético. El comentario que lo justificaba decía que las cuentas mixtas
    // «se conciliaban en el TaxTotal de cabecera»: la cabecera es OTRA regla
    // (FAS02), y FAX02 no la mira. La conciliación de cabecera no exime a la
    // línea.
    const by_scheme = UblCommonBuilder.groupTaxRowsBySchemeAndRate(
      line_taxes,
      (tax) => {
        const code = UblCommonBuilder.resolveTaxCodeFromTax(tax);
        return {
          code,
          // MISMA regla de tarifa que la cabecera —incluido el por-mil del ICA—,
          // porque FAS01b contrasta el porcentaje de la línea contra el suyo.
          percent: UblCommonBuilder.resolveSchemePercent(code, tax.tax_rate),
          base: tax.taxable_amount,
          amount: tax.tax_amount,
        };
      },
    );

    for (const [code, by_rate] of by_scheme) {
      const line_tax_total = line.ele(UBL_NAMESPACES.CAC, 'TaxTotal');

      // FAX02 — el importe del bloque es la Σ de LOS SUYOS, computada desde los
      // mismos cubos que emiten los subtotales para que la igualdad no dependa
      // de que dos truncados coincidan.
      line_tax_total
        .ele(UBL_NAMESPACES.CBC, 'TaxAmount')
        .att('currencyID', currency)
        .txt(dianSum([...by_rate.values()].map((row) => dianSum(row.amount))));

      // FAX04 (pág. 96) — «un grupo de estos para cada tarifa». Dos tarifas del
      // MISMO esquema abren dos subtotales dentro de ESTE bloque; dos filas de la
      // misma tarifa se funden en uno, sumando sus bases, que es lo que
      // `lineTaxableContribution` ya suma para la base de cabecera (FAU04): las
      // dos caras siguen leyendo el mismo número.
      for (const [percent, bucket] of by_rate) {
        UblCommonBuilder.emitTaxSubtotal(
          line_tax_total,
          code,
          percent,
          bucket,
          currency,
        );
      }
    }
  }

  /**
   * `cac:Price/cbc:BaseQuantity` — **la cantidad facturada**, no un divisor.
   *
   * ## Por qué devuelve la cantidad y no la escala de precio
   *
   * En UBL genérico `BaseQuantity` es «a cuántas unidades aplica el precio», y
   * PEPPOL lo usa así (EN16931-R120 DIVIDE por él). **El perfil de la DIAN no.**
   * Su regla de línea es una multiplicación, sin división en ninguna parte:
   *
   * ```
   * LineExtensionAmount = PriceAmount × BaseQuantity
   *                     − Σ AllowanceCharge[ChargeIndicator=false]
   *                     + Σ AllowanceCharge[ChargeIndicator=true]
   * ```
   *
   * Verificado sobre los **27 renglones** de todos los XML de ejemplo oficiales
   * de la Caja de Herramientas: 27/27 reconcilian con esa fórmula y **0/27** con
   * la lectura de divisor. Los dos casos con cantidad ≠ 1 la deciden solos —
   * `Transporte de Carga.xml` (Qty=10, BQ=10, P=200.000, LEA=2.000.000) y
   * `FacturaVenta_moneda_extranjera.xml` (Qty=10, BQ=10, P=1.000, LEA=10.000):
   * bajo la lectura de divisor darían 20.000 y 100, errados por factor 10. El
   * único renglón que parecía desmentirlo (`Consumidor Final.xml`, línea 3,
   * LEA=1.410.000 frente a P×BQ=1.400.000) confirma en realidad el término de
   * cargos: trae `ChargeIndicator=true, Amount=10000, Reason=Cargo`.
   *
   * ## Consecuencia para QUI-648
   *
   * La escala de precio (`price_unit_quantity`) **no es representable** en este
   * perfil: el campo que la declararía está ocupado por la cantidad. Por eso se
   * consume ANTES del XML, dentro del precio — `dianPriceAmount` despeja
   * `importe ÷ cantidad`, y el queso a $28.000/kg vendido en gramos sale con su
   * precio por gramo y un importe correcto, en vez de un `BaseQuantity` que la
   * DIAN multiplicaría.
   *
   * ## Alcance del defecto que corrige
   *
   * La versión anterior devolvía la escala (1 en todo el catálogo por pieza), de
   * modo que **toda línea con cantidad ≠ 1** declaraba `BaseQuantity=1` y
   * afirmaba un importe igual al precio unitario. No fallaba sólo el producto
   * con escala: fallaba cualquier venta de más de una unidad.
   *
   * Devuelve la cadena TAL CUAL la emite el elemento de cantidad
   * (`cbc:InvoicedQuantity` / `CreditedQuantity` / `DebitedQuantity`) para que
   * los dos números no puedan divergir por un redondeo intermedio.
   */
  static resolveBaseQuantity(item: { quantity: string }): string {
    return item.quantity;
  }

  /**
   * Resolves a tax name (IVA, INC, ICA) to its DIAN code.
   */
  static resolveTaxCode(tax_name: string): string {
    const name = tax_name.toUpperCase().trim();

    // Las retenciones van PRIMERO: sus nombres contienen el del tributo que
    // retienen («ReteIVA» contiene «IVA», «ReteICA» contiene «ICA»), así que
    // cualquier orden que las deje de últimas las clasifica como el tributo y
    // las suma al `cac:TaxTotal` que la DIAN contrasta. Sólo se mira por
    // PREFIJO —«RETE»/«AUTORRETE»— porque buscarlo en cualquier posición haría
    // que una palabra que lo contenga por dentro clasifique como retención.
    const compact = name.replace(/[^A-Z0-9]/g, '');
    if (compact.startsWith('RETE') || compact.startsWith('AUTORRETE')) {
      if (compact.includes('IVA')) return DIAN_TAX_CODES.RETE_IVA;
      if (compact.includes('ICA')) return DIAN_TAX_CODES.RETE_ICA;
      if (compact.includes('CREE')) return DIAN_TAX_CODES.RETE_CREE;
      return DIAN_TAX_CODES.RETE_FUENTE;
    }

    if (name.includes('IVA') || name.includes('VAT')) {
      return DIAN_TAX_CODES.IVA;
    }
    if (name.includes('INC') || name.includes('CONSUMO')) {
      return DIAN_TAX_CODES.INC;
    }
    if (name.includes('ICA')) {
      return DIAN_TAX_CODES.ICA;
    }
    return DIAN_TAX_CODES.IVA; // Default
  }

  /**
   * Resolves the DIAN tax scheme code for a tax row, prioritizing the persisted
   * fiscal type over the tax_name heuristic. This makes IVA (01), INC (04) and
   * ICA (03) deterministic regardless of how the tax was named by the user.
   *
   * Las RETENCIONES resuelven su propio código —05 ReteIVA, 06 Retefuente,
   * 07 ReteICA— y no el del tributo que retienen. Sin esa rama caían al
   * heurístico por nombre, que es el peor camino posible para ellas: «ReteIVA»
   * contiene «IVA» y «ReteICA» contiene «ICA», así que una retención infiltrada
   * entre los tributos se clasificaba como el impuesto mismo. `isWithholdingTax`
   * ya describía esa trampa y la evitaba para decidir SI la fila es retención;
   * faltaba usarla también para decidir QUÉ código lleva.
   */
  static resolveTaxCodeFromTax(tax: ProviderInvoiceTax): string {
    const tax_type = (tax.tax_type || '').toLowerCase();
    switch (tax_type) {
      case 'iva':
        return DIAN_TAX_CODES.IVA;
      case 'inc':
        return DIAN_TAX_CODES.INC;
      case 'ica':
        return DIAN_TAX_CODES.ICA;
      case 'reteiva':
        return DIAN_TAX_CODES.RETE_IVA;
      case 'retefuente':
        return DIAN_TAX_CODES.RETE_FUENTE;
      case 'reteica':
        return DIAN_TAX_CODES.RETE_ICA;
      case 'retecree':
        return DIAN_TAX_CODES.RETE_CREE;
      default:
        // `withholding` es el genérico de `tax_type_enum`: dice que la fila es
        // una retención pero no cuál, así que el nombre es lo único que queda
        // para distinguirlas — y ahí sí se busca «rete» primero.
        return UblCommonBuilder.resolveTaxCode(tax.tax_name);
    }
  }

  /**
   * ¿Esta fila de `invoice_taxes` es una RETENCIÓN y no un tributo del documento?
   *
   * ## Qué se rompe sin ella
   *
   * Una retención tiene su propio grupo (`cac:WithholdingTaxTotal`) y NO puede
   * sumar al `cac:TaxTotal` que la DIAN contrasta. Pero el DTO legacy
   * (`dto.taxes[]`) deja escribir cualquier fila en `invoice_taxes`, así que una
   * retención puede llegar infiltrada entre los tributos. Y `resolveTaxCode`, que
   * clasifica por nombre, la clasificaría MAL de la peor manera posible: «ReteIVA»
   * contiene «IVA» y «ReteICA» contiene «ICA», así que las dos entrarían al
   * `cac:TaxTotal` como si fueran el tributo que retienen, inflando el impuesto
   * declarado del documento.
   *
   * ## Por qué NO mira el importe
   *
   * Porque el validador previo la llama con los importes en CERO: sólo necesita
   * CLASIFICAR la fila (ver `FiscalDocumentValidator.emitterProbeOf`). Una
   * clasificación que dependiera del importe aprobaría en el prevalidador filas
   * que el emisor descarta, que es exactamente la divergencia que compartir esta
   * función existe para impedir.
   *
   * ## Las tres señales, en orden de autoridad
   *
   * 1. **`tax_type` persistido** — es el dato, no una pista. Cubre los valores de
   *    los dos enums que pueden llegar acá (ver `DIAN_WITHHOLDING_TAX_TYPES`).
   * 2. **`tax_name`** — respaldo para el histórico anterior a que `tax_type`
   *    existiera, donde el nombre es lo único que hay. Se compara sobre la forma
   *    normalizada (sin tildes, sin espacios, en mayúscula) y sólo por PREFIJO
   *    para «rete»/«autorrete»: buscarlo en cualquier posición haría que una
   *    palabra que lo contiene por dentro clasificara como retención.
   * 3. **Tarifa negativa** — una tarifa por debajo de cero no es un tributo: la
   *    DIAN valida `cbc:Percent` como un porcentaje aplicado a una base y jamás
   *    lo acepta negativo. Es la única señal que queda cuando una fila legacy no
   *    tiene tipo y su nombre es libre.
   */
  static isWithholdingTax(tax: ProviderInvoiceTax): boolean {
    const tax_type = (tax.tax_type || '').trim().toLowerCase();
    if (tax_type) {
      return DIAN_WITHHOLDING_TAX_TYPES.has(tax_type);
    }

    const name = (tax.tax_name || '')
      // NFD separa la tilde de su letra y el filtro de abajo la descarta con
      // todo lo que no sea A-Z0-9: «Retención», «Retencion» y «RETE-FUENTE»
      // colapsan a la misma cadena.
      .normalize('NFD')
      .toUpperCase()
      .replace(/[^A-Z0-9]/g, '');
    if (
      name.startsWith('RETE') ||
      name.startsWith('AUTORRETE') ||
      name.includes('RETENCION')
    ) {
      return true;
    }

    return toDecimal(tax.tax_rate).isNegative();
  }

  /**
   * Generates the SoftwareSecurityCode hash.
   * SHA-384(software_id + pin + invoice_number)
   */
  static generateSoftwareSecurityCode(
    software_id: string,
    pin: string,
    invoice_number: string,
  ): string {
    const raw = software_id + pin + invoice_number;
    return createHash('sha384').update(raw).digest('hex');
  }
}
