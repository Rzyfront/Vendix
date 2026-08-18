import { ApiProperty } from '@nestjs/swagger';
import { IsBoolean, IsInt, IsOptional, IsString, Max, Min } from 'class-validator';
import { Transform, Type } from 'class-transformer';

/**
 * Búsqueda de artículos del centro de ayuda.
 *
 * Existe como DTO —y no como `@Query('q')` suelto— porque el catálogo de rutas
 * del agente publica los campos leyendo la metadata de class-validator del DTO.
 * Sin él, `help-center/articles/search` aparecía como una ruta sin parámetros y
 * Vexi solo sabía de `q` porque el system prompt se lo decía a mano.
 */
export class ArticleSearchQueryDto {
  @ApiProperty({
    description:
      'Palabras a buscar. Se parte en palabras sueltas y se buscan todas: ' +
      'basta con una o dos palabras clave ("multitarifa", "ajustar stock"), ' +
      'no hace falta escribir la pregunta completa.',
  })
  @IsString()
  q!: string;

  @ApiProperty({
    required: false,
    description: 'Cuántos artículos devolver como máximo. Por defecto 10.',
  })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(50)
  limit?: number;

  @ApiProperty({
    required: false,
    description:
      'Devolver el texto completo de cada artículo. Por defecto falso: la ' +
      'búsqueda responde con título, resumen y un adelanto, y el artículo ' +
      'entero se lee con GET /help-center/articles/{slug}.',
  })
  @IsOptional()
  @Transform(({ value }) =>
    typeof value === 'string' ? value === 'true' : value,
  )
  @IsBoolean()
  include_content?: boolean;
}
