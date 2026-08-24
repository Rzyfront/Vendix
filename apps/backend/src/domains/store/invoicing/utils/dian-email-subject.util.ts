/**
 * ASUNTO DEL CORREO DE ENTREGA AL ADQUIRIENTE — formato normativo DIAN.
 *
 * ✅ VERIFICADO CONTRA LA FUENTE PRIMARIA — `docs/Anexo-Tecnico-Factura-
 * Electronica-de-Venta-vr-1-9.pdf`, Resolución 000165 (01/NOV/2023), Anexo
 * Técnico de la Factura Electrónica de Venta v1.9, numeral **9.1 «Recepción de
 * factura electrónica, notas débito y notas crédito»**, páginas **635-636**.
 *
 * Texto literal del anexo (p. 635):
 *
 *   «Asunto: NIT del Facturador Electrónico; Nombre del Facturador Electrónico;
 *    Número del Documento Electrónico (campo cbc:ID); Código del tipo de
 *    documento según tabla 0; Nombre comercial del facturador; Línea de negocio
 *    (este último opcional, acuerdo comercial entre las partes)
 *    Nota: el separador utilizado entre cada nombre es el punto y coma “;”»
 *
 * Tabla de XPath del anexo (p. 636), campo por campo:
 *
 * | # | Campo del Asunto                     | XPath                                                                          |
 * |---|--------------------------------------|--------------------------------------------------------------------------------|
 * | 1 | NIT del Facturador Electrónico       | `//cac:AccountingSupplierParty/cac:Party/cac:PartyTaxScheme/cbc:CompanyID`      |
 * | 2 | Nombre del Facturador Electrónico    | `//cac:AccountingSupplierParty/cac:Party/cac:PartyTaxScheme/cbc:RegistrationName` |
 * | 3 | Número del Documento Electrónico     | `//cbc:ID`                                                                     |
 * | 4 | Código del tipo de documento (tabla 0)| `//cbc:InvoiceTypeCode` — «En caso de las notas crédito y débito remitirse a los valores del numeral 0» |
 * | 5 | Nombre comercial del facturador      | `//cac:AccountingSupplierParty/cac:Party/cac:PartyName/cbc:Name` **o** `…/cac:PartyTaxScheme/cbc:RegistrationName` |
 * | 6 | Línea de negocio                     | «No está en el XML, acuerdo comercial entre las partes.» — OPCIONAL            |
 *
 * Ejemplo textual del anexo (p. 636):
 *
 *   `99998888; Facturador Ejemplo; FEV500;01; Facturador Ejemplo;ContabilidadBog`
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * CORRECCIÓN AL SUPUESTO DE PARTIDA — el defecto que este módulo cierra ANTES de
 * existir:
 *
 * El paso se planteó con «cinco campos: NIT del emisor, razón social del emisor,
 * número de documento, código del tipo de documento, y **razón social del
 * adquiriente**». El anexo dice otra cosa: son **seis** campos (el sexto
 * opcional) y el quinto es el **NOMBRE COMERCIAL DEL FACTURADOR**, no el
 * adquiriente. El adquiriente NO aparece en el asunto en ningún campo.
 *
 * Lo que hacía verosímil la suposición es precisamente lo que la desmiente: en
 * el ejemplo `901280137;TEXMALL SAS;FVET2254;01;TEXMALL SAS` el quinto campo
 * repite el segundo. No es que el emisor y el adquiriente se llamen igual: es
 * que el nombre comercial del emisor CAE a su razón social cuando no hay nombre
 * comercial configurado — y el anexo lo autoriza explícitamente al dar dos
 * XPath para el mismo campo. El ejemplo del propio anexo repite «Facturador
 * Ejemplo» en las mismas dos posiciones, por la misma razón.
 *
 * La caída está implementada de forma idéntica en el XML que se firma:
 * `ubl-common.builder.ts` emite `cac:PartyName/cbc:Name` como
 * `issuer.trade_name || issuer.legal_name`. Este módulo reproduce ESA misma
 * disyunción para que el asunto y el XML no puedan divergir.
 *
 * Haber tomado la suposición por buena habría puesto el nombre del adquiriente
 * donde el sistema receptor espera el nombre comercial del emisor. Es el tipo de
 * error que ningún test detecta y que nadie ve hasta que un cliente reclama.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * DECISIONES DE SANEAMIENTO, y por qué cada una es la menos mala:
 *
 * 1. **El `;` dentro de un campo se sustituye por un espacio; NO se rechaza el
 *    envío.** El anexo define el `;` como separador posicional y no define
 *    ningún mecanismo de escape. Un `;` literal dentro de una razón social
 *    fabricaría un campo fantasma y correría de sitio todos los campos
 *    posteriores para cualquier lector automático. Rechazar el envío sería peor:
 *    el documento ya está emitido y transmitido, el consecutivo ya se quemó, y
 *    el adquiriente tiene derecho a recibirlo. Se neutraliza el campo, no el
 *    envío. El `;` es carácter ilegal en una razón social del RUT, así que el
 *    caso solo se da con datos sucios.
 * 2. **CR, LF y controles se eliminan siempre.** Un `Subject:` con salto de
 *    línea es inyección de cabecera SMTP: permite añadir un `Bcc:` arbitrario.
 *    Esto no es una cuestión de formato DIAN, es la razón por la que el
 *    saneamiento no puede ser opcional.
 * 3. **El separador va SIN espacios.** El anexo solo regula el carácter («el
 *    separador utilizado entre cada nombre es el punto y coma “;”») y su propio
 *    ejemplo es inconsistente —`99998888; Facturador Ejemplo; FEV500;01;`—, con
 *    espacio tras tres de los cinco separadores. Esa inconsistencia demuestra
 *    que el espacio NO forma parte de la regla. Se emite sin espacios, que es
 *    además la forma del ejemplo de referencia del cliente.
 * 4. **El NIT se normaliza a su forma de `cbc:CompanyID`: dígitos, SIN el DV.**
 *    En el XML el DV viaja en el atributo `@schemeID` y `cbc:CompanyID` lleva el
 *    número desnudo (`ubl-common.builder.ts`). `organizations.tax_id` guarda en
 *    producción formas como `900123456-7`, así que copiarlo tal cual metería el
 *    DV en el asunto y el asunto dejaría de coincidir con el XML. Se deriva con
 *    `normalizeNit`, la misma utilidad que ya usa el resto del dominio fiscal.
 * 5. **No se recorta la longitud.** El anexo no fija tope para el asunto (sí
 *    para el adjunto: 2 MB). El transporte plegará la cabecera según RFC 2047 si
 *    hace falta; truncar aquí mutilaría un campo normativo.
 */
import { invoice_type_enum } from '@prisma/client';
import { normalizeNit } from '@common/utils/nit.util';
import { VendixHttpException } from '@common/errors/vendix-http.exception';
import { ErrorCodes } from '@common/errors/error-codes';
import { DIAN_DOCUMENT_TYPES } from '../providers/dian-direct/constants/dian-document-types';

/** El separador normativo. Un solo carácter, sin espacios. Anexo 1.9 §9.1. */
export const DIAN_EMAIL_SUBJECT_SEPARATOR = ';';

/**
 * Campos del asunto, nombrados como los nombra el anexo y en su orden.
 *
 * Los cuatro primeros son obligatorios. `issuer_trade_name` cae a
 * `issuer_legal_name` (el anexo da dos XPath para ese campo). `business_line` es
 * opcional por acuerdo comercial y se omite del asunto si no llega.
 */
export interface DianEmailSubjectParts {
  /** Campo 1 — `cac:PartyTaxScheme/cbc:CompanyID`. Se normaliza a NIT sin DV. */
  issuer_nit: string | null | undefined;
  /** Campo 2 — `cac:PartyTaxScheme/cbc:RegistrationName`: la RAZÓN SOCIAL. */
  issuer_legal_name: string | null | undefined;
  /** Campo 3 — `cbc:ID`: prefijo + consecutivo, tal como se transmitió. */
  document_number: string | null | undefined;
  /** Campo 4 — `cbc:InvoiceTypeCode` (tabla 0): '01', '02', '91', '92', … */
  document_type_code: string | null | undefined;
  /** Campo 5 — `cac:PartyName/cbc:Name`: el NOMBRE COMERCIAL del emisor. */
  issuer_trade_name?: string | null;
  /** Campo 6 — línea de negocio. Opcional; fuera del XML. */
  business_line?: string | null;
}

/**
 * Deja el campo apto para ocupar una posición delimitada por `;` dentro de una
 * cabecera `Subject`. Ver decisiones 1 y 2 del docblock.
 */
export function sanitizeDianSubjectField(
  value: string | null | undefined,
): string {
  return (value ?? '')
    // Controles (incluidos CR y LF) fuera: inyección de cabecera SMTP.
    .replace(/[\u0000-\u001F\u007F]+/g, ' ')
    // El separador posicional no se puede escapar, así que se neutraliza.
    .replace(/;/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

/**
 * Código de `cbc:InvoiceTypeCode` (tabla 0 del anexo) para el tipo interno de
 * documento de Vendix.
 *
 * Devuelve `undefined` en los dos casos en que el tipo interno NO determina el
 * código, y devolver un valor sería inventarlo:
 *
 * - `equivalent_adjustment_note`: la nota de ajuste al documento equivalente es
 *   '93' si es de tipo débito y '94' si es de tipo crédito (numeral 16.3). El
 *   tipo interno no distingue; lo distingue `note_concept_code` / la dirección
 *   del ajuste, que el llamador sí conoce y debe pasar explícito.
 * - `purchase_invoice`: es una factura de COMPRA, un documento recibido. No lo
 *   emite ni lo entrega este tenant, así que no tiene código de emisión.
 */
export function resolveDianDocumentTypeCode(
  invoice_type: invoice_type_enum | null | undefined,
): string | undefined {
  switch (invoice_type) {
    case 'sales_invoice':
      return DIAN_DOCUMENT_TYPES.INVOICE;
    case 'export_invoice':
      return DIAN_DOCUMENT_TYPES.EXPORT_INVOICE;
    case 'credit_note':
      return DIAN_DOCUMENT_TYPES.CREDIT_NOTE;
    case 'debit_note':
      return DIAN_DOCUMENT_TYPES.DEBIT_NOTE;
    case 'support_document':
      return DIAN_DOCUMENT_TYPES.SUPPORT_DOCUMENT;
    case 'support_adjustment_note':
      return DIAN_DOCUMENT_TYPES.SUPPORT_ADJUSTMENT_NOTE;
    case 'pos_equivalent_document':
      return DIAN_DOCUMENT_TYPES.POS_EQUIVALENT_DOCUMENT;
    default:
      return undefined;
  }
}

/**
 * Arma el asunto normativo del correo de entrega.
 *
 * @example
 * buildDianEmailSubject({
 *   issuer_nit: '901280137-1',
 *   issuer_legal_name: 'TEXMALL SAS',
 *   document_number: 'FVET2254',
 *   document_type_code: '01',
 * });
 * // → '901280137;TEXMALL SAS;FVET2254;01;TEXMALL SAS'
 *
 * @throws VendixHttpException `INVOICING_TENANT_FISCAL_DATA_INCOMPLETE` (422)
 *   si falta el NIT o la razón social del emisor — es un hueco de la identidad
 *   fiscal del tenant, con corrección concreta en el wizard fiscal.
 * @throws VendixHttpException `INVOICING_VALIDATE_001` (400) si falta el número
 *   del documento o su código de tipo — un documento sin `cbc:ID` no se ha
 *   emitido y no hay nada que entregar.
 */
export function buildDianEmailSubject(parts: DianEmailSubjectParts): string {
  const issuer_nit = normalizeNit(
    sanitizeDianSubjectField(parts.issuer_nit),
  ).number;
  const issuer_legal_name = sanitizeDianSubjectField(parts.issuer_legal_name);
  const document_number = sanitizeDianSubjectField(parts.document_number);
  const document_type_code = sanitizeDianSubjectField(parts.document_type_code);
  // Campo 5: el anexo da dos XPath para el nombre comercial, en ese orden.
  const issuer_trade_name =
    sanitizeDianSubjectField(parts.issuer_trade_name) || issuer_legal_name;
  const business_line = sanitizeDianSubjectField(parts.business_line);

  if (!issuer_nit) {
    throw new VendixHttpException(
      ErrorCodes.INVOICING_TENANT_FISCAL_DATA_INCOMPLETE,
      undefined,
      { missing_field: 'issuer_nit' },
    );
  }
  if (!issuer_legal_name) {
    throw new VendixHttpException(
      ErrorCodes.INVOICING_TENANT_FISCAL_DATA_INCOMPLETE,
      undefined,
      { missing_field: 'issuer_legal_name' },
    );
  }
  if (!document_number) {
    throw new VendixHttpException(
      ErrorCodes.INVOICING_VALIDATE_001,
      undefined,
      { missing_field: 'document_number' },
    );
  }
  if (!document_type_code) {
    throw new VendixHttpException(
      ErrorCodes.INVOICING_VALIDATE_001,
      undefined,
      { missing_field: 'document_type_code' },
    );
  }

  const fields = [
    issuer_nit,
    issuer_legal_name,
    document_number,
    document_type_code,
    issuer_trade_name,
  ];
  if (business_line) fields.push(business_line);

  return fields.join(DIAN_EMAIL_SUBJECT_SEPARATOR);
}
