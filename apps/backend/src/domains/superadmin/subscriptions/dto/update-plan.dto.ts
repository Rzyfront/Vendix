import { PartialType } from '@nestjs/mapped-types';
import { IsBoolean, IsOptional, IsString, MaxLength } from 'class-validator';
import { CreatePlanDto } from './plan.dto';

export class UpdatePlanDto extends PartialType(CreatePlanDto) {
  @IsOptional()
  @IsBoolean()
  is_free?: boolean;

  @IsOptional()
  @IsString()
  @MaxLength(64)
  redemption_code?: string | null;
}
