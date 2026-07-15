import { Type } from 'class-transformer';
import { IsNumber, Max, Min } from 'class-validator';

/**
 * Query DTO for `GET /ecommerce/geocoding/reverse`.
 *
 * The URL carries the coordinates as `lat` and `lng` query params
 * (e.g. `?lat=4.65&lng=-74.05`). The global `ValidationPipe`
 * (`transform: true`, `enableImplicitConversion: true`) coerces the raw
 * query strings to numbers via `@Type(() => Number)` before validation.
 *
 * Range guards here produce a 400 (mapped to `SYS_VALIDATION_001` by
 * `AllExceptionsFilter`) for out-of-range coordinates; the controller
 * re-checks the range as defense-in-depth.
 */
export class ReverseGeocodeDto {
  @Type(() => Number)
  @IsNumber({}, { message: 'lat must be a number' })
  @Min(-90, { message: 'lat must be between -90 and 90' })
  @Max(90, { message: 'lat must be between -90 and 90' })
  lat!: number;

  @Type(() => Number)
  @IsNumber({}, { message: 'lng must be a number' })
  @Min(-180, { message: 'lng must be between -180 and 180' })
  @Max(180, { message: 'lng must be between -180 and 180' })
  lng!: number;
}
