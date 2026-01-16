import { IsOptional, IsInt, IsBoolean, IsEnum, IsString, Min } from 'class-validator';
import { Transform, Type } from 'class-transformer';
import { template_config_type_enum } from '@prisma/client';

export class TemplateQueryDto {
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  page?: number = 1;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  limit?: number = 10;

  @IsOptional()
  @IsString()
  search?: string;

  @IsOptional()
  @IsEnum(template_config_type_enum)
  configuration_type?: template_config_type_enum;

  @IsOptional()
  @Transform(({ value }) => value === 'true')
  @IsBoolean()
  is_active?: boolean;

  @IsOptional()
  @Transform(({ value }) => value === 'true')
  @IsBoolean()
  is_system?: boolean;

  @IsOptional()
  @IsString()
  sort_by?: string = 'created_at';

  @IsOptional()
  @IsEnum(['asc', 'desc'] as const)
  sort_order?: 'asc' | 'desc' = 'desc';
}
