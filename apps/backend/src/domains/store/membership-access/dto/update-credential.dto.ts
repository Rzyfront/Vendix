import { IsBoolean, IsOptional, IsString, MaxLength } from 'class-validator';
import { Transform } from 'class-transformer';

/**
 * DTO to update an existing access credential (rotate value / toggle active).
 */
export class UpdateCredentialDto {
  @IsOptional()
  @IsString()
  @MaxLength(255)
  credential_value?: string;

  @IsOptional()
  @IsBoolean()
  @Transform(({ value }) =>
    typeof value === 'string' ? value === 'true' : value,
  )
  is_active?: boolean;
}
