import {
  ArrayMaxSize,
  ArrayMinSize,
  IsArray,
  IsBoolean,
  IsDateString,
  IsEmail,
  IsEnum,
  IsIn,
  IsInt,
  IsISO4217CurrencyCode,
  IsNotEmpty,
  IsNotIn,
  IsNumber,
  IsOptional,
  IsString,
  Matches,
  Max,
  MaxLength,
  Min,
  ValidateNested,
} from 'class-validator';
import { Transform, TransformFnParams, Type } from 'class-transformer';
import { TaxFiscalType } from '../../taxes/dto';
import { CreateCustomerDto } from '../../customers/dto/create-customer.dto';
import { CreateProductDto } from '../../products/dto';
import { FiscalResponsibilityInCatalogRule } from '../../../../common/validators/fiscal-responsibility.validator';
import { NitDvMatches } from '../../../../common/validators/nit-dv.validator';
import { DIAN_ID_TYPES } from '../providers/dian-direct/constants/dian-document-types';
import { InvoiceAddressDto, liftInvoiceAddress } from './invoice-address.dto';
import { IsWithinFiscalIssueDateWindow } from './invoice-issue-date-window.validator';
import { InvoiceWithholdingInputDto } from './invoice-withholding-input.dto';
import {
  AIU_TAXABLE_BASES,
  ENABLED_ACCOUNTING_MODELS,
  accountingModelDisabledReason,
} from '../profiles/invoice-profile-config.contract';
import type {
  AccountingModel,
  AiuTaxableBasis,
} from '../profiles/invoice-profile-config.contract';

/**
 * Códigos DIAN del tipo de identificación del adquiriente (Anexo Técnico 1.9,
 * tabla 13.2.1). Se derivan de `DIAN_ID_TYPES` —la tabla que el proveedor UBL ya
 * usa para escribir `@schemeID`— en vez de copiarse, porque dos listas del mismo
 * catálogo siempre terminan divergiendo y el que se equivoca es el XML.
 *
 * Hoy son 12: 11 Registro Civil · 12 Tarjeta de Identidad · **13 Cédula de
 * ciudadanía** · 21 Tarjeta de Extranjería · **22 Cédula de extranjería** ·
 * **31 NIT** · 41 Pasaporte · 42 Documento de Identificación Extranjero ·
 * 47 PEP · 48 PPT · 50 NIT de persona natural extranjera · 91 NUIP.
 * Los tres en negrita cubren la práctica totalidad del tráfico real.
 */
export const DIAN_IDENTIFICATION_TYPE_CODES: readonly string[] =
  Object.values(DIAN_ID_TYPES);

/**
 * Un control de texto vacío no es un valor inválido, es la ausencia de valor.
 * Sin esto, un formulario que serializa `''` en un campo de formato estricto
 * (correo, código DIAN, divisa) recibe un 400 por no haber escrito nada — que es
 * la misma familia de defecto que esta fase viene a cerrar.
 */
const blankToUndefined = ({ value }: TransformFnParams): unknown =>
  typeof value === 'string' && value.trim() === '' ? undefined : value;

/** Normaliza códigos que el estándar exige en mayúsculas (ISO 4217, 3166-1). */
const upperCodeOrUndefined = ({ value }: TransformFnParams): unknown =>
  typeof value === 'string' ? value.trim().toUpperCase() || undefined : value;

/**
 * Mensaje del piso de una llave foránea numérica del documento.
 *
 * ## Por qué toda FK necesita `@Min(1)` y por qué `@IsNumber()` no basta
 *
 * El `ValidationPipe` global se monta con `transform: true` y
 * `transformOptions.enableImplicitConversion: true`
 * (`apps/backend/src/main.ts`). Bajo esa configuración `@IsNumber()` **no es
 * una compuerta de signo**: coerciona la cadena `"-5000"` a `-5000` y la
 * aprueba, y aprueba el `0` —que es justo lo que serializa un formulario a
 * medio llenar—. El id imposible atraviesa la validación, entra al servicio
 * como número válido y sólo falla más abajo: un `findFirst` que no encuentra
 * nada y contesta 404 por la razón equivocada, o un 500 sobre lo que era una
 * petición mal formada. Un fallo de petición presentado como fallo de
 * servidor no se puede atribuir al input, que es lo que lo vuelve caro de
 * depurar.
 *
 * Con el piso declarado acá el rechazo es un **400** del pipe que nombra el
 * campo, antes de tocar la base.
 *
 * El precedente está en este MISMO archivo: `profile_id` ya lleva `@Min(1)`
 * con esta razón escrita en su docblock. La asimetría no era entre archivos —
 * era entre campos vecinos—, así que estas siete llaves eran una omisión y no
 * una decisión de diseño.
 *
 * Nota de alcance: estas son llaves de la base de Vendix, no nodos del XML. El
 * Anexo Técnico DIAN no las gobierna y no se le atribuye cifra alguna: el piso
 * `1` sale de que `id` es un `Int` autoincremental que arranca en 1.
 */
const foreignKeyFloorMessage = (field: string, consequence = ''): string =>
  `${field} debe ser un entero positivo: el mínimo es 1 porque es el id de una ` +
  `fila existente. Omite el campo si no aplica — un 0 o un negativo no ` +
  `identifica ninguna fila.${consequence ? ` ${consequence}` : ''}`;

/**
 * Códigos que ISO 4217 asigna a unidades que NO son dinero.
 *
 * Están en la norma, así que `@IsISO4217CurrencyCode()` los acepta, pero
 * ninguno puede denominar el importe de una factura:
 *
 * - `XXX` — la operación no involucra divisa alguna.
 * - `XTS` — reservado para pruebas.
 * - `XAU` `XAG` `XPT` `XPD` — oro, plata, platino y paladio (onza troy).
 * - `XDR` — Derechos Especiales de Giro del FMI.
 * - `XUA` — unidad de cuenta del Banco Africano de Desarrollo.
 * - `XBA` `XBB` `XBC` `XBD` — unidades de cuenta del mercado de bonos europeo.
 * - `XSU` — Sucre, unidad de cuenta regional.
 *
 * Se excluyen a mano porque `cbc:DocumentCurrencyCode` gobierna el
 * `@currencyID` de TODOS los importes del UBL: un `@currencyID="XXX"` afirma
 * que la factura está expresada en "ninguna divisa", y la DIAN la devuelve.
 *
 * NO se excluyen `XCD`, `XOF`, `XAF` ni `XPF`: empiezan por X pero son monedas
 * en circulación (Caribe Oriental, francos CFA y CFP).
 */
const NON_MONETARY_ISO_4217_CODES: readonly string[] = [
  'XXX',
  'XTS',
  'XAU',
  'XAG',
  'XPT',
  'XPD',
  'XDR',
  'XUA',
  'XBA',
  'XBB',
  'XBC',
  'XBD',
  'XSU',
];

export class CreateInvoiceItemDto {
  /** Piso: ver `foreignKeyFloorMessage`. */
  @IsOptional()
  @IsNumber()
  @IsInt({
    message:
      'product_id debe ser un número entero: los ids de producto no tienen fracciones.',
  })
  @Type(() => Number)
  @Min(1, {
    message: foreignKeyFloorMessage(
      'product_id',
      'Para crear el producto en la misma transacción usa inline_product en vez de un id inventado.',
    ),
  })
  product_id?: number;

  /** Piso: ver `foreignKeyFloorMessage`. */
  @IsOptional()
  @IsNumber()
  @IsInt({
    message:
      'product_variant_id debe ser un número entero: los ids de variante no tienen fracciones.',
  })
  @Type(() => Number)
  @Min(1, {
    message: foreignKeyFloorMessage(
      'product_variant_id',
      'Si la línea no es de una variante, omite el campo: un 0 haría buscar la variante «cero» y la línea saldría sin variante igual, pero con un 404 de por medio.',
    ),
  })
  product_variant_id?: number;

  /**
   * Inline product creation payload. When present AND `product_id` is omitted,
   * the backend creates a new `products` row inside the same transaction as
   * the invoice and uses the resulting `product_id`. Ignored when `product_id`
   * is provided. All `CreateProductDto` validators apply (price, type, etc.).
   */
  @IsOptional()
  @ValidateNested()
  @Type(() => CreateProductDto)
  inline_product?: CreateProductDto;

  // El trim es lo que le da dientes al `@IsNotEmpty`: `isNotEmpty` solo compara
  // contra `''`, así que sin recortar antes, una descripción de puros espacios
  // pasaría la validación y saldría en blanco en el `cbc:Description` del XML.
  //
  // F.6 — el Anexo Técnico 1.9 fija un tope DISTINTO para `cbc:Description`
  // según el documento padre: factura (regla FAZ02) 1..300, nota crédito
  // (CAZ02) 1..600, nota débito (DAZ02) sin confirmar por PDF —ver el
  // `@MaxLength` de `CreateFacturaInvoiceItemDto`—. Esta clase la comparten
  // los TRES DTOs (`CreateInvoiceDto`, `CreateCreditNoteDto`,
  // `CreateDebitNoteDto`), así que el `@MaxLength` de acá es el techo COMÚN,
  // no el de ninguno de los tres en particular: 500 es la anchura real de
  // `invoice_items.description` en la base (`VARCHAR(500)`), que es MENOR que
  // el legal de nota crédito (600) y MAYOR que el de factura (300). Subir este
  // campo a 600 para que nota crédito alcance su techo legal completo
  // requeriría ensanchar esa columna —una migración de `schema.prisma`, fuera
  // de este alcance—; mientras tanto, 500 es seguro para los tres: nunca deja
  // pasar más de lo que la columna admite.
  //
  // Factura SÍ necesita ser más estricta que el DB —300, no 500— porque el
  // Anexo la rechaza por encima de eso aunque la columna tenga espacio de
  // sobra: `CreateInvoiceDto.items` usa `CreateFacturaInvoiceItemDto`, que
  // redeclara `@IsString`/`@IsNotEmpty`/`@MaxLength(300)` completos (no sólo
  // el `@MaxLength`: ver su propio docblock — class-validator dedupea por
  // `(propertyName, type)` y las tres comparten `type: 'customValidation'`,
  // así que redeclarar una sola borraba las otras dos heredadas en
  // silencio). El `@Transform` de recorte de acá SÍ se hereda intacto.
  @Transform(({ value }) => (typeof value === 'string' ? value.trim() : value))
  @IsString({ message: 'La descripción de la línea debe ser texto.' })
  @IsNotEmpty({
    message:
      'Cada línea necesita una descripción: es lo que la DIAN publica en `cbc:Description` y lo único que el adquiriente lee en el documento.',
  })
  @MaxLength(500, {
    message:
      'La descripción de la línea no puede superar 500 caracteres: es el ancho de la columna invoice_items.description en base de datos.',
  })
  description: string;

  /**
   * Cantidad facturada. `@IsPositive()` no basta: la columna es `Decimal(12,4)`,
   * así que el mínimo representable —y el mínimo que sobrevive el redondeo al
   * persistir— es `0.0001`. Un `0` colado aquí llega al cálculo fiscal y produce
   * una línea con base gravable cero que la DIAN acepta y nadie puede cobrar.
   */
  @IsNumber({}, { message: 'La cantidad debe ser un número.' })
  @Type(() => Number)
  @Min(0.0001, {
    message:
      'La cantidad debe ser mayor que cero (mínimo 0.0001, que es la precisión de la columna). Si querías anular la línea, quítala en vez de ponerla en cero.',
  })
  quantity: number;

  @IsNumber({}, { message: 'El precio unitario debe ser un número.' })
  @Type(() => Number)
  @Min(0, {
    message:
      'El precio unitario no puede ser negativo. Para descontar valor usa discount_amount; para devolver una venta, emite una nota crédito.',
  })
  unit_price: number;

  @IsOptional()
  @IsNumber({}, { message: 'El descuento de la línea debe ser un número.' })
  @Type(() => Number)
  @Min(0, {
    message:
      'El descuento de la línea no puede ser negativo. Un descuento negativo es un recargo: súbelo al precio unitario o factúralo como línea aparte.',
  })
  discount_amount?: number;

  @IsOptional()
  @IsNumber({}, { message: 'El impuesto de la línea debe ser un número.' })
  @Type(() => Number)
  @Min(0, {
    message: 'El impuesto de la línea no puede ser negativo.',
  })
  tax_amount?: number;

  /**
   * Per-line typed taxes (DIAN). Drives both the line `tax_amount` snapshot
   * and the header `invoice_taxes` aggregate. Replaces the previous "single
   * tax_amount per line + header aggregate" model. Backward-compatible: if
   * omitted, the backend falls back to the legacy single-tax-amount path.
   */
  @IsOptional()
  @IsArray()
  @ValidateNested({ each: true })
  @ArrayMaxSize(10)
  @Type(() => CreateInvoiceTaxDto)
  taxes?: CreateInvoiceTaxDto[];

  /**
   * Per-line flag: INCLUDED in `unit_price` or ADDITIONAL on top. When omitted,
   * the backend derives it from the first item-level tax (`is_inclusive` on
   * `CreateInvoiceTaxDto`) or the catalog (`tax_rates.is_inclusive`); default
   * is ADDITIONAL for backward compatibility.
   */
  @IsOptional()
  @IsBoolean()
  is_inclusive?: boolean;

  /**
   * Unidad de medida UN/ECE rec. 20 que viaja en `@unitCode` de
   * `cbc:InvoicedQuantity` (`NIU` unidad, `KGM` kilo, `LTR` litro, `MTR` metro…).
   * Sin ella el proveedor UBL escribe el default histórico; declararla es lo que
   * permite facturar a granel sin mentir en la unidad.
   *
   * ## Por qué 5 y no los 10 que tenía
   *
   * El Anexo Técnico 1.9 acota `@unitCode` a 5 caracteres en las TRES tablas de
   * documento, así que no hay conflicto que resolver: **FAV05**
   * (`/Invoice/cac:InvoiceLine/cbc:InvoicedQuantity/@unitCode`, `A A 1-5`),
   * **CAV05** (nota crédito, `A A 2-5`) y **DAV05** (nota débito, `A A 2-5`).
   * El 10 anterior no citaba ninguna regla y dejaba pasar un código de 6 a 10
   * caracteres que la DIAN devuelve al validar la línea. Los códigos reales de
   * la rec. 20 son de 2 o 3 caracteres.
   */
  @IsOptional()
  @Transform(blankToUndefined)
  @IsString()
  @MaxLength(5, {
    message:
      'unit_code no puede superar 5 caracteres: el Anexo Técnico DIAN 1.9 acota @unitCode a 5 en las tres tablas (FAV05 factura, CAV05 nota crédito, DAV05 nota débito). Usa el código UN/ECE rec. 20 (ej. "NIU", "KGM", "LTR"), no el nombre de la unidad.',
  })
  unit_code?: string;

  /**
   * Cuenta PUC con la que esta línea debe contabilizarse cuando el usuario
   * quiere forzarla. Vacío ⇒ el mapeo por defecto de `account-mapping.service`
   * decide, que es el camino normal.
   */
  @IsOptional()
  @Transform(blankToUndefined)
  @IsString()
  @MaxLength(20, {
    message: 'account_code no puede superar 20 caracteres.',
  })
  account_code?: string;

  /**
   * Componente AIU de la línea (Administración, Imprevistos, Utilidad).
   *
   * Solo tiene sentido cuando el documento declara `operation_type = '09'`
   * (AIU). Sin marcar qué es cada línea, el motor no puede separar la base
   * gravable del resto del contrato.
   *
   * **Cuál es esa base depende del régimen, y no hay uno universal:**
   *
   * - **E.T. art. 462-1** (aseo, vigilancia, servicios temporales): la base es
   *   el AIU **completo** —A + I + U—, con un piso del 10 % del valor del
   *   contrato. Es el valor por defecto de Vendix.
   * - **Decreto 1372/1992 art. 3** (construcción): la base es **únicamente la
   *   utilidad**.
   *
   * El régimen se configura por tienda en `store_settings.invoicing.aiu.regime`;
   * este campo solo dice a qué componente pertenece la línea, no cuánto tributa.
   * Las líneas que quedan fuera de la base gravable se emiten SIN
   * `cac:TaxTotal` de línea (Anexo Técnico 1.9 §CAX01), que no es lo mismo que
   * un impuesto exento al 0 % —ese sí se emite—.
   *
   * `'contrato'` (D.2/D.4, ADR-6) es distinto de los otros tres: declara que
   * ESTA línea es el AIU **completo** del contrato (Modelo 1 /
   * `accounting_model: 'no_sumada'`), en vez de venir partido en tres
   * renglones (Modelo 2 / `'sumada'`). Es mutuamente excluyente con las otras
   * tres marcas y con una segunda línea `'contrato'` en el mismo documento —
   * ver `INVOICING_AIU_007`—. `InvoiceCalculatorService` la explota
   * internamente en A/I/U según el reparto configurado del perfil.
   */
  @IsOptional()
  @Transform(blankToUndefined)
  @IsIn(['administracion', 'imprevistos', 'utilidad', 'contrato'], {
    message:
      'aiu_component debe ser "administracion", "imprevistos", "utilidad" o "contrato". Solo aplica en facturas con operation_type="09" (AIU); si no es una factura AIU, omite el campo.',
  })
  aiu_component?: 'administracion' | 'imprevistos' | 'utilidad' | 'contrato';
}

/**
 * F.6 — línea de una FACTURA (`CreateInvoiceDto.items`), nunca de una nota.
 *
 * Acota `description` de 500 (el techo común de `CreateInvoiceItemDto`, ver su
 * docblock) a 300, que es el legal para `cac:InvoiceLine/cbc:Description` bajo
 * el Anexo Técnico 1.9 regla FAZ02.
 *
 * OJO — esto NO es «sobreescribe sólo `@MaxLength`, el resto se hereda».
 * `class-validator` no distingue `IsString`/`IsNotEmpty`/`MaxLength` entre sí:
 * las tres comparten el mismo `ValidationTypes.CUSTOM_VALIDATION`
 * (`'customValidation'`), y `MetadataStorage.getTargetValidationMetadatas`
 * dedupea por el PAR `(propertyName, type)` — no por qué constraint es. En
 * cuanto la subclase declara CUALQUIER decorador de validación sobre
 * `description`, las tres metadatas heredadas del padre para esa propiedad
 * —las tres comparten `type: 'customValidation'`— quedan filtradas por
 * completo, no sólo la que se redeclaró. Verificado con
 * `getMetadataStorage().getTargetValidationMetadatas(CreateFacturaInvoiceItemDto, …)`:
 * declarar sólo `@MaxLength(300)` dejaba UNA metadata para `description` (la
 * propia), cero heredadas — `@IsString`/`@IsNotEmpty` del padre desaparecían
 * en silencio, y una descripción vacía o no-string pasaba la validación de
 * una FACTURA. Por eso las tres viajan explícitas acá, no dos.
 *
 * El `@Transform` de recorte SÍ se hereda intacto: class-transformer resuelve
 * sus propias metadatas por clase+propiedad con `getAncestors()` y concatena
 * (padre + hijo), sin el dedupe destructivo de class-validator — confirmado
 * con el mismo repro (`description` llega ya recortado al validador aunque la
 * subclase no redeclare el `@Transform`).
 *
 * Nota crédito y nota débito NO usan esta subclase: sus techos legales
 * (CAZ02 600, DAZ02 sin confirmar) son mayores o iguales al de factura, así
 * que el techo común de 500 —limitado por la columna, no por la ley— ya las
 * cubre sin necesitar una subclase propia.
 */
export class CreateFacturaInvoiceItemDto extends CreateInvoiceItemDto {
  @IsString({ message: 'La descripción de la línea debe ser texto.' })
  @IsNotEmpty({
    message:
      'Cada línea necesita una descripción: es lo que la DIAN publica en `cbc:Description` y lo único que el adquiriente lee en el documento.',
  })
  @MaxLength(300, {
    message:
      'La descripción de la línea de una factura no puede superar 300 caracteres (Anexo Técnico DIAN 1.9, regla FAZ02 para cac:InvoiceLine/cbc:Description). Acorta el texto: una descripción más larga hace que la DIAN rechace el documento DESPUÉS de haber consumido el consecutivo autorizado.',
  })
  description: string;
}

export class CreateInvoiceTaxDto {
  /** Piso: ver `foreignKeyFloorMessage`. */
  @IsOptional()
  @IsNumber()
  @IsInt({
    message:
      'tax_rate_id debe ser un número entero: los ids del catálogo de tarifas no tienen fracciones.',
  })
  @Type(() => Number)
  @Min(1, {
    message: foreignKeyFloorMessage(
      'tax_rate_id',
      'Sin id de catálogo el impuesto se declara con tax_name, tax_rate y tax_type; no hace falta inventar un 0.',
    ),
  })
  tax_rate_id?: number;

  @IsString()
  @MaxLength(100, {
    message: 'tax_name no puede superar 100 caracteres.',
  })
  tax_name: string;

  /**
   * Tarifa en PORCENTAJE (19 = 19%), no en fracción. El techo de 100 es la cota
   * dura: una tarifa mayor produciría un impuesto superior a la base, que ningún
   * tributo colombiano admite y que la DIAN rechaza al recalcular el total.
   */
  @IsNumber({}, { message: 'tax_rate debe ser un número.' })
  @Type(() => Number)
  @Min(0, { message: 'tax_rate no puede ser negativa.' })
  @Max(100, {
    message:
      'tax_rate se expresa en porcentaje y no puede superar 100 (19 = 19%, no 0.19). Un valor mayor haría el impuesto más grande que la base.',
  })
  tax_rate: number;

  /**
   * Base gravable AFIRMADA por el cliente. **Opcional a propósito.**
   *
   * Quien manda la verdad de este número es `InvoiceCalculatorService`, que la
   * deriva de `unit_price × quantity`, el descuento y `is_inclusive`. Su propia
   * interfaz de entrada ya declara `taxable_amount?` como opcional e
   * informativo: si viene y difiere en más de un centavo del recalculado, el
   * desacuerdo sale en `divergences` en vez de silenciarse.
   *
   * Exigirlo aquí contradecía ese diseño y volvía a repartir el cálculo entre
   * cliente y servidor —que es exactamente el reparto que produjo facturas con
   * IVA en cero—: obligaba a TODO llamador (el modal fiscal, el POS, las
   * herramientas de IA, un `curl`) a calcular un importe que el servidor iba a
   * sobrescribir de todas formas, y a acertarlo al centavo sólo para que el
   * `ValidationPipe` lo dejara pasar.
   *
   * Las cotas se conservan para cuando SÍ viene: un valor presente pero
   * imposible sigue siendo un error del llamador, no un dato a corregir en
   * silencio.
   */
  @IsOptional()
  @IsNumber({}, { message: 'taxable_amount debe ser un número.' })
  @Type(() => Number)
  @Min(0, {
    message:
      'taxable_amount no puede ser negativo. Si estás revirtiendo una venta, emite una nota crédito en vez de una base negativa.',
  })
  taxable_amount?: number;

  /**
   * Cuota afirmada por el cliente. Opcional por el mismo motivo que
   * `taxable_amount`: el servidor la recalcula como `base × tarifa / 100` y ésta
   * sólo sirve para contrastar. Ver el docblock de arriba.
   */
  @IsOptional()
  @IsNumber({}, { message: 'tax_amount debe ser un número.' })
  @Type(() => Number)
  @Min(0, {
    message:
      'tax_amount no puede ser negativo. Las retenciones se declaran en withholding_amount, no como impuesto negativo.',
  })
  tax_amount?: number;

  /** Fiscal classification (iva/inc/ica/...). Defaults to iva when omitted. */
  @IsOptional()
  @IsEnum(TaxFiscalType)
  tax_type?: TaxFiscalType;

  /**
   * INCLUDED in `unit_price` (true) or ADDITIONAL on top (false). Defaults to
   * false (additional) when omitted. Drives the UBL DIAN builder's
   * `TaxInclusiveIndicator` XML attribute and the per-line desglose in the
   * frontend totals panel.
   */
  @IsOptional()
  @IsBoolean()
  is_inclusive?: boolean;
}

export class CreateInvoiceDto {
  @IsIn([
    'sales_invoice',
    'purchase_invoice',
    'export_invoice',
    'support_document',
    'support_adjustment_note',
    'pos_equivalent_document',
    'equivalent_adjustment_note',
  ])
  invoice_type:
    | 'sales_invoice'
    | 'purchase_invoice'
    | 'export_invoice'
    | 'support_document'
    | 'support_adjustment_note'
    | 'pos_equivalent_document'
    | 'equivalent_adjustment_note';

  /** Piso: ver `foreignKeyFloorMessage`. */
  @IsOptional()
  @IsNumber()
  @IsInt({
    message:
      'customer_id debe ser un número entero: los ids de cliente no tienen fracciones.',
  })
  @Type(() => Number)
  @Min(1, {
    message: foreignKeyFloorMessage(
      'customer_id',
      'Para una venta anónima omite el campo; para crear el cliente al vuelo usa inline_customer.',
    ),
  })
  customer_id?: number;

  /**
   * Inline customer creation payload. When present AND `customer_id` is
   * omitted, the backend creates a new `users` row (role='customer') inside
   * the same transaction as the invoice and uses the resulting `customer_id`.
   * Ignored when `customer_id` is provided. Full DIAN validators apply
   * (NIT+DV módulo 11, JuridicaNameRule, FiscalResponsibilityInCatalogRule).
   */
  @IsOptional()
  @ValidateNested()
  @Type(() => CreateCustomerDto)
  inline_customer?: CreateCustomerDto;

  /** Piso: ver `foreignKeyFloorMessage`. */
  @IsOptional()
  @IsNumber()
  @IsInt({
    message:
      'supplier_id debe ser un número entero: los ids de proveedor no tienen fracciones.',
  })
  @Type(() => Number)
  @Min(1, {
    message: foreignKeyFloorMessage(
      'supplier_id',
      'Sólo aplica a documento soporte y factura de compra; en una venta se omite.',
    ),
  })
  supplier_id?: number;

  /** Piso: ver `foreignKeyFloorMessage`. */
  @IsOptional()
  @IsNumber()
  @IsInt({
    message:
      'related_invoice_id debe ser un número entero: los ids de factura no tienen fracciones.',
  })
  @Type(() => Number)
  @Min(1, {
    message: foreignKeyFloorMessage(
      'related_invoice_id',
      'Es la factura original que este documento ajusta. Un 0 dejaría una nota de ajuste apuntando a la nada, y el vínculo es lo único que la hace válida ante la DIAN.',
    ),
  })
  related_invoice_id?: number;

  @IsOptional()
  @IsString()
  @MaxLength(255)
  customer_name?: string;

  @IsOptional()
  @IsString()
  @MaxLength(50)
  customer_tax_id?: string;

  /**
   * Correo del adquiriente. Es el destino del `AttachedDocument` que la norma
   * obliga a entregar, así que un correo mal escrito no rompe la validación DIAN
   * pero sí deja al cliente sin su factura.
   */
  @IsOptional()
  @Transform(blankToUndefined)
  @IsEmail(
    {},
    {
      message:
        'customer_email debe ser un correo válido (ej. cliente@dominio.com). Es la dirección a la que se entrega la factura electrónica; déjalo vacío si no la tienes.',
    },
  )
  @MaxLength(255, {
    message: 'customer_email no puede superar 255 caracteres.',
  })
  customer_email?: string;

  @IsOptional()
  @Transform(blankToUndefined)
  @IsString()
  @MaxLength(50, {
    message: 'customer_phone no puede superar 50 caracteres.',
  })
  customer_phone?: string;

  /**
   * Código DIAN del tipo de identificación del adquiriente
   * (`@schemeID` de `cbc:CompanyID`). Los tres frecuentes: **'13'** cédula de
   * ciudadanía, **'31'** NIT, **'22'** cédula de extranjería.
   *
   * Importa más de lo que parece: `dianPartyId()` recorta el dígito de
   * verificación SOLO cuando el tipo es `'31'`. Declarar NIT en una cédula le
   * amputa el último dígito y la convierte en la cédula de otra persona.
   *
   * OJO AL CABLEAR: `ProviderInvoiceData.customer_document_type` se llama igual
   * pero habla otro vocabulario — lleva la SIGLA (`'CC'`, `'NIT'`), porque el
   * adaptador la copia de `users.document_type` (`identification_type_enum`).
   * Quien conecte este campo al proveedor debe traducir código→sigla (el mapa
   * inverso de `DIAN_ID_TYPES`), no pasarlo tal cual: `dianPartyId()` tolera
   * ambos, pero `translatePersonTypeToStructural()` y
   * `normalizePartyAccountType()` solo entienden la sigla.
   */
  @IsOptional()
  @Transform(blankToUndefined)
  @IsIn(DIAN_IDENTIFICATION_TYPE_CODES, {
    message: `customer_document_type debe ser un código DIAN del catálogo de identificación: ${DIAN_IDENTIFICATION_TYPE_CODES.join(
      ', ',
    )} ('13' cédula de ciudadanía, '31' NIT, '22' cédula de extranjería). No envíes la sigla ("CC", "NIT"), envía el código.`,
  })
  customer_document_type?: string;

  /**
   * Dígito de verificación del NIT.
   *
   * Se acepta por compatibilidad con clientes que ya lo capturan, pero la fuente
   * de verdad es `computeNitDv()` (`common/utils/nit.util.ts`): el DV es un
   * checksum módulo 11 derivado del número, no un dato independiente. Un DV
   * tecleado que discrepe está mal por definición, y las filas sembradas o
   * capturadas a mano discrepan en la práctica. Lo que el cliente mande aquí
   * sirve para detectar la discrepancia, no para reemplazar el cálculo.
   */
  @IsOptional()
  @Transform(blankToUndefined)
  @IsString()
  @MaxLength(1)
  @Matches(/^\d$/, {
    message:
      'customer_verification_digit debe ser un único dígito (0-9). Si no lo conoces, omítelo: el sistema lo calcula del NIT con el algoritmo módulo 11 de la DIAN.',
  })
  // El DV es un checksum: si no cuadra con el NIT, la DIAN rechaza la
  // identificación del adquiriente DESPUÉS de haber consumido el consecutivo
  // autorizado, que no se recupera. Los nombres de campo son explícitos porque
  // este DTO habla el vocabulario DIAN (`'31'` = NIT), no la sigla que usa
  // `CreateCustomerDto`.
  @NitDvMatches({
    documentTypeField: 'customer_document_type',
    documentNumberField: 'customer_tax_id',
    verificationDigitField: 'customer_verification_digit',
    nitValue: DIAN_ID_TYPES.NIT,
  })
  customer_verification_digit?: string;

  /** Régimen tributario del adquiriente (`cbc:TaxLevelCode` / responsabilidad). */
  @IsOptional()
  @Transform(blankToUndefined)
  @IsString()
  @MaxLength(10, {
    message: 'customer_tax_regime no puede superar 10 caracteres.',
  })
  customer_tax_regime?: string;

  /**
   * Responsabilidades fiscales del RUT del adquiriente. Se validan contra el
   * mismo catálogo canónico que `CreateCustomerDto` porque terminan en el mismo
   * `cbc:TaxLevelCode` del Anexo Técnico 19: un código fuera de la tabla
   * publicada hace que la DIAN rechace el documento entero.
   */
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(20, {
    message:
      'customer_fiscal_responsibilities admite máximo 20 códigos; el RUT no lista más.',
  })
  @IsString({ each: true })
  @FiscalResponsibilityInCatalogRule()
  customer_fiscal_responsibilities?: string[];

  /**
   * Dirección fiscal del adquiriente, ahora validada contra
   * `InvoiceAddressDto`.
   *
   * Acepta tanto el objeto desglosado como un string plano —lo que hoy manda el
   * formulario del panel—; ver `liftInvoiceAddress()` para el porqué de esa
   * tolerancia. Sea cual sea la forma de entrada, lo que sale de aquí es
   * siempre una instancia de `InvoiceAddressDto` validada.
   *
   * El TIPO declarado sigue siendo `any` a propósito, y no por descuido: el
   * consumidor (`invoicing.service.ts`) escribe este valor en una columna
   * `Json` de Prisma, y `Prisma.InputJsonValue` exige una firma de índice que
   * TypeScript no infiere para las clases. Tiparlo a `InvoiceAddressDto` haría
   * fallar la compilación de un archivo que este DTO no debe arrastrar. La
   * validación en runtime —que es lo que protege al motor fiscal— la dan
   * `@Transform` + `@Type` + `@ValidateNested`, no la anotación.
   */
  @IsOptional()
  @Transform(({ value }) => liftInvoiceAddress(value))
  @ValidateNested()
  @Type(() => InvoiceAddressDto)
  customer_address?: any;

  @IsDateString(
    {},
    {
      message:
        'issue_date debe ser una fecha ISO 8601 (ej. "2026-08-15" o "2026-08-15T10:30:00Z").',
    },
  )
  @IsWithinFiscalIssueDateWindow()
  issue_date: string;

  @IsOptional()
  @Transform(blankToUndefined)
  @IsDateString(
    {},
    { message: 'due_date debe ser una fecha ISO 8601 (ej. "2026-09-15").' },
  )
  due_date?: string;

  /**
   * Divisa del documento (`cbc:DocumentCurrencyCode`). La columna es
   * `VarChar(10)` por historia, pero el valor legal son 3 letras. Se normaliza
   * a mayúsculas para que "cop" no se convierta en un 400.
   *
   * Se valida contra el catálogo ISO 4217 REAL, no contra `/^[A-Z]{3}$/`: ese
   * patrón sólo comprobaba la FORMA, así que dejaba pasar "ABC", "ZZZ" o
   * "XXX". Un código inventado no se detiene aquí: viaja al XML como el
   * `@currencyID` de todos los importes y lo devuelve la DIAN.
   *
   * OJO — que la divisa exista NO la habilita para facturar. La factura
   * electrónica colombiana se emite SIEMPRE en COP (Res. DIAN 000042/2020
   * art. 73); la divisa extranjera se declara aparte como conversión
   * (`foreign_currency` + `cac:PaymentExchangeRate`). Esa regla de negocio la
   * impone `FiscalDocumentValidator.checkCurrency` en el momento de emitir
   * (hallazgo `CURRENCY_NOT_COP`, severidad blocker, con su pantalla y su
   * explicación) y NO se duplica aquí: este DTO valida el contrato de datos
   * —«esto es una moneda»—, no la política fiscal.
   */
  @IsOptional()
  @Transform(upperCodeOrUndefined)
  @IsString()
  @IsISO4217CurrencyCode({
    message:
      'currency debe ser un código de moneda ISO 4217 (ej. "COP", "USD"). No uses el símbolo ni el nombre de la moneda.',
  })
  @IsNotIn(NON_MONETARY_ISO_4217_CODES, {
    message:
      'currency no puede ser un código ISO 4217 no monetario (XXX "sin divisa", XAU oro, XDR derechos de giro, XTS pruebas…): el cbc:DocumentCurrencyCode denomina todos los importes de la factura, y esos códigos no representan dinero. Usa "COP".',
  })
  currency?: string;

  /**
   * Resolución de facturación de la que sale el consecutivo. Piso: ver
   * `foreignKeyFloorMessage`.
   *
   * Es la llave más sensible de las siete: el formulario del panel ya sabe que
   * `0` significa «sin resolución» y lo filtra antes de enviar
   * (`invoice-section-field-map.ts:120`, `fields.resolution_id > 0`). El
   * backend nunca impuso lo mismo, así que cualquier otro llamador —POS, una
   * herramienta de IA, un `curl`— podía mandar `0` y llegar al servicio.
   */
  @IsOptional()
  @IsNumber()
  @IsInt({
    message:
      'resolution_id debe ser un número entero: los ids de resolución DIAN no tienen fracciones.',
  })
  @Type(() => Number)
  @Min(1, {
    message: foreignKeyFloorMessage(
      'resolution_id',
      'Omite el campo para que el servicio resuelva la resolución vigente del tipo de documento; no mandes 0 para decir «ninguna».',
    ),
  })
  resolution_id?: number;

  /**
   * Agregado de lo RETENIDO sobre este documento.
   *
   * ⚠️ **No netea el total.** Anexo Técnico 1.9 §11.9.1: «los cálculos aplicados
   * por la validación previa de facturas electrónicas de la DIAN no incluyen en
   * el fragmento `<cac:LegalMonetaryTotal/>` operaciones con el elemento
   * `<cac:WithholdingTaxTotal/>`». O sea, la DIAN revalida
   * `PayableAmount = base + tributos` SIN mirar la retención; restarla de
   * `invoices.total_amount` rompe esa identidad y el documento se rechaza por
   * descuadre aritmético — con el consecutivo autorizado ya gastado.
   *
   * El servicio lo respeta: `total_amount` sale de
   * `InvoiceCalculatorService.calculate()`, que devuelve la retención aparte en
   * `totals.withholding_amount` y jamás netada. Este campo sólo alimenta la
   * columna `invoices.withholding_amount`, que es informativa (lo que el cliente
   * girará de menos), y el grupo `cac:WithholdingTaxTotal` del XML.
   */
  @IsOptional()
  @IsNumber({}, { message: 'withholding_amount debe ser un número.' })
  @Type(() => Number)
  @Min(0, {
    message:
      'withholding_amount no puede ser negativo: es el valor retenido, que se declara aparte y NO se resta del total de la factura (Anexo Técnico DIAN 1.9 §11.9.1). No lo envíes con signo menos.',
  })
  withholding_amount?: number;

  /**
   * Desglose de retenciones a PERPETRAR al crear la factura.
   *
   * ## Por qué existe, no bastando `withholding_amount`
   *
   * El agregado se puede sacar de las líneas; lo que NO se recupera del agregado
   * es a qué concepto se le retuvo, con qué tarifa, ni si la tienda PRACTICED
   * (le retienen al cliente) o SUFFERED (la tienda retiene al proveedor). La
   * declaración obligatoria del XML (`cac:WithholdingTaxTotal`) necesita el
   * desglose por `cac:TaxSubtotal/cac:TaxCategory/cbc:Percent` y, lo más
   * delicado, el asiento contable lo requiere para sentar `credit`/`debit` por
   * cuenta PUC.
   *
   * ## Por qué se valida aparte
   *
   * Cada elemento se valida en `assertWithholdingsResolvable` del flujo, NO
   * aquí, porque la verificación de que el concepto existe y pertenece al tenant
   * es una invariante de NEGOCIO, no de tipo. Un class-validator que devolviera
   * «id de concepto no existe» en 400 sería el mismo mensaje para «concepto
   * borrado» y «concepto de otro tenant», y eso confunde al comerciante que
   * está depurando. La puerta del flujo nombra el motivo exacto.
   *
   * Vacío o ausente ≡ sin retenciones. Compatibilidad: un cliente que mande el
   * agregado pero no el desglose sigue funcionando, porque el agregado se
   * acepta en `withholding_amount` y el desglose se rellena DESPUÉS (sólo si
   * llega).
   */
  @IsOptional()
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => InvoiceWithholdingInputDto)
  @ArrayMaxSize(20, {
    message:
      'Una factura no puede llevar más de 20 retenciones. Si necesitas más, divide el documento.',
  })
  withholdings?: InvoiceWithholdingInputDto[];

  /**
   * Forma de pago DIAN (`cbc:PaymentMeans/cbc:PaymentMeansCode` de nivel método):
   * '1' contado, '2' crédito. Cuando es '2' la DIAN espera una fecha de
   * vencimiento coherente en `due_date`.
   */
  @IsOptional()
  @Transform(blankToUndefined)
  @IsIn(['1', '2'], {
    message:
      "payment_form debe ser '1' (contado) o '2' (crédito). Si la factura se paga a plazo, usa '2' y declara due_date.",
  })
  payment_form?: string;

  /**
   * Medio de pago DIAN (tabla UN/CEFACT 4461): '10' efectivo, '30' crédito,
   * '42' transferencia débito bancaria, '48' tarjeta crédito, '49' tarjeta
   * débito. Ver `DIAN_PAYMENT_MEANS` en las constantes del proveedor.
   */
  @IsOptional()
  @Transform(blankToUndefined)
  @IsString()
  @MaxLength(3, {
    message:
      'payment_means_code no puede superar 3 caracteres: es el código numérico DIAN del medio de pago (ej. "10" efectivo, "42" transferencia), no su nombre.',
  })
  payment_means_code?: string;

  /**
   * Tipo de operación (`cbc:CustomizationID` del UBL): '10' estándar, '09' AIU,
   * '11' mandatos, '12' transporte.
   *
   * No es cosmético: '09' cambia la base gravable del IVA y la DIAN valida la
   * coherencia entre este código y el desglose de las líneas (ver
   * `aiu_component` en `CreateInvoiceItemDto`).
   *
   * CUÁL es esa base depende del RÉGIMEN configurado en la tienda, no del
   * código: bajo E.T. art. 462-1 —aseo y cafetería, vigilancia, servicios
   * temporales— grava el AIU COMPLETO; bajo el Decreto 1372/1992 —construcción
   * de bien inmueble— grava sólo la utilidad. Afirmar acá que siempre es la
   * utilidad instruía a sub-declarar IVA a toda tienda del 462-1, que es el
   * régimen por defecto.
   */
  @IsOptional()
  @Transform(blankToUndefined)
  @IsIn(['10', '09', '11', '12'], {
    message:
      "operation_type debe ser '10' (estándar), '09' (AIU), '11' (mandatos) o '12' (transporte). Es el CustomizationID del UBL y determina cómo la DIAN calcula la base gravable.",
  })
  operation_type?: string;

  /**
   * Perfil de facturación bajo el que se timbra este documento.
   *
   * ## Qué cambia cuando llega
   *
   * La configuración fiscal deja de leerse de `store_settings` y sale de la
   * versión VIGENTE del perfil, y la factura persiste
   * `(profile_id, profile_version)`. Eso es lo que hace reproducible el
   * documento: `invoice_profile_versions` es append-only, así que editar el
   * perfil mañana crea la versión N+1 y no toca la N que esta factura congeló.
   *
   * ## Y qué pasa cuando NO llega
   *
   * Nada cambia: el flujo manual sigue leyendo `store_settings.invoicing.aiu`
   * exactamente como antes y las dos columnas quedan NULL. Es deliberado —los
   * tenants que ya facturan sin perfiles no pueden verse obligados a crear uno
   * para seguir emitiendo—. El CHECK de la tabla impone «ambas o ninguna», así
   * que no existe el estado intermedio.
   *
   * ## Por qué `@Min(1)` y no sólo `@IsNumber`
   *
   * Con `enableImplicitConversion`, `@IsNumber()` aprueba la cadena `"-5000"`:
   * no es una compuerta de signo. Un id negativo o cero llegaría al `findFirst`
   * y saldría como 404, que es un error correcto por la razón equivocada — y
   * `0` es justamente el valor que un formulario a medio llenar manda. El piso
   * se declara acá para que el rechazo ocurra antes de tocar la base.
   */
  @IsOptional()
  @Transform(blankToUndefined)
  @Type(() => Number)
  @IsNumber(
    {},
    {
      message:
        'profile_id debe ser el id numérico de un perfil de facturación de esta tienda.',
    },
  )
  @Min(1, {
    message:
      'profile_id debe ser un entero positivo. Omite el campo para facturar con el flujo manual (configuración de la tienda).',
  })
  profile_id?: number;

  /**
   * Objeto del contrato AIU de ESTA factura.
   *
   * La regla que la gobierna en una FACTURA es **FAV03**
   * (`/Invoice/cac:InvoiceLine/cbc:Note`, `E A 20..5000`), no CAV03: CAV03 y
   * DAV03 son sus gemelas de nota crédito y nota débito, con los mismos
   * `20..5000`, y este DTO no emite ninguna de las dos. La cifra 4900 no cambia
   * por la corrección de la cita; el nombre sí importa para poder volver al
   * anexo y encontrar la fila.
   *
   * Opcional: sin él se usa el de la tienda
   * (`store_settings.invoicing.aiu.contract_object`), que sigue siendo el valor
   * por defecto y no hay que repetirlo en cada documento. Se declara acá porque
   * una empresa de servicios tiene VARIOS contratos AIU —es su negocio— y hasta
   * ahora sólo podía describir uno para todos.
   *
   * La cota no se valida sólo por longitud de este campo: lo que la DIAN mide
   * es la nota COMPLETA, con el prefijo obligatorio delante. De eso se encarga
   * `resolveAiuContext`, que compone la cadena real con `buildAiuNote` y falla
   * antes de tomar consecutivo. Acá sólo se ataja lo que ni siquiera puede
   * caber.
   */
  @IsOptional()
  @Transform(blankToUndefined)
  @IsString()
  @MaxLength(4900, {
    message:
      'aiu_contract_object no puede superar 4900 caracteres: la regla FAV03 del Anexo Técnico DIAN 1.9 limita la nota completa a 5000 y el prefijo obligatorio «Contrato de servicios AIU por concepto de:» ya ocupa parte.',
  })
  aiu_contract_object?: string;

  /**
   * Modelo de contabilización del AIU de ESTA factura.
   *
   * Se declara acá **por obligación, no por comodidad**: el `ValidationPipe`
   * global corre con `forbidNonWhitelisted: true` (`main.ts:206`), así que una
   * clave no declarada en el DTO devuelve 400 antes de que ninguna lógica la
   * mire. Sin esta propiedad, el campo que el perfil ya guarda sería
   * inexpresable por documento y el 400 llegaría con un mensaje que no explica
   * nada.
   *
   * Opcional, y **la ausencia significa `'sumada'`** —ver
   * `resolveAccountingModel`—, que es lo que el calculador hace por
   * construcción: un cliente que no manda el campo emite exactamente igual que
   * antes de que existiera.
   *
   * La lista contra la que se valida es `ENABLED_ACCOUNTING_MODELS`, no
   * `ACCOUNTING_MODELS`: es el mismo interruptor único que gobierna la escritura
   * del perfil. Mientras `'no_sumada'` estuvo fuera, se rechazaba en la puerta
   * —con el motivo y su fecha— en vez de tomar consecutivo y que la DIAN devolviera
   * el documento al firmar; la apertura del Modelo 1 (D.7, 2026-08-25) añadió el
   * valor a esa constante y las dos superficies se levantaron juntas.
   */
  @IsOptional()
  @Transform(blankToUndefined)
  @IsIn(ENABLED_ACCOUNTING_MODELS as readonly string[], {
    message: `aiu_accounting_model sólo admite ${ENABLED_ACCOUNTING_MODELS.join(', ')}. ${accountingModelDisabledReason('no_sumada') ?? ''}`.trim(),
  })
  aiu_accounting_model?: AccountingModel;

  /**
   * Base gravable AIU de ESTA factura (C.7). Es la excepción, no la regla: la
   * congela el perfil (`profile_aiu.taxable_basis`) o, sin perfil, la tienda
   * (`store_settings.invoicing.aiu`) — este campo existe para el contrato que
   * SÍ se aparta de esa configuración, no para repetirla en cada documento.
   *
   * Se declara acá por la misma obligación que `aiu_accounting_model`: con
   * `forbidNonWhitelisted: true` (`main.ts:206`) una clave no declarada
   * devuelve 400 antes de que ninguna lógica la mire.
   *
   * Opcional, y **la ausencia significa "usa lo que diga el perfil o la
   * tienda"** — NUNCA `'aiu'` a secas. `resolveAiuContext` resuelve la
   * ausencia con la MISMA función que usa el perfil,
   * `resolveAiuTaxableBasis` (`invoice-profile-config.contract.ts:268`), para
   * no repetir un cuarto punto de decisión: ese archivo ya tiene la regla de
   * qué hacer si falta (derivar de `regime`, por defecto hacia la base MÁS
   * ANCHA, nunca `'utilidad'`).
   *
   * Los tres valores son iguales de legítimos: `'aiu'` (A+I+U completo, con
   * piso), `'utilidad'` (sólo Utilidad, sin piso) y `'subtotal'` (se declina
   * el tratamiento AIU, grava todo el contrato). La columna donde esto se
   * persiste se llama `aiu_regime` pero NO guarda un régimen legal: guarda
   * esta base — `'subtotal'` es un valor legítimo ahí sin que exista ningún
   * régimen al que corresponda. No lo confundas con `AiuVatRegimeLiteral`.
   */
  @IsOptional()
  @Transform(blankToUndefined)
  @IsIn(AIU_TAXABLE_BASES as readonly string[], {
    message: `aiu_taxable_basis sólo admite ${AIU_TAXABLE_BASES.join(', ')}.`,
  })
  aiu_taxable_basis?: AiuTaxableBasis;

  /**
   * Exigir el piso legal del 10% (E.T. art. 462-1) en ESTA factura (C.7).
   * Sólo tiene efecto bajo `taxable_basis` efectivo `'aiu'` — ver
   * `resolveAiuMinimumPercent`; el Decreto 1372/1992 no fija piso y
   * `'subtotal'` no tiene AIU que pisar.
   *
   * Opcional, y la ausencia significa "lo que diga el perfil o la tienda":
   * NO se sustituye el respaldo, se le da precedencia. Un documento que no
   * manda este campo se comporta exactamente igual que uno emitido antes de
   * que existiera.
   */
  @IsOptional()
  @IsBoolean({
    message: 'aiu_enforce_minimum_base debe ser verdadero o falso.',
  })
  aiu_enforce_minimum_base?: boolean;

  /**
   * Porcentaje del piso legal AIU de ESTA factura (C.7). Ausente ⇒ el del
   * perfil o la tienda; ninguno de los dos ⇒ 10 (`DEFAULT_AIU_MINIMUM_PERCENT`).
   *
   * Sólo se valida el FORMATO acá (número entre 0 y 100). La legalidad del
   * valor —que el piso DECLARADO efectivamente cubra la AIU calculada— la
   * exige `INVOICING_AIU_001` (`checkAiuDivergences`), exactamente igual que
   * hoy: threading este campo a través de `aiu_context.aiu.minimum_base_percent`
   * hace que esa puerta ya existente evalúe el piso EFECTIVO en vez del
   * heredado, sin código nuevo. Lo que este DTO NO cierra —y queda fuera de
   * C.7, reportado aparte— es que nada impide que ESTE valor, por sí mismo,
   * se declare por debajo del 10% legal del E.T. art. 462-1: esa compuerta
   * (`AIU_FLOOR_BELOW_LEGAL`) hoy sólo corre al guardar el PERFIL.
   */
  @IsOptional()
  @IsNumber({}, { message: 'aiu_minimum_base_percent debe ser un número.' })
  @Type(() => Number)
  @Min(0, {
    message: 'aiu_minimum_base_percent no puede ser negativo.',
  })
  @Max(100, {
    message: 'aiu_minimum_base_percent no puede superar 100.',
  })
  aiu_minimum_base_percent?: number;

  /**
   * Divisa extranjera de la operación, ISO 4217. Acompaña a
   * `foreign_total_amount`, `exchange_rate` y `exchange_rate_date` en el bloque
   * `cac:PaymentAlternativeExchangeRate` de las facturas de exportación.
   *
   * Mismo endurecimiento que `currency` y por la misma razón: el valor termina
   * en `cbc:TargetCurrencyCode` del bloque de conversión, y una divisa
   * inventada hace que la DIAN devuelva el documento. Un código no monetario
   * es todavía peor aquí, porque `exchange_rate` declara cuántos pesos vale
   * UNA UNIDAD de esta divisa: no existe una TRM de "XXX".
   *
   * Este campo NO cambia la moneda del documento —eso lo dice `currency`—,
   * sólo declara la conversión. Se admite deliberadamente "COP": el flujo de
   * emisión (`InvoiceFlowService.buildExchangeRateDeclaration`) ya lo
   * interpreta como "sin divisa extranjera" y omite el bloque, así que
   * rechazarlo aquí convertiría en 400 algo que hoy se resuelve solo.
   */
  @IsOptional()
  @Transform(upperCodeOrUndefined)
  @IsString()
  @IsISO4217CurrencyCode({
    message:
      'foreign_currency debe ser un código de moneda ISO 4217 (ej. "USD", "EUR").',
  })
  @IsNotIn(NON_MONETARY_ISO_4217_CODES, {
    message:
      'foreign_currency no puede ser un código ISO 4217 no monetario (XXX "sin divisa", XAU oro, XDR derechos de giro, XTS pruebas…): es la divisa de la conversión y exige una tasa de cambio real frente al peso.',
  })
  foreign_currency?: string;

  @IsOptional()
  @IsNumber({}, { message: 'foreign_total_amount debe ser un número.' })
  @Type(() => Number)
  @Min(0, {
    message:
      'foreign_total_amount no puede ser negativo: es el total de la factura expresado en la divisa extranjera.',
  })
  foreign_total_amount?: number;

  /** Fecha de la TRM aplicada (`cbc:Date` del bloque de tasa de cambio). */
  @IsOptional()
  @Transform(blankToUndefined)
  @IsDateString(
    {},
    {
      message:
        'exchange_rate_date debe ser una fecha ISO 8601 (ej. "2026-08-15"). Es el día de la TRM aplicada.',
    },
  )
  exchange_rate_date?: string;

  @IsOptional()
  @IsNumber({}, { message: 'exchange_rate debe ser un número.' })
  @Type(() => Number)
  @Min(0, {
    message:
      'exchange_rate no puede ser negativa: es la tasa de cambio aplicada (pesos por unidad de divisa extranjera).',
  })
  exchange_rate?: number;

  /**
   * Información adicional del documento. Viaja tal cual a `/Invoice/cbc:Note`
   * (`ubl-invoice.builder.ts:147-149`).
   *
   * ## De dónde sale el 500
   *
   * Anexo Técnico 1.9, regla **FAD13** — `/Invoice/cbc:Note`, formato
   * `E A 1-500`. No es una cifra elegida acá: es la longitud que la DIAN
   * publica para ese nodo. Y la columna `invoices.notes` es `String?`
   * (Postgres `text`, sin límite), así que la base no ataja nada — esta era la
   * única propiedad de texto del DTO sin ninguna cota, y por tanto la única por
   * la que un texto arbitrariamente largo llegaba al XML.
   *
   * El costo de no tenerla no es un 400 tardío: el consecutivo autorizado se
   * toma ANTES de firmar, así que la DIAN devuelve el documento con el número
   * ya gastado y ese número no se recupera.
   *
   * ## Por qué 500 y no 5000
   *
   * 5000 es el techo de las notas crédito y débito (reglas **CAD11** y
   * **DAD11**, `E A 5-5000`), que viajan por `CreateCreditNoteDto` /
   * `CreateDebitNoteDto` y no por acá. 500 es la cota del documento que ESTE
   * DTO emite.
   *
   * No confundir con la nota AIU: esa es de LÍNEA (regla FAV03, `20..5000`) y
   * la compone `buildAiuNote` a partir de `aiu_contract_object`.
   */
  @IsOptional()
  @IsString()
  @MaxLength(500, {
    message:
      'notes no puede superar 500 caracteres: es el límite que el Anexo Técnico DIAN 1.9 (regla FAD13) fija para /Invoice/cbc:Note. Un texto más largo hace que la DIAN devuelva la factura DESPUÉS de haber consumido el consecutivo autorizado, que no se recupera.',
  })
  notes?: string;

  /**
   * Invoice line items. Capped at 100 entries (defensive ceiling; real
   * invoices rarely exceed ~50). Each line may carry an `inline_product`
   * payload to create a new product at the same time, plus per-line
   * `taxes[]` with `is_inclusive` to drive the INCLUDED / ADDITIONAL split.
   *
   * El piso de 1 es tan duro como el techo: una factura sin líneas no es una
   * factura, y sin él el documento consume un consecutivo autorizado para
   * declarar un total de cero ante la DIAN.
   */
  @IsArray({ message: 'items debe ser un arreglo de líneas de factura.' })
  @ArrayMinSize(1, {
    message:
      'La factura necesita al menos una línea. Un documento sin líneas quema un consecutivo autorizado ante la DIAN para declarar un total de cero.',
  })
  @ArrayMaxSize(100, {
    message: 'La factura admite máximo 100 líneas.',
  })
  @ValidateNested({ each: true })
  // F.6 — `CreateFacturaInvoiceItemDto`, no la base: acota `description` a
  // los 300 caracteres de la regla FAZ02, no a los 500 del techo común de
  // `CreateInvoiceItemDto` (pensado para nota crédito/débito).
  @Type(() => CreateFacturaInvoiceItemDto)
  items: CreateFacturaInvoiceItemDto[];

  /**
   * Header-aggregated tax rows (one per `(tax_name, rate, type)`). Kept for
   * backward compatibility — new flows can omit this and use only
   * `items[].taxes[]` (the backend will aggregate them into
   * `invoice_taxes`).
   */
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(20, {
    message:
      'taxes agrupa una fila por (nombre, tarifa, tipo); 20 es techo de sobra para cualquier documento real.',
  })
  @ValidateNested({ each: true })
  @Type(() => CreateInvoiceTaxDto)
  taxes?: CreateInvoiceTaxDto[];
}
