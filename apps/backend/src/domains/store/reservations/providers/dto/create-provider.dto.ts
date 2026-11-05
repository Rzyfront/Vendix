import { IsInt, IsOptional, IsString } from 'class-validator';

export class CreateProviderDto {
  /** Store user (non-customer) who provides the service. Preferred. */
  @IsOptional()
  @IsInt()
  user_id?: number;

  /** Legacy: payroll employee. Used only when `user_id` is absent. */
  @IsOptional()
  @IsInt()
  employee_id?: number;

  @IsOptional()
  @IsString()
  display_name?: string;

  @IsOptional()
  @IsString()
  avatar_url?: string;

  @IsOptional()
  @IsString()
  bio?: string;

  /** Preferred station (S10). The provider is linked to it on creation. */
  @IsOptional()
  @IsInt()
  default_station_id?: number | null;
}
