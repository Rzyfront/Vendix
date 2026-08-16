import { IsInt, IsNumber, IsPositive, Max, Min } from 'class-validator';
import { Type } from 'class-transformer';

/**
 * Primer año gravable con UVT. La unidad nace con la Ley 863 de 2003 y empieza a
 * regir en 2006, así que un año anterior no puede tener valor publicado: no es
 * una cota arbitraria, es el punto donde la figura existe.
 */
export const UVT_MIN_YEAR = 2006;

/**
 * Cota superior deliberadamente holgada. Su trabajo es garantizar cuatro dígitos
 * y descartar basura (`0`, `-5`, `20260`), no adivinar hasta cuándo existirá la
 * UVT. Una cota pegada al año en curso caducaría sola y bloquearía el registro
 * anticipado que la DIAN publica cada noviembre para el año siguiente — un
 * bloqueo que aparecería un 1 de enero, sin que nadie hubiera tocado el código.
 */
export const UVT_MAX_YEAR = 2100;

/**
 * Techo del valor en pesos. `uvt_values.value_cop` es `Decimal(12,2)`, así que a
 * partir de 10^10 el dato ya no cabe en la columna y Postgres responde «numeric
 * field overflow»: otro 500 por una entrada que se puede rechazar en la puerta.
 */
export const UVT_MAX_VALUE_COP = 9_999_999_999.99;

/**
 * Alta/actualización del valor en pesos de la UVT para un año gravable.
 *
 * Existe como CLASE y no como el tipo inline que había antes
 * (`@Body() body: { year: number; value_cop: number }`) porque `ValidationPipe`
 * valida contra los metadatos que dejan los decoradores, y un tipo inline se
 * borra al compilar: el handler quedaba literalmente sin validación. Con él,
 * `{"year":"dosmil"}` viajaba crudo hasta el campo `Int` de Prisma y `{}` dejaba
 * `value_cop` en `undefined`, que `new Prisma.Decimal(undefined)` convertía en
 * `[DecimalError] Invalid argument`. Ambos terminaban en 500 sobre lo que en
 * realidad es una petición mal formada.
 *
 * El endpoint hace upsert por año, de modo que un año equivocado no crea basura
 * nueva: PISA el valor bueno de otro año. Por eso la cota inferior importa tanto
 * como el tipo.
 */
export class CreateUvtValueDto {
  @Type(() => Number)
  @IsInt({
    message:
      'year debe ser un año gravable de 4 dígitos, sin decimales (por ejemplo, 2026).',
  })
  @Min(UVT_MIN_YEAR, {
    message: `year debe ser ${UVT_MIN_YEAR} o posterior: la UVT rige desde el año gravable ${UVT_MIN_YEAR}.`,
  })
  @Max(UVT_MAX_YEAR, {
    message: `year no puede ser posterior a ${UVT_MAX_YEAR}.`,
  })
  year: number;

  @Type(() => Number)
  @IsNumber(
    { maxDecimalPlaces: 2 },
    {
      message:
        'value_cop debe ser un número en pesos con máximo 2 decimales (por ejemplo, 52000).',
    },
  )
  @IsPositive({
    message: 'value_cop debe ser mayor que cero: la UVT nunca vale 0 pesos.',
  })
  @Max(UVT_MAX_VALUE_COP, {
    message: `value_cop excede el máximo almacenable (${UVT_MAX_VALUE_COP} COP).`,
  })
  value_cop: number;
}
