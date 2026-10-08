import { IsOptional, IsString, MaxLength, MinLength } from 'class-validator';

/**
 * Query DTO for `GET /ecommerce/geocoding/municipality-center`.
 * Visual map framing only: `city` is required, `state` disambiguates.
 */
export class MunicipalityCenterDto {
  @IsString({ message: 'city must be a string' })
  @MinLength(2, { message: 'city must be at least 2 characters' })
  @MaxLength(100, { message: 'city must be at most 100 characters' })
  city!: string;

  @IsOptional()
  @IsString({ message: 'state must be a string' })
  @MaxLength(100, { message: 'state must be at most 100 characters' })
  state?: string;
}
