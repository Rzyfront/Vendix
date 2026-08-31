import { Transform, Type } from 'class-transformer';
import {
  ArrayMinSize,
  IsArray,
  IsBoolean,
  IsIn,
  IsInt,
  IsISO8601,
  IsNumber,
  IsOptional,
  IsString,
  IsUUID,
  Length,
  Matches,
  Max,
  MaxLength,
  Min,
  ValidateNested,
} from 'class-validator';
import {
  TrimString,
  TrimTaxId,
} from '../../../../../common/decorators/trim-string.decorator';
import {
  TECHNICAL_KEY_LENGTHS_LABEL,
  TECHNICAL_KEY_PATTERN,
  normalizeTechnicalKey,
} from '../../../../store/invoicing/fiscal-document-requirements';

export type SubscriptionFiscalEnvironment = 'test' | 'production';

/**
 * La resolución de la PLATAFORMA se numera y se hashea con el mismo motor
 * fiscal que la de cualquier tienda —la plataforma es un tenant más—, así que su
 * clave técnica tiene que juzgarse con la misma regla. Este DTO declaraba su
 * propio `technical_key` con solo `@MaxLength(255)`: el hueco exacto por el que
 * entró en producción una ClTec de 38 caracteres y se quemó un consecutivo
 * autorizado. Se consume el contrato compartido en vez de reescribirlo.
 */
const TECHNICAL_KEY_MESSAGE =
  `La clave técnica (ClTec) debe tener ${TECHNICAL_KEY_LENGTHS_LABEL} caracteres ` +
  'hexadecimales (0-9, a-f), tal como la entrega la DIAN en la autorización de ' +
  'numeración. Déjala vacía si este documento no lleva clave técnica.';

/** Quita el ruido de copiar de un PDF y trata el campo en blanco como ausente. */
const transformTechnicalKey = ({ value }: { value: unknown }) => {
  if (typeof value !== 'string') return value;
  const normalized = normalizeTechnicalKey(value);
  return normalized === '' ? undefined : normalized;
};

export const PLATFORM_RESOLUTION_DOCUMENT_TYPES = [
  'sales_invoice',
  'support_document',
] as const;

export type PlatformResolutionDocumentType =
  (typeof PLATFORM_RESOLUTION_DOCUMENT_TYPES)[number];

export class UpsertSubscriptionFiscalConfigDto {
  /**
   * IGNORADO. Se conserva para no romper clientes que aún lo envíen: el servicio
   * lo sobrescribe con el id derivado de `organizations.is_platform`.
   *
   * Dejó de ser obligatorio porque no es una preferencia — es un hecho. Pedirlo
   * como id forzaba a acertar el valor que el resolutor ya calcula, y un valor
   * distinto no fallaba al guardar: fallaba después, con un 404 sobre filas que
   * existían.
   */
  @Type(() => Number)
  @IsOptional()
  @IsInt()
  @Min(1)
  platform_organization_id?: number;

  /**
   * IGNORADO, por la misma razón y con una consecuencia peor: el cliente Prisma
   * scopeado deriva la entidad fiscal de `organizations.fiscal_scope` en cada
   * consulta y no consulta este ajuste. Un valor que no coincida deja la
   * configuración de plataforma apuntando a filas que ninguna lectura scopeada
   * puede ver. El servicio lo sobrescribe con la entidad derivada.
   */
  @Type(() => Number)
  @IsOptional()
  @IsInt()
  @Min(1)
  accounting_entity_id?: number;

  @Type(() => Number)
  @IsOptional()
  @IsInt()
  @Min(1)
  invoice_resolution_id?: number;

  @Type(() => Number)
  @IsOptional()
  @IsInt()
  @Min(1)
  dian_configuration_id?: number;

  @TrimString()
  @IsString()
  @MaxLength(100)
  name!: string;

  // Dots and spaces are stripped; hyphens are NOT, so `900123456-8` fails the
  // digits-only guard instead of silently becoming a corrupt NIT.
  @TrimTaxId()
  @IsString()
  @Matches(/^\d+$/, { message: 'nit must contain only digits' })
  nit!: string;

  @IsOptional()
  @TrimString()
  @IsString()
  @Matches(/^\d$/, { message: 'nit_dv must be a single digit' })
  nit_dv?: string;

  // DIAN issues software_id and test_set_id as UUIDs. A pasted value with a
  // trailing space or a stray character is accepted by the DIAN endpoint and
  // then never classified, which is indistinguishable from a queue backlog.
  @TrimString()
  @IsUUID(undefined, { message: 'software_id must be the UUID issued by DIAN' })
  software_id!: string;

  @IsOptional()
  @TrimString()
  @IsString()
  @MaxLength(100)
  software_pin?: string;

  @IsOptional()
  @TrimString()
  @IsUUID(undefined, { message: 'test_set_id must be the UUID issued by DIAN' })
  test_set_id?: string;

  /**
   * Ambiente. Opcional en edición: si el caller NO envía `environment`,
   * `upsertConfig` lo trata como «el ambiente vigente» y rechaza la
   * transición test→production o la degradación production→test. Sólo
   * se exige si el caller quiere CAMBIAR el ambiente.
   */
  @IsOptional()
  @IsIn(['test', 'production'])
  environment?: SubscriptionFiscalEnvironment;

  @IsBoolean()
  is_enabled!: boolean;

  @IsBoolean()
  auto_issue!: boolean;

  @IsOptional()
  @IsBoolean()
  confirm_production?: boolean;
}

export class SubscriptionFiscalQueryDto {
  @Type(() => Number)
  @IsOptional()
  @IsInt()
  @Min(1)
  page?: number = 1;

  @Type(() => Number)
  @IsOptional()
  @IsInt()
  @Min(1)
  limit?: number = 20;

  @IsOptional()
  @IsString()
  status?: string;

  @IsOptional()
  @IsIn(['test', 'production'])
  environment?: SubscriptionFiscalEnvironment;

  @IsOptional()
  @IsString()
  search?: string;
}

export class RetrySubscriptionFiscalDto {
  @IsOptional()
  @IsBoolean()
  force?: boolean;
}

export class CreatePlatformResolutionDto {
  @IsString()
  @Length(1, 4)
  prefix!: string;

  @IsIn(PLATFORM_RESOLUTION_DOCUMENT_TYPES as unknown as string[])
  document_type!: PlatformResolutionDocumentType;

  @IsIn(['test', 'production'])
  environment!: SubscriptionFiscalEnvironment;

  @Type(() => Number)
  @IsInt()
  @Min(1)
  rango_inicial!: number;

  @Type(() => Number)
  @IsInt()
  @Min(1)
  rango_final!: number;

  @IsOptional()
  @Transform(transformTechnicalKey)
  @IsString()
  @Matches(TECHNICAL_KEY_PATTERN, { message: TECHNICAL_KEY_MESSAGE })
  technical_key?: string;

  @IsOptional()
  @IsString()
  @MaxLength(100)
  resolution_number?: string;

  @IsOptional()
  @IsISO8601()
  resolution_date?: string;

  @IsOptional()
  @IsISO8601()
  valid_from?: string;

  @IsOptional()
  @IsISO8601()
  valid_to?: string;
}

/**
 * Partial update of a platform DIAN resolution.
 *
 * Every field is optional so the caller can send only what changed. What is
 * *legal* to change depends on whether DIAN numbers have already been consumed
 * — that rule lives in the service, not here, because it needs the stored row.
 */
export class UpdatePlatformResolutionDto {
  @IsOptional()
  @IsString()
  @Length(1, 4)
  prefix?: string;

  @IsOptional()
  @IsIn(PLATFORM_RESOLUTION_DOCUMENT_TYPES as unknown as string[])
  document_type?: PlatformResolutionDocumentType;

  @Type(() => Number)
  @IsOptional()
  @IsInt()
  @Min(1)
  rango_inicial?: number;

  @Type(() => Number)
  @IsOptional()
  @IsInt()
  @Min(1)
  rango_final?: number;

  @IsOptional()
  @Transform(transformTechnicalKey)
  @IsString()
  @Matches(TECHNICAL_KEY_PATTERN, { message: TECHNICAL_KEY_MESSAGE })
  technical_key?: string;

  @IsOptional()
  @IsString()
  @MaxLength(100)
  resolution_number?: string;

  @IsOptional()
  @IsISO8601()
  resolution_date?: string;

  @IsOptional()
  @IsISO8601()
  valid_from?: string;

  @IsOptional()
  @IsISO8601()
  valid_to?: string;

  @IsOptional()
  @IsBoolean()
  is_active?: boolean;
}

export class ListPlatformResolutionsQueryDto {
  @IsOptional()
  @IsIn(PLATFORM_RESOLUTION_DOCUMENT_TYPES as unknown as string[])
  document_type?: PlatformResolutionDocumentType;

  @IsOptional()
  @IsIn(['test', 'production'])
  environment?: SubscriptionFiscalEnvironment;

  @Type(() => Boolean)
  @IsOptional()
  @IsBoolean()
  is_active?: boolean;
}

/**
 * C.11: DTO de creación de una factura personalizada de plataforma (no
 * generada por el motor de suscripciones). El destinatario es una
 * organización tenant existente, no un customer suelto. El backend
 * arma la `fiscal_transmission` con `source_type='platform_invoice'`
 * y reutiliza la `platform_settings.invoice_resolution_id` activa.
 *
 * Cubre los casos típicos: implementación, consultoría, capacitación,
 * servicios de plataforma facturados a nombre de la org 1.
 */
export class PlatformInvoiceLineTaxDto {
  // `tax_type` del enum del dominio (IVA, INC, ICUI, RETE_FUENTE, etc).
  // El legacy mapea `tax_type` → `tax_name` antes de firmar la DIAN.
  @IsString()
  @MaxLength(50)
  tax_type!: string;

  // Fracción entre 0 y 1. La fachada convierte esto a porcentaje
  // (×100) una sola vez para el provider; el legacy NUNCA debe
  // recalcular base×tarifa (FAS02).
  @Type(() => Number)
  @IsNumber({ maxDecimalPlaces: 6 })
  @Min(0)
  @Max(1)
  rate!: number;

  @IsOptional()
  @Type(() => Number)
  @IsNumber({ maxDecimalPlaces: 2 })
  @Min(0)
  taxable_amount?: number;

  @IsOptional()
  @Type(() => Number)
  @IsNumber({ maxDecimalPlaces: 2 })
  @Min(0)
  tax_amount?: number;

  @IsOptional()
  @IsBoolean()
  is_inclusive?: boolean;
}

export class PlatformInvoiceLineDto {
  @IsString()
  @MaxLength(500)
  description!: string;

  @Type(() => Number)
  @IsNumber({ maxDecimalPlaces: 4 })
  @Min(0)
  quantity!: number;

  @Type(() => Number)
  @IsNumber({ maxDecimalPlaces: 4 })
  @Min(0)
  unit_price!: number;

  /**
   * UN/ECE Rec. 20. La fachada envía `'NIU'` por defecto cuando el V1
   * no lo trae — `'EA'` no existe en la rec. 20 y ningún selector lo
   * pinta. El legacy hoy hardcodea `'EA'`; cuando frank extienda la
   * construcción de `lineItems` en `subscription-fiscal.service.ts:2208`,
   * va a leer este campo y el valor fluye desde el facade.
   */
  @IsOptional()
  @IsString()
  @MaxLength(10)
  unit_code?: string;

  /**
   * Descuento POR LÍNEA (en pesos). El mapper aplica fallback `0` cuando
   * el V1 no lo trae, idéntico a como el legacy ya operaba.
   */
  @IsOptional()
  @Type(() => Number)
  @IsNumber({ maxDecimalPlaces: 2 })
  @Min(0)
  discount_amount?: number;

  /**
   * Cuenta PUC de ingreso POR LÍNEA. El listener contable de frank la
   * lee desde el snapshot para asientos multi-crédito. Si falta, cae al
   * mapping key `invoice.validated.revenue` (mismo default que el riel tienda).
   */
  @IsOptional()
  @IsString()
  @MaxLength(20)
  account_code?: string;

  /**
   * Impuestos por línea. Vacío = línea exenta. El legacy mapea a
   * `providerData.taxes[]` (ya lo hace para ventas estándar).
   */
  @IsOptional()
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => PlatformInvoiceLineTaxDto)
  taxes?: PlatformInvoiceLineTaxDto[];
}

export class PlatformInvoiceCustomerDto {
  @IsString()
  @MaxLength(500)
  legal_name!: string;

  @IsString()
  @Matches(/^\d+$/, { message: 'NIT debe ser numérico' })
  @MaxLength(20)
  tax_id!: string;

  @IsString()
  @Matches(/^\d$/, { message: 'El DV del destinatario es obligatorio (NIT, tipo 31): un solo dígito numérico.' })
  @MaxLength(3)
  tax_id_dv!: string;

  @IsOptional()
  @IsString()
  @MaxLength(200)
  email?: string;

  @IsOptional()
  @IsString()
  @MaxLength(200)
  address_line?: string;

  @IsOptional()
  @IsString()
  @MaxLength(100)
  city?: string;

  @IsOptional()
  @IsString()
  @MaxLength(2)
  department_code?: string;

  /**
   * Tipo de documento del destinatario. El legacy hoy hardcodea `'31'`
   * (NIT); cuando frank extienda `providerData.customer_document_type`,
   * el valor fluye desde el facade.
   */
  @IsOptional()
  @IsString()
  @MaxLength(10)
  document_type?: string;

  @IsOptional()
  @IsIn(['1', '2'])
  person_type?: '1' | '2';

  @IsOptional()
  @IsString()
  @MaxLength(10)
  tax_regime_code?: string;

  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  fiscal_responsibilities?: string[];
}

export class CreatePlatformInvoiceWithholdingInputDto {
  @IsIn(['practiced', 'suffered', 'self'])
  role!: 'practiced' | 'suffered' | 'self';

  @Type(() => Number)
  @IsInt()
  @Min(1)
  concept_id!: number;

  @Type(() => Number)
  @IsNumber({ maxDecimalPlaces: 2 })
  @Min(0)
  base_amount!: number;

  @Type(() => Number)
  @IsNumber({ maxDecimalPlaces: 6 })
  @Min(0)
  @Max(1)
  rate!: number;

  @IsOptional()
  @Type(() => Number)
  @IsNumber({ maxDecimalPlaces: 2 })
  @Min(0)
  amount?: number;
}

export class PlatformInvoiceCurrencyDto {
  // Misma regla que `MvpV1CurrencyDto.iso_4217`: V1 sólo soporta COP y USD.
  // Si la fachada trae otra moneda, `@IsIn` rechaza con 400 — sin bypass.
  @IsString()
  @Length(3, 3)
  @IsIn(['COP', 'USD'], {
    message: 'V1 solo soporta COP y USD (multi-moneda es V2)',
  })
  iso_4217!: string;

  // TRM. 0 o ausente = «declarar divisa sin tasa» → el grupo
  // `cac:PaymentAlternativeExchangeRate` NO se emite; la firma sigue en COP.
  @IsOptional()
  @Type(() => Number)
  @IsNumber({ maxDecimalPlaces: 6 })
  @Min(0)
  exchange_rate?: number;

  @IsOptional()
  @IsISO8601()
  exchange_rate_date?: string;
}

export class CreatePlatformInvoiceDto {
  @ValidateNested()
  @Type(() => PlatformInvoiceCustomerDto)
  customer!: PlatformInvoiceCustomerDto;

  @IsArray()
  @ArrayMinSize(1)
  @ValidateNested({ each: true })
  @Type(() => PlatformInvoiceLineDto)
  items!: PlatformInvoiceLineDto[];

  @IsOptional()
  @IsISO8601()
  period_start?: string;

  @IsOptional()
  @IsISO8601()
  period_end?: string;

  @IsOptional()
  @IsString()
  @MaxLength(10)
  currency?: string;

  // ── Extendidos para que el mapper V1→legacy propague sin perder info ──
  //
  // Todos son opcionales. Las llamadas legacy existentes siguen
  // funcionando idéntico; sólo los callers V1 los pueblan. El legacy
  // (`subscription-fiscal.service.ts:createPlatformInvoice`) lee estos
  // campos cuando frank extienda la construcción de `lineItems`,
  // `providerData`, `taxAmount` y el `metadata` del snapshot.

  @IsOptional()
  @Type(() => Number)
  @IsInt({ message: 'resolution_id debe ser un entero positivo.' })
  @Min(1, { message: 'resolution_id debe ser un entero positivo.' })
  resolution_id?: number;

  @IsOptional()
  @IsISO8601()
  issue_date?: string;

  @IsOptional()
  @Transform(({ value }) => (value === '' || value === null ? undefined : value))
  @IsISO8601()
  due_date?: string;

  @IsOptional()
  @IsIn(['1', '2'])
  payment_form?: '1' | '2';

  @IsOptional()
  @IsString()
  @MaxLength(3)
  payment_means_code?: string;

  @IsOptional()
  @IsString()
  @MaxLength(5000)
  notes?: string;

  @IsOptional()
  @IsString()
  @MaxLength(20)
  counterpart_account_code?: string;

  @IsOptional()
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => CreatePlatformInvoiceWithholdingInputDto)
  withholdings?: CreatePlatformInvoiceWithholdingInputDto[];

  /**
   * Bloque de divisa extranjera completo (`iso_4217`, `exchange_rate`,
   * `exchange_rate_date`). Se mantiene APARTE del campo `currency` (string)
   * para no romper a callers legacy que ya mandaban `currency: 'USD'` plano.
   *
   * El legacy lo lee en `buildExchangeRate` (subscription-fiscal.service.ts:2482)
   * para emitir `cac:PaymentAlternativeExchangeRate` cuando hay tasa. Si el
   * operador sólo eligió la casilla «declarar divisa» sin TRM, este campo
   * queda con `exchange_rate` null/0 y el grupo NO se emite (firma COP
   * intacta, no se rechaza el documento).
   */
  @IsOptional()
  @ValidateNested()
  @Type(() => PlatformInvoiceCurrencyDto)
  exchange_rate_payload?: PlatformInvoiceCurrencyDto;
}

/* ─────────────────────────────────────────────────────────────────────────────
 * CP-platform-fiscal-invoicing-mvp: DTOs V1 (sales_invoice + support_document)
 * Etiquetados con `MvpV1` para señalar que son la pieza del plan crítico
 * ejecutado — el rail legacy `CreatePlatformInvoiceDto` queda activo y NO se
 * reescribe. Cuando V2 retire el legacy, `CreatePlatformInvoiceDto` se borra
 * y `MvpV1` prefix cae.
 * ─────────────────────────────────────────────────────────────────────────── */

// Tax codes DIAN — reusado por taxes per-line.
// Tipos del enum tax_type_enum (IVA/INC/IBUA/ICUI/RETE_FUENTE/RETE_IVA/RETE_ICA/ICA)
// ver schema.prisma. V1 emite IVA/INC/ICUI/RETENCIONES — IBUA solo si la
// feature explícita lo pide (caso Shopify/marketplace).
const MvpV1_TAX_TYPES = [
  'IVA',
  'INC',
  'ICUI',
  'RETE_FUENTE',
  'RETE_IVA',
  'RETE_ICA',
] as const;
export type MvpV1TaxType = (typeof MvpV1_TAX_TYPES)[number];

/**
 * AIU: el regimen colombiano (E.T. art. 462-1) exige un minimo de 10% sobre
 * la base gravable acumulada (administracion + imprevistos + utilidad). El
 * backend ya tiene `aiu_base_below_minimum` en `invoice-calculator.service.ts`;
 * V1 solo expone el campo al frontend. La regla del piso NO se redefine aquí.
 */
const MvpV1_AIU_COMPONENTS = [
  'administracion',
  'imprevistos',
  'utilidad',
] as const;
export type MvpV1AiuComponent = (typeof MvpV1_AIU_COMPONENTS)[number];

const MvpV1_OPERATION_TYPES = ['10', '09', '11', '12'] as const;
export type MvpV1OperationType = (typeof MvpV1_OPERATION_TYPES)[number];

/**
 * Roles de withholding: practiced (VENDIX retiene al cliente), suffered
 * (VENDIX sufre retención del cliente), self (auto-retención).
 */
const MvpV1_WITHHOLDING_ROLES = ['practiced', 'suffered', 'self'] as const;
export type MvpV1WithholdingRole = (typeof MvpV1_WITHHOLDING_ROLES)[number];

// ── Tenant customer ADR-7 ────────────────────────────────────────────────────
//
// El rail super-admin factura a TENANTS (stores u organizations), NO a
// `users`. ADR-7 lo formaliza con discriminated `kind`. El selector de
// tenant en el frontend usa estas dos variantes, y el backend persiste
// snapshot fiscal en `fiscal_evidences.metadata.kind='platform_acquirer_snapshot'`.

export class PlatformInvoiceTenantRefStore {
  @IsIn(['store'])
  kind!: 'store';

  @Type(() => Number)
  @IsInt()
  @Min(1)
  store_id!: number;
}

export class PlatformInvoiceTenantRefOrganization {
  @IsIn(['organization'])
  kind!: 'organization';

  @Type(() => Number)
  @IsInt()
  @Min(1)
  organization_id!: number;
}

export class PlatformInvoiceExternalCustomerAddressDto {
  @IsOptional()
  @IsString()
  @MaxLength(255)
  line?: string;

  @IsOptional()
  @IsString()
  @MaxLength(100)
  city?: string;

  @IsOptional()
  @IsString()
  @MaxLength(10)
  city_code?: string;

  @IsOptional()
  @IsString()
  @MaxLength(10)
  department_code?: string;
}

/**
 * Discriminated union extendida para soportar:
 *   - 'store' | 'organization' | 'user' (referenciados por tenant_id)
 *   - 'external' (cliente manual con todos los datos fiscales legales)
 */
export class PlatformInvoiceTenantRefDto {
  @IsIn(['store', 'organization', 'user', 'external'])
  kind!: 'store' | 'organization' | 'user' | 'external';

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  tenant_id?: number;

  @IsOptional()
  @TrimString()
  @IsString()
  @MaxLength(255)
  legal_name?: string;

  @IsOptional()
  @TrimTaxId()
  @IsString()
  tax_id?: string;

  @IsOptional()
  @TrimString()
  @IsString()
  @MaxLength(1)
  tax_id_dv?: string;

  @IsOptional()
  @IsIn(['1', '2'])
  person_type?: '1' | '2';

  @IsOptional()
  @IsString()
  @MaxLength(10)
  tax_regime_code?: string;

  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  fiscal_responsibilities?: string[];

  @IsOptional()
  @IsString()
  @MaxLength(150)
  email?: string;

  @IsOptional()
  @IsString()
  @MaxLength(50)
  phone?: string;

  @IsOptional()
  @ValidateNested()
  @Type(() => PlatformInvoiceExternalCustomerAddressDto)
  address?: PlatformInvoiceExternalCustomerAddressDto;
}

export class SaveAsProfileDto {
  @TrimString()
  @IsString()
  @MaxLength(100)
  name!: string;

  @IsOptional()
  @IsBoolean()
  is_default?: boolean;
}

// ── Item (line) con taxes + discount + AIU + is_inclusive + unit_code ────────

export class MvpV1InvoiceLineTaxDto {
  @IsIn(MvpV1_TAX_TYPES as unknown as string[])
  tax_type!: MvpV1TaxType;

  @Type(() => Number)
  @IsNumber({ maxDecimalPlaces: 4 })
  @Min(0)
  @Max(1, { message: 'rate debe ser fracción entre 0 y 1 (0.19 = 19%)' })
  rate!: number;

  @IsOptional()
  @Type(() => Number)
  @IsNumber({ maxDecimalPlaces: 2 })
  @Min(0)
  taxable_amount?: number;

  @IsOptional()
  @Type(() => Number)
  @IsNumber({ maxDecimalPlaces: 2 })
  @Min(0)
  tax_amount?: number;

  @IsOptional()
  @IsBoolean()
  is_inclusive?: boolean;
}

export class MvpV1InvoiceLineDto {
  @TrimString()
  @IsString()
  @MaxLength(500)
  description!: string;

  @Type(() => Number)
  @IsNumber({ maxDecimalPlaces: 4 })
  @Min(0.0001, { message: 'quantity debe ser > 0' })
  quantity!: number;

  @Type(() => Number)
  @IsNumber({ maxDecimalPlaces: 4 })
  @Min(0)
  unit_price!: number;

  @IsOptional()
  @Type(() => Number)
  @IsNumber({ maxDecimalPlaces: 2 })
  @Min(0)
  discount_amount?: number;

  @IsOptional()
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => MvpV1InvoiceLineTaxDto)
  taxes?: MvpV1InvoiceLineTaxDto[];

  @IsOptional()
  @IsString()
  @MaxLength(10)
  unit_code?: string; // UN/ECE Rec. 20 — default 'EA' en el servicio si falta

  @IsOptional()
  @IsString()
  @MaxLength(20)
  account_code?: string;

  @IsOptional()
  @IsIn(MvpV1_AIU_COMPONENTS as unknown as string[])
  aiu_component?: MvpV1AiuComponent;
}

// ── Withholdings (input, resolver en backend) ────────────────────────────────

export class MvpV1InvoiceWithholdingInputDto {
  @IsIn(MvpV1_WITHHOLDING_ROLES as unknown as string[])
  role!: MvpV1WithholdingRole;

  @Type(() => Number)
  @IsInt()
  @Min(1)
  concept_id!: number;

  @Type(() => Number)
  @IsNumber({ maxDecimalPlaces: 2 })
  @Min(0)
  base_amount!: number;

  // rate entre 0 y 1 (fracción). Auto-resolución: si viene vacío y el
  // `concept_id` existe, el backend rellena desde `withholding_concepts.rate`.
  @Type(() => Number)
  @IsNumber({ maxDecimalPlaces: 6 })
  @Min(0)
  @Max(1)
  rate!: number;

  @IsOptional()
  @Type(() => Number)
  @IsNumber({ maxDecimalPlaces: 2 })
  @Min(0)
  amount?: number;
}

// ── Moneda + TRM ──────────────────────────────────────────────────────────

export class MvpV1CurrencyDto {
  // ISO 4217 alpha-3. V1 solo soporta COP y USD — la regla completa (no USD
  // en tienda COP-only, etc.) se valida con `vendix-currency-formatting` en
  // el servicio. Restringir en DTO bloquea bypass por JSON manual.
  @IsString()
  @Length(3, 3)
  @IsIn(['COP', 'USD'], {
    message: 'V1 solo soporta COP y USD (multi-moneda es V2)',
  })
  iso_4217!: string;

  @IsOptional()
  @Type(() => Number)
  @IsNumber({ maxDecimalPlaces: 6 })
  @Min(0)
  exchange_rate?: number;

  @IsOptional()
  @IsISO8601()
  exchange_rate_date?: string;
}

// ── V1: CreatePlatformSalesInvoiceDto ────────────────────────────────────────

/**
 * Discriminated variant: para `sales_invoice`, el destinatario es un
 * `PlatformInvoiceTenantRefDto` y los campos tenant-fiscal se derivan del
 * snapshot en `fiscal_evidences.metadata` post-emisión.
 *
 * El DTO `CreatePlatformInvoiceDto` (legacy MVP) sigue operativo bajo la
 * ruta `POST /invoices` (sin taxes, sin AIU). V1 entra por la ruta nueva
 * `POST /sales-invoices` y se queda con esta DTO.
 */
export class CreatePlatformSalesInvoiceDto {
  @ValidateNested()
  @Type(() => PlatformInvoiceTenantRefDto)
  customer!: PlatformInvoiceTenantRefDto;

  @IsArray()
  @ArrayMinSize(1)
  @ValidateNested({ each: true })
  @Type(() => MvpV1InvoiceLineDto)
  items!: MvpV1InvoiceLineDto[];

  @IsOptional()
  @IsISO8601()
  period_start?: string;

  @IsOptional()
  @IsISO8601()
  period_end?: string;

  // '09' = régimen AIU (E.T. art. 462-1). '10' es estándar.
  @IsIn(MvpV1_OPERATION_TYPES as unknown as string[])
  operation_type!: MvpV1OperationType;

  // SI operation_type='09' se exige el AIU note de 4900 char DIAN.
  @IsOptional()
  @TrimString()
  @IsString()
  @MaxLength(4900)
  aiu_contract_object?: string;

  // '1' contado / '2' crédito. Default '1' en el servicio.
  @IsOptional()
  @IsIn(['1', '2'])
  payment_form?: '1' | '2';

  @IsOptional()
  @IsString()
  @MaxLength(3)
  payment_means_code?: string;

  // Transform: `''` y `null` se tratan como ausente. Sin esto, `@IsISO8601()`
  // rechaza string vacío con 400 y bloquea payment_form='2' (crédito) sin
  // fecha de vencimiento explícita. El frontend ya omite el campo en ese
  // caso, pero blindamos el DTO para JSON manual.
  @IsOptional()
  @Transform(({ value }) => (value === '' || value === null ? undefined : value))
  @IsISO8601()
  due_date?: string;

  @IsOptional()
  @ValidateNested()
  @Type(() => MvpV1CurrencyDto)
  currency?: MvpV1CurrencyDto;

  @IsOptional()
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => MvpV1InvoiceWithholdingInputDto)
  withholdings?: MvpV1InvoiceWithholdingInputDto[];

  // Documento -> cac:AllowanceCharge (descuento global)
  @IsOptional()
  @Type(() => Number)
  @IsNumber({ maxDecimalPlaces: 2 })
  @Min(0)
  global_discount_amount?: number;

  // Notas libres para el XML (≤ 5000 char concat)
  @IsOptional()
  @IsString()
  @MaxLength(5000)
  notes?: string;

  /**
   * Perfil de facturación a aplicar como punto de partida editable.
   *
   * ## Por qué en ESTE DTO y no en el legacy CreatePlatformInvoiceDto
   *
   * El DTO MvpV1 es la superficie que el frontend del wizard plataforma
   * construye y la que el controller V1 acepta. El legacy
   * `CreatePlatformInvoiceDto` es la capa interna de `subscription-fiscal.service`
   * a la que la fachada traduce (CP-platform-invoicing-parity C.1). Si
   * añadiéramos `profile_id` sólo al legacy, el frontend nunca podría
   * pasarlo. Si lo añadimos sólo al MvpV1 sin propagarlo a legacy, queda
   * muerto en la frontera de la fachada.
   *
   * Mismo patrón que el resto del MvpV1: el campo entra por aquí, se valida
   * (operation_type match con `PLATFORM_PROFILE_008` 409 si difiere), y la
   * fachada lo propaga al DTO legacy con `profile_version = profile.current_version`
   * y `profile_snapshot = profile.current_config`. La persistencia final
   * (`invoices.profile_id`/`profile_version`/`profile_snapshot`) la hace la
   * `createPlatformInvoice` legacy al reescribirla (TODO C.1 — el servicio
   * legacy necesita aceptar esos tres campos y la FK compuesta los respeta;
   * ver H1 del plan).
   *
   * Sin `profile_id`, comportamiento byte-idéntico al actual — la migración
   * de A.1 no cambia filas existentes y el DTO es `IsOptional`.
   */
  @IsOptional()
  @Type(() => Number)
  @IsInt({ message: 'profile_id debe ser un entero positivo.' })
  @Min(1, { message: 'profile_id debe ser un entero positivo.' })
  profile_id?: number;

  @IsOptional()
  @ValidateNested()
  @Type(() => SaveAsProfileDto)
  save_as_profile?: SaveAsProfileDto;

  /**
   * Resolución DIAN que debe numerar el documento.
   *
   * Sin este campo, `InvoicingService.create` (riel tienda) selecciona la
   * resolución más reciente vigente del accounting entity. Si el operador
   * eligió una específica en el selector del frontend, ese id viaja acá
   * y la fachada lo respeta (`platform-invoicing.service.ts` lo propaga
   * al riel tienda en `resolution_id`).
   *
   * El DTO MvpV1 NO declaraba este campo — `forbidNonWhitelisted:true`
   * en el ValidationPipe global lo rechazaba con 400, y el selector del
   * frontend se perdía en silencio.
   */
  @IsOptional()
  @Type(() => Number)
  @IsInt({ message: 'resolution_id debe ser un entero positivo.' })
  @Min(1, { message: 'resolution_id debe ser un entero positivo.' })
  resolution_id?: number;

  /**
   * Fecha de emisión del documento (YYYY-MM-DD o ISO 8601 completo).
   *
   * Si el operador la omite, la fachada usa `new Date().toISOString().slice(0,10)`
   * (regla vigente en `mapToStoreCreateInvoiceDto`).
   */
  @IsOptional()
  @IsISO8601()
  issue_date?: string;

  /**
   * Cuenta PUC de contrapartida del documento, una sola por documento
   * (cabeza). Se persiste top-level en `fiscal_evidences.metadata` para
   * que `subscription-fiscal.service.ts` (asiento contable de frank) la
   * consuma al emitir el journal entry.
   *
   * Por línea NO se admite: abrir esa puerta permitiría asientos
   * descuadrados en `accounting_entries`. El débito global del documento
   * lleva esta única cuenta; los créditos siguen saliendo por línea.
   */
  @IsOptional()
  @IsString()
  @MaxLength(20)
  counterpart_account_code?: string;
}

// ── V1: CreatePlatformSupportDocumentDto ────────────────────────────────────

/**
 * Vendor support document (DSA). Vendor = VENDIX vendiendo servicios a un
 * tenant; el `supplier_id` es el tenant-receptor (análogo al `customer`).
 *
 * Diferencias con sales_invoice:
 *   - sin AIU (no es contrato AIU)
 *   - sin payment_means_code (el rail tienda DSA no lo usa)
 *   - sin withholdings (la DIAN lo modela distinto a ventas)
 *   - único fiscal doc que NO exige ClTec (CUDS en lugar de CUFE)
 */
export class CreatePlatformSupportDocumentDto {
  @ValidateNested()
  @Type(() => PlatformInvoiceTenantRefDto)
  supplier!: PlatformInvoiceTenantRefDto;

  @IsArray()
  @ArrayMinSize(1)
  @ValidateNested({ each: true })
  @Type(() => MvpV1InvoiceLineDto)
  items!: MvpV1InvoiceLineDto[];

  @IsOptional()
  @IsISO8601()
  period_start?: string;

  @IsOptional()
  @IsISO8601()
  period_end?: string;

  @IsIn(MvpV1_OPERATION_TYPES as unknown as string[])
  operation_type!: MvpV1OperationType;

  @IsOptional()
  @IsString()
  @MaxLength(3)
  payment_means_code?: string;

  @IsOptional()
  @IsISO8601()
  due_date?: string;

  @IsOptional()
  @ValidateNested()
  @Type(() => MvpV1CurrencyDto)
  currency?: MvpV1CurrencyDto;

  @IsOptional()
  @Type(() => Number)
  @IsNumber({ maxDecimalPlaces: 2 })
  @Min(0)
  global_discount_amount?: number;

  @IsOptional()
  @IsString()
  @MaxLength(5000)
  notes?: string;

  /**
   * Perfil de facturación a aplicar como punto de partida editable (mismo
   * contrato que `CreatePlatformSalesInvoiceDto.profile_id`).
   *
   * El DSA raramente lleva AIU ni perfiles exóticos —el `operation_type` del
   * DSA siempre será uno de los códigos de soporte, y los perfiles plataforma
   * se crean con cualquier operation_type— pero se admite el campo para que
   * el frontend tenga UNA firma de DTO consistente entre `sales_invoice` y
   * `support_document`. La validación de operation_type-match vive en el
   * servicio de la fachada (C.1).
   */
  @IsOptional()
  @Type(() => Number)
  @IsInt({ message: 'profile_id debe ser un entero positivo.' })
  @Min(1, { message: 'profile_id debe ser un entero positivo.' })
  profile_id?: number;
}

