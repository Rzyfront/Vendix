import { Type } from 'class-transformer';
import {
  IsIn,
  IsInt,
  Matches,
  IsObject,
  IsOptional,
  IsString,
  Max,
  MaxLength,
  Min,
  ValidateNested,
} from 'class-validator';

/**
 * E.4 (F-069) — snapshot de flags del motor al momento de la selección.
 * Todo opcional: superficies viejas mandan solo rank_mode.
 */
export class SearchSelectionFlagsDto {
  @IsOptional()
  l1?: boolean;

  @IsOptional()
  l2?: boolean;

  @IsOptional()
  trigram?: boolean;

  // Capa efectiva del rank (meta.search.layer); es la señal de flags que el
  // cliente sí conoce (l1/l2/trigram crudos viven solo en backend).
  @IsOptional()
  @IsString()
  @MaxLength(16)
  layer?: string;
}

/**
 * E.4 (F-069) — evento de selección del buscador (CTR-por-posición).
 *
 * La query cruda NUNCA viaja: `query_hash` es sha256-hex de la query
 * normalizada (lowercase + trim + espacios colapsados), calculada en el
 * cliente. `position` es 1-based dentro de la grilla visible al elegir.
 */
export class LogSearchSelectionDto {
  @IsString()
  @Matches(/^[0-9a-f]{64}$/, {
    message: 'query_hash must be a sha256 hex string',
  })
  query_hash!: string;

  @IsInt()
  @Type(() => Number)
  @Min(1)
  @Max(500)
  position!: number;

  @IsInt()
  @Type(() => Number)
  @Min(1)
  product_id!: number;

  @IsInt()
  @Type(() => Number)
  @Min(1)
  @Max(100000)
  result_count!: number;

  @IsString()
  @IsIn(['ranked', 'unranked_scan_cap', 'unranked_error', 'legacy'])
  rank_mode!: 'ranked' | 'unranked_scan_cap' | 'unranked_error' | 'legacy';

  @IsOptional()
  @IsObject()
  @ValidateNested()
  @Type(() => SearchSelectionFlagsDto)
  flags?: SearchSelectionFlagsDto;

  @IsOptional()
  @IsString()
  @MaxLength(16)
  surface?: string;
}
