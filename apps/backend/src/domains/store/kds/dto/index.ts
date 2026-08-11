import {
  IsBoolean,
  IsInt,
  IsNotEmpty,
  IsOptional,
  IsString,
  MaxLength,
  Min,
} from 'class-validator';
import { Type } from 'class-transformer';

/**
 * DTOs de estaciones de preparación (KDS) — QUI-651.
 *
 * Espejo deliberado de los DTOs de `cash-registers`: misma forma de entidad,
 * mismas validaciones. La diferencia sustantiva está en la sesión, que no
 * maneja montos sino responsabilidad sobre el consumo de insumos.
 */
export class CreateKdsDto {
  @IsString()
  @IsNotEmpty()
  @MaxLength(100)
  name!: string;

  @IsString()
  @IsNotEmpty()
  @MaxLength(50)
  code!: string;

  @IsOptional()
  @IsString()
  @MaxLength(255)
  description?: string;

  @IsOptional()
  @IsBoolean()
  is_active?: boolean;

  /**
   * Marcar esta estación como la de por defecto de la tienda. Promueve: la
   * estación que era default deja de serlo en la misma transacción, porque el
   * índice único parcial `kds_one_default_per_store` no admite dos.
   */
  @IsOptional()
  @IsBoolean()
  is_default?: boolean;

  @IsOptional()
  @IsInt()
  @Type(() => Number)
  @Min(1)
  location_id?: number;
}

export class UpdateKdsDto {
  @IsOptional()
  @IsString()
  @IsNotEmpty()
  @MaxLength(100)
  name?: string;

  @IsOptional()
  @IsString()
  @IsNotEmpty()
  @MaxLength(50)
  code?: string;

  @IsOptional()
  @IsString()
  @MaxLength(255)
  description?: string;

  @IsOptional()
  @IsBoolean()
  is_active?: boolean;

  @IsOptional()
  @IsBoolean()
  is_default?: boolean;

  @IsOptional()
  @IsInt()
  @Type(() => Number)
  @Min(1)
  location_id?: number;
}

/**
 * Abrir sesión de KDS. Sin montos a propósito: la sesión de caja custodia
 * dinero, la de KDS custodia responsabilidad sobre el consumo de insumos.
 */
export class OpenKdsSessionDto {
  @IsInt()
  @Type(() => Number)
  @Min(1)
  kds_id!: number;
}

export class CloseKdsSessionDto {
  @IsOptional()
  @IsString()
  @MaxLength(1000)
  closing_notes?: string;
}
