import { Transform } from 'class-transformer';
import { IsBoolean, IsOptional } from 'class-validator';

/**
 * Query del listado de resoluciones. Las archivadas se ocultan por defecto.
 * El `@Transform` lee el valor crudo (`obj[key]`) porque la conversión implícita
 * del ValidationPipe volvería `Boolean('false')` en `true`.
 */
export class ListResolutionsQueryDto {
  @IsOptional()
  @Transform(({ obj, key }) => obj[key] === true || obj[key] === 'true')
  @IsBoolean()
  include_archived?: boolean;
}
