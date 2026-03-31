import { IsString, IsOptional } from 'class-validator';

export class SwitchEnvironmentDto {
  @IsString()
  target_environment: string;

  @IsOptional()
  @IsString()
  store_slug?: string;
}
