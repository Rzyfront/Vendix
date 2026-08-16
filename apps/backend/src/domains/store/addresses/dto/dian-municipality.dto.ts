import { IsInt, IsOptional, IsString, Max, MaxLength, Min } from 'class-validator';
import { ApiPropertyOptional } from '@nestjs/swagger';
import { Transform } from 'class-transformer';

/**
 * Query de `GET /store/addresses/dian/municipalities`.
 *
 * El catálogo son 1122 municipios: no caben en un `<select>` ni conviene
 * mandarlos enteros en cada carga de un formulario de dirección. El selector
 * teclea y esta query filtra.
 */
export class DianMunicipalityQueryDto {
  @ApiPropertyOptional({
    example: 'medell',
    description:
      'Texto libre: código DANE, nombre del municipio o nombre del departamento. Sin tildes ni mayúsculas obligatorias.',
  })
  @IsOptional()
  @IsString()
  @MaxLength(100)
  search?: string;

  @ApiPropertyOptional({
    example: 20,
    description: 'Tamaño de página (1-50). Por defecto 20.',
  })
  @IsOptional()
  @Transform(({ value }) => (value === '' || value == null ? undefined : parseInt(value, 10)))
  @IsInt()
  @Min(1)
  @Max(50)
  limit?: number;
}

/**
 * Query de `GET /store/addresses/dian/municipalities/resolve`.
 *
 * Sirve al camino del geocodificador: Nominatim devuelve nombres («Medellín»,
 * «Antioquia») y NUNCA el código DANE, así que tras un reverse-geocode hay que
 * traducir esos nombres a Divipola. Ambos campos son obligatorios de facto: sin
 * departamento el nombre del municipio es ambiguo entre departamentos.
 */
export class DianMunicipalityResolveQueryDto {
  @ApiPropertyOptional({
    example: 'Medellín',
    description: 'Nombre del municipio tal como lo devolvió el geocodificador.',
  })
  @IsOptional()
  @IsString()
  @MaxLength(100)
  city?: string;

  @ApiPropertyOptional({
    example: 'Antioquia',
    description:
      'Departamento: nombre («Antioquia») o código DANE de 2 dígitos («05»).',
  })
  @IsOptional()
  @IsString()
  @MaxLength(100)
  department?: string;
}
