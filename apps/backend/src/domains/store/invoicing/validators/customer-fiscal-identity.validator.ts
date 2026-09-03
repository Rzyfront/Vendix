import { Injectable } from '@nestjs/common';
import { computeNitDv, onlyDigits } from '@common/utils/nit.util';

/**
 * PUERTA DE IDENTIDAD DEL ADQUIRIENTE ANTE LA DIAN.
 *
 * ## El defecto que cierra
 *
 * Hoy nadie valida al adquiriente. `InvoiceFlowService.validate()` solo cuenta
 * ítems, y cuando faltan datos el código **los inventa en vez de fallar**:
 * `UblCommonBuilder.buildAddressFields` rellena municipio `11001`, ciudad
 * `Bogotá`, departamento `Bogotá`/`11` y código postal `110111`;
 * `DianDirectProvider` rellena el número `222222222222` cuando no hay
 * `customer_tax_id`.
 *
 * Eso no produce un error: produce un documento **legalmente emitido con datos
 * falsos**. Vendix le declara a la DIAN un municipio en el que la operación no
 * ocurrió, sobre un adquiriente que nadie verificó, y el consecutivo autorizado
 * ya se gastó. Un rechazo cuesta un consecutivo; una aceptación con datos falsos
 * cuesta una corrección con nota crédito y una inconsistencia en exógena.
 *
 * ## La distinción que gobierna todo el diseño
 *
 * `222222222222` («Consumidor Final») es **legítimo**: es el valor oficial para
 * la venta de mostrador a quien no pide factura nominativa. Lo que NO es
 * legítimo es usarlo como **relleno silencioso** cuando alguien olvidó capturar
 * al cliente en una factura nominativa.
 *
 * La diferencia no está en el dato — es el mismo número — sino en **quién lo
 * decidió**. Por eso este validador no prohíbe el Consumidor Final: exige que
 * sea una elección declarada por el documento
 * ({@link CustomerFiscalIdentityInput.identification_mode}) y no el resultado de
 * un campo vacío. En `final_consumer` el número oficial es correcto; en
 * `nominative` ese mismo número es {@link CustomerFiscalIdentityCode}
 * `IMPLICIT_FINAL_CONSUMER`, un bloqueante.
 *
 * Modelar el modo en la ENTRADA —y no deducirlo de los datos— es lo que impide
 * que el bug vuelva: un fallback nunca puede disfrazarse de decisión porque la
 * decisión es un campo obligatorio del contrato.
 *
 * ## Criterio de severidad (por qué unas cosas bloquean y otras avisan)
 *
 * Una sola regla decide, y se aplica igual a todos los campos:
 *
 *   - **Bloqueante** cuando la ausencia del dato hace que el documento **afirme
 *     algo falso**. Sin municipio, el XML declara Bogotá: una mentira sobre
 *     dónde ocurrió la operación. Sin identificación en una factura nominativa,
 *     el XML declara Consumidor Final: una mentira sobre a quién se le vendió.
 *   - **Advertencia** cuando la ausencia hace que el documento **no afirme
 *     nada**. Sin correo, el builder omite `cac:Contact` — no inventa una
 *     dirección de acuse. Sin línea de dirección, escribe `N/A`, que es admitir
 *     la ausencia, no falsearla.
 *
 * ## Forma
 *
 * PURA y testeable sin Nest: entra data, sale una lista de hallazgos. No lanza
 * excepciones HTTP, no consulta Prisma, no lee contexto de request. `@Injectable`
 * solo para que el flujo de emisión pueda inyectarla; el cableado (traducir
 * bloqueantes a `VendixHttpException`, decidir en qué transición se aplica) es de
 * quien la consume.
 *
 * @see apps/backend/src/domains/store/invoicing/fiscal-document-requirements.ts
 *      — mismo patrón de contrato puro para los requisitos POR TIPO DE DOCUMENTO.
 *      Aquel responde «¿qué necesita este documento?»; este, «¿es emitible este
 *      adquiriente?».
 */

// -----------------------------------------------------------------------------
// CATÁLOGOS LOCALES
//
// Declarados AQUÍ a propósito y no importados de
// `providers/dian-direct/constants/`: ese archivo está siendo corregido en
// paralelo, y acoplar la puerta de validación a una tabla en movimiento
// significa que el arreglo de una rompe a la otra.
//
// CUANDO EXISTA EL CATÁLOGO UNIFICADO, esta sección se borra y se consume de
// allá. Lo que NO debe migrar sin revisarse son las longitudes y el flag
// `carries_verification_digit`, que son propios de esta validación y hoy no
// viven en ninguna tabla del repo.
// -----------------------------------------------------------------------------

/** Un tipo de identificación de la tabla del Anexo Técnico 19 (13.2.1). */
export interface DianIdentificationType {
  /** Código DIAN que viaja en `@schemeID`. */
  code: string;
  /** Rótulo en español para los mensajes. */
  label: string;
  /**
   * Alias internos que el repo persiste en `users.document_type`
   * (`identification_type_enum`) y que viajan en `@schemeName`. El primero es el
   * canónico.
   */
  aliases: readonly string[];
  /** ¿El número es SOLO dígitos? El pasaporte y el DIE admiten letras. */
  numeric: boolean;
  /** Longitud plausible mínima del número, sin DV ni separadores. */
  min_length: number;
  /** Longitud plausible máxima del número, sin DV ni separadores. */
  max_length: number;
  /**
   * ¿Lleva dígito de verificación módulo 11?
   *
   * SOLO el NIT colombiano ('31'). El '50' es «NIT de otro país»: no lo emite la
   * DIAN y no tiene checksum módulo 11 que calcular.
   */
  carries_verification_digit: boolean;
}

/**
 * Los 12 tipos del Anexo 19. Las longitudes replican
 * `common/constants/document-types.ts` (`DOCUMENT_TYPE_RULES`) allí donde ese
 * archivo ya declara una, para que la puerta de captura y la de emisión no
 * discrepen.
 *
 * ⚠️ DIVERGENCIA CONOCIDA CON `DIAN_ID_TYPES`: aquel mapea el alias `PA` al
 * código `'21'` (Tarjeta de Extranjería) y reserva `'41'` para un alias
 * `PASSPORT` que `identification_type_enum` no tiene. Pero
 * `DOCUMENT_TYPE_RULES.PA` se llama «Pasaporte» y acepta letras, que es la forma
 * de un pasaporte y no la de una tarjeta de extranjería. Aquí `PA` se resuelve a
 * `'41'` (Pasaporte). Si el catálogo unificado decide lo contrario, este es el
 * punto que hay que cambiar — y significa que todo cliente con pasaporte se está
 * declarando ante la DIAN como tarjeta de extranjería.
 */
export const DIAN_IDENTIFICATION_TYPES: readonly DianIdentificationType[] =
  Object.freeze([
    {
      code: '11',
      label: 'Registro civil',
      aliases: ['RC'],
      numeric: true,
      min_length: 8,
      max_length: 11,
      carries_verification_digit: false,
    },
    {
      code: '12',
      label: 'Tarjeta de identidad',
      aliases: ['TI'],
      numeric: true,
      min_length: 8,
      max_length: 11,
      carries_verification_digit: false,
    },
    {
      code: '13',
      label: 'Cédula de ciudadanía',
      aliases: ['CC'],
      numeric: true,
      min_length: 6,
      max_length: 10,
      carries_verification_digit: false,
    },
    {
      code: '21',
      label: 'Tarjeta de extranjería',
      aliases: ['TE'],
      numeric: true,
      min_length: 6,
      max_length: 12,
      carries_verification_digit: false,
    },
    {
      code: '22',
      label: 'Cédula de extranjería',
      aliases: ['CE'],
      numeric: true,
      min_length: 6,
      max_length: 10,
      carries_verification_digit: false,
    },
    {
      code: '31',
      label: 'NIT',
      aliases: ['NIT'],
      numeric: true,
      min_length: 8,
      max_length: 10,
      carries_verification_digit: true,
    },
    {
      code: '41',
      label: 'Pasaporte',
      aliases: ['PA', 'PASSPORT'],
      numeric: false,
      min_length: 5,
      max_length: 16,
      carries_verification_digit: false,
    },
    {
      code: '42',
      label: 'Documento de identificación extranjero',
      aliases: ['DIE'],
      numeric: false,
      min_length: 5,
      max_length: 20,
      carries_verification_digit: false,
    },
    {
      code: '47',
      label: 'PEP (Permiso Especial de Permanencia)',
      aliases: ['PEP'],
      numeric: true,
      min_length: 9,
      max_length: 15,
      carries_verification_digit: false,
    },
    {
      code: '48',
      label: 'PPT (Permiso por Protección Temporal)',
      aliases: ['PPT'],
      numeric: true,
      min_length: 9,
      max_length: 15,
      carries_verification_digit: false,
    },
    {
      code: '50',
      label: 'NIT de otro país',
      aliases: ['NIT_EXTRANJERIA'],
      numeric: false,
      min_length: 5,
      max_length: 20,
      carries_verification_digit: false,
    },
    {
      code: '91',
      label: 'NUIP',
      aliases: ['NUIP'],
      numeric: true,
      min_length: 8,
      max_length: 11,
      carries_verification_digit: false,
    },
  ]);

/** Índice por código DIAN y por alias interno, en MAYÚSCULA. */
const IDENTIFICATION_TYPE_INDEX: ReadonlyMap<string, DianIdentificationType> =
  (() => {
    const index = new Map<string, DianIdentificationType>();
    for (const type of DIAN_IDENTIFICATION_TYPES) {
      index.set(type.code, type);
      for (const alias of type.aliases) {
        index.set(alias.toUpperCase(), type);
      }
    }
    return index;
  })();

/**
 * Resuelve un `document_type` escrito en cualquiera de las dos vocabularios que
 * conviven en el repo: el código DIAN (`'31'`) o el alias interno (`'NIT'`).
 * `undefined` cuando no figura en el catálogo.
 */
export function resolveIdentificationType(
  value: string | null | undefined,
): DianIdentificationType | undefined {
  const key = (value ?? '').trim().toUpperCase();
  if (!key) return undefined;
  return IDENTIFICATION_TYPE_INDEX.get(key);
}

/** Régimen fiscal — espejo de `tax_regime_enum` en `schema.prisma`. */
export const TAX_REGIME_CODES: readonly string[] = Object.freeze([
  'COMUN',
  'SIMPLIFICADO',
  'GRAN_CONTRIBUYENTE',
  'AUTORRETENEDOR',
  'ESPECIAL',
  'NO_APLICA',
]);

/**
 * Responsabilidades fiscales conocidas (casilla 53 del RUT). Espejo de
 * `domains/fiscal-operations/constants/fiscal-responsibilities.catalog.ts` más
 * `R-99-PJ`, que el escáner de RUT ya emite para personas jurídicas.
 */
export const KNOWN_TAX_RESPONSIBILITIES: readonly string[] = Object.freeze([
  'O-13',
  'O-15',
  'O-23',
  'O-47',
  'O-48',
  'O-49',
  'R-99-PN',
  'R-99-PJ',
]);

/**
 * FORMA de un código de responsabilidad. Se valida la forma como bloqueante y la
 * pertenencia al catálogo como advertencia: la lista de la DIAN crece por
 * resolución, y un `O-` nuevo y válido no puede quedar bloqueado esperando a que
 * alguien actualice este archivo. Réplica de la expresión que ya usa
 * `store/subscriptions/dto/billing-profile.dto.ts`.
 */
const TAX_RESPONSIBILITY_PATTERN = /^(O-\d{1,3}|R-99-P[NJ])$/;

/** «Ninguna de las anteriores» — el valor por defecto legítimo del Anexo 19. */
export const DIAN_DEFAULT_TAX_RESPONSIBILITY = 'R-99-PN';

/** Número oficial del adquiriente no identificado (Consumidor Final). */
export const DIAN_FINAL_CONSUMER_DOCUMENT_NUMBER = '222222222222';

/** Tipo de identificación con el que la DIAN espera el Consumidor Final. */
export const DIAN_FINAL_CONSUMER_TYPE_CODE = '13';

/** Razón social con la que se declara al adquiriente no identificado. */
export const DIAN_FINAL_CONSUMER_NAME = 'Consumidor Final';

/**
 * Números que la gente teclea cuando no tiene el dato. NO incluye el
 * `222222222222` de Consumidor Final: ese es un valor oficial y se juzga por el
 * modo del documento, no por la lista de rellenos.
 */
const PLACEHOLDER_DOCUMENT_NUMBERS: ReadonlySet<string> = new Set([
  '0',
  '1',
  '123',
  '1234',
  '12345',
  '123456',
  '1234567',
  '12345678',
  '123456789',
  '1234567890',
  '987654321',
]);

/** Nombres que significan «no lo sé», no una razón social. */
const PLACEHOLDER_NAMES: ReadonlySet<string> = new Set([
  'N/A',
  'NA',
  'ND',
  'N.D.',
  'S/N',
  'SIN NOMBRE',
  'SIN DATOS',
  'CLIENTE',
  'CLIENTE GENERICO',
  'CLIENTE GENÉRICO',
  'CLIENTE OCASIONAL',
  'GENERICO',
  'GENÉRICO',
  'ANONIMO',
  'ANÓNIMO',
  'TEST',
  'PRUEBA',
  'XXX',
  'XXXX',
  'ASDF',
  '-',
  '.',
  '--',
]);

/**
 * Correo suficientemente estricto para atrapar lo que la DIAN rechaza y
 * suficientemente laxo para no inventar reglas de RFC que ningún validador de la
 * industria aplica: un `@`, algo antes, un dominio con punto y sin espacios.
 */
const EMAIL_PATTERN = /^[^\s@]+@[^\s@.]+(\.[^\s@.]+)+$/;

/** ISO 3166-1 alfa-2: exactamente dos letras. */
const COUNTRY_CODE_PATTERN = /^[A-Z]{2}$/;

/** Código DANE (Divipola) de municipio: 5 dígitos, los 2 primeros del depto. */
const DANE_MUNICIPALITY_PATTERN = /^\d{5}$/;

/** Código DANE de departamento: 2 dígitos. */
const DANE_DEPARTMENT_PATTERN = /^\d{2}$/;

/** País cuya división político-administrativa es la Divipola del DANE. */
const COLOMBIA_COUNTRY_CODE = 'CO';

// -----------------------------------------------------------------------------
// CONTRATO DE ENTRADA
// -----------------------------------------------------------------------------

/**
 * Cómo se identifica al adquiriente EN ESTE DOCUMENTO. Es una declaración del
 * documento, no una propiedad del cliente: el mismo cliente puede comprar en el
 * mostrador sin pedir factura nominativa un día y pedirla al siguiente.
 *
 * - `final_consumer` — venta de mostrador a un adquiriente que no se identifica.
 *   El `222222222222` es correcto y esperado; no se exige dirección ni correo.
 * - `nominative` — factura a nombre de alguien. Se exige identidad completa, y
 *   el `222222222222` pasa a ser prueba de que el dato se perdió.
 */
export type AcquirerIdentificationMode = 'final_consumer' | 'nominative';

/** Dirección fiscal del adquiriente, tal como llega del registro de clientes. */
export interface CustomerFiscalAddressInput {
  address_line?: string | null;
  /** Código DANE del municipio (5 dígitos). */
  city_code?: string | null;
  city_name?: string | null;
  /** Código DANE del departamento (2 dígitos). */
  department_code?: string | null;
  department_name?: string | null;
  /** ISO 3166-1 alfa-2. */
  country_code?: string | null;
  postal_code?: string | null;
}

/** Todo lo que hace falta para juzgar si un adquiriente es emitible. */
export interface CustomerFiscalIdentityInput {
  /**
   * OBLIGATORIO y sin valor por defecto a propósito. Es la pieza que convierte
   * el Consumidor Final en una decisión y no en un fallback: quien emite tiene
   * que declarar qué está emitiendo.
   */
  identification_mode: AcquirerIdentificationMode;
  /** Código DIAN (`'31'`) o alias interno (`'NIT'`). */
  document_type?: string | null;
  document_number?: string | null;
  /** DV declarado. Se confronta contra el derivado; nunca se acepta a ciegas. */
  verification_digit?: string | null;
  /** `'NATURAL'` | `'JURIDICA'`. Ausente ⇒ se deriva del tipo de documento. */
  person_type?: string | null;
  /** Razón social (jurídica) o nombre completo (natural). */
  legal_name?: string | null;
  first_name?: string | null;
  last_name?: string | null;
  /** Valor de `tax_regime_enum`. */
  tax_regime?: string | null;
  /** Códigos de la casilla 53 del RUT. */
  tax_responsibilities?: readonly string[] | null;
  email?: string | null;
  phone?: string | null;
  address?: CustomerFiscalAddressInput | null;
  /**
   * Otras direcciones REALES del mismo adquiriente — el segundo y tercer
   * escalón de la cascada de respaldo que aplica el emisor al transmitir
   * (`acquirer-address.resolver.ts`: fiscal → cualquier otra del cliente →
   * dirección de la tienda que emite). `undefined` significa «el llamador no
   * investigó la cascada»: el reporte se queda en `ADDRESS_REQUIRED` como
   * advertencia, igual que siempre. Un ARREGLO (vacío o no) significa «el
   * llamador SÍ la investigó», y entonces `ADDRESS_REQUIRED` escala a
   * `ADDRESS_UNRESOLVABLE` (bloqueante) si ninguna candidata resuelve — porque
   * eso es EXACTAMENTE lo que hoy hace `resolveAcquirerAddressForDocument` al
   * transmitir, sólo que después de haber numerado. Ver el docblock de
   * `checkAddress`.
   */
  other_addresses?: readonly CustomerFiscalAddressInput[] | null;
}

// -----------------------------------------------------------------------------
// CONTRATO DE SALIDA
// -----------------------------------------------------------------------------

export type FiscalIdentitySeverity = 'blocker' | 'warning';

/** Código estable de hallazgo, para que la UI mapee sin parsear texto. */
export type CustomerFiscalIdentityCode =
  // Modo consumidor final
  | 'IMPLICIT_FINAL_CONSUMER'
  | 'FINAL_CONSUMER_NUMBER_MISMATCH'
  | 'FINAL_CONSUMER_TYPE_MISMATCH'
  | 'FINAL_CONSUMER_IS_IDENTIFIED'
  // Identificación
  | 'DOCUMENT_TYPE_REQUIRED'
  | 'DOCUMENT_TYPE_UNKNOWN'
  | 'DOCUMENT_NUMBER_REQUIRED'
  | 'DOCUMENT_NUMBER_NOT_NUMERIC'
  | 'DOCUMENT_NUMBER_IMPLAUSIBLE_LENGTH'
  | 'DOCUMENT_NUMBER_PLACEHOLDER'
  // Dígito de verificación
  | 'VERIFICATION_DIGIT_MISMATCH'
  | 'VERIFICATION_DIGIT_NOT_APPLICABLE'
  // Nombre y tipo de persona
  | 'LEGAL_NAME_REQUIRED'
  | 'PERSON_NAME_REQUIRED'
  | 'NAME_PLACEHOLDER'
  | 'FAMILY_NAME_MISSING'
  | 'PERSON_TYPE_UNKNOWN'
  | 'PERSON_TYPE_DOCUMENT_MISMATCH'
  // Régimen y responsabilidades
  | 'TAX_REGIME_UNKNOWN'
  | 'TAX_RESPONSIBILITY_MALFORMED'
  | 'TAX_RESPONSIBILITY_UNKNOWN'
  | 'TAX_RESPONSIBILITIES_MISSING'
  // Dirección
  | 'ADDRESS_REQUIRED'
  | 'ADDRESS_UNRESOLVABLE'
  | 'COUNTRY_CODE_REQUIRED'
  | 'COUNTRY_CODE_MALFORMED'
  | 'CITY_CODE_REQUIRED'
  | 'CITY_CODE_MALFORMED'
  | 'CITY_NAME_REQUIRED'
  | 'DEPARTMENT_CODE_MALFORMED'
  | 'DEPARTMENT_CITY_MISMATCH'
  | 'DEPARTMENT_NAME_REQUIRED'
  | 'ADDRESS_LINE_MISSING'
  | 'POSTAL_CODE_MISSING'
  // Contacto
  | 'EMAIL_MISSING'
  | 'EMAIL_MALFORMED';

/**
 * Un hallazgo. `problem` dice QUÉ está mal y por qué importa ante la DIAN;
 * `fix` dice CÓMO se corrige y DÓNDE, nombrando la pantalla. Un bloqueante sin
 * `fix` es un callejón sin salida para quien está parado frente al formulario,
 * así que la interfaz lo hace obligatorio y el test lo verifica.
 */
export interface CustomerFiscalIdentityFinding {
  code: CustomerFiscalIdentityCode;
  severity: FiscalIdentitySeverity;
  /** Campo del adquiriente al que apunta el hallazgo. */
  field: string;
  problem: string;
  fix: string;
  /** Datos seguros para el cliente (nunca secretos). */
  details?: Record<string, unknown>;
}

/** Dirección ya juzgada. Ningún campo se rellena con un valor inventado. */
export interface NormalizedCustomerFiscalAddress {
  address_line: string | null;
  city_code: string | null;
  city_name: string | null;
  department_code: string | null;
  department_name: string | null;
  country_code: string;
  postal_code: string | null;
}

/**
 * Identidad lista para emitir. Se entrega SOLO cuando no hay bloqueantes, y
 * existe para que quien emite no tenga que volver a derivar nada — que es
 * exactamente cómo nacieron los fallbacks que este validador viene a matar.
 */
export interface NormalizedCustomerFiscalIdentity {
  mode: AcquirerIdentificationMode;
  /** Código DIAN para `@schemeID`. */
  document_type_code: string;
  /** Alias canónico para `@schemeName`. */
  document_type_alias: string;
  /** Número sin separadores y SIN DV. */
  document_number: string;
  /** DV DERIVADO. `null` cuando el tipo no lleva DV — nunca cadena vacía. */
  verification_digit: string | null;
  person_type: 'NATURAL' | 'JURIDICA';
  /** Razón social o nombre completo, ya resuelto. */
  name: string;
  first_name: string | null;
  last_name: string | null;
  email: string | null;
  phone: string | null;
  /** Con `R-99-PN` cuando el cliente no declaró ninguna. */
  tax_responsibilities: string[];
  address: NormalizedCustomerFiscalAddress | null;
}

/** Veredicto completo sobre un adquiriente. */
export interface CustomerFiscalIdentityReport {
  /** `true` cuando no hay ningún hallazgo bloqueante. */
  emittable: boolean;
  mode: AcquirerIdentificationMode;
  findings: CustomerFiscalIdentityFinding[];
  blockers: CustomerFiscalIdentityFinding[];
  warnings: CustomerFiscalIdentityFinding[];
  /** Poblada solo cuando `emittable` es `true`. */
  normalized: NormalizedCustomerFiscalIdentity | null;
}

// -----------------------------------------------------------------------------
// RÓTULOS DE PANTALLA
//
// Un mensaje que dice «customer_document_type is invalid» obliga al comerciante
// a adivinar dónde se arregla. Estos rótulos existen para que cada `fix` termine
// nombrando el clic exacto.
// -----------------------------------------------------------------------------

const SCREEN_FISCAL_DATA =
  'Clientes → abre la ficha del cliente → pestaña «Datos fiscales»';
const SCREEN_ADDRESS =
  'Clientes → abre la ficha del cliente → pestaña «Direcciones» → dirección principal';
const SCREEN_CONTACT =
  'Clientes → abre la ficha del cliente → pestaña «Datos de contacto»';

// -----------------------------------------------------------------------------
// EL VALIDADOR
// -----------------------------------------------------------------------------

@Injectable()
export class CustomerFiscalIdentityValidator {
  /**
   * Juzga un adquiriente y devuelve TODOS los hallazgos.
   *
   * No lanza y no devuelve un booleano: un booleano obliga a quien lo consume a
   * redactar el mensaje, y ahí es donde se pierde la instrucción de corrección.
   */
  validate(input: CustomerFiscalIdentityInput): CustomerFiscalIdentityReport {
    const findings: CustomerFiscalIdentityFinding[] = [];
    const mode = input.identification_mode;

    const document_number_digits = onlyDigits(input.document_number);
    const document_number_raw = (input.document_number ?? '').trim();
    const declared_type = resolveIdentificationType(input.document_type);
    const has_declared_type = (input.document_type ?? '').trim().length > 0;
    const name = this.resolveName(input);

    // -------------------------------------------------------------------------
    // 1. CONSUMIDOR FINAL: EXPLÍCITO VS IMPLÍCITO
    // -------------------------------------------------------------------------
    if (mode === 'final_consumer') {
      findings.push(...this.checkFinalConsumer(input, document_number_digits));
      return this.buildReport(
        mode,
        findings,
        this.normalizeFinalConsumer(input),
      );
    }

    // A partir de aquí el documento es NOMINATIVO.
    //
    // El adquiriente completamente vacío es el caso que hoy sale al XML como
    // «Consumidor Final / 222222222222 / Bogotá». Se reporta como UN bloqueante
    // y se corta: emitir además «falta el tipo», «falta el número», «falta el
    // nombre» y «falta el municipio» entierra el único mensaje que explica lo
    // que de verdad pasó — que no hay cliente.
    const identity_is_empty =
      !has_declared_type && !document_number_raw && !name.full;
    const number_is_final_consumer_sentinel =
      document_number_digits === DIAN_FINAL_CONSUMER_DOCUMENT_NUMBER;

    if (identity_is_empty || number_is_final_consumer_sentinel) {
      findings.push({
        code: 'IMPLICIT_FINAL_CONSUMER',
        severity: 'blocker',
        field: 'document_number',
        problem: identity_is_empty
          ? 'El documento se está emitiendo como factura nominativa pero no tiene adquiriente: no hay tipo de identificación, ni número, ni nombre. Tal como está, el XML saldría declarando «Consumidor Final», identificación 222222222222 y municipio Bogotá — datos que nadie verificó, sobre una factura que sí lleva nombre propio.'
          : `El adquiriente está identificado con ${DIAN_FINAL_CONSUMER_DOCUMENT_NUMBER}, que es el número oficial del Consumidor Final (adquiriente NO identificado). En una factura nominativa ese número significa que el dato del cliente se perdió, no que el cliente sea anónimo.`,
        fix: `Si la venta es a un cliente identificado, carga su identificación real en ${SCREEN_FISCAL_DATA} y vuelve a validar el documento. Si de verdad es una venta de mostrador sin factura nominativa, emítela como documento a consumidor final desde el POS en vez de como factura nominativa.`,
        details: {
          identification_mode: mode,
          document_number: document_number_raw || null,
        },
      });

      if (identity_is_empty) {
        return this.buildReport(mode, findings, null);
      }
    }

    // -------------------------------------------------------------------------
    // 2. TIPO DE IDENTIFICACIÓN
    // -------------------------------------------------------------------------
    if (!has_declared_type) {
      findings.push({
        code: 'DOCUMENT_TYPE_REQUIRED',
        severity: 'blocker',
        field: 'document_type',
        problem:
          'El adquiriente no tiene tipo de identificación. La DIAN lo exige en `@schemeID` de la identificación, y sin él el documento no se puede armar.',
        fix: `Edita el cliente en ${SCREEN_FISCAL_DATA} y elige el tipo de identificación (${this.typeMenu()}).`,
      });
    } else if (!declared_type) {
      findings.push({
        code: 'DOCUMENT_TYPE_UNKNOWN',
        severity: 'blocker',
        field: 'document_type',
        problem: `«${(input.document_type ?? '').trim()}» no es un tipo de identificación de la tabla DIAN del Anexo Técnico 19. Un código fuera de la lista se rechaza con «este código no corresponde a un valor válido de la lista».`,
        fix: `Corrige el tipo de identificación del cliente en ${SCREEN_FISCAL_DATA}: los valores admitidos son ${this.typeMenu()}.`,
        details: { document_type: (input.document_type ?? '').trim() },
      });
    }

    // -------------------------------------------------------------------------
    // 3. NÚMERO DE IDENTIFICACIÓN
    // -------------------------------------------------------------------------
    findings.push(
      ...this.checkDocumentNumber(
        declared_type,
        document_number_raw,
        document_number_digits,
        number_is_final_consumer_sentinel,
      ),
    );

    // -------------------------------------------------------------------------
    // 4. DÍGITO DE VERIFICACIÓN
    // -------------------------------------------------------------------------
    findings.push(
      ...this.checkVerificationDigit(
        declared_type,
        input.verification_digit,
        document_number_digits,
      ),
    );

    // -------------------------------------------------------------------------
    // 5. NOMBRE Y TIPO DE PERSONA
    // -------------------------------------------------------------------------
    const person_type = this.resolvePersonType(input.person_type, declared_type);
    findings.push(
      ...this.checkPersonAndName(input, name, person_type, declared_type),
    );

    // -------------------------------------------------------------------------
    // 6. RÉGIMEN Y RESPONSABILIDADES
    // -------------------------------------------------------------------------
    findings.push(...this.checkFiscalClassification(input));

    // -------------------------------------------------------------------------
    // 7. DIRECCIÓN
    // -------------------------------------------------------------------------
    findings.push(...this.checkAddress(input.address, input.other_addresses));

    // -------------------------------------------------------------------------
    // 8. CORREO ELECTRÓNICO
    // -------------------------------------------------------------------------
    findings.push(...this.checkEmail(input.email));

    const normalized = this.normalizeNominative(
      input,
      declared_type,
      document_number_digits,
      person_type,
      name,
    );
    return this.buildReport(mode, findings, normalized);
  }

  // ---------------------------------------------------------------------------
  // CONSUMIDOR FINAL EXPLÍCITO
  // ---------------------------------------------------------------------------

  /**
   * En modo `final_consumer` NO se exige identidad: se exige que la identidad
   * que viaje sea la oficial. Ese es todo el punto — el número está permitido
   * porque el documento lo pidió, no porque un campo quedó vacío.
   *
   * Tampoco se exige dirección ni correo: en una venta de mostrador el
   * adquiriente no dejó ninguna de las dos, y exigirlas obligaría a inventarlas,
   * que es el defecto que este archivo cierra.
   */
  private checkFinalConsumer(
    input: CustomerFiscalIdentityInput,
    document_number_digits: string,
  ): CustomerFiscalIdentityFinding[] {
    const findings: CustomerFiscalIdentityFinding[] = [];

    // Un número distinto del oficial. Vacío es correcto: se normaliza al oficial.
    if (
      document_number_digits &&
      document_number_digits !== DIAN_FINAL_CONSUMER_DOCUMENT_NUMBER
    ) {
      const identified = this.looksLikeRealIdentification(
        input,
        document_number_digits,
      );
      findings.push({
        code: identified
          ? 'FINAL_CONSUMER_IS_IDENTIFIED'
          : 'FINAL_CONSUMER_NUMBER_MISMATCH',
        severity: 'warning',
        field: 'document_number',
        problem: identified
          ? `El documento se declaró a consumidor final, pero el adquiriente sí trae una identificación real (${document_number_digits}). El documento se emitirá igual a nombre de «${DIAN_FINAL_CONSUMER_NAME}» con ${DIAN_FINAL_CONSUMER_DOCUMENT_NUMBER}, así que ese cliente NO quedará como adquiriente de la operación y no podrá descontar la compra.`
          : `El adquiriente no identificado se declara con ${DIAN_FINAL_CONSUMER_DOCUMENT_NUMBER}, y aquí llegó «${document_number_digits}». Se emitirá con el número oficial.`,
        fix: `Si el cliente pidió factura a su nombre, emite el documento como factura nominativa en vez de a consumidor final. Si no la pidió, no hay nada que corregir: se emitirá con ${DIAN_FINAL_CONSUMER_DOCUMENT_NUMBER}.`,
        details: { document_number: document_number_digits },
      });
    }

    // El tipo, si viene, debe ser el que la DIAN espera para el no identificado.
    const declared_type = resolveIdentificationType(input.document_type);
    if (
      (input.document_type ?? '').trim() &&
      declared_type?.code !== DIAN_FINAL_CONSUMER_TYPE_CODE
    ) {
      findings.push({
        code: 'FINAL_CONSUMER_TYPE_MISMATCH',
        severity: 'warning',
        field: 'document_type',
        problem: `El consumidor final se declara con tipo de identificación ${DIAN_FINAL_CONSUMER_TYPE_CODE} (cédula de ciudadanía) y aquí llegó «${(input.document_type ?? '').trim()}». Se emitirá con el tipo oficial.`,
        fix: 'No requiere acción si la venta es de mostrador. Si el cliente sí se identificó, emite una factura nominativa.',
        details: { document_type: (input.document_type ?? '').trim() },
      });
    }

    return findings;
  }

  /**
   * ¿Lo que trae el adquiriente parece una identificación de verdad y no ruido?
   * Se usa solo para escoger el mensaje del hallazgo, nunca para decidir el modo:
   * el modo lo declara el documento y no se deduce de los datos.
   */
  private looksLikeRealIdentification(
    input: CustomerFiscalIdentityInput,
    document_number_digits: string,
  ): boolean {
    if (PLACEHOLDER_DOCUMENT_NUMBERS.has(document_number_digits)) return false;
    if (this.isRepeatedDigits(document_number_digits)) return false;
    const type = resolveIdentificationType(input.document_type);
    const min = type?.min_length ?? 6;
    return document_number_digits.length >= min;
  }

  // ---------------------------------------------------------------------------
  // NÚMERO
  // ---------------------------------------------------------------------------

  private checkDocumentNumber(
    type: DianIdentificationType | undefined,
    raw: string,
    digits: string,
    already_reported_as_final_consumer: boolean,
  ): CustomerFiscalIdentityFinding[] {
    const findings: CustomerFiscalIdentityFinding[] = [];

    if (!raw) {
      findings.push({
        code: 'DOCUMENT_NUMBER_REQUIRED',
        severity: 'blocker',
        field: 'document_number',
        problem:
          'El adquiriente no tiene número de identificación. Es el valor que la DIAN publica en la identificación del adquiriente y el que entra al hash del CUFE; sin él el documento no identifica a nadie.',
        fix: `Carga el número de identificación del cliente en ${SCREEN_FISCAL_DATA}.`,
      });
      return findings;
    }

    // El sentinel ya se reportó como Consumidor Final implícito: repetirlo como
    // «relleno» sería el mismo defecto contado dos veces con otro nombre.
    if (already_reported_as_final_consumer) {
      return findings;
    }

    // El valor COMPARABLE depende del tipo: para un documento numérico son sus
    // dígitos; para un pasaporte o un NIT de otro país, la cadena sin
    // separadores. Medir un alfanumérico por `onlyDigits` haría que
    // «ES-B12345678» se comparara como «12345678» y cayera en la lista de
    // rellenos siendo una identificación legítima.
    const cleaned = raw.replace(/[\s.\-]/g, '');
    const comparable = type && !type.numeric ? cleaned : digits;

    if (
      PLACEHOLDER_DOCUMENT_NUMBERS.has(comparable) ||
      (comparable.length > 1 && this.isRepeatedDigits(comparable))
    ) {
      findings.push({
        code: 'DOCUMENT_NUMBER_PLACEHOLDER',
        severity: 'blocker',
        field: 'document_number',
        problem: `«${raw}» es un número de relleno, no una identificación. Emitido, el documento declara ante la DIAN un adquiriente que no existe, y corregirlo después exige nota crédito.`,
        fix: `Reemplázalo por la identificación real del cliente en ${SCREEN_FISCAL_DATA}. Si el comprador no se identificó, emite el documento a consumidor final en vez de como factura nominativa.`,
        details: { document_number: raw },
      });
      return findings;
    }

    // Sin tipo reconocido no hay regla de forma que aplicar; el hallazgo del tipo
    // ya está emitido y añadir uno de longitud solo añadiría ruido.
    if (!type) return findings;

    const value = comparable;

    if (type.numeric && /[^\d]/.test(cleaned)) {
      findings.push({
        code: 'DOCUMENT_NUMBER_NOT_NUMERIC',
        severity: 'blocker',
        field: 'document_number',
        problem: `«${raw}» tiene caracteres que no son dígitos y ${type.label} es un documento numérico. La DIAN valida la forma del número contra el tipo declarado.`,
        fix: `Deja solo los dígitos del documento en ${SCREEN_FISCAL_DATA} (sin puntos, guiones ni letras). El dígito de verificación no va en este campo.`,
        details: { document_type: type.code, document_number: raw },
      });
      return findings;
    }

    if (value.length < type.min_length || value.length > type.max_length) {
      findings.push({
        code: 'DOCUMENT_NUMBER_IMPLAUSIBLE_LENGTH',
        severity: 'blocker',
        field: 'document_number',
        problem: `«${raw}» tiene ${value.length} ${value.length === 1 ? 'carácter' : 'caracteres'} y ${type.label} tiene entre ${type.min_length} y ${type.max_length}. Un número de longitud imposible es casi siempre un dato incompleto o el DV pegado al número.`,
        fix: `Revisa el número en ${SCREEN_FISCAL_DATA}. Si es un NIT, el dígito de verificación va en su propio campo, no pegado al número.`,
        details: {
          document_type: type.code,
          length: value.length,
          min_length: type.min_length,
          max_length: type.max_length,
        },
      });
    }

    return findings;
  }

  private isRepeatedDigits(digits: string): boolean {
    return digits.length > 0 && /^(\d)\1*$/.test(digits);
  }

  // ---------------------------------------------------------------------------
  // DÍGITO DE VERIFICACIÓN
  // ---------------------------------------------------------------------------

  /**
   * EL DV ES UN CHECKSUM, NO UN DATO DE CAPTURA.
   *
   * Es una función del número (módulo 11, `computeNitDv`), así que un valor
   * almacenado que discrepa está mal por definición y no hay ambigüedad sobre
   * cuál gana: gana el derivado. Por eso ausente NO es un hallazgo — se deriva —
   * y presente-y-distinto SÍ lo es, con ambos valores en el mensaje para que se
   * vea de dónde salió.
   *
   * SOLO EL NIT LLEVA DV. Una cédula son diez dígitos de dato y ninguno de
   * checksum. Que traiga uno no es un detalle cosmético: `UblCommonBuilder`
   * emite la identificación como `<número>-<DV>` cuando el DV está presente, así
   * que una cédula con DV sale al XML como `1118860776-3` — la identificación de
   * nadie. Y por el otro lado, `dianPartyId` recorta el último dígito SOLO
   * cuando la parte declaró NIT, precisamente porque recortárselo a una cédula
   * produciría la cédula de OTRA persona, el hash no cuadraría y la DIAN
   * rechazaría el documento con el consecutivo ya gastado.
   */
  private checkVerificationDigit(
    type: DianIdentificationType | undefined,
    provided: string | null | undefined,
    document_number_digits: string,
  ): CustomerFiscalIdentityFinding[] {
    const declared = (provided ?? '').trim();
    if (!type) return [];

    if (!type.carries_verification_digit) {
      if (!declared) return [];
      return [
        {
          code: 'VERIFICATION_DIGIT_NOT_APPLICABLE',
          severity: 'blocker',
          field: 'verification_digit',
          problem: `${type.label} no lleva dígito de verificación —solo el NIT lo tiene— y este cliente trae «${declared}». El XML publica la identificación como «número-DV» cuando hay DV, así que se emitiría «${document_number_digits}-${declared}», que no es la identificación de esta persona.`,
          fix: `Borra el dígito de verificación del cliente en ${SCREEN_FISCAL_DATA}: ese campo solo aplica cuando el tipo de identificación es NIT.`,
          details: {
            document_type: type.code,
            verification_digit: declared,
          },
        },
      ];
    }

    // NIT sin DV: se deriva. No es un hallazgo — pedirle el checksum a un humano
    // solo invita al error tipográfico que la DIAN detecta después de gastar el
    // consecutivo.
    if (!declared) return [];
    if (!document_number_digits) return [];

    const derived = computeNitDv(document_number_digits);
    if (declared === derived) return [];

    return [
      {
        code: 'VERIFICATION_DIGIT_MISMATCH',
        severity: 'blocker',
        field: 'verification_digit',
        problem: `El dígito de verificación guardado es «${declared}», pero el NIT ${document_number_digits} tiene DV «${derived}» según el módulo 11 de la DIAN. Uno de los dos está mal tecleado, y el documento se emitiría afirmando un NIT que no existe.`,
        fix: `Confronta el NIT y su DV con el RUT del cliente y corrígelos en ${SCREEN_FISCAL_DATA}. El DV es un cálculo sobre el número: si el número es correcto, el DV correcto es «${derived}».`,
        details: {
          document_number: document_number_digits,
          provided_verification_digit: declared,
          computed_verification_digit: derived,
        },
      },
    ];
  }

  // ---------------------------------------------------------------------------
  // NOMBRE Y TIPO DE PERSONA
  // ---------------------------------------------------------------------------

  private resolveName(input: CustomerFiscalIdentityInput): {
    legal: string;
    first: string;
    last: string;
    full: string;
  } {
    const legal = (input.legal_name ?? '').trim();
    const first = (input.first_name ?? '').trim();
    const last = (input.last_name ?? '').trim();
    return {
      legal,
      first,
      last,
      full: legal || `${first} ${last}`.trim(),
    };
  }

  /**
   * Réplica de la derivación estructural de `UblCommonBuilder.buildCustomerParty`:
   * NIT ⇒ jurídica, todo lo demás ⇒ natural. Derivar de un valor declarado no es
   * inventar: es la misma clase de operación que derivar el DV del NIT.
   */
  private resolvePersonType(
    declared: string | null | undefined,
    type: DianIdentificationType | undefined,
  ): 'NATURAL' | 'JURIDICA' {
    const value = (declared ?? '').trim().toUpperCase();
    if (value === 'JURIDICA' || value === 'JURÍDICA') return 'JURIDICA';
    if (value === 'NATURAL') return 'NATURAL';
    return type?.code === '31' ? 'JURIDICA' : 'NATURAL';
  }

  private checkPersonAndName(
    input: CustomerFiscalIdentityInput,
    name: { legal: string; first: string; last: string; full: string },
    person_type: 'NATURAL' | 'JURIDICA',
    type: DianIdentificationType | undefined,
  ): CustomerFiscalIdentityFinding[] {
    const findings: CustomerFiscalIdentityFinding[] = [];
    const declared_person_type = (input.person_type ?? '').trim();

    if (
      declared_person_type &&
      !['NATURAL', 'JURIDICA', 'JURÍDICA'].includes(
        declared_person_type.toUpperCase(),
      )
    ) {
      findings.push({
        code: 'PERSON_TYPE_UNKNOWN',
        severity: 'warning',
        field: 'person_type',
        problem: `«${declared_person_type}» no es un tipo de persona reconocido. Se usará «${person_type}», derivado del tipo de identificación.`,
        fix: `Selecciona «Persona natural» o «Persona jurídica» en ${SCREEN_FISCAL_DATA}.`,
        details: { person_type: declared_person_type },
      });
    }

    // Persona jurídica con documento personal: contradicción estructural. El XML
    // emitiría `cac:PartyLegalEntity` con una cédula, que es el defecto de Anexo
    // 19 que provoca rechazo — no hay razón social honesta para un ciudadano.
    if (
      person_type === 'JURIDICA' &&
      type &&
      !['31', '50'].includes(type.code)
    ) {
      findings.push({
        code: 'PERSON_TYPE_DOCUMENT_MISMATCH',
        severity: 'blocker',
        field: 'person_type',
        problem: `El cliente está marcado como persona jurídica pero se identifica con ${type.label}. Una persona jurídica se identifica con NIT; el XML emitiría una razón social con un documento de persona natural, que la DIAN rechaza.`,
        fix: `En ${SCREEN_FISCAL_DATA}, o cambia el tipo de identificación a NIT, o marca al cliente como persona natural.`,
        details: { person_type, document_type: type.code },
      });
    }

    if (person_type === 'JURIDICA') {
      if (!name.legal) {
        findings.push({
          code: 'LEGAL_NAME_REQUIRED',
          severity: 'blocker',
          field: 'legal_name',
          problem:
            'El cliente es persona jurídica y no tiene razón social. La DIAN exige el nombre registrado del adquiriente y no hay de dónde derivarlo.',
          fix: `Carga la razón social tal como figura en el RUT del cliente en ${SCREEN_FISCAL_DATA}.`,
        });
      }
    } else if (!name.full) {
      findings.push({
        code: 'PERSON_NAME_REQUIRED',
        severity: 'blocker',
        field: 'first_name',
        problem:
          'El adquiriente no tiene nombre. La DIAN exige nombres y apellidos de la persona natural; sin ellos el documento identifica un número sin dueño.',
        fix: `Carga nombres y apellidos del cliente en ${SCREEN_FISCAL_DATA}.`,
      });
    } else if (!name.first || !name.last) {
      // El builder pone todo el nombre en `cbc:FirstName` y deja `cbc:FamilyName`
      // vacío. No afirma nada falso —de ahí que sea advertencia— pero un apellido
      // vacío es una causa conocida de rechazo por campo obligatorio.
      findings.push({
        code: 'FAMILY_NAME_MISSING',
        severity: 'warning',
        field: 'last_name',
        problem:
          'El cliente tiene el nombre en un solo campo. El XML separa nombres y apellidos, así que el apellido saldría vacío y la DIAN puede rechazar el documento por campo obligatorio no informado.',
        fix: `Separa nombres y apellidos en ${SCREEN_FISCAL_DATA}.`,
        details: { first_name: name.first || null, last_name: name.last || null },
      });
    }

    if (name.full && this.isPlaceholderName(name.full)) {
      findings.push({
        code: 'NAME_PLACEHOLDER',
        severity: 'blocker',
        field: name.legal ? 'legal_name' : 'first_name',
        problem: `«${name.full}» es un nombre de relleno, no el nombre del adquiriente. El documento saldría a nombre de nadie y quedaría así en la exógena.`,
        fix: `Reemplázalo por el nombre real del cliente en ${SCREEN_FISCAL_DATA}. Si el comprador no se identificó, emite el documento a consumidor final.`,
        details: { name: name.full },
      });
    }

    return findings;
  }

  private isPlaceholderName(value: string): boolean {
    const normalized = value.trim().toUpperCase().replace(/\s+/g, ' ');
    if (PLACEHOLDER_NAMES.has(normalized)) return true;
    // «Consumidor Final» escrito a mano en una factura nominativa ES el defecto:
    // el relleno se coló como si fuera un nombre de cliente.
    if (normalized === DIAN_FINAL_CONSUMER_NAME.toUpperCase()) return true;
    return normalized.replace(/[^A-Z0-9ÁÉÍÓÚÑÜ]/g, '').length < 2;
  }

  // ---------------------------------------------------------------------------
  // RÉGIMEN Y RESPONSABILIDADES
  // ---------------------------------------------------------------------------

  private checkFiscalClassification(
    input: CustomerFiscalIdentityInput,
  ): CustomerFiscalIdentityFinding[] {
    const findings: CustomerFiscalIdentityFinding[] = [];

    // Régimen: NO viaja como tal al XML del adquiriente (el marcador estructural
    // sale de `person_type` y de las responsabilidades), así que un valor fuera
    // de catálogo es un problema de calidad de dato, no una causa de rechazo.
    const regime = (input.tax_regime ?? '').trim();
    if (regime && !TAX_REGIME_CODES.includes(regime.toUpperCase())) {
      findings.push({
        code: 'TAX_REGIME_UNKNOWN',
        severity: 'warning',
        field: 'tax_regime',
        problem: `«${regime}» no es un régimen fiscal reconocido. Los válidos son ${TAX_REGIME_CODES.join(', ')}.`,
        fix: `Corrige el régimen del cliente en ${SCREEN_FISCAL_DATA} tomándolo de la casilla 53 de su RUT.`,
        details: { tax_regime: regime },
      });
    }

    const responsibilities = (input.tax_responsibilities ?? [])
      .map((code) => (code ?? '').trim())
      .filter((code) => code.length > 0);

    if (responsibilities.length === 0) {
      // El builder cae a `R-99-PN` («no aplica»). Es un valor legal, así que no
      // bloquea; pero es una afirmación sobre el cliente que nadie verificó, y
      // en un adquiriente gran contribuyente o autorretenedor es falsa.
      findings.push({
        code: 'TAX_RESPONSIBILITIES_MISSING',
        severity: 'warning',
        field: 'tax_responsibilities',
        problem: `El cliente no declara responsabilidades fiscales, así que el documento saldrá con ${DIAN_DEFAULT_TAX_RESPONSIBILITY} («no aplica»). Si el cliente es gran contribuyente (O-13), autorretenedor (O-15) o agente de retención de IVA (O-23), esa afirmación es falsa y afecta las retenciones de la operación.`,
        fix: `Copia las responsabilidades de la casilla 53 del RUT del cliente en ${SCREEN_FISCAL_DATA}.`,
      });
      return findings;
    }

    for (const code of responsibilities) {
      if (!TAX_RESPONSIBILITY_PATTERN.test(code)) {
        findings.push({
          code: 'TAX_RESPONSIBILITY_MALFORMED',
          severity: 'blocker',
          field: 'tax_responsibilities',
          problem: `«${code}» no tiene forma de código de responsabilidad fiscal. El valor viaja tal cual al XML y la DIAN responde «este código no corresponde a un valor válido de la lista».`,
          fix: `Corrige la responsabilidad en ${SCREEN_FISCAL_DATA}: los códigos se escriben como O-13, O-15, O-23, O-47 o ${DIAN_DEFAULT_TAX_RESPONSIBILITY}, tal como aparecen en la casilla 53 del RUT.`,
          details: { tax_responsibility: code },
        });
        continue;
      }
      if (!KNOWN_TAX_RESPONSIBILITIES.includes(code)) {
        // Forma válida pero fuera del catálogo conocido: la lista de la DIAN
        // crece por resolución, así que se avisa en vez de bloquear un código
        // nuevo y legítimo.
        findings.push({
          code: 'TAX_RESPONSIBILITY_UNKNOWN',
          severity: 'warning',
          field: 'tax_responsibilities',
          problem: `«${code}» tiene forma válida pero no está en el catálogo de responsabilidades que Vendix conoce (${KNOWN_TAX_RESPONSIBILITIES.join(', ')}). Se emitirá tal cual.`,
          fix: `Verifica el código contra la casilla 53 del RUT del cliente en ${SCREEN_FISCAL_DATA}. Si la DIAN lo publicó recientemente, añádelo al catálogo de responsabilidades.`,
          details: { tax_responsibility: code },
        });
      }
    }

    return findings;
  }

  // ---------------------------------------------------------------------------
  // DIRECCIÓN
  // ---------------------------------------------------------------------------

  /**
   * QUE FALTE NO SE RESUELVE INVENTANDO BOGOTÁ.
   *
   * `buildAddressFields` rellena hoy municipio `11001`, ciudad `Bogotá`,
   * departamento `Bogotá`/`11` y código postal `110111`. Cada uno de esos
   * valores es una afirmación sobre DÓNDE ocurrió la operación, y el municipio
   * del adquiriente es un dato que la DIAN cruza. Por eso los cuatro que
   * falsearían la ubicación bloquean, y solo la línea de dirección —cuyo
   * fallback es `N/A`, que admite la ausencia en vez de mentir— avisa.
   *
   * Los códigos DANE solo se exigen cuando el país es Colombia: un adquiriente
   * extranjero no tiene municipio Divipola, y pedírselo bloquearía toda factura
   * de exportación.
   */
  private checkAddress(
    address: CustomerFiscalAddressInput | null | undefined,
    other_addresses?: readonly CustomerFiscalAddressInput[] | null,
  ): CustomerFiscalIdentityFinding[] {
    const findings: CustomerFiscalIdentityFinding[] = [];

    if (!address) {
      // `other_addresses === undefined` ⇒ el llamador no corrió la cascada de
      // respaldo. Se preserva el comportamiento histórico: sólo advertencia,
      // confiando en que el emisor resuelva por su cuenta al transmitir.
      //
      // HOY NINGÚN LLAMADOR LO PUEBLA, y es deliberado. Poblarlo bien exige
      // dos cosas que no están a mano en `invoice-flow`: ensanchar
      // `INVOICE_INCLUDE` (que trae `addresses: { take: 1 }`) y cargar la
      // dirección fiscal de la tienda emisora. Con datos PARCIALES —sólo las
      // del cliente, sin la de la tienda— el bloqueante dispararía sobre
      // documentos que la cascada del emisor SÍ habría rescatado: un bloqueo
      // falso, que es peor que el aviso que sustituye.
      //
      // Y el fallo que guarda es inalcanzable para un facturador HABILITADO:
      // `resolveAcquirerAddress` sólo devuelve `null` cuando la dirección del
      // propio emisor no es emitible, y un emisor sin municipio Divipola no
      // pasa la habilitación ante la DIAN (FAJ09/FAJ16) — no llega a tener
      // resolución con la que numerar. La regla queda escrita para el día en
      // que un llamador SÍ pueda reunir el universo completo.
      //
      // `other_addresses` es un ARREGLO (vacío o no) ⇒ el llamador SÍ reunió
      // las direcciones reales que existen — el mismo universo que agota
      // `resolveAcquirerAddressForDocument` en `dian-direct.provider.ts`
      // (dirección del cliente + dirección de la tienda emisora, si el
      // llamador la incluyó). Si NINGUNA resuelve, el emisor va a LANZAR al
      // transmitir, ya con el consecutivo numerado — así que acá se adelanta
      // el mismo bloqueo, antes de que `validate()` deje pasar el documento.
      if (other_addresses !== undefined && other_addresses !== null) {
        const has_rescue = other_addresses.some((candidate) =>
          this.isCascadeRescueUsable(candidate),
        );

        if (!has_rescue) {
          findings.push({
            code: 'ADDRESS_UNRESOLVABLE',
            severity: 'blocker',
            field: 'address',
            problem:
              'El adquiriente no tiene dirección fiscal propia, y tampoco se encontró ninguna otra dirección real —ni suya ni de la tienda que emite— que la emisión pueda declarar como respaldo. Tal como está, la transmisión a la DIAN fallaría después de haber numerado el documento.',
            fix: `Agrega una dirección con municipio y departamento al cliente en ${SCREEN_ADDRESS}, o completa la dirección de facturación de la tienda/organización que emite.`,
          });
          return findings;
        }
      }

      findings.push({
        // AVISO, no bloqueante: desde la cascada de dirección el emisor ya no
        // inventa Bogotá. Baja por los domicilios REALES que existan —fiscal,
        // luego envío, luego el de la tienda emisora— y declara cuál usó en
        // `provider_data.acquirer_address_source`. Si no hay ninguno, falla él
        // con un error tipado antes de firmar. Mantener esto en `blocker`
        // dejaba la cascada inalcanzable: el usuario veía el modal de errores
        // aunque el respaldo funcionara, que es justo el atasco reportado.
        code: 'ADDRESS_REQUIRED',
        severity: 'warning',
        field: 'address',
        problem:
          'El adquiriente no tiene dirección fiscal propia. El documento se emitirá declarando la primera dirección real disponible (la de envío del cliente o, en su defecto, la de la tienda emisora), y el origen usado queda registrado en la factura.',
        fix: `Para que el documento declare el domicilio del propio cliente, agrégalo en ${SCREEN_ADDRESS} con municipio y departamento.`,
      });
      return findings;
    }

    const country = (address.country_code ?? '').trim().toUpperCase();
    if (!country) {
      findings.push({
        code: 'COUNTRY_CODE_REQUIRED',
        severity: 'blocker',
        field: 'address.country_code',
        problem:
          'La dirección del adquiriente no declara país. El XML caería a «CO», que decide si la operación es nacional o de exportación — no es un dato que se pueda suponer.',
        fix: `Selecciona el país del cliente en ${SCREEN_ADDRESS}.`,
      });
    } else if (!COUNTRY_CODE_PATTERN.test(country)) {
      findings.push({
        code: 'COUNTRY_CODE_MALFORMED',
        severity: 'blocker',
        field: 'address.country_code',
        problem: `«${country}» no es un código de país ISO 3166-1 alfa-2 (dos letras, como CO, US o ES).`,
        fix: `Corrige el país del cliente en ${SCREEN_ADDRESS}.`,
        details: { country_code: country },
      });
    }

    const line = (address.address_line ?? '').trim();
    if (!line) {
      findings.push({
        code: 'ADDRESS_LINE_MISSING',
        severity: 'warning',
        field: 'address.address_line',
        problem:
          'La dirección del adquiriente no tiene calle. El documento saldrá con «N/A» en la línea de dirección: no afirma nada falso, pero deja la representación gráfica sin dirección de entrega.',
        fix: `Completa la dirección del cliente en ${SCREEN_ADDRESS}.`,
      });
    }

    // Divipola solo aplica a Colombia.
    if (country && country !== COLOMBIA_COUNTRY_CODE) {
      return findings;
    }

    const city_code = (address.city_code ?? '').trim();
    const department_code = (address.department_code ?? '').trim();
    const city_name = (address.city_name ?? '').trim();
    const department_name = (address.department_name ?? '').trim();

    if (!city_code) {
      findings.push({
        code: 'CITY_CODE_REQUIRED',
        severity: 'blocker',
        field: 'address.city_code',
        problem:
          'La dirección del adquiriente no tiene código DANE de municipio. Sin él el documento declara 11001 (Bogotá), que es el municipio equivocado para cualquier cliente que no esté en Bogotá.',
        fix: `Selecciona el municipio del cliente en ${SCREEN_ADDRESS}; el código DANE se completa solo al elegirlo.`,
      });
    } else if (!DANE_MUNICIPALITY_PATTERN.test(city_code)) {
      findings.push({
        code: 'CITY_CODE_MALFORMED',
        severity: 'blocker',
        field: 'address.city_code',
        problem: `«${city_code}» no es un código DANE de municipio: la Divipola son 5 dígitos, los 2 primeros del departamento (por ejemplo 05001 Medellín, 76001 Cali).`,
        fix: `Vuelve a seleccionar el municipio del cliente en ${SCREEN_ADDRESS} para que el código se cargue correctamente.`,
        details: { city_code },
      });
    }

    if (department_code && !DANE_DEPARTMENT_PATTERN.test(department_code)) {
      findings.push({
        code: 'DEPARTMENT_CODE_MALFORMED',
        severity: 'blocker',
        field: 'address.department_code',
        problem: `«${department_code}» no es un código DANE de departamento: son exactamente 2 dígitos (05 Antioquia, 11 Bogotá D.C., 76 Valle del Cauca).`,
        fix: `Vuelve a seleccionar el departamento del cliente en ${SCREEN_ADDRESS}.`,
        details: { department_code },
      });
    }

    // COHERENCIA. El código de municipio CONTIENE el de departamento, así que
    // cuando el departamento falta se DERIVA de los dos primeros dígitos del
    // municipio — la misma clase de operación que derivar el DV del NIT, y por
    // eso tampoco es un hallazgo. Lo que sí lo es: que el declarado contradiga
    // al derivado, porque entonces uno de los dos está mal y no se sabe cuál.
    if (
      city_code &&
      department_code &&
      DANE_MUNICIPALITY_PATTERN.test(city_code) &&
      DANE_DEPARTMENT_PATTERN.test(department_code) &&
      city_code.slice(0, 2) !== department_code
    ) {
      findings.push({
        code: 'DEPARTMENT_CITY_MISMATCH',
        severity: 'blocker',
        field: 'address.department_code',
        problem: `El municipio ${city_code} pertenece al departamento ${city_code.slice(0, 2)}, pero la dirección declara el departamento ${department_code}. En la Divipola los dos primeros dígitos del municipio SON el departamento, así que uno de los dos códigos está mal y el documento declararía una ubicación que no existe.`,
        fix: `Vuelve a seleccionar municipio y departamento del cliente en ${SCREEN_ADDRESS}, empezando por el departamento.`,
        details: {
          city_code,
          department_code,
          department_code_from_city: city_code.slice(0, 2),
        },
      });
    }

    if (city_code && !city_name) {
      findings.push({
        // AVISO: el nombre se deriva del código por catálogo DANE
        // (`resolveDianMunicipality`), así que el XML no puede contradecirse.
        // Si el código no resuelve, la emisión falla nombrando el municipio
        // rechazado — no lo rellena.
        code: 'CITY_NAME_REQUIRED',
        severity: 'warning',
        field: 'address.city_name',
        problem:
          'La dirección tiene código de municipio pero no nombre. El documento lo completará desde el catálogo DANE a partir del código.',
        fix: `Si el municipio no es el correcto, vuelve a seleccionarlo en ${SCREEN_ADDRESS}.`,
        details: { city_code },
      });
    }

    if ((city_code || department_code) && !department_name) {
      findings.push({
        // AVISO por la misma razón que `CITY_NAME_REQUIRED`: el departamento
        // sale del catálogo DANE junto con el municipio. Verificado en runtime:
        // una fila con `department_name` NULL y municipio 05001 emite
        // «05 / Antioquia», no «Bogotá».
        code: 'DEPARTMENT_NAME_REQUIRED',
        severity: 'warning',
        field: 'address.department_name',
        problem:
          'La dirección no tiene nombre de departamento. El documento lo derivará del municipio usando el catálogo DANE.',
        fix: `Si quieres fijarlo explícitamente, selecciona el departamento del cliente en ${SCREEN_ADDRESS}.`,
      });
    }

    if (!(address.postal_code ?? '').trim()) {
      findings.push({
        code: 'POSTAL_CODE_MISSING',
        severity: 'warning',
        field: 'address.postal_code',
        problem:
          'La dirección no tiene código postal. Hoy el documento sale con 110111, que es un código de Bogotá; el campo es opcional para la DIAN, pero el valor inventado no debería viajar.',
        fix: `Carga el código postal del cliente en ${SCREEN_ADDRESS}, o déjalo vacío para que el documento no declare ninguno.`,
      });
    }

    return findings;
  }

  /**
   * ¿Esta candidata (otra dirección del cliente, o la de la tienda emisora)
   * alcanzaría para que la cascada de respaldo del emisor
   * (`acquirer-address.resolver.ts`) la use? Réplica LIGERA del mismo criterio
   * que `checkAddress` ya aplica a la dirección declarada — país ISO válido y,
   * para Colombia, municipio DANE de 5 dígitos.
   *
   * No se llama a `UblCommonBuilder.canEmitAddress` (el criterio real que usa
   * el emisor): ese import cruzaría este validador, que es agnóstico de
   * proveedor, con el proveedor concreto `dian-direct`. La réplica puede
   * divergir del emisor en el margen (un código con forma válida que el
   * catálogo DANE real no reconoce), pero el error que importa evitar es el
   * bloqueante silencioso — un `ADDRESS_REQUIRED` que no avisa cuando la
   * cascada completa (incluida la tienda) tampoco tiene nada que ofrecer — y
   * eso sí lo cubre.
   */
  private isCascadeRescueUsable(
    candidate: CustomerFiscalAddressInput | null | undefined,
  ): boolean {
    if (!candidate) return false;

    const country = (candidate.country_code ?? '').trim().toUpperCase();
    if (!country || !COUNTRY_CODE_PATTERN.test(country)) return false;

    const has_line = Boolean((candidate.address_line ?? '').trim());
    const has_city_name = Boolean((candidate.city_name ?? '').trim());
    const city_code = (candidate.city_code ?? '').trim();

    if (country !== COLOMBIA_COUNTRY_CODE) {
      return has_line || has_city_name || Boolean(city_code);
    }

    return DANE_MUNICIPALITY_PATTERN.test(city_code);
  }

  // ---------------------------------------------------------------------------
  // CORREO
  // ---------------------------------------------------------------------------

  /**
   * DECISIÓN: correo ausente = ADVERTENCIA; correo mal formado = BLOQUEANTE.
   *
   * La DIAN valida y acepta un documento sin `cac:Contact/cbc:ElectronicMail`: el
   * builder omite el elemento en vez de fabricar una dirección, así que la
   * ausencia no hace que el documento afirme nada falso. Lo que se incumple es
   * otra obligación —entregar el ejemplar al adquiriente (art. 616-1 E.T., Res.
   * 000165/2023)—, y esa se puede subsanar después reenviando; el consecutivo no
   * se pierde. Bloquear por correo detendría además toda venta de mostrador
   * nominativa donde el comprador da su NIT y no deja correo, que es la mitad de
   * las facturas de un negocio físico.
   *
   * Un correo MAL FORMADO es el caso contrario: el XML sí declara una dirección
   * de acuse, y declara una que no puede recibir nada. Ahí sí se afirma algo
   * falso, y la DIAN valida el formato del elemento cuando está presente.
   */
  private checkEmail(
    email: string | null | undefined,
  ): CustomerFiscalIdentityFinding[] {
    const value = (email ?? '').trim();

    if (!value) {
      return [
        {
          code: 'EMAIL_MISSING',
          severity: 'warning',
          field: 'email',
          problem:
            'El adquiriente no tiene correo electrónico. El documento se emite y la DIAN lo acepta, pero el cliente no recibe la factura ni su acuse, y la obligación de entregarle el ejemplar queda incumplida.',
          fix: `Carga el correo del cliente en ${SCREEN_CONTACT}. Si el comprador no lo dio, entrégale la representación gráfica impresa y regístralo cuando lo tengas.`,
        },
      ];
    }

    if (!EMAIL_PATTERN.test(value)) {
      return [
        {
          code: 'EMAIL_MALFORMED',
          severity: 'blocker',
          field: 'email',
          problem: `«${value}» no es una dirección de correo válida. El documento la publicaría como dirección de acuse del adquiriente, declarando un buzón que no puede recibir nada.`,
          fix: `Corrige el correo del cliente en ${SCREEN_CONTACT}, o bórralo: es preferible no declarar ninguno a declarar uno inválido.`,
          details: { email: value },
        },
      ];
    }

    return [];
  }

  // ---------------------------------------------------------------------------
  // NORMALIZACIÓN
  // ---------------------------------------------------------------------------

  /** Identidad oficial del adquiriente no identificado. Nada que derivar. */
  private normalizeFinalConsumer(
    input: CustomerFiscalIdentityInput,
  ): NormalizedCustomerFiscalIdentity {
    return {
      mode: 'final_consumer',
      document_type_code: DIAN_FINAL_CONSUMER_TYPE_CODE,
      document_type_alias: 'CC',
      document_number: DIAN_FINAL_CONSUMER_DOCUMENT_NUMBER,
      verification_digit: null,
      person_type: 'NATURAL',
      name: DIAN_FINAL_CONSUMER_NAME,
      first_name: null,
      last_name: null,
      email: (input.email ?? '').trim() || null,
      phone: (input.phone ?? '').trim() || null,
      tax_responsibilities: [DIAN_DEFAULT_TAX_RESPONSIBILITY],
      address: null,
    };
  }

  private normalizeNominative(
    input: CustomerFiscalIdentityInput,
    type: DianIdentificationType | undefined,
    document_number_digits: string,
    person_type: 'NATURAL' | 'JURIDICA',
    name: { legal: string; first: string; last: string; full: string },
  ): NormalizedCustomerFiscalIdentity | null {
    if (!type) return null;

    const number = type.numeric
      ? document_number_digits
      : (input.document_number ?? '').trim().replace(/[\s.\-]/g, '');
    if (!number) return null;

    const responsibilities = (input.tax_responsibilities ?? [])
      .map((code) => (code ?? '').trim())
      .filter((code) => code.length > 0);

    const address = input.address ?? null;

    return {
      mode: 'nominative',
      document_type_code: type.code,
      document_type_alias: type.aliases[0],
      document_number: number,
      // SIEMPRE derivado, nunca el declarado: el declarado ya se confrontó y un
      // documento que no lleva DV no se lo lleva aquí.
      verification_digit: type.carries_verification_digit
        ? computeNitDv(number)
        : null,
      person_type,
      name: name.full,
      first_name: name.first || null,
      last_name: name.last || null,
      email: (input.email ?? '').trim() || null,
      phone: (input.phone ?? '').trim() || null,
      tax_responsibilities:
        responsibilities.length > 0
          ? responsibilities
          : [DIAN_DEFAULT_TAX_RESPONSIBILITY],
      address: address ? this.normalizeAddress(address) : null,
    };
  }

  /**
   * Ningún campo se rellena con un valor inventado: lo ausente queda `null` y el
   * bloqueante correspondiente ya impidió que esta normalización se entregue. La
   * única excepción es el departamento, que se DERIVA de los dos primeros
   * dígitos del municipio cuando falta — un recorte del valor declarado, no un
   * valor nuevo.
   */
  private normalizeAddress(
    address: CustomerFiscalAddressInput,
  ): NormalizedCustomerFiscalAddress {
    const city_code = (address.city_code ?? '').trim() || null;
    const declared_department = (address.department_code ?? '').trim() || null;
    const derived_department =
      city_code && DANE_MUNICIPALITY_PATTERN.test(city_code)
        ? city_code.slice(0, 2)
        : null;

    return {
      address_line: (address.address_line ?? '').trim() || null,
      city_code,
      city_name: (address.city_name ?? '').trim() || null,
      department_code: declared_department ?? derived_department,
      department_name: (address.department_name ?? '').trim() || null,
      country_code:
        (address.country_code ?? '').trim().toUpperCase() ||
        COLOMBIA_COUNTRY_CODE,
      postal_code: (address.postal_code ?? '').trim() || null,
    };
  }

  // ---------------------------------------------------------------------------
  // ENSAMBLADO
  // ---------------------------------------------------------------------------

  private buildReport(
    mode: AcquirerIdentificationMode,
    findings: CustomerFiscalIdentityFinding[],
    normalized: NormalizedCustomerFiscalIdentity | null,
  ): CustomerFiscalIdentityReport {
    const blockers = findings.filter((f) => f.severity === 'blocker');
    const warnings = findings.filter((f) => f.severity === 'warning');
    const emittable = blockers.length === 0;

    return {
      emittable,
      mode,
      findings,
      blockers,
      warnings,
      // La identidad normalizada solo se entrega cuando es emitible: devolverla
      // junto a un bloqueante invitaría a usarla igual, que es exactamente el
      // patrón «rellena y sigue» que este archivo existe para cerrar.
      normalized: emittable ? normalized : null,
    };
  }

  /** Menú de tipos para los mensajes: «NIT (31), cédula de ciudadanía (13), …». */
  private typeMenu(): string {
    return DIAN_IDENTIFICATION_TYPES.map(
      (type) => `${type.label} (${type.code})`,
    ).join(', ');
  }
}
