import { IsString, IsOptional, IsNumber, IsBoolean, MaxLength } from 'class-validator';
import { Type } from 'class-transformer';

export class CreateCategoryDto {
  @IsString()
  @MaxLength(100)
  name: string;

  @IsOptional()
  @IsString()
  @MaxLength(500)
  description?: string;

  @IsOptional()
  @IsString()
  @MaxLength(50)
  icon?: string;

  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  sort_order?: number;

  @IsOptional()
  @IsBoolean()
  is_active?: boolean;
}
