import { IsString, MaxLength, MinLength } from 'class-validator';

/**
 * Query DTO for `GET /ecommerce/geocoding/forward`.
 *
 * `q` is the free-text address the customer typed (e.g. "Calle 70 4-83,
 * Bogotá"). Bounded length keeps abusive/huge queries off the provider; the
 * service further trims/collapses whitespace and biases the search to Colombia.
 */
export class ForwardGeocodeDto {
  @IsString({ message: 'q must be a string' })
  @MinLength(3, { message: 'q must be at least 3 characters' })
  @MaxLength(200, { message: 'q must be at most 200 characters' })
  q!: string;
}
