import { IsInt, IsOptional, IsString } from 'class-validator';

export class CreateProviderDto {
  @IsInt()
  employee_id: number;

  @IsOptional()
  @IsString()
  display_name?: string;

  @IsOptional()
  @IsString()
  avatar_url?: string;

  @IsOptional()
  @IsString()
  bio?: string;
}
