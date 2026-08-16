import {
  IsString,
  IsOptional,
  IsNumber,
  IsBoolean,
  IsArray,
  IsInt,
  MaxLength,
  Min,
  Max,
  ArrayMaxSize,
} from 'class-validator';
import { Type, Transform } from 'class-transformer';

export class QueryAccountDto {
  @IsOptional()
  @IsString()
  @MaxLength(100)
  search?: string;

  @IsOptional()
  @IsString()
  @MaxLength(20)
  account_type?: string;

  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  parent_id?: number;

  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  level?: number;

  @IsOptional()
  @Transform(({ value }) => value === 'true' || value === true)
  @IsBoolean()
  accepts_entries?: boolean;

  @IsOptional()
  @Transform(({ value }) => value === 'true' || value === true)
  @IsBoolean()
  is_active?: boolean;

  @IsOptional()
  @Transform(({ value }) => value === 'true' || value === true)
  @IsBoolean()
  tree?: boolean;

  /**
   * Hidratación de preselección del selector de cuentas. Una pantalla que
   * ya tiene N cuentas elegidas las pide por id en un solo round-trip
   * (`?ids=1,2,3&limit=N`), así el selector abre con TODAS visibles, no
   * sólo las 5 primeras del ranking por código ascendente. Vacío o ausente:
   * el comportamiento histórico (paginado por `search` u `offset`).
   *
   * Sin este campo, una pantalla que ya guardó 100 subcuentas sólo podía
   * recargar 5 y el resto quedaba invisible hasta que el usuario tipeara
   * el código exacto. La UI del selector sí lo manda —el backend era el que
   * lo descartaba.
   */
  @IsOptional()
  @Transform(({ value }) => {
    if (Array.isArray(value)) return value.map((v) => Number(v));
    if (typeof value === 'string') return value.split(',').map((v) => Number(v.trim()));
    return value;
  })
  @IsArray()
  @ArrayMaxSize(500, {
    message:
      'El selector de cuentas no admite más de 500 ids por petición. Si necesitas más, divide la pantalla.',
  })
  @IsInt({ each: true })
  ids?: number[];

  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  @Min(1)
  @Max(1000)
  limit?: number;

  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  @Min(0)
  offset?: number;
}
