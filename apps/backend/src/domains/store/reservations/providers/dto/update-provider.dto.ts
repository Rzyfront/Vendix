import { IsBoolean, IsInt, IsOptional, IsString } from 'class-validator';

export class UpdateProviderDto {
  @IsOptional()
  @IsString()
  display_name?: string;

  @IsOptional()
  @IsString()
  avatar_url?: string;

  @IsOptional()
  @IsString()
  bio?: string;

  @IsOptional()
  @IsBoolean()
  is_active?: boolean;

  @IsOptional()
  @IsInt()
  sort_order?: number;

  /** Preferred station (S10): must be linked to the provider; `null` clears it. */
  @IsOptional()
  @IsInt()
  default_station_id?: number | null;
}
