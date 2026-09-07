import { Type } from 'class-transformer';
import {
  IsIn,
  IsInt,
  IsOptional,
  IsString,
  Max,
  MaxLength,
  Min,
} from 'class-validator';

import { QUOTATION_PROFILE_STATES } from './quotation-profile.constants';

/**
 * Filtros del listado. Cada campo llega al `where` de Prisma, así que todo
 * campo lleva validador de forma (un campo sin validador no produce «filtro
 * ignorado» sino un 500). Sin `sort_by`: el servicio ordena por
 * `updated_at desc`, sin que el cliente pueda nombrar una columna.
 */
export class QueryQuotationProfilesDto {
  @IsOptional()
  @IsString()
  @MaxLength(150)
  search?: string;

  @IsOptional()
  @IsIn(QUOTATION_PROFILE_STATES)
  state?: string;

  /** `@Min(1)`: el servicio calcula `skip = (page - 1) * limit`. */
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  page?: number = 1;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(200)
  limit?: number = 20;
}

/** Paginación del historial de versiones. Sin filtros: el historial es completo por definición. */
export class QueryQuotationProfileVersionsDto {
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  page?: number = 1;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(100)
  limit?: number = 20;
}
