import {
  IsOptional,
  IsInt,
  IsString,
  IsNotEmpty,
  IsNumber,
  IsArray,
  ValidateNested,
  IsDateString,
  IsEnum,
  Max,
  Min,
} from 'class-validator';
import { Type } from 'class-transformer';
import { quotation_destination_enum } from '@prisma/client';

export class CreateQuotationItemDto {
  @IsOptional()
  @IsInt()
  product_id?: number;

  @IsOptional()
  @IsInt()
  product_variant_id?: number;

  @IsString()
  @IsNotEmpty()
  product_name: string;

  @IsOptional()
  @IsString()
  variant_sku?: string;

  @IsInt()
  @Min(1)
  quantity: number;

  @IsNumber()
  unit_price: number;

  @IsOptional()
  @IsNumber()
  discount_amount?: number;

  /**
   * Tasa del impuesto de la línea como FRACCIÓN: `0.19` es 19%.
   *
   * La columna es `Decimal(6,5)` (máximo 9.99999), así que mandar `19` —la
   * lectura intuitiva, y la convención que usa `tax_rates.tax_rate` en
   * `Decimal(5,2)`— desbordaba el numérico de Postgres y salía un
   * `500 SYS_INTERNAL_001 "Internal server error"` en lugar de un 400 que
   * dijera qué corregir.
   */
  @IsOptional()
  @IsNumber()
  @Min(0)
  @Max(1, {
    message:
      'tax_rate se expresa como fracción: usa 0.19 para 19% (máximo 1 = 100%)',
  })
  tax_rate?: number;

  @IsOptional()
  @IsNumber()
  tax_amount_item?: number;

  @IsNumber()
  total_price: number;

  @IsOptional()
  @IsString()
  notes?: string;

  /**
   * Multi-tarifa: id de la tarifa aplicada a la línea (opcional).
   * Permission `store:products:apply_pricing_tier` requerido cuando se envía.
   */
  @IsOptional()
  @IsInt()
  @Min(1)
  applied_price_tier_id?: number;
}

export class CreateQuotationDto {
  @IsOptional()
  @IsInt()
  customer_id?: number;

  /**
   * A.1 (ADR-01, FB-01) — Destino de la cotizacion. Opcional al crear:
   * sin valor nace `sale` y fluye a orden como hoy. Se fija al crear y
   * jamas se edita (`update` lo rechaza con QUOTE_DESTINATION_001).
   */
  @IsOptional()
  @IsEnum(quotation_destination_enum, {
    message: 'destination debe ser sale, contract u other',
  })
  destination?: quotation_destination_enum;

  /**
   * F-003 (FB-05) — Perfil opcional. Sin el campo, `forbidNonWhitelisted`
   * rechaza con 400 toda creacion que elija perfil en el modal.
   */
  @IsOptional()
  @IsInt()
  @Min(1)
  profile_id?: number;

  @IsOptional()
  @IsString()
  channel?: string;

  @IsOptional()
  @IsDateString()
  valid_until?: string;

  @IsOptional()
  @IsString()
  notes?: string;

  @IsOptional()
  @IsString()
  internal_notes?: string;

  @IsOptional()
  @IsString()
  terms_and_conditions?: string;

  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => CreateQuotationItemDto)
  items: CreateQuotationItemDto[];
}
