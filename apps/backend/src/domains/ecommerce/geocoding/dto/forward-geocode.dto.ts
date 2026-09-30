import {
  IsOptional,
  IsString,
  Matches,
  MaxLength,
  MinLength,
} from 'class-validator';

/**
 * Query DTO for `GET /ecommerce/geocoding/forward`.
 *
 * `q` is the free-text address the customer typed (e.g. "Calle 70 4-83,
 * Bogotá"). Bounded length keeps abusive/huge queries off the provider; the
 * service further trims/collapses whitespace and biases the search to Colombia.
 *
 * `city`/`state` are OPTIONAL and purely additive — the current frontend only
 * ever sends `q` (see `GeocodingService.forward`, which parses them out of
 * `q` itself via `parseFreeTextQuery` when they are omitted), so existing
 * callers keep working unchanged. Passing them explicitly lets a future
 * caller that already knows the city (e.g. a selected municipality dropdown)
 * skip that parsing and feed the DANE-intersection/structured-search steps
 * directly.
 */
export class ForwardGeocodeDto {
  @IsString({ message: 'q must be a string' })
  @MinLength(3, { message: 'q must be at least 3 characters' })
  @MaxLength(200, { message: 'q must be at most 200 characters' })
  q!: string;

  @IsOptional()
  @IsString({ message: 'city must be a string' })
  @MaxLength(120, { message: 'city must be at most 120 characters' })
  city?: string;

  @IsOptional()
  @IsString({ message: 'state must be a string' })
  @MaxLength(120, { message: 'state must be at most 120 characters' })
  state?: string;

  /**
   * DANE municipality code (5 digits, e.g. "11001" for Bogotá). Optional —
   * when present it pins the municipality bounding box exactly instead of
   * resolving it from `city`/`state` text, and skips city-name matching
   * ambiguity (e.g. two municipalities sharing a name in different states).
   */
  @IsOptional()
  @IsString({ message: 'municipality_code must be a string' })
  @Matches(/^\d{5}$/, { message: 'municipality_code must be exactly 5 digits' })
  municipality_code?: string;
}
