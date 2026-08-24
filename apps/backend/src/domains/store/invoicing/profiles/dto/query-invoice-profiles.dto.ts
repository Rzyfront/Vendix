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

import {
  INVOICE_PROFILE_OPERATION_TYPES,
  INVOICE_PROFILE_STATES,
} from './invoice-profile.constants';

/**
 * Filtros del listado.
 *
 * Cada campo que entra por acá llega al `where` de Prisma, así que un campo sin
 * validador de forma no produce «filtro ignorado» sino un 500 —el mismo defecto
 * que `QueryInvoiceDto` documenta para `sort_by` y `page`—. Por eso no hay
 * `sort_by`: el listado ordena por `updated_at desc` en el servicio, sin que el
 * cliente pueda nombrar una columna.
 */
export class QueryInvoiceProfilesDto {
  @IsOptional()
  @IsString()
  @MaxLength(150)
  search?: string;

  @IsOptional()
  @IsIn(INVOICE_PROFILE_OPERATION_TYPES)
  operation_type?: string;

  @IsOptional()
  @IsIn(INVOICE_PROFILE_STATES)
  state?: string;

  /** `@Min(1)`: el servicio calcula `skip = (page - 1) * limit` y `?page=0` daba un OFFSET negativo. */
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
export class QueryProfileVersionsDto {
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
