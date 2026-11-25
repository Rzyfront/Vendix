import {
  IsOptional,
  IsString,
  IsInt,
  Min,
  Max,
  MaxLength,
  IsEnum,
  IsIn,
  ValidateBy,
} from 'class-validator';
import { Type, Transform } from 'class-transformer';

/**
 * Tope máximo de identificadores permitidos en `GET /ecommerce/catalog?ids=...`.
 *
 * Va alineado con el `@Max(100)` de `limit`: la página pública de servicios
 * pide hasta `MAX_LISTED_SERVICES` (60) ids en una sola llamada y, con un tope
 * menor, respondía 400 y la página caía en «no disponible».
 */
export const MAX_CATALOG_QUERY_IDS = 100;

function hasAtMostMaxCatalogIds(value: unknown): boolean {
  if (typeof value !== 'string') return false;
  const parts = value
    .split(',')
    .map((part) => part.trim())
    .filter((part) => part.length > 0);
  return parts.length <= MAX_CATALOG_QUERY_IDS;
}

export enum ProductSortBy {
  NAME = 'name',
  PRICE_ASC = 'price_asc',
  PRICE_DESC = 'price_desc',
  NEWEST = 'newest',
  OLDEST = 'oldest',
  BEST_SELLING = 'best_selling',
}

export class CatalogQueryDto {
  // D.3 (ADR-09, ERR-16, F-024): mismo hardening que B.1 en ProductQueryDto.
  // Overlong → 400 SYS_VALIDATION_001; el storefront clampa a 200 (nunca 400
  // por tipeo) y min-length en service evita scans de 1 char.
  @IsOptional()
  @Transform(({ value }) =>
    typeof value === 'string' ? value.trim() || undefined : value,
  )
  @IsString()
  @MaxLength(200)
  search?: string;

  @IsOptional()
  @IsInt()
  @Type(() => Number)
  @Min(1)
  category_id?: number;

  @IsOptional()
  @IsString()
  category_ids?: string;

  @IsOptional()
  @IsInt()
  @Type(() => Number)
  @Min(1)
  brand_id?: number;

  @IsOptional()
  @IsString()
  brand_ids?: string;

  @IsOptional()
  @IsInt()
  @Type(() => Number)
  @Min(0)
  min_price?: number;

  @IsOptional()
  @IsInt()
  @Type(() => Number)
  @Min(0)
  max_price?: number;

  @IsOptional()
  @IsEnum(ProductSortBy)
  sort_by?: ProductSortBy = ProductSortBy.NEWEST;

  @IsOptional()
  @IsInt()
  @Type(() => Number)
  @Min(1)
  page?: number = 1;

  @IsOptional()
  @IsInt()
  @Type(() => Number)
  @Min(1)
  @Max(100)
  limit?: number = 20;

  /** Lista CSV de IDs de productos (máx. 100, igual que `limit`, para evitar respuestas gigantes en el endpoint público). */
  @IsOptional()
  @IsString()
  // El tope real es la cantidad de ids (100). El largo se deja holgado para no
  // rechazar 100 ids válidos largos, pero acotado para que un valor absurdo
  // (`1,,,,…`) no llegue al parser.
  @MaxLength(2400)
  @ValidateBy({
    name: 'maxCatalogIds',
    validator: {
      validate: (value: unknown) => hasAtMostMaxCatalogIds(value),
      defaultMessage: () =>
        `ids admite máximo ${MAX_CATALOG_QUERY_IDS} identificadores`,
    },
  })
  ids?: string;

  @IsOptional()
  @IsString()
  has_discount?: string;

  @IsOptional()
  @IsString()
  is_featured?: string;

  @IsOptional()
  @IsString()
  fill?: string;

  /** Opcional: cuando es 'true', incluye las variantes con precio resuelto en el listado. */
  @IsOptional()
  @IsIn(['true', 'false'])
  include_variants?: string;
}
