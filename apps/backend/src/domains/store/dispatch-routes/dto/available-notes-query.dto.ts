import {
  ArrayMaxSize,
  IsInt,
  IsOptional,
  IsString,
  MaxLength,
  Min,
} from 'class-validator';
import { Transform } from 'class-transformer';

/**
 * Query de `GET /store/dispatch-routes/available-notes` (selector de remisiones
 * del wizard de planilla y del modal "Agregar remisiones").
 *
 * `limit` no se valida con `@Max`: el servicio lo recorta a
 * `AVAILABLE_NOTES_MAX_LIMIT` para no romper clientes que pidan de más.
 */
export class AvailableNotesQueryDto {
  @IsOptional()
  @Transform(({ value }) => parseInt(value))
  @IsInt()
  @Min(1)
  page?: number;

  @IsOptional()
  @Transform(({ value }) => parseInt(value))
  @IsInt()
  @Min(1)
  limit?: number;

  @IsOptional()
  @IsString()
  @MaxLength(100)
  search?: string;

  /**
   * Ids puntuales (`?ids=12,34`): el wizard los usa para resolver el prefill
   * de "crear ruta desde una remisión" sin depender de que la remisión caiga
   * en la primera página. Se combina con el resto de filtros (una remisión
   * bloqueada no se devuelve aunque se pida por id).
   */
  @IsOptional()
  @Transform(({ value }) =>
    (Array.isArray(value) ? value : String(value ?? '').split(','))
      .map((v) => parseInt(String(v).trim(), 10))
      .filter((n) => Number.isInteger(n) && n > 0),
  )
  @IsInt({ each: true })
  @ArrayMaxSize(100)
  ids?: number[];
}
