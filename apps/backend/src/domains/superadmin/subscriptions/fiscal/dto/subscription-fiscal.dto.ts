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
}
