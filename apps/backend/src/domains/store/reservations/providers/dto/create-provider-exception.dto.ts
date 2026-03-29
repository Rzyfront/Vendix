import { IsBoolean, IsOptional, IsString } from 'class-validator';

export class CreateProviderExceptionDto {
  @IsString()
  date: string;

  @IsOptional()
  @IsBoolean()
  is_unavailable?: boolean = true;

  @IsOptional()
  @IsString()
  custom_start_time?: string;

  @IsOptional()
  @IsString()
  custom_end_time?: string;

  @IsOptional()
  @IsString()
  reason?: string;
}
